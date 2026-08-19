/**
 * LOCAL AI ENGINE — one lightweight local server.
 *
 *   GAME ──► http://127.0.0.1:11435
 *              ├── /health                     readiness (partial supported)
 *              ├── /v1/models                  local-fast, local-balanced, local-image-fast
 *              ├── /v1/chat/completions ──► llama-server (child process, kept warm)
 *              ├── /v1/completions      ──► llama-server
 *              ├── /v1/images/generations ─► sd (one process per image, so the
 *              │                             diffusion weights hold no memory
 *              │                             between requests)
 *              └── /generated/<id>.png        the images, served locally
 *
 * Design rules, straight from the brief:
 *   - binds 127.0.0.1 and nothing else unless the user edits config.json
 *   - never requires an account, an API key, or the internet once installed —
 *     this process makes NO outbound network calls; both runtimes read only
 *     local model files
 *   - text keeps working when images cannot (partial readiness)
 *   - failures answer in an OpenAI-shaped error envelope, never a crash
 *   - queues: text ≤2 in flight, images 1; priorities high > normal > low
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import {
  DIRS,
  ENGINE_DIR,
  PORT_PATH,
  PID_PATH,
  ensureDirs,
  loadConfig,
  logLine,
  httpJson,
  isOurEngine,
  sleep,
  killPidTree,
} from './lib.mjs';
import { ENGINE_VERSION, IMAGE_STYLE_SUFFIX, IMAGE_NEGATIVE_DEFAULT } from './manifest.mjs';

const cfg = loadConfig();
if (!cfg) {
  console.error('LOCAL_AI_NOT_INSTALLED — run `node local-ai-engine/install.mjs` first.');
  process.exit(3);
}
const FAKE = cfg.fakeRuntime || process.env.SHDOWPIT_LOCAL_AI_FAKE === '1';

const state = {
  port: cfg.port,
  startedAt: Date.now(),
  text: { ready: false, error: '', restarts: 0, warmupMs: 0 },
  image: { ready: false, error: cfg.image.enabled ? '' : 'IMAGE_BACKEND_UNAVAILABLE' },
  llama: /** @type {import('node:child_process').ChildProcess|null} */ (null),
  llamaPort: 0,
  shuttingDown: false,
  busy: 0,
};

const IDLE_MS = Math.max(0, Number(process.env.SHDOWPIT_LOCAL_AI_IDLE_SECONDS ?? cfg.idleTimeoutSeconds ?? 120) * 1000);
const GOODBYE_MS = Math.max(0, Number(process.env.SHDOWPIT_LOCAL_AI_GOODBYE_SECONDS ?? cfg.goodbyeDelaySeconds ?? 8) * 1000);

let lastClientAt = Date.now();
let goodbyeAt = 0;

function noteClient() {
  lastClientAt = Date.now();
  goodbyeAt = 0;
}

function scheduleGoodbye() {
  goodbyeAt = Date.now() + GOODBYE_MS;
}

/* ============================================================
   errors — one OpenAI-like envelope everywhere
   ============================================================ */

function errBody(message, code) {
  return { error: { message, type: 'local_ai_error', param: null, code } };
}

function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/* ============================================================
   minimal priority queue
   ============================================================ */

class Queue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.items = [];
    this.seq = 0;
  }

  /** priority: 0 high (current nemesis / killer), 1 normal, 2 low (background) */
  push(priority, job) {
    return new Promise((resolve) => {
      this.items.push({ priority, seq: this.seq++, job, resolve });
      this.items.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.pump();
    });
  }

  pump() {
    while (this.running < this.concurrency && this.items.length) {
      const it = this.items.shift();
      this.running++;
      it.job()
        .then((r) => it.resolve(r))
        .catch((e) => it.resolve({ status: 500, body: errBody(String(e?.message ?? e), 'IMAGE_GENERATION_FAILED') }))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}

const textQueue = new Queue(cfg.lowMemory ? 1 : 2);
const imageQueue = new Queue(cfg.image.concurrency || 1);

function priorityOf(body, req) {
  const p = String(body?.priority ?? req.headers['x-priority'] ?? 'normal').toLowerCase();
  return p === 'high' ? 0 : p === 'low' ? 2 : 1;
}

/* ============================================================
   llama-server child — the text runtime, kept warm
   ============================================================ */

async function freePort(from) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  return 0;
}

