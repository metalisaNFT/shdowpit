/**
 * The AI backend.
 *
 * SECURITY CONTRACT — read before changing anything in this file.
 *
 *  - The OpenAI API key lives ONLY in the `keyStore` closure below, in this
 *    process's memory. It is never written to disk, never returned to the
 *    browser, never logged, and never placed in an error message.
 *  - `sanitiseError` is the only path by which a provider failure reaches the
 *    client. It maps to a fixed vocabulary of strings. Upstream error bodies
 *    are never forwarded, because OpenAI echoes the key prefix in some of them.
 *  - Restarting the process forgets the key. That is intended.
 *
 * This same handler is mounted as Vite middleware in dev and preview
 * (see vite.config.ts) and by server/index.mjs as a standalone server, so
 * there is exactly one implementation of the security contract.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopEngineSync } from '../local-ai-engine/lib.mjs';

const OPENAI_BASE = 'https://api.openai.com/v1';
const TEXT_MODEL = process.env.SHDOWPIT_TEXT_MODEL ?? 'gpt-4o-mini';
const IMAGE_MODEL = process.env.SHDOWPIT_IMAGE_MODEL ?? 'gpt-image-1';
const TIMEOUT_MS = 45_000;

/* ============================================================
   LOCAL AI ENGINE (side-by-side provider)
   ============================================================

   A separate, fully local service in ../local-ai-engine (llama.cpp +
   stable-diffusion.cpp behind one small Node server on 127.0.0.1:11435).
   This handler routes per request:

     provider: 'openai'  — the existing path above. THE DEFAULT. Untouched.
     provider: 'local'   — the local engine. No key involved, ever.
     provider: 'auto'    — local first, then OpenAI (order configurable via
                           autoOrder: 'local_first' | 'openai_first').

   THE SECURITY CONTRACT EXTENDS HERE: the OpenAI key is never sent to the
   local engine. Local requests carry the placeholder `Bearer local`.
*/

const ENGINE_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'local-ai-engine');
const ENGINE_CONFIG = path.join(ENGINE_DIR, 'config', 'config.json');
const ENGINE_PORT_FILE = path.join(ENGINE_DIR, 'config', 'port.json');
const ENGINE_PROGRESS = path.join(ENGINE_DIR, 'logs', 'install-progress.json');
const ENGINE_INSTALLER = path.join(ENGINE_DIR, 'install.mjs');
const LOCAL_TEXT_TIMEOUT_MS = Number(process.env.SHDOWPIT_LOCAL_TEXT_TIMEOUT ?? 45_000);
const LOCAL_IMAGE_TIMEOUT_MS = Number(process.env.SHDOWPIT_LOCAL_IMAGE_TIMEOUT ?? 300_000);

function localPort() {
  try {
    return Number(JSON.parse(fs.readFileSync(ENGINE_PORT_FILE, 'utf8')).port) || 11435;
  } catch {
    return 11435;
  }
}

function localBaseUrl() {
  return `http://127.0.0.1:${localPort()}`;
}

function localInstalled() {
  try {
    return fs.existsSync(ENGINE_CONFIG);
  } catch {
    return false;
  }
}

/** Health is cached briefly so AUTO routing costs ~nothing per request. */
const localHealthCache = { at: 0, value: null };

async function localHealth(force = false) {
  if (!force && Date.now() - localHealthCache.at < 4000) return localHealthCache.value;
  let value = { running: false };
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(`${localBaseUrl()}/health`, { signal: ac.signal });
    clearTimeout(t);
    const json = await res.json();
    if (res.ok && json?.server === 'shdowpit-local-ai') {
      value = {
        running: true,
        status: json.status,
        textReady: Boolean(json.text?.ready),
        imageReady: Boolean(json.image?.ready),
        textModel: json.text?.model ?? '',
        imageModel: json.image?.model ?? '',
        device: json.device ?? '',
        accel: json.accel ?? {},
        port: json.port,
      };
    }
  } catch {
    /* not running — an expected condition */
  }
  localHealthCache.at = Date.now();
  localHealthCache.value = value;
  return value;
}

