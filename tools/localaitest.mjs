/**
 * LOCAL AI ENGINE — the sprint's success checklist, automated.
 *
 * PART A drives the engine directly over HTTP: install, health, models, chat,
 * completions, grammar/JSON repair, image generation (URL + b64, 512 + 256),
 * caching, priorities, timeouts, OOM recovery, port conflicts, partial
 * readiness, supervisor restarts, error envelopes.
 *
 * PART B drives the built game in Chromium: provider modes OPENAI | LOCAL |
 * AUTO side-by-side with the mock OpenAI backend, the one-button install UI,
 * live provider switching with no restarts, and engine death not hurting the
 * game.
 *
 * The engine runs its FAKE runtime here (install.mjs --fake): identical
 * server code, canned inference. Real llama.cpp / sd binaries and models are
 * downloaded on the user's machine by the same installer.
 *
 *   npm run build && SHDOWPIT_AI_MOCK=1 npx vite preview --port 4173 &
 *   node tools/localaitest.mjs
 */

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE = path.join(ROOT, 'local-ai-engine');
const INSTALLER = path.join(ENGINE, 'install.mjs');
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const PREVIEW = URL_BASE.replace(/\/\?.*$/, '');
const FAKE_KEY = 'sk-' + 'M0ckM0ckM0ckM0ckM0ckM0ckM0ckM0ck';

const checks = [];
const errors = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[localai] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function log(...a) {
  console.log('[localai]', ...a);
}

function run(args, opts = {}) {
  return execFileSync(process.execPath, [INSTALLER, ...args], { encoding: 'utf8', timeout: 120_000, ...opts });
}

async function j(url, opts = {}) {
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null), res };
  } catch {
    // Mid-restart sockets are an expected condition in these tests.
    return { status: 0, json: null, res: null };
  }
}