function llamaCommand(port) {
  if (FAKE) {
    return [process.execPath, [path.join(ENGINE_DIR, 'fake-runtime.mjs'), 'llama', String(port), path.basename(cfg.text.model || 'fake.gguf')]];
  }
  const args = [
    '-m', cfg.text.model,
    '--host', '127.0.0.1',
    '--port', String(port),
    '-c', String(cfg.lowMemory ? Math.min(1024, cfg.text.ctx) : cfg.text.ctx),
    '-np', String(cfg.lowMemory ? 1 : cfg.text.parallel),
    '--threads', String(cfg.threads),
  ];
  if (cfg.text.gpuLayers > 0) args.push('-ngl', String(cfg.text.gpuLayers));
  return [cfg.text.binary, args];
}

async function startLlama() {
  if (!cfg.text.enabled) {
    state.text.error = 'TEXT_MODEL_NOT_FOUND';
    return;
  }
  if (!FAKE && !fs.existsSync(cfg.text.model)) {
    state.text.error = 'TEXT_MODEL_NOT_FOUND';
    return;
  }
  if (!FAKE && !fs.existsSync(cfg.text.binary)) {
    state.text.error = 'TEXT_MODEL_LOAD_FAILED';
    return;
  }
  state.llamaPort = await freePort(state.port + 1);
  const [cmd, args] = llamaCommand(state.llamaPort);
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  state.llama = child;
  let stderrTail = '';
  child.stderr?.on('data', (c) => {
    stderrTail = (stderrTail + c.toString()).slice(-4000);
  });
  child.stdout?.on('data', () => {});
  child.on('exit', (code) => {
    state.text.ready = false;
    if (state.shuttingDown) return;
    logLine('engine.log', `llama exited code=${code} restarts=${state.text.restarts}`);
    if (state.text.restarts < 3) {
      // Transient: we are about to restart it. /health keeps saying
      // "starting" rather than scaring clients with a fatal error.
      state.text.error = '';
      state.text.restarts++;
      setTimeout(() => void startLlama(), 1500 * state.text.restarts);
    } else if (/out of memory|OOM/i.test(stderrTail)) {
      state.text.error = 'OUT_OF_MEMORY';
    } else {
      state.text.error = 'TEXT_MODEL_LOAD_FAILED';
    }
  });

  // Wait for the model to load; a 1.5B Q4 takes a moment, bigger boxes less.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !state.shuttingDown) {
    const h = await httpJson(`http://127.0.0.1:${state.llamaPort}/health`, { timeoutMs: 1500 });
    if (h.status === 200) {
      state.text.ready = true;
      state.text.error = '';
      await warmupText();
      return;
    }
    if (child.exitCode !== null) return; // supervisor will retry
    await sleep(500);
  }
}

/** One tiny request so the first REAL request does not pay the cold cost. */
async function warmupText() {
  const t0 = Date.now();
  const r = await httpJson(`http://127.0.0.1:${state.llamaPort}/v1/chat/completions`, {
    method: 'POST',
    timeoutMs: 60_000,
    body: {
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      max_tokens: 4,
      temperature: 0,
    },
  });
  state.text.warmupMs = Date.now() - t0;
  logLine('engine.log', `text warmup ${r.status === 200 ? 'ok' : 'failed'} ${state.text.warmupMs}ms`);
}

/* ============================================================
   image backend — verified at startup, run per request
   ============================================================ */

async function checkImageBackend() {
  if (!cfg.image.enabled) {
    state.image.ready = false;
    state.image.error = 'IMAGE_BACKEND_UNAVAILABLE';
    return;
  }
  if (!FAKE && !fs.existsSync(cfg.image.model)) {
    state.image.error = 'IMAGE_MODEL_NOT_FOUND';
    return;
  }
  const bin = FAKE ? process.execPath : cfg.image.binary;
  if (!FAKE && !fs.existsSync(bin)) {
    state.image.error = 'IMAGE_MODEL_LOAD_FAILED';
    return;
  }
  // Initialise the pipeline WITHOUT generating an image: `--help` proves the
  // binary loads (and pages it into the OS cache) at zero cost.
  const args = FAKE ? [path.join(ENGINE_DIR, 'fake-runtime.mjs'), 'sd', '--help'] : ['--help'];
  const ok = await new Promise((resolve) => {
    try {
      execFile(bin, args, { timeout: 20_000, windowsHide: true }, (err, _o, _e) => resolve(!err || err.code === 1));
    } catch {
      resolve(false);
    }
  });
  if (!ok) {
    state.image.error = 'IMAGE_MODEL_LOAD_FAILED';
    return;
  }
  state.image.ready = true;
  state.image.error = '';
}