function normalizeProvider(p) {
  return p === 'local' || p === 'auto' ? p : 'openai';
}

/** Ordered candidate list for a request. */
async function providerOrder(body) {
  const want = normalizeProvider(body?.provider);
  if (want === 'openai') return ['openai'];
  if (want === 'local') return ['local'];
  const openaiFirst = body?.autoOrder === 'openai_first';
  const h = await localHealth();
  if (openaiFirst) return keyStore.key ? ['openai', 'local'] : ['local'];
  // local_first (the default): only try local when it looks alive; a dead
  // engine costs one cached health probe, not a request timeout.
  return h.running ? ['local', 'openai'] : ['openai', 'local'];
}

async function localTextCall(body) {
  const system = String(body?.system ?? '').slice(0, 6000);
  const user = String(body?.user ?? '').slice(0, 12000);
  const maxTokens = Math.min(1024, Math.max(16, Number(body?.maxTokens) || 300));
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), LOCAL_TEXT_TIMEOUT_MS);
    const res = await fetch(`${localBaseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        // A harmless placeholder — NEVER an OpenAI key. See the contract above.
        Authorization: 'Bearer local',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local-fast',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: typeof body?.temperature === 'number' ? body.temperature : 0.9,
        ...(body?.json ? { response_format: { type: 'json_object' } } : {}),
        ...(body?.priority ? { priority: body.priority } : {}),
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: localErrorText(json), code: json?.error?.code ?? 'local_error' };
    }
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (!text) return { ok: false, error: 'Local AI returned nothing', code: 'empty' };
    return { ok: true, text, latencyMs: Date.now() - t0, provider: 'local' };
  } catch (err) {
    const timeout = err?.name === 'AbortError';
    return {
      ok: false,
      error: timeout ? 'Local AI timed out' : 'Local AI engine not running',
      code: timeout ? 'GENERATION_TIMEOUT' : 'LOCAL_AI_NOT_RUNNING',
    };
  }
}

async function localImageCall(body) {
  const prompt = String(body?.prompt ?? '').slice(0, 2000);
  // The local engine tops out at 768; the game's 1024 default maps to 512.
  const size = body?.size === '256x256' ? '256x256' : '512x512';
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), LOCAL_IMAGE_TIMEOUT_MS);
    const res = await fetch(`${localBaseUrl()}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: 'Bearer local', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local-image-fast',
        prompt,
        size,
        n: 1,
        // b64 keeps the portrait pipeline identical to the OpenAI path: the
        // browser stores a data URL and the save never depends on the engine
        // still running later.
        response_format: 'b64_json',
        ...(body?.seed !== undefined ? { seed: body.seed } : {}),
        ...(body?.priority ? { priority: body.priority } : {}),
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: localErrorText(json), code: json?.error?.code ?? 'local_error' };
    }
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, error: 'Local AI returned no image', code: 'empty' };
    return { ok: true, dataUrl: `data:image/png;base64,${b64}`, latencyMs: Date.now() - t0, provider: 'local' };
  } catch (err) {
    const timeout = err?.name === 'AbortError';
    return {
      ok: false,
      error: timeout ? 'Local image generation timed out' : 'Local AI engine not running',
      code: timeout ? 'GENERATION_TIMEOUT' : 'LOCAL_AI_NOT_RUNNING',
    };
  }
}

/** Local-engine errors carry no secrets, but keep the strings short + fixed-ish. */
function localErrorText(json) {
  const code = json?.error?.code ?? 'local_error';
  const msg = String(json?.error?.message ?? 'Local AI error').slice(0, 140);
  return `Local AI: ${msg}${code ? ` (${code})` : ''}`;
}

function isLoopback(req) {
  const a = req?.socket?.remoteAddress ?? '';
  return /^(::1|127\.|::ffff:127\.)/.test(a);
}

function pingEngine(pathname, timeoutMs = 1500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(`${localBaseUrl()}${pathname}`, { method: 'POST', signal: ac.signal })
    .catch(() => null)
    .finally(() => clearTimeout(t));
}