function pngSize(buf) {
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function enginePort() {
  try {
    return Number(JSON.parse(fs.readFileSync(path.join(ENGINE, 'config', 'port.json'), 'utf8')).port) || 11435;
  } catch {
    return 11435;
  }
}

async function waitFor(fn, ms, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   PART A — the engine itself
   ============================================================ */

async function partA() {
  log('--- PART A: engine ---');

  // Clean slate: stop anything running and remove prior state.
  try {
    run(['--stop']);
  } catch {
    /* not running */
  }
  try {
    run(['--remove', '--purge-models']);
  } catch {
    /* not installed */
  }

  /* 1 — one-command install (fake runtime; same code path as real) */
  const out = run(['--fake']);
  check('installer completes and reports READY', /Status:\s+READY/.test(out), out.split('\n').slice(-6).join(' | '));
  const prog = JSON.parse(fs.readFileSync(path.join(ENGINE, 'logs', 'install-progress.json'), 'utf8'));
  check('all 12 install steps complete or skipped', prog.steps.every((s) => s.status === 'complete' || s.status === 'skipped'));
  check('progress file reports ready', prog.state === 'ready', prog.state);

  const base = `http://127.0.0.1:${enginePort()}`;

  /* 2 — health */
  const h = await j(`${base}/health`);
  check('/health returns ready', h.json?.status === 'ready', JSON.stringify(h.json?.status));
  check('/health identifies the engine + version + device', h.json?.server === 'shdowpit-local-ai' && Boolean(h.json?.version) && Boolean(h.json?.device));
  check('/health text and image blocks', h.json?.text?.ready === true && h.json?.image?.ready === true);

  /* 3 — models */
  const m = await j(`${base}/v1/models`);
  const ids = (m.json?.data ?? []).map((x) => x.id);
  check(
    '/v1/models lists local-fast, local-balanced, local-image-fast (owned_by local)',
    ids.includes('local-fast') && ids.includes('local-balanced') && ids.includes('local-image-fast') && (m.json?.data ?? []).every((x) => x.owned_by === 'local'),
    ids.join(',')
  );

  /* 4 — chat completions, OpenAI shape */
  const t0 = Date.now();
  const chat = await j(`${base}/v1/chat/completions`, {
    body: {
      model: 'local-fast',
      messages: [
        { role: 'system', content: 'You name monsters.' },
        { role: 'user', content: 'Give Vark a title' },
      ],
      temperature: 0.7,
      max_tokens: 128,
    },
  });
  const chatMs = Date.now() - t0;
  const c = chat.json;
  check(
    'chat completion has the OpenAI shape',
    c?.object === 'chat.completion' && typeof c?.id === 'string' && typeof c?.created === 'number' && c?.model === 'local-fast' && c?.choices?.[0]?.message?.role === 'assistant' && c?.choices?.[0]?.finish_reason === 'stop' && typeof c?.usage?.total_tokens === 'number'
  );
  check('chat completion returns content quickly', Boolean(c?.choices?.[0]?.message?.content) && chatMs < 10_000, `${chatMs}ms "${c?.choices?.[0]?.message?.content}"`);

  /* defaults: no max_tokens / temperature supplied */
  const chatDefaults = await j(`${base}/v1/chat/completions`, { body: { messages: [{ role: 'user', content: 'hi' }] } });
  check('chat works with engine defaults (temp 0.7 / 128 tokens)', chatDefaults.status === 200 && Boolean(chatDefaults.json?.choices?.[0]?.message?.content));

  /* 5 — plain completions */
  const comp = await j(`${base}/v1/completions`, { body: { model: 'local-fast', prompt: 'Say something.', max_tokens: 32 } });
  check('/v1/completions works', comp.status === 200 && typeof comp.json?.choices?.[0]?.text === 'string' && comp.json?.object === 'text_completion');

  /* 6 — structured JSON + local repair */
  const jgood = await j(`${base}/v1/chat/completions`, {
    body: { messages: [{ role: 'user', content: 'Name a nemesis.' }], response_format: { type: 'json_object' } },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(jgood.json?.choices?.[0]?.message?.content ?? '');
  } catch {
    parsed = null;
  }
  check('json_object responses parse', parsed !== null && typeof parsed.name === 'string', JSON.stringify(parsed));

  const jbad = await j(`${base}/v1/chat/completions`, {
    body: { messages: [{ role: 'user', content: 'INVALIDJSON please' }], response_format: { type: 'json_object' } },
  });
  let repaired = null;
  try {
    repaired = JSON.parse(jbad.json?.choices?.[0]?.message?.content ?? '');
  } catch {
    repaired = null;
  }
  check('broken model JSON is repaired locally (no second request)', repaired !== null && repaired.name === 'Vark', jbad.json?.choices?.[0]?.message?.content);

  /* 7 — image generation: URL path, 512x512 */
  const img = await j(`${base}/v1/images/generations`, {
    body: { model: 'local-image-fast', prompt: 'a scarred warlord, wanted poster', size: '512x512', n: 1, seed: 99 },
  });
  const url = img.json?.data?.[0]?.url ?? '';
  check('image generation returns a local URL', img.status === 200 && url.startsWith(`http://127.0.0.1:`), url);
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const size = pngSize(bytes);
  check('the URL serves a real 512x512 PNG', size?.w === 512 && size?.h === 512, JSON.stringify(size));

  /* 8 — b64_json + 256x256 */
  const img256 = await j(`${base}/v1/images/generations`, {
    body: { prompt: 'ultra fast portrait', size: '256x256', response_format: 'b64_json', seed: 5 },
  });
  const b64 = img256.json?.data?.[0]?.b64_json ?? '';
  const png256 = pngSize(Buffer.from(b64, 'base64'));
  check('b64_json + 256x256 works', png256?.w === 256 && png256?.h === 256, JSON.stringify(png256));

  /* 9 — deterministic cache */
  const tCache = Date.now();
  const img2 = await j(`${base}/v1/images/generations`, {
    body: { prompt: 'a scarred warlord, wanted poster', size: '512x512', seed: 99 },
  });
  check('same prompt+seed hits the cache (same URL, fast)', img2.json?.data?.[0]?.url === url && Date.now() - tCache < 1500, `${Date.now() - tCache}ms`);

  /* 10 — priority queue: a slow LOW job then a HIGH job; HIGH wins */
  const done = [];
  const slowLow = j(`${base}/v1/images/generations`, {
    body: { prompt: 'bg chronicle SLEEP:1500', size: '256x256', priority: 'low' },
  }).then(() => done.push('low1'));
  const slowLow2 = j(`${base}/v1/images/generations`, {
    body: { prompt: 'bg chronicle two SLEEP:1200', size: '256x256', priority: 'low' },
  }).then(() => done.push('low2'));
  await sleep(150); // low #1 is running, low #2 queued
  const high = j(`${base}/v1/images/generations`, {
    body: { prompt: 'current nemesis portrait SLEEP:100', size: '256x256', priority: 'high' },
  }).then(() => done.push('high'));
  await Promise.all([slowLow, slowLow2, high]);
  check('high priority overtakes queued low-priority work', done.indexOf('high') < done.indexOf('low2'), done.join(' -> '));

  /* 11 — timeouts produce GENERATION_TIMEOUT envelopes */
  const slow = await j(`${base}/v1/chat/completions`, {
    body: { messages: [{ role: 'user', content: 'SLEEP:3000' }], timeout_ms: 1000 },
  });
  check(
    'text timeout returns the OpenAI-like error envelope',
    slow.status === 504 && slow.json?.error?.code === 'GENERATION_TIMEOUT' && slow.json?.error?.type === 'local_ai_error',
    JSON.stringify(slow.json)
  );

  /* 12 — OOM: retried at reduced settings, then hard failure code */
  const oomRecovers = await j(`${base}/v1/images/generations`, {
    body: { prompt: 'FAKE_OOM huge scene', size: '512x512', seed: 3 },
  });
  check('image OOM retries once at reduced settings and succeeds', oomRecovers.status === 200 && Boolean(oomRecovers.json?.data?.[0]?.url));
  const oomAlways = await j(`${base}/v1/images/generations`, {
    body: { prompt: 'FAKE_OOM_ALWAYS', size: '512x512', seed: 4 },
  });
  check('unrecoverable OOM reports OUT_OF_MEMORY without crashing', oomAlways.json?.error?.code === 'OUT_OF_MEMORY');
  const stillUp = await j(`${base}/health`);
  check('engine is still healthy after OOM failures', stillUp.json?.status === 'ready');

  /* 13 — invalid requests */
  const bad = await j(`${base}/v1/chat/completions`, { body: { messages: 'nope' } });
  check('invalid body → INVALID_REQUEST', bad.status === 400 && bad.json?.error?.code === 'INVALID_REQUEST');
  const missing = await j(`${base}/v1/nothing`, { body: {} });
  check('unknown endpoint → error envelope', missing.status === 404 && missing.json?.error?.type === 'local_ai_error');
  const trav = await fetch(`${base}/generated/..%2fconfig%2fconfig.json`);
  check('path traversal on /generated is refused', trav.status === 404);

  /* 14 — port conflict: a FOREIGN service on 11435 pushes us to 11436 */
  run(['--stop']);
  const squatter = http.createServer((req, res) => res.end('not an ai engine'));
  await new Promise((r) => squatter.listen(11435, '127.0.0.1', r));
  run(['--start']);
  const movedPort = enginePort();
  const moved = await j(`http://127.0.0.1:${movedPort}/health`);
  check('foreign service on 11435 → engine relocates and reports its port', movedPort !== 11435 && moved.json?.server === 'shdowpit-local-ai', `port ${movedPort}`);
  await new Promise((r) => squatter.close(r));
  run(['--restart']);
  await waitFor(async () => (await j(`http://127.0.0.1:${enginePort()}/health`)).json?.status === 'ready', 15_000);
  check('engine reclaims 11435 once it is free', enginePort() === 11435);

  /* 15 — second start reuses the running engine (idempotent) */
  const again = run(['--start']);
  check('starting twice reuses the running engine', /already running/.test(again), again.trim());

  /* 16 — partial readiness: image disabled, text keeps working */
  const cfgPath = path.join(ENGINE, 'config', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.image.enabled = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  run(['--restart']);
  await waitFor(async () => (await j(`http://127.0.0.1:${enginePort()}/health`)).json?.text?.ready === true, 15_000);
  const partial = await j(`http://127.0.0.1:${enginePort()}/health`);
  check(
    'image-less install reports PARTIAL with an image error code',
    partial.json?.status === 'partial' && partial.json?.text?.ready === true && partial.json?.image?.ready === false && Boolean(partial.json?.image?.error),
    JSON.stringify(partial.json?.image)
  );
  const textStill = await j(`http://127.0.0.1:${enginePort()}/v1/chat/completions`, { body: { messages: [{ role: 'user', content: 'still there?' }] } });
  check('text generation still works without images', textStill.status === 200);
  const imgRefused = await j(`http://127.0.0.1:${enginePort()}/v1/images/generations`, { body: { prompt: 'x' } });
  check('image endpoint refuses cleanly when unavailable', imgRefused.status === 503 && Boolean(imgRefused.json?.error?.code));
  cfg.image.enabled = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  run(['--restart']);
  await waitFor(async () => (await j(`http://127.0.0.1:${enginePort()}/health`)).json?.status === 'ready', 15_000);

  /* 17 — text runtime supervision (POSIX only: uses pkill) */
  if (process.platform !== 'win32') {
    try {
      execFileSync('pkill', ['-f', 'fake-runtime.mjs llama'], { encoding: 'utf8' });
      await sleep(900); // let the engine notice the death (health goes un-ready)
      const back = await waitFor(async () => {
        const hh = await j(`http://127.0.0.1:${enginePort()}/health`);
        return hh.json?.text?.ready === true ? hh : null;
      }, 25_000);
      // Ready again is not enough — prove it with an actual generation.
      const gen = back
        ? await waitFor(async () => {
            const r = await j(`http://127.0.0.1:${enginePort()}/v1/chat/completions`, {
              body: { messages: [{ role: 'user', content: 'back from the dead?' }] },
            });
            return r.status === 200 ? r : null;
          }, 10_000)
        : null;
      check('killed text runtime is restarted by the supervisor', Boolean(gen));
    } catch {
      check('killed text runtime is restarted by the supervisor', false, 'pkill failed');
    }
  }

  /* 18 — no cloud: prove the model hosts are actually unreachable from here,
     then generate anyway. Once installed, the engine needs no internet. */
  const hfBlocked = await fetch('https://huggingface.co/', { signal: AbortSignal.timeout(4000) })
    .then((r) => !r.ok)
    .catch(() => true);
  const offlineGen = await j(`http://127.0.0.1:${enginePort()}/v1/chat/completions`, {
    body: { messages: [{ role: 'user', content: 'offline check' }] },
  });
  const offlineImg = await j(`http://127.0.0.1:${enginePort()}/v1/images/generations`, {
    body: { prompt: 'offline poster', size: '256x256', seed: 12 },
  });
  check(
    'text + image generation work with model hosts unreachable (offline once installed)',
    hfBlocked && offlineGen.status === 200 && offlineImg.status === 200,
    `hfBlocked=${hfBlocked}`
  );
}

/* ============================================================
   PART B — the game, side by side with OpenAI
   ============================================================ */

async function partB() {
  log('--- PART B: game integration ---');

  // The engine was left READY by part A. Remove it so the one-button UI can
  // install it from scratch (the preview server was started with
  // SHDOWPIT_LOCAL_AI_FAKE_INSTALL=1 so the button performs a --fake install).
  run(['--stop']);
  run(['--remove']);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (/sk-[A-Za-z0-9_-]{8,}/.test(m.text())) errors.push('KEY IN CONSOLE: ' + m.text());
  });

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await (await page.$('#title-screen button')).click();
  await page.waitForTimeout(1800);

  /* 19 — status carries the local block */
  const st = await j(`${PREVIEW}/api/ai/status`);
  check('/api/ai/status includes local engine info and keeps provider=openai', st.json?.provider === 'openai' && typeof st.json?.local?.installed === 'boolean', JSON.stringify(st.json?.local));

  /* 20 — the one-button UI, from NOT INSTALLED to RUNNING */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const panelText = await page.$eval('#pause-screen', (e) => e.textContent);
  check('AI panel shows PROVIDER chips and the LOCAL AI section', /PROVIDER/.test(panelText) && /LOCAL AI/.test(panelText));
  check('uninstalled state shows the one-button installer', /DOWNLOAD & RUN LOCAL AI ENGINE/.test(panelText));

  await page.$$eval('#pause-screen button', (els) => {
    els.find((e) => e.textContent.trim() === 'DOWNLOAD & RUN LOCAL AI ENGINE')?.click();
  });
  const installed = await waitFor(async () => {
    const s = await page.evaluate(() => window.SHDOWPIT.__localAIStatus());
    return s.installed && s.running && s.textReady ? s : null;
  }, 40_000, 600);
  check('one button → engine installed, running, text+image ready', Boolean(installed?.imageReady), JSON.stringify(installed));
  await page.waitForTimeout(1600); // let the panel poll once more
  const panelText2 = await page.$eval('#pause-screen', (e) => e.textContent);
  check('panel shows RUNNING with STOP/RESTART/OPEN FOLDER', /RUNNING|PARTIAL/.test(panelText2) && /STOP/.test(panelText2) && /RESTART/.test(panelText2) && /OPEN FOLDER/.test(panelText2));

  /* 21 — LOCAL provider generates with NO OpenAI key at all */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.SHDOWPIT.__setAIProvider('local'));
  await page.evaluate(() => window.SHDOWPIT.__setAIMode('full'));
  await page.evaluate(() => window.SHDOWPIT.__aiRefresh());
  await page.waitForTimeout(800);

  const roster = await page.evaluate(() => window.SHDOWPIT.__debug().listNemeses().map((n) => n.id));
  const target = roster[1];
  await page.evaluate((id) => window.SHDOWPIT.__debug().scarTarget(id), target); // burns, so THE ASHEN is accepted
  await page.waitForTimeout(400);
  await page.evaluate((id) => window.SHDOWPIT.__fireMyth(id, 'promoted_captain'), target);
  const localContent = await waitFor(async () => {
    const cnt = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), target);
    return cnt?.title === 'THE ASHEN' && cnt?.portraitIsGenerated ? cnt : null;
  }, 30_000, 800);
  check('LOCAL provider, no key: generated title reaches the game', localContent?.title === 'THE ASHEN', localContent?.title ?? '(none)');
  check('LOCAL provider, no key: generated portrait reaches the game', localContent?.portraitIsGenerated === true);

  /* 22 — the OpenAI path still works, side by side (mock) */
  const conn = await page.evaluate(
    (k) => fetch('/api/ai/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) }).then((r) => r.json()),
    FAKE_KEY
  );
  check('OpenAI (mock) connection still works alongside', conn.ok === true);
  const viaOpenAI = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'openai' } });
  check('provider=openai routes to OpenAI', viaOpenAI.json?.ok === true && viaOpenAI.json?.provider === 'openai');
  const viaLocal = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'local' } });
  check('provider=local routes to the engine (no key involved)', viaLocal.json?.ok === true && viaLocal.json?.provider === 'local');

  /* 23 — AUTO prefers local, falls back to OpenAI when the engine dies */
  const viaAuto = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'auto' } });
  check('AUTO uses the running local engine first', viaAuto.json?.ok === true && viaAuto.json?.provider === 'local');
  run(['--stop']);
  await sleep(4500); // outlive the server's health cache
  const autoFallback = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'auto' } });
  check('AUTO falls back to OpenAI when the engine is down', autoFallback.json?.ok === true && autoFallback.json?.provider === 'openai');
  const openaiFirst = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'auto', autoOrder: 'openai_first' } });
  check('AUTO honours OPENAI_FIRST ordering', openaiFirst.json?.ok === true && openaiFirst.json?.provider === 'openai');

  /* 24 — a dead engine on provider=local fails soft; the game keeps running */
  const deadLocal = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'local' } });
  check('provider=local with a dead engine fails gracefully', deadLocal.json?.ok === false && Boolean(deadLocal.json?.error));
  await page.evaluate((id) => window.SHDOWPIT.__fireMyth(id, 'killed_rival'), target);
  await page.waitForTimeout(2500);
  const alive = await page.evaluate(() => window.SHDOWPIT.__state());
  check('the game keeps playing while its local engine is dead', alive.mode === 'playing' && !alive.lastTickError, alive.lastTickError || 'clean');

  /* 25 — provider switching required no restart anywhere */
  run(['--start']);
  await waitFor(async () => (await j(`http://127.0.0.1:${enginePort()}/health`)).json?.text?.ready === true, 20_000);
  await page.evaluate(() => window.SHDOWPIT.__setAIProvider('auto'));
  await sleep(4500);
  const backLocal = await j(`${PREVIEW}/api/ai/text`, { body: { system: 's', user: 'ping', provider: 'auto' } });
  check('engine restarts and AUTO returns to local — all without reloading the game', backLocal.json?.ok === true && backLocal.json?.provider === 'local');

  const finalState = await page.evaluate(() => window.SHDOWPIT.__state());
  check('no frame errors across the whole scenario', !finalState.lastTickError, finalState.lastTickError || 'clean');

  await browser.close();
}

/* ============================================================
   run
   ============================================================ */

async function main() {
  // The preview must be up (with the mock OpenAI + fake local install envs).
  const probe = await fetch(`${PREVIEW}/api/ai/status`).then((r) => r.json()).catch(() => null);
  if (!probe) {
    console.error('preview server not reachable — start it first (see file header)');
    process.exit(2);
  }

  await partA();
  await partB();

  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ LOCAL AI ================');
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.log(`  FAIL ${f.name} — ${f.detail}`);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 8)) console.log('  ERR', e);
  process.exit(failed.length || errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error('localaitest failed:', e);
  process.exit(2);
});