const SIZES = new Set([256, 512, 768]);

function parseSize(s) {
  const m = /^(\d+)x(\d+)$/.exec(String(s ?? ''));
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!SIZES.has(w) || !SIZES.has(h)) return null;
  return { w, h };
}

function imageCacheKey(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
}

/** Run one sd generation. Retries once on OOM with reduced settings. */
async function generateImage({ prompt, negative, w, h, steps, seed, timeoutMs }) {
  const attempt = async (aw, ah, asteps) => {
    const id = `${imageCacheKey({ prompt, negative, aw, ah, asteps, seed, m: cfg.image.modelName })}.png`;
    const outPath = path.join(DIRS.generated, id);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return { ok: true, id, cached: true };
    }
    const tmp = outPath + '.tmp.png';
    const sdArgs = [
      '-m', cfg.image.model,
      '-p', prompt,
      '-n', negative,
      '--cfg-scale', String(cfg.image.cfgScale),
      '--steps', String(asteps),
      '-W', String(aw),
      '-H', String(ah),
      '-s', String(seed),
      '-t', String(cfg.threads),
      '-o', tmp,
    ];
    const [cmd, args] = FAKE
      ? [process.execPath, [path.join(ENGINE_DIR, 'fake-runtime.mjs'), 'sd', ...sdArgs]]
      : [cfg.image.binary, sdArgs];

    const res = await new Promise((resolve) => {
      let stderr = '';
      let timedOut = false;
      const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, timeoutMs);
      child.stderr?.on('data', (c) => {
        stderr = (stderr + c.toString()).slice(-4000);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr, timedOut });
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve({ code: -1, stderr: 'spawn failed', timedOut: false });
      });
    });

    if (res.timedOut) return { ok: false, code: 'GENERATION_TIMEOUT' };
    if (res.code !== 0 || !fs.existsSync(tmp)) {
      if (/out of memory|OOM|CUDA error|vk::.*DeviceLost|ErrorOutOfDeviceMemory/i.test(res.stderr)) {
        return { ok: false, code: 'OUT_OF_MEMORY' };
      }
      return { ok: false, code: 'IMAGE_GENERATION_FAILED' };
    }
    fs.renameSync(tmp, outPath);
    return { ok: true, id, cached: false };
  };

  let r = await attempt(w, h, steps);
  if (!r.ok && r.code === 'OUT_OF_MEMORY') {
    // Recovery ladder: 512 -> 256, then steps -> half (min 1). One retry.
    const rw = w > 256 ? 256 : w;
    const rh = h > 256 ? 256 : h;
    const rsteps = rw === w && rh === h ? Math.max(1, Math.floor(steps / 2)) : steps;
    logLine('engine.log', `image OOM — retrying at ${rw}x${rh} steps=${rsteps}`);
    r = await attempt(rw, rh, rsteps);
    if (r.ok) r.reduced = { w: rw, h: rh, steps: rsteps };
  }
  return r;
}

/* ============================================================
   JSON repair — fix trivial model formatting locally, never with a
   second LLM request
   ============================================================ */

export function repairJson(text) {
  const t = String(text ?? '');
  try {
    JSON.parse(t);
    return t;
  } catch {
    /* fall through */
  }
  let s = t;
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1];
  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  s = s.slice(start, end + 1);
  s = s
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .replace(/,\s*,+/g, ',') // doubled commas
    .replace(/[“”]/g, '"') // smart quotes
    .replace(/[‘’]/g, "'");
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

/* ============================================================
   route handlers
   ============================================================ */

function modelAlias(requested) {
  // The rest of the game never depends on a checkpoint filename: local-fast
  // and local-balanced both resolve to whatever is installed.
  return requested === 'local-balanced' ? 'local-balanced' : 'local-fast';
}