function spawnInstaller(extraArgs, logName) {
  try {
    fs.mkdirSync(path.join(ENGINE_DIR, 'logs'), { recursive: true });
    const out = fs.openSync(path.join(ENGINE_DIR, 'logs', logName), 'a');
    const child = spawn(process.execPath, [ENGINE_INSTALLER, ...extraArgs], {
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
    child.unref();
    return child.pid ?? 0;
  } catch {
    return 0;
  }
}

function runInstaller(extraArgs, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    try {
      execFile(process.execPath, [ENGINE_INSTALLER, ...extraArgs], { timeout: timeoutMs, windowsHide: true }, (err, stdout) =>
        resolve({ ok: !err, out: String(stdout ?? '') })
      );
    } catch {
      resolve({ ok: false, out: '' });
    }
  });
}

function readInstallProgress() {
  try {
    return JSON.parse(fs.readFileSync(ENGINE_PROGRESS, 'utf8'));
  } catch {
    return null;
  }
}

/* ============================================================
   in-memory key store
   ============================================================ */

const keyStore = {
  /** @type {string|null} */
  key: null,
  /** true once a real call to OpenAI has succeeded with this key */
  verified: false,
  connectedAt: 0,
};

/**
 * An env key is a convenience for local dev only. It is still only ever held
 * in memory and never echoed back.
 */
if (process.env.OPENAI_API_KEY) {
  keyStore.key = process.env.OPENAI_API_KEY;
  keyStore.connectedAt = Date.now();
}

/** Shape check only — never a substring of the key, never logged. */
function looksLikeKey(k) {
  return typeof k === 'string' && /^sk-[A-Za-z0-9_\-]{16,}$/.test(k.trim());
}

/* ============================================================
   mock provider (tests only)
   ============================================================ */

/**
 * With SHDOWPIT_AI_MOCK=1 the backend answers from a canned provider instead
 * of calling OpenAI. This exists so the success path — generated title,
 * taunts, chronicle, portrait, caching, portrait evolution — can be tested in
 * CI without a real key or a real bill.
 *
 * The mock deliberately returns a title that CLAIMS FIRE ("THE ASHEN").
 * That is the point: the client-side validator must accept it only for a
 * nemesis who actually has burn scars, and reject it for one who does not.
 * (It is "THE ASHEN" and not "THE CINDER-EYED" because the latter asserts two
 * facts — fire and a lost eye — and would be rejected for a merely burned
 * enemy. Which is the guard behaving correctly, but a poor test fixture.)
 */
const MOCK = process.env.SHDOWPIT_AI_MOCK === '1';

// A 4x4 solid PNG. Small enough to be free, real enough to be an image.
const MOCK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQIW2NkYGD4z8DAwMgAB' +
  'aMCowKjAqMCAAoAAwAB/pB7AAAAAElFTkSuQmCC';

async function mockRoute(path, body) {
  await new Promise((r) => setTimeout(r, 120));
  if (path === '/api/ai/test') return { ok: true, connected: true, latencyMs: 120 };
  if (path === '/api/ai/image') {
    return { ok: true, dataUrl: `data:image/png;base64,${MOCK_PNG}`, latencyMs: 120 };
  }
  if (path === '/api/ai/text') {
    const user = String(body?.user ?? '');
    if (/Give .* a title/.test(user)) return { ok: true, text: 'THE ASHEN', latencyMs: 120 };
    if (/Write 3 things/.test(user)) {
      return {
        ok: true,
        text: 'You die exactly the way I remember.\nStand still.\nThis ends quiet.',
        latencyMs: 120,
      };
    }
    return {
      ok: true,
      text: 'You met them in the pit and left them standing. They have not forgotten it.',
      latencyMs: 120,
    };
  }
  return null;
}

/* ============================================================
   error sanitising
   ============================================================ */

/**
 * Map any failure to a short, safe, useful string. Never include the upstream
 * body: OpenAI's 401 payload contains a redacted-but-recognisable key prefix.
 * @returns {{error: string, code: string}}
 */
