/**
 * FAKE RUNTIME — test double for llama-server and the sd CLI.
 *
 * The engine's own logic (queueing, timeouts, caching, JSON repair, OOM
 * retry, health, ports) is exactly the code we need to prove, and none of it
 * cares whether a real model produced the bytes. In sandboxed CI — where the
 * multi-gigabyte runtimes and models cannot be downloaded — the installer's
 * `--fake` mode wires the engine to this file instead:
 *
 *   node fake-runtime.mjs llama <port>   speaks llama-server's HTTP surface
 *   node fake-runtime.mjs sd <args...>   mimics the sd CLI and writes a REAL
 *                                        PNG of the requested size
 *
 * Magic prompt tokens (tests only):
 *   SLEEP:<ms>        delay before answering (timeout paths)
 *   INVALIDJSON       return deliberately broken JSON (repair path)
 *   FAKE_OOM          sd: fail with an out-of-memory stderr unless <=256px
 *   FAKE_OOM_ALWAYS   sd: fail with OOM at any size (hard-failure path)
 *
 * Never shipped as a default — `fakeRuntime` is off unless a test turns it on.
 */

import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';

const mode = process.argv[2];

/* ============================================================
   tiny PNG encoder (truecolor, no deps)
   ============================================================ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgbAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgbAt(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ============================================================
   canned text — mirrors the OpenAI mock in server/aiHandler.mjs so the
   game-side fact validator accepts the output on the local path too
   ============================================================ */

function cannedAnswer(userText, wantJson) {
  if (wantJson) return '{"name":"Vark","title":"THE ASHEN","taunt":"I remember the fire."}';
  if (/Give .* a title/.test(userText)) return 'THE ASHEN';
  if (/Write 3 things/.test(userText)) {
    return 'You die exactly the way I remember.\nStand still.\nThis ends quiet.';
  }
  return 'You met them in the pit and left them standing. They have not forgotten it.';
}

function sleepToken(text) {
  const m = /SLEEP:(\d+)/.exec(text);
  return m ? Number(m[1]) : 0;
}

/* ============================================================
   llama-server double
   ============================================================ */

if (mode === 'llama') {
  const port = Number(process.argv[3]) || 11436;
  const model = process.argv[4] || 'fake-qwen2.5-1.5b-instruct-q4_k_m.gguf';

  const server = http.createServer((req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/v1/models') {
      return send(200, { object: 'list', data: [{ id: model, object: 'model', owned_by: 'llamacpp' }] });
    }
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/v1/completions')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: { message: 'bad json' } });
        }
        const isChat = req.url === '/v1/chat/completions';
        const userText = isChat
          ? (body.messages ?? []).map((m) => String(m.content ?? '')).join('\n')
          : String(body.prompt ?? '');
        const wantJson =
          body.response_format?.type === 'json_object' || body.response_format?.type === 'json_schema' || Boolean(body.json_schema);
        let content = /INVALIDJSON/.test(userText)
          ? '{"name": "Vark", "title": "THE ASHEN",, "taunt": "I remember the fire",}'
          : cannedAnswer(userText, wantJson);
        const delay = sleepToken(userText);
        const finish = () => {
          const usage = { prompt_tokens: Math.ceil(userText.length / 4), completion_tokens: Math.ceil(content.length / 4) };
          usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          send(
            200,
            isChat
              ? {
                  id: 'chatcmpl-fake',
                  object: 'chat.completion',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
                  usage,
                }
              : {
                  id: 'cmpl-fake',
                  object: 'text_completion',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, text: content, finish_reason: 'stop' }],
                  usage,
                }
          );
        };
        setTimeout(finish, 60 + delay);
      });
      return;
    }
    send(404, { error: { message: 'not found' } });
  });
  server.listen(port, '127.0.0.1', () => console.log(`[fake-llama] listening on ${port}`));
}

/* ============================================================
   sd CLI double
   ============================================================ */

if (mode === 'sd') {
  const args = process.argv.slice(3);
  const get = (flag, def = '') => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
  };
  if (args.includes('--help')) {
    console.log('usage: sd [fake]');
    process.exit(0);
  }
  const prompt = get('-p');
  const out = get('-o', 'out.png');
  const W = Number(get('-W', '512'));
  const H = Number(get('-H', '512'));
  const seed = Number(get('-s', '42'));
  const steps = Number(get('--steps', '4'));

  if (/FAKE_OOM_ALWAYS/.test(prompt) || (/FAKE_OOM/.test(prompt) && W > 256)) {
    console.error('ggml_backend_alloc: CUDA error: out of memory');
    process.exit(1);
  }

  const delay = sleepToken(prompt);
  setTimeout(() => {
    // Deterministic toxic-neon gradient from the seed — a real, valid PNG.
    const r0 = (seed * 2654435761) >>> 0;
    const png = encodePng(W, H, (x, y) => [
      (r0 >> 16) & 0x3f,
      64 + (((x * 191) / W) | 0) + ((r0 >> 8) & 0x1f),
      ((y * 96) / H + (r0 & 0x1f)) | 0,
    ]);
    fs.writeFileSync(out, png);
    console.log(`[fake-sd] wrote ${out} ${W}x${H} steps=${steps}`);
    process.exit(0);
  }, 140 + delay);
}

const runDirectly = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
  } catch {
    return false;
  }
})();
if (runDirectly && mode !== 'llama' && mode !== 'sd') {
  console.error('usage: fake-runtime.mjs llama <port> [model] | sd <sd-args...>');
  process.exit(2);
}