async function handleChat(body, req, isChat) {
  if (!state.text.ready) {
    return { status: 503, body: errBody('Local text model is not loaded.', state.text.error || 'TEXT_MODEL_LOAD_FAILED') };
  }
  if (isChat && !Array.isArray(body?.messages)) {
    return { status: 400, body: errBody('`messages` must be an array.', 'INVALID_REQUEST') };
  }
  if (!isChat && typeof body?.prompt !== 'string') {
    return { status: 400, body: errBody('`prompt` must be a string.', 'INVALID_REQUEST') };
  }

  const alias = modelAlias(body?.model);
  const maxTokens = clampInt(body?.max_tokens, 1, 1024, alias === 'local-balanced' ? 256 : cfg.text.defaultMaxTokens);
  const timeoutMs = clampInt(body?.timeout_ms, 1000, 180_000, cfg.text.timeoutMs);
  const wantsJson =
    body?.response_format?.type === 'json_object' || body?.response_format?.type === 'json_schema' || Boolean(body?.json_schema);

  const forward = {
    ...(isChat ? { messages: body.messages } : { prompt: body.prompt }),
    max_tokens: maxTokens,
    temperature: typeof body?.temperature === 'number' ? body.temperature : cfg.text.defaultTemperature,
    ...(body?.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body?.stop !== undefined ? { stop: body.stop } : {}),
    ...(body?.seed !== undefined ? { seed: body.seed } : {}),
    // llama-server enforces grammar-constrained JSON for these natively.
    ...(body?.response_format ? { response_format: body.response_format } : {}),
    ...(body?.json_schema ? { json_schema: body.json_schema } : {}),
    stream: false, // streaming is out of scope for the game's short outputs
  };

  state.busy++;
  const t0 = Date.now();
  const r = await textQueue.push(priorityOf(body, req), () =>
    httpJson(`http://127.0.0.1:${state.llamaPort}${isChat ? '/v1/chat/completions' : '/v1/completions'}`, {
      method: 'POST',
      body: forward,
      timeoutMs,
    })
  );
  state.busy--;
  const ms = Date.now() - t0;

  if (r.status === 0) {
    const timedOut = /abort/i.test(r.error ?? '');
    logLine('engine.log', `text ${isChat ? 'chat' : 'completion'} FAIL ${ms}ms ${timedOut ? 'timeout' : 'unreachable'}`);
    return timedOut
      ? { status: 504, body: errBody(`Text generation exceeded ${timeoutMs} ms.`, 'GENERATION_TIMEOUT') }
      : { status: 503, body: errBody('Text runtime is not responding.', 'TEXT_MODEL_LOAD_FAILED') };
  }
  if (r.status !== 200 || !r.json) {
    return { status: 502, body: errBody('Text runtime rejected the request.', 'TEXT_MODEL_LOAD_FAILED') };
  }

  const out = { ...r.json, model: alias };
  if (!out.id) out.id = `${isChat ? 'chatcmpl' : 'cmpl'}-${crypto.randomUUID().slice(0, 12)}`;
  if (!out.created) out.created = Math.floor(Date.now() / 1000);
  if (!out.object) out.object = isChat ? 'chat.completion' : 'text_completion';

  // Trivial JSON repair, locally. Never a second model call.
  if (wantsJson && isChat) {
    const content = out.choices?.[0]?.message?.content ?? '';
    try {
      JSON.parse(content);
    } catch {
      const fixed = repairJson(content);
      if (fixed !== null && out.choices?.[0]?.message) out.choices[0].message.content = fixed;
    }
  }

  logLine('engine.log', `text ${isChat ? 'chat' : 'completion'} ok ${ms}ms tok=${out.usage?.completion_tokens ?? '?'}`);
  return { status: 200, body: out };
}

async function handleImage(body, req) {
  if (!state.image.ready) {
    return { status: 503, body: errBody('Local image model is not loaded.', state.image.error || 'IMAGE_MODEL_NOT_READY') };
  }
  const prompt = String(body?.prompt ?? '').slice(0, 2000);
  if (!prompt) return { status: 400, body: errBody('`prompt` is required.', 'INVALID_REQUEST') };

  const size = parseSize(body?.size) ?? { w: cfg.image.defaultSize, h: cfg.image.defaultSize };
  const n = clampInt(body?.n, 1, 4, 1);
  const steps = clampInt(body?.steps, 1, 8, cfg.image.steps);
  const hasSeed = body?.seed !== undefined && body?.seed !== null && body?.seed !== -1;
  const timeoutMs = clampInt(body?.timeout_ms, 5000, 600_000, cfg.image.timeoutMs);
  const wantB64 = body?.response_format === 'b64_json';
  const styled =
    body?.raw_prompt === true || !cfg.image.style ? prompt : prompt + IMAGE_STYLE_SUFFIX;
  const negative = String(body?.negative_prompt ?? IMAGE_NEGATIVE_DEFAULT).slice(0, 1000);

  state.busy++;
  const data = [];
  try {
    for (let i = 0; i < n; i++) {
      // Deterministic content caches; random seeds never collide.
      const seed = hasSeed ? Number(body.seed) + i : crypto.randomInt(1, 2 ** 31);
      const t0 = Date.now();
      const r = await imageQueue.push(priorityOf(body, req), () =>
        generateImage({ prompt: styled, negative, w: size.w, h: size.h, steps, seed, timeoutMs })
      );
      const ms = Date.now() - t0;
      if (!r.ok) {
        logLine('engine.log', `image FAIL ${ms}ms ${r.code}`);
        const status = r.code === 'GENERATION_TIMEOUT' ? 504 : r.code === 'OUT_OF_MEMORY' ? 507 : 500;
        return { status, body: errBody(imageErrorMessage(r.code), r.code) };
      }
      logLine('engine.log', `image ok ${ms}ms ${size.w}x${size.h} steps=${steps}${r.cached ? ' (cache)' : ''}${r.reduced ? ' (reduced after OOM)' : ''}`);
      if (wantB64) {
        data.push({ b64_json: fs.readFileSync(path.join(DIRS.generated, r.id)).toString('base64') });
      } else {
        data.push({ url: `http://127.0.0.1:${state.port}/generated/${r.id}` });
      }
    }
    return { status: 200, body: { created: Math.floor(Date.now() / 1000), data } };
  } finally {
    state.busy--;
  }
}