function sanitiseError(err, status) {
  if (status === 401 || status === 403) return { error: 'Invalid API key', code: 'auth' };
  if (status === 429) return { error: 'Rate limited — too many requests', code: 'rate_limit' };
  if (status === 404) return { error: 'API unavailable — model not found', code: 'model' };
  if (status && status >= 500) return { error: 'API unavailable', code: 'upstream' };
  if (status && status >= 400) return { error: 'API rejected the request', code: 'bad_request' };

  const name = err?.name ?? '';
  const msg = String(err?.message ?? '');
  if (name === 'AbortError' || /abort|timeout/i.test(msg)) {
    return { error: 'Request timed out', code: 'timeout' };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(msg)) {
    return { error: 'Network unavailable', code: 'network' };
  }
  return { error: 'API unavailable', code: 'unknown' };
}

/* ============================================================
   OpenAI calls
   ============================================================ */

async function callOpenAI(path, body, method = 'POST') {
  if (!keyStore.key) {
    const e = new Error('not connected');
    e.shdowpitStatus = 401;
    throw e;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(OPENAI_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${keyStore.key}`,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    // Deliberately discard the body. See the security contract above.
    const e = new Error('upstream ' + res.status);
    e.shdowpitStatus = res.status;
    throw e;
  }
  return res.json();
}

/* ============================================================
   routes
   ============================================================ */

/* ---- provider-specific calls, shared by the routed endpoints ---- */

async function openaiTextCall(body) {
  if (MOCK && keyStore.key) {
    const mocked = await mockRoute('/api/ai/text', body);
    if (mocked) {
      keyStore.verified = true;
      return { ...mocked, provider: 'openai' };
    }
  }
  if (!keyStore.key) return { ok: false, error: 'No API key connected', code: 'no_key' };
  const system = String(body?.system ?? '').slice(0, 6000);
  const user = String(body?.user ?? '').slice(0, 12000);
  const maxTokens = Math.min(1200, Math.max(16, Number(body?.maxTokens) || 300));
  if (!user) return { ok: false, error: 'Empty request', code: 'bad_request' };

  try {
    const t0 = Date.now();
    const json = await callOpenAI('/chat/completions', {
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: typeof body?.temperature === 'number' ? body.temperature : 0.9,
      response_format: body?.json ? { type: 'json_object' } : undefined,
    });
    keyStore.verified = true;
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (!text) return { ok: false, error: 'API returned nothing', code: 'empty' };
    return { ok: true, text, latencyMs: Date.now() - t0, provider: 'openai' };
  } catch (err) {
    const s = sanitiseError(err, err?.shdowpitStatus);
    return { ok: false, ...s };
  }
}

async function openaiImageCall(body) {
  if (MOCK && keyStore.key) {
    const mocked = await mockRoute('/api/ai/image', body);
    if (mocked) {
      keyStore.verified = true;
      return { ...mocked, provider: 'openai' };
    }
  }
  if (!keyStore.key) return { ok: false, error: 'No API key connected', code: 'no_key' };
  const prompt = String(body?.prompt ?? '').slice(0, 4000);
  if (!prompt) return { ok: false, error: 'Empty prompt', code: 'bad_request' };
  const size = ['1024x1024', '1024x1536', '1536x1024'].includes(body?.size) ? body.size : '1024x1024';

  try {
    const t0 = Date.now();
    const json = await callOpenAI('/images/generations', {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size,
      // gpt-image-1 always returns b64_json; keeping the bytes server-side
      // of the browser means no third-party URL ends up in the save.
    });
    keyStore.verified = true;
    const b64 = json?.data?.[0]?.b64_json;
    const url = json?.data?.[0]?.url;
    if (b64) return { ok: true, dataUrl: `data:image/png;base64,${b64}`, latencyMs: Date.now() - t0, provider: 'openai' };
    if (url) return { ok: true, url, latencyMs: Date.now() - t0, provider: 'openai' };
    return { ok: false, error: 'API returned no image', code: 'empty' };
  } catch (err) {
    const s = sanitiseError(err, err?.shdowpitStatus);
    return { ok: false, ...s };
  }
}

const routes = {
  'GET /api/ai/status': async () => {
    const local = await localHealth();
    return {
      provider: 'openai',
      connected: Boolean(keyStore.key),
      verified: keyStore.verified,
      textModel: TEXT_MODEL,
      imageModel: IMAGE_MODEL,
      // Deliberately no key, no prefix, no length, no hash.
      local: {
        installed: localInstalled(),
        running: Boolean(local.running),
        textReady: Boolean(local.textReady),
        imageReady: Boolean(local.imageReady),
        port: local.port ?? localPort(),
      },
    };
  },

  'POST /api/ai/connect': async (body) => {
    const raw = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!looksLikeKey(raw)) {
      return { ok: false, connected: false, error: 'That does not look like an OpenAI key (sk-...)' };
    }
    keyStore.key = raw;
    keyStore.verified = false;
    keyStore.connectedAt = Date.now();
    return { ok: true, connected: true };
  },

  'POST /api/ai/disconnect': async () => {
    keyStore.key = null;
    keyStore.verified = false;
    keyStore.connectedAt = 0;
    return { ok: true, connected: false };
  },

  'POST /api/ai/test': async () => {
    if (!keyStore.key) {
      return { ok: false, connected: false, error: 'No API key connected' };
    }
    try {
      const t0 = Date.now();
      await callOpenAI('/models', null, 'GET');
      keyStore.verified = true;
      return { ok: true, connected: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      keyStore.verified = false;
      const s = sanitiseError(err, err?.shdowpitStatus);
      return { ok: false, connected: Boolean(keyStore.key), ...s };
    }
  },

  'POST /api/ai/text': async (body) => {
    const user = String(body?.user ?? '').slice(0, 12000);
    if (!user) return { ok: false, error: 'Empty request', code: 'bad_request' };
    const order = await providerOrder(body);
    let last = { ok: false, error: 'No AI provider available', code: 'no_provider' };
    for (const p of order) {
      last = p === 'local' ? await localTextCall(body) : await openaiTextCall(body);
      if (last.ok) return last;
    }
    return last;
  },

  'POST /api/ai/image': async (body) => {
    const prompt = String(body?.prompt ?? '').slice(0, 4000);
    if (!prompt) return { ok: false, error: 'Empty prompt', code: 'bad_request' };
    const order = await providerOrder(body);
    let last = { ok: false, error: 'No AI provider available', code: 'no_provider' };
    for (const p of order) {
      last = p === 'local' ? await localImageCall(body) : await openaiImageCall(body);
      if (last.ok) return last;
    }
    return last;
  },

  /* ============================================================
     LOCAL AI ENGINE management — the one-button UI drives these.
     POST routes are loopback-guarded: they spawn processes.
     ============================================================ */

  'GET /api/ai/local/status': async () => {
    const health = await localHealth(true);
    return {
      ok: true,
      installed: localInstalled(),
      running: Boolean(health.running),
      status: health.status ?? '',
      textReady: Boolean(health.textReady),
      imageReady: Boolean(health.imageReady),
      textModel: health.textModel ?? '',
      imageModel: health.imageModel ?? '',
      device: health.device ?? '',
      accel: health.accel ?? {},
      port: health.port ?? localPort(),
      baseUrl: `${localBaseUrl()}/v1`,
      progress: readInstallProgress(),
      dir: ENGINE_DIR,
    };
  },

  'POST /api/ai/local/heartbeat': async () => {
    await pingEngine('/heartbeat');
    return { ok: true };
  },

  'POST /api/ai/local/goodbye': async (_body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    await pingEngine('/goodbye');
    return { ok: true };
  },

  'POST /api/ai/local/install': async (body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    const prog = readInstallProgress();
    if (prog?.state === 'installing' && Date.now() - (prog.updatedAt ?? 0) < 15_000) {
      return { ok: true, already: true };
    }
    // Tests install the fake runtime; real installs download real models.
    const fake = process.env.SHDOWPIT_LOCAL_AI_FAKE_INSTALL === '1' || body?.fake === true;
    const pid = spawnInstaller(fake ? ['--fake'] : [], 'install.out.log');
    return pid ? { ok: true, pid } : { ok: false, error: 'Could not start the installer', code: 'SERVER_START_FAILED' };
  },

  'POST /api/ai/local/start': async (_body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    const pid = spawnInstaller(['--start'], 'install.out.log');
    return pid ? { ok: true } : { ok: false, error: 'Could not start the engine', code: 'SERVER_START_FAILED' };
  },

  'POST /api/ai/local/stop': async (_body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    const r = await runInstaller(['--stop']);
    localHealthCache.at = 0;
    return { ok: r.ok };
  },

  'POST /api/ai/local/restart': async (_body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    await runInstaller(['--stop']);
    localHealthCache.at = 0;
    const pid = spawnInstaller(['--start'], 'install.out.log');
    return pid ? { ok: true } : { ok: false, error: 'Could not restart the engine', code: 'SERVER_START_FAILED' };
  },

  'POST /api/ai/local/remove': async (body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    const argsList = body?.purgeModels ? ['--remove', '--purge-models'] : ['--remove'];
    const r = await runInstaller(argsList, 60_000);
    localHealthCache.at = 0;
    return { ok: r.ok };
  },

  'POST /api/ai/local/open-folder': async (_body, req) => {
    if (!isLoopback(req)) return { ok: false, error: 'Local requests only', code: 'forbidden' };
    const cmd =
      process.platform === 'win32' ? ['explorer', [ENGINE_DIR]] : process.platform === 'darwin' ? ['open', [ENGINE_DIR]] : ['xdg-open', [ENGINE_DIR]];
    try {
      const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not open the folder', code: 'unknown' };
    }
  },
};

/* ============================================================
   plumbing
   ============================================================ */

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Prompts are small; anything larger is a mistake or an attack.
      if (size > 256 * 1024) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
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

function send(res, status, payload) {
  const text = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

/**
 * Connect-style handler. Returns true if it handled the request.
 * Usable as Vite middleware and from a bare node http server.
 */
export async function handleAiRequest(req, res) {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/ai/')) return false;

  const routeKey = `${req.method} ${url}`;
  const route = routes[routeKey];
  if (!route) {
    send(res, 404, { ok: false, error: 'Unknown endpoint' });
    return true;
  }

  let body = {};
  if (req.method !== 'GET') {
    body = await readBody(req);
    if (body === null) {
      send(res, 400, { ok: false, error: 'Malformed request' });
      return true;
    }
  }

  // Mock still requires a "connection", so the tests exercise the same gating.
  // Text/image mocks moved INSIDE the OpenAI provider calls so provider
  // routing (OPENAI | LOCAL | AUTO) behaves identically under test.
  if (MOCK && keyStore.key && url === '/api/ai/test') {
    const mocked = await mockRoute(url, body);
    if (mocked) {
      keyStore.verified = true;
      send(res, 200, mocked);
      return true;
    }
  }

  try {
    const out = await route(body, req);
    send(res, 200, out);
  } catch (err) {
    // Never surface `err` itself — it may hold a request object with headers.
    send(res, 200, { ok: false, ...sanitiseError(err, err?.shdowpitStatus) });
  }
  return true;
}

let shutdownHooked = false;

/** Vite plugin form, used by vite.config.ts for both dev and preview. */
export function aiBackendPlugin() {
  const mount = (server) => {
    server.middlewares.use(async (req, res, next) => {
      const handled = await handleAiRequest(req, res);
      if (!handled) next();
    });
    const stop = () => {
      try {
        stopEngineSync();
      } catch {
        /* already gone */
      }
    };
    const hookClose = () => {
      server.httpServer?.once('close', stop);
    };
    hookClose();
    if (!shutdownHooked) {
      shutdownHooked = true;
      process.once('exit', stop);
    }
    // httpServer exists after internal middleware is installed.
    return hookClose;
  };
  return {
    name: 'shdowpit-ai-backend',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