function imageErrorMessage(code) {
  switch (code) {
    case 'GENERATION_TIMEOUT':
      return 'Image generation timed out.';
    case 'OUT_OF_MEMORY':
      return 'Image generation ran out of memory, even after reducing settings.';
    default:
      return 'Image generation failed.';
  }
}

function clampInt(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function healthBody() {
  const textReady = state.text.ready;
  const imageReady = state.image.ready;
  return {
    status: textReady && imageReady ? 'ready' : textReady || imageReady ? 'partial' : 'starting',
    server: 'shdowpit-local-ai',
    version: ENGINE_VERSION,
    device: cfg.device,
    accel: { text: cfg.textAccel, image: cfg.imageAccel },
    port: state.port,
    uptimeMs: Date.now() - state.startedAt,
    text: {
      ready: textReady,
      model: cfg.text.modelName,
      alias: 'local-fast',
      quantization: cfg.text.quantization,
      // `error` present = definitively failed; absent while loading/restarting.
      ...(textReady || !state.text.error ? {} : { error: state.text.error }),
    },
    image: {
      ready: imageReady,
      model: cfg.image.modelName,
      alias: 'local-image-fast',
      quantization: cfg.image.quantization,
      defaultSize: `${cfg.image.defaultSize}x${cfg.image.defaultSize}`,
      steps: cfg.image.steps,
      ...(imageReady || !state.image.error ? {} : { error: state.image.error }),
    },
  };
}

/* ============================================================
   HTTP server
   ============================================================ */

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        req.destroy();
        resolve(null);
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url !== '/goodbye') noteClient();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Priority',
    });
    return res.end();
  }

  if (req.method === 'GET' && url === '/health') return send(res, 200, healthBody());

  if (req.method === 'GET' && url === '/v1/models') {
    const data = [];
    if (cfg.text.enabled) {
      data.push({ id: 'local-fast', object: 'model', owned_by: 'local' });
      data.push({ id: 'local-balanced', object: 'model', owned_by: 'local' });
    }
    if (cfg.image.enabled) data.push({ id: 'local-image-fast', object: 'model', owned_by: 'local' });
    return send(res, 200, { object: 'list', data });
  }

  if (req.method === 'GET' && url.startsWith('/generated/')) {
    const name = path.basename(url); // no traversal: basename only
    const file = path.join(DIRS.generated, name);
    if (!/^[a-f0-9]{40}\.png$/.test(name) || !fs.existsSync(file)) {
      return send(res, 404, errBody('No such image.', 'INVALID_REQUEST'));
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'POST' && url === '/heartbeat') {
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/goodbye') {
    const remote = req.socket.remoteAddress ?? '';
    if (!/^(::1|127\.|::ffff:127\.)/.test(remote)) return send(res, 403, errBody('Forbidden.', 'INVALID_REQUEST'));
    scheduleGoodbye();
    return send(res, 200, { ok: true, delayMs: GOODBYE_MS });
  }

  if (req.method === 'POST' && url === '/shutdown') {
    // Loopback-only server, but double-check anyway.
    const remote = req.socket.remoteAddress ?? '';
    if (!/^(::1|127\.|::ffff:127\.)/.test(remote)) return send(res, 403, errBody('Forbidden.', 'INVALID_REQUEST'));
    send(res, 200, { ok: true });
    return void shutdown();
  }

  if (req.method === 'POST' && ['/v1/chat/completions', '/v1/completions', '/v1/images/generations'].includes(url)) {
    const body = await readBody(req);
    if (body === null) return send(res, 400, errBody('Malformed JSON body.', 'INVALID_REQUEST'));
    try {
      const out =
        url === '/v1/images/generations'
          ? await handleImage(body, req)
          : await handleChat(body, req, url === '/v1/chat/completions');
      return send(res, out.status, out.body);
    } catch (err) {
      logLine('engine.log', `unhandled ${url} ${String(err?.message ?? err)}`);
      return send(res, 500, errBody('Internal engine error.', url.includes('images') ? 'IMAGE_GENERATION_FAILED' : 'TEXT_MODEL_LOAD_FAILED'));
    }
  }

  send(res, 404, errBody(`No such endpoint: ${req.method} ${url}`, 'INVALID_REQUEST'));
});

async function shutdown() {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  logLine('engine.log', 'shutdown');
  try {
    if (state.llama?.pid) await killPidTree(state.llama.pid);
    else state.llama?.kill();
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

function maybeIdleShutdown() {
  if (state.shuttingDown || state.busy > 0) return;
  const now = Date.now();
  if (goodbyeAt && now >= goodbyeAt) {
    logLine('engine.log', 'game closed — shutting down');
    void shutdown();
    return;
  }
  if (IDLE_MS > 0 && now - lastClientAt >= IDLE_MS) {
    logLine('engine.log', `idle timeout ${Math.round(IDLE_MS / 1000)}s — shutting down`);
    void shutdown();
  }
}

setInterval(maybeIdleShutdown, 2000).unref();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// A failed image spawn or a dropped socket must never take the server down.
process.on('uncaughtException', (err) => logLine('engine.log', `uncaught ${String(err?.stack ?? err)}`));
process.on('unhandledRejection', (err) => logLine('engine.log', `unhandledRejection ${String(err)}`));

/* ============================================================
   startup — port conflict handling, banner, children
   ============================================================ */

async function main() {
  ensureDirs();
  const host = cfg.host || '127.0.0.1';

  const tryListen = (candidate) =>
    new Promise((resolve) => {
      const onErr = (err) => {
        server.removeListener('listening', onOk);
        if (err.code === 'EADDRINUSE') return resolve(false);
        console.error('SERVER_START_FAILED', err.message);
        process.exit(4);
      };
      const onOk = () => {
        server.removeListener('error', onErr);
        resolve(true);
      };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(candidate, host);
    });

  const base = cfg.port || 11435;
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    const candidate = base + i;
    // If the occupant is another copy of us, reuse it instead of relocating.
    if (await isOurEngine(candidate)) {
      console.log(`LOCAL AI ENGINE already running on 127.0.0.1:${candidate} — reusing it.`);
      process.exit(0);
    }
    if (await tryListen(candidate)) port = candidate;
    else logLine('engine.log', `port ${candidate} busy (foreign service), trying ${candidate + 1}`);
  }
  if (!port) {
    console.error('PORT_IN_USE — no free port found near 11435.');
    process.exit(4);
  }
  state.port = port;
  fs.writeFileSync(PORT_PATH, JSON.stringify({ port, host, pid: process.pid }));
  fs.writeFileSync(PID_PATH, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }));

  console.log('LOCAL AI ENGINE');
  console.log(`Text:               ${cfg.text.enabled ? `${cfg.text.modelName} (local-fast, ${cfg.text.quantization})` : 'disabled'}`);
  console.log(`Image:              ${cfg.image.enabled ? `${cfg.image.modelName} (local-image-fast, ${cfg.image.quantization})` : 'disabled'}`);
  console.log(`Device:             ${cfg.device}`);
  console.log(`Text acceleration:  ${cfg.textAccel}${FAKE ? ' (FAKE RUNTIME)' : ''}`);
  console.log(`Image acceleration: ${cfg.imageAccel}${FAKE ? ' (FAKE RUNTIME)' : ''}`);
  console.log(`Listening:          http://${host}:${port}  (loopback only by default)`);
  logLine('engine.log', `startup port=${port} fake=${FAKE} device="${cfg.device}"`);

  await Promise.all([startLlama(), checkImageBackend()]);
  logLine('engine.log', `ready text=${state.text.ready} image=${state.image.ready}`);
}

void main();
