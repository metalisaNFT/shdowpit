/**
 * Shared plumbing for the LOCAL AI ENGINE. Node built-ins only — the whole
 * engine deliberately has zero npm dependencies.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Self-contained layout. Nothing lands outside this directory. */
export const DIRS = {
  runtime: path.join(ENGINE_DIR, 'runtime'),
  runtimeText: path.join(ENGINE_DIR, 'runtime', 'llama'),
  runtimeImage: path.join(ENGINE_DIR, 'runtime', 'sd'),
  models: path.join(ENGINE_DIR, 'models'),
  modelsText: path.join(ENGINE_DIR, 'models', 'text'),
  modelsImage: path.join(ENGINE_DIR, 'models', 'image'),
  cache: path.join(ENGINE_DIR, 'cache'),
  generated: path.join(ENGINE_DIR, 'cache', 'generated'),
  config: path.join(ENGINE_DIR, 'config'),
  logs: path.join(ENGINE_DIR, 'logs'),
};

export const CONFIG_PATH = path.join(DIRS.config, 'config.json');
export const PORT_PATH = path.join(DIRS.config, 'port.json');
export const PID_PATH = path.join(DIRS.config, 'engine.pid');
export const PROGRESS_PATH = path.join(DIRS.logs, 'install-progress.json');

export function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

/* ============================================================
   config
   ============================================================ */

export function defaultConfig() {
  return {
    version: 1,
    /** NEVER default to 0.0.0.0 — the engine is a private local service. */
    host: '127.0.0.1',
    port: 11435,

    device: 'CPU',
    textAccel: 'CPU',
    imageAccel: 'CPU',
    threads: Math.max(1, Math.min(8, os.cpus().length)),

    text: {
      enabled: false,
      runtimeKey: '',
      binary: '',
      model: '',
      modelName: '',
      quantization: '',
      ctx: 2048,
      gpuLayers: 0,
      parallel: 2,
      defaultMaxTokens: 128,
      defaultTemperature: 0.7,
      timeoutMs: 15000,
    },
    image: {
      enabled: false,
      runtimeKey: '',
      binary: '',
      model: '',
      modelName: '',
      quantization: '',
      defaultSize: 512,
      steps: 4,
      cfgScale: 1.0,
      timeoutMs: 60000,
      concurrency: 1,
      style: true,
      /**
       * The image model is run as one process per generation, so its weights
       * are resident only WHILE an image is being made — effectively
       * "unload after 0 seconds idle". Kept as a config field for parity with
       * runtimes that hold the model resident.
       */
      unloadAfterSeconds: 0,
    },

    /** FAST MODE is the default: small models, low steps, short outputs. */
    fastMode: true,
    /** LOW MEMORY MODE: 256px default, 1 step, single text slot. */
    lowMemory: false,
    debug: false,
    /** test/dev only: substitute the runtimes with fake-runtime.mjs */
    fakeRuntime: false,

    /**
     * Shut the engine down if nothing talks to it for this long (game closed,
     * Vite killed, leftover from an old attempt). 0 disables. Generation,
     * /health, and /heartbeat all count as traffic.
     */
    idleTimeoutSeconds: 120,
    /** After the game tab sends /goodbye, wait this long so a refresh can cancel. */
    goodbyeDelaySeconds: 8,

    /** Per-install secret — required on mutating HTTP routes (A-11). */
    authToken: '',
  };
}

/** Mint or preserve the install token; persisted in config.json. */
export function ensureAuthToken(cfg) {
  if (!cfg.authToken) cfg.authToken = crypto.randomBytes(32).toString('hex');
  return cfg.authToken;
}

export function readAuthToken() {
  const cfg = loadConfig();
  return cfg?.authToken ?? '';
}

export function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const def = defaultConfig();
    return { ...def, ...raw, text: { ...def.text, ...raw.text }, image: { ...def.image, ...raw.image } };
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/* ============================================================
   logging — minimal on purpose
   ============================================================ */

const LOG_MAX = 1024 * 1024;

export function logLine(file, line) {
  try {
    ensureDirs();
    const p = path.join(DIRS.logs, file);
    try {
      if (fs.statSync(p).size > LOG_MAX) fs.truncateSync(p, 0);
    } catch {
      /* new file */
    }
    fs.appendFileSync(p, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break the engine */
  }
}

/* ============================================================
   hardware / platform detection
   ============================================================ */

export function detectPlatform() {
  const p = process.platform;
  const a = process.arch === 'arm64' ? 'arm64' : 'x64';
  return { os: p === 'win32' ? 'win' : p === 'darwin' ? 'mac' : 'linux', arch: a };
}

function execOut(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : String(stdout ?? ''));
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Best-effort GPU detection. Wrong answers here are recoverable — the engine
 * falls down the runtime candidate list if an accelerated binary will not
 * start — so this only has to be right most of the time, quickly.
 */
export async function detectGPU() {
  const { os: osName, arch } = detectPlatform();
  if (osName === 'mac') {
    return arch === 'arm64'
      ? { kind: 'metal', name: `Apple Silicon (${os.cpus()[0]?.model ?? 'arm64'})` }
      : { kind: 'none', name: '' };
  }
  const smi = await execOut('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  if (smi && smi.trim()) {
    return { kind: 'nvidia', name: smi.trim().split('\n')[0].trim() };
  }
  if (osName === 'win') {
    const ps = await execOut('powershell', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_VideoController).Name',
    ]);
    const names = (ps ?? '').toLowerCase();
    if (/radeon|amd/.test(names)) return { kind: 'amd', name: firstLine(ps) };
    if (/arc|intel/.test(names) && /arc/.test(names)) return { kind: 'intel', name: firstLine(ps) };
  }
  return { kind: 'none', name: '' };
}

function firstLine(s) {
  return String(s ?? '').trim().split('\n')[0].trim();
}

export function deviceLabel(gpu) {
  if (gpu.kind === 'nvidia' || gpu.kind === 'amd' || gpu.kind === 'intel' || gpu.kind === 'metal') {
    return gpu.name || gpu.kind.toUpperCase();
  }
  return `CPU (${os.cpus().length} threads, ${os.cpus()[0]?.model?.trim() ?? 'unknown'})`;
}

/* ============================================================
   disk space
   ============================================================ */

export async function freeDiskBytes(dir) {
  try {
    const s = await fsp.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return -1; // unknown — do not block the install on an unsupported statfs
  }
}

export function gb(n) {
  return `${(n / 1e9).toFixed(1)} GB`;
}

/* ============================================================
   resumable downloads
   ============================================================ */

/**
 * Download `url` to `dest` with resume, progress and verification.
 *
 *  - partial data lives in `dest.part`; an interrupted download resumes from
 *    its current byte count via a Range request, and completed files are never
 *    deleted or re-fetched (`expectedSize`/`sha256` decide validity).
 *  - stalls (no bytes for 45 s) abort the attempt; up to `retries` attempts.
 *  - sha256 is streamed during the final attempt when the manifest pins one.
 */
export async function download(url, dest, opts = {}) {
  const { expectedSize = 0, sha256 = '', label = path.basename(dest), onProgress = () => {}, retries = 3 } = opts;

  // Already valid? Then this is a no-op — the installer is idempotent.
  if (await fileLooksValid(dest, expectedSize)) {
    onProgress({ label, downloaded: expectedSize || fs.statSync(dest).size, total: expectedSize, done: true, skipped: true });
    return { ok: true, skipped: true };
  }

  const part = dest + '.part';
  let lastErr = 'MODEL_DOWNLOAD_FAILED';

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await downloadAttempt(url, dest, part, { expectedSize, sha256, label, onProgress });
    if (res.ok) return res;
    lastErr = res.code;
    if (res.fatal) break;
    await sleep(1200 * attempt);
  }
  return { ok: false, code: lastErr };
}

async function downloadAttempt(url, dest, part, { expectedSize, sha256, label, onProgress }) {
  let offset = 0;
  try {
    offset = fs.statSync(part).size;
  } catch {
    offset = 0;
  }

  const headers = { 'User-Agent': 'shdowpit-local-ai/1.0' };
  if (offset > 0) headers.Range = `bytes=${offset}-`;

  const ac = new AbortController();
  let stallTimer = null;
  const bumpStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => ac.abort(), 45_000);
  };

  let res;
  try {
    bumpStall();
    res = await fetch(url, { headers, signal: ac.signal, redirect: 'follow' });
  } catch (err) {
    clearTimeout(stallTimer);
    return { ok: false, code: abortName(err) };
  }

  if (res.status === 416) {
    // Range beyond EOF: the .part is complete (or garbage). Finalise and verify.
    clearTimeout(stallTimer);
    return finaliseDownload(dest, part, expectedSize, sha256, offset > 0);
  }
  if (!res.ok || !res.body) {
    clearTimeout(stallTimer);
    return { ok: false, code: 'MODEL_DOWNLOAD_FAILED', fatal: res.status === 404 || res.status === 403 };
  }

  // A 200 answer to a Range request means the server restarted from zero.
  const resumed = res.status === 206;
  if (offset > 0 && !resumed) {
    offset = 0;
    try {
      fs.unlinkSync(part);
    } catch {
      /* ignore */
    }
  }

  const lenHeader = Number(res.headers.get('content-length') ?? 0);
  const total = expectedSize || (resumed ? offset + lenHeader : lenHeader);

  // Only hash when starting from zero; a resumed file is verified after the
  // fact with a full re-read (cheaper than throwing away gigabytes).
  const hash = sha256 && offset === 0 ? crypto.createHash('sha256') : null;

  const out = fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' });
  let downloaded = offset;
  try {
    for await (const chunk of res.body) {
      bumpStall();
      hash?.update(chunk);
      downloaded += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      onProgress({ label, downloaded, total, done: false });
    }
  } catch (err) {
    clearTimeout(stallTimer);
    out.end();
    return { ok: false, code: abortName(err) };
  }
  clearTimeout(stallTimer);
  await new Promise((r) => out.end(r));

  if (expectedSize && downloaded !== expectedSize) {
    return { ok: false, code: 'MODEL_DOWNLOAD_INTERRUPTED' };
  }
  if (hash && sha256 && hash.digest('hex') !== sha256) {
    try {
      fs.unlinkSync(part);
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'MODEL_DOWNLOAD_FAILED', fatal: false };
  }
  const fin = await finaliseDownload(dest, part, expectedSize, sha256, hash === null && Boolean(sha256));
  if (fin.ok) onProgress({ label, downloaded, total: total || downloaded, done: true });
  return fin;
}

async function finaliseDownload(dest, part, expectedSize, sha256, needsFullVerify) {
  try {
    if (expectedSize && fs.statSync(part).size !== expectedSize) {
      return { ok: false, code: 'MODEL_DOWNLOAD_INTERRUPTED' };
    }
    if (needsFullVerify && sha256) {
      const ok = (await hashFile(part)) === sha256;
      if (!ok) {
        fs.unlinkSync(part);
        return { ok: false, code: 'MODEL_DOWNLOAD_FAILED' };
      }
    }
    fs.renameSync(part, dest);
    return { ok: true };
  } catch {
    return { ok: false, code: 'MODEL_DOWNLOAD_FAILED' };
  }
}

export async function fileLooksValid(file, expectedSize) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return false;
    if (expectedSize && st.size !== expectedSize) return false;
    return true;
  } catch {
    return false;
  }
}

export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function abortName(err) {
  return err?.name === 'AbortError' ? 'MODEL_DOWNLOAD_INTERRUPTED' : 'MODEL_DOWNLOAD_FAILED';
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ============================================================
   archive extraction — system tools only
   ============================================================ */

export async function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const isZip = archive.endsWith('.zip');
  const attempts = [];
  if (isZip) {
    // Windows 10+ tar is bsdtar and reads zip; macOS tar is bsdtar too.
    attempts.push(['tar', ['-xf', archive, '-C', destDir]]);
    attempts.push(['unzip', ['-o', '-q', archive, '-d', destDir]]);
    attempts.push(['python3', ['-m', 'zipfile', '-e', archive, destDir]]);
    if (process.platform === 'win32') {
      attempts.push([
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${destDir}'`],
      ]);
    }
  } else {
    attempts.push(['tar', ['-xzf', archive, '-C', destDir]]);
  }
  for (const [cmd, args] of attempts) {
    const ok = await new Promise((resolve) => {
      try {
        execFile(cmd, args, { timeout: 180000, windowsHide: true }, (err) => resolve(!err));
      } catch {
        resolve(false);
      }
    });
    if (ok) return true;
  }
  return false;
}

/** Find one of `names` anywhere under `dir` (upstream archive layouts vary). */
export function findBinary(dir, names) {
  let found = '';
  const walk = (d, depth) => {
    if (found || depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (names.includes(e.name)) found = p;
    }
  };
  walk(dir, 0);
  return found;
}

/* ============================================================
   ports & processes
   ============================================================ */

export async function httpJson(url, { method = 'GET', body = null, timeoutMs = 2500, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === null ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(t);
  }
}

/** Is the thing on this port OUR engine (as opposed to a stranger)? */
export async function isOurEngine(port) {
  const r = await httpJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 1500 });
  return r.status === 200 && r.json?.server === 'shdowpit-local-ai';
}

export function readPortFile() {
  try {
    const j = JSON.parse(fs.readFileSync(PORT_PATH, 'utf8'));
    return Number(j.port) || 11435;
  } catch {
    return 11435;
  }
}

export function readPid() {
  try {
    return JSON.parse(fs.readFileSync(PID_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const STRAY_RE = /engine\.mjs|fake-runtime\.mjs|llama-server|sd-cli|[\\/]sd\.exe|\bsd\b/;

function looksLikeOurRuntime(commandLine, executablePath) {
  const hay = `${commandLine ?? ''} ${executablePath ?? ''}`.replace(/\\/g, '/').toLowerCase();
  const dir = ENGINE_DIR.replace(/\\/g, '/').toLowerCase();
  if (!hay.includes(dir)) return false;
  if (/install\.mjs/.test(hay)) return false;
  return STRAY_RE.test(hay);
}

/** Kill a pid and its children. Safe if the pid is already gone. */
export function killPidTreeSync(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0 || n === process.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(n), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try {
        process.kill(-n, 'SIGKILL');
      } catch {
        try {
          process.kill(n, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
  } catch {
    /* already gone */
  }
}

export function killPidTree(pid) {
  return new Promise((resolve) => {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0 || n === process.pid) return resolve();
    try {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(n), '/T', '/F'], { windowsHide: true }, () => resolve());
      } else {
        try {
          process.kill(-n, 'SIGTERM');
        } catch {
          try {
            process.kill(n, 'SIGTERM');
          } catch {
            /* gone */
          }
        }
        setTimeout(() => {
          try {
            process.kill(-n, 'SIGKILL');
          } catch {
            try {
              if (pidAlive(n)) process.kill(n, 'SIGKILL');
            } catch {
              /* gone */
            }
          }
          resolve();
        }, 400);
      }
    } catch {
      resolve();
    }
  });
}

async function collectStrayPids() {
  const self = process.pid;
  /** @type {number[]} */
  const pids = [];
  if (process.platform === 'win32') {
    const dir = ENGINE_DIR.replace(/'/g, "''");
    const script =
      `$d='${dir}'.ToLower() -replace '\\\\','/';` +
      `Get-CimInstance Win32_Process | ForEach-Object {` +
      `$hay=(($_.CommandLine+' '+$_.ExecutablePath) -replace '\\\\','/').ToLower();` +
      `if($_.ProcessId -ne ${self} -and $hay.Contains($d) -and $hay -notmatch 'install\\.mjs' -and $hay -match 'engine\\.mjs|fake-runtime\\.mjs|llama-server|sd-cli|[/]sd\\.exe'){ $_.ProcessId }` +
      `}`;
    const out = await execOut('powershell', ['-NoProfile', '-Command', script], 20_000);
    for (const m of String(out ?? '').match(/\d+/g) ?? []) pids.push(Number(m));
  } else {
    const out = await execOut('ps', ['-ax', '-o', 'pid=,command='], 8_000);
    for (const line of String(out ?? '').split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const pid = Number(m[1]);
      if (pid === self) continue;
      if (looksLikeOurRuntime(m[2], '')) pids.push(pid);
    }
  }
  return [...new Set(pids.filter((p) => Number.isFinite(p) && p > 0))];
}

function collectStrayPidsSync() {
  const self = process.pid;
  /** @type {number[]} */
  const pids = [];
  try {
    if (process.platform === 'win32') {
      const dir = ENGINE_DIR.replace(/'/g, "''");
      const script =
        `$d='${dir}'.ToLower() -replace '\\\\','/';` +
        `Get-CimInstance Win32_Process | ForEach-Object {` +
        `$hay=(($_.CommandLine+' '+$_.ExecutablePath) -replace '\\\\','/').ToLower();` +
        `if($_.ProcessId -ne ${self} -and $hay.Contains($d) -and $hay -notmatch 'install\\.mjs' -and $hay -match 'engine\\.mjs|fake-runtime\\.mjs|llama-server|sd-cli|[/]sd\\.exe'){ $_.ProcessId }` +
        `}`;
      const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 20_000,
        windowsHide: true,
      });
      for (const m of String(out ?? '').match(/\d+/g) ?? []) pids.push(Number(m));
    } else {
      const out = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 8_000 });
      for (const line of String(out ?? '').split('\n')) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (!m) continue;
        const pid = Number(m[1]);
        if (pid === self) continue;
        if (looksLikeOurRuntime(m[2], '')) pids.push(pid);
      }
    }
  } catch {
    /* listing failed — pid-file kill is still enough for the common case */
  }
  return [...new Set(pids.filter((p) => Number.isFinite(p) && p > 0))];
}

function forgetPidFile() {
  try {
    fs.unlinkSync(PID_PATH);
  } catch {
    /* ignore */
  }
}

/**
 * Stop every copy of this engine, including orphan llama-server / sd
 * processes left over from a crashed or abandoned start.
 */
export async function stopEngine() {
  const rec = readPid();
  const port = readPortFile();
  const ports = new Set([port]);
  for (let i = 0; i < 16; i++) ports.add(11435 + i);
  await Promise.all(
    [...ports].map((p) => httpJson(`http://127.0.0.1:${p}/shutdown`, { method: 'POST', timeoutMs: 800 }))
  );
  await sleep(400);
  if (rec?.pid) await killPidTree(rec.pid);
  for (const pid of await collectStrayPids()) await killPidTree(pid);
  forgetPidFile();
  return true;
}

/** Sync variant for process-exit hooks that cannot await. */
export function stopEngineSync() {
  const rec = readPid();
  if (rec?.pid) killPidTreeSync(rec.pid);
  for (const pid of collectStrayPidsSync()) killPidTreeSync(pid);
  forgetPidFile();
  return true;
}

/** Spawn the engine detached so it outlives the installer / game server. */
export function spawnEngineDetached(extraEnv = {}) {
  ensureDirs();
  const out = fs.openSync(path.join(DIRS.logs, 'engine.out.log'), 'a');
  const child = spawn(process.execPath, [path.join(ENGINE_DIR, 'engine.mjs')], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

/* ============================================================
   install progress — the UI reads this file
   ============================================================ */

export function writeProgress(p) {
  try {
    ensureDirs();
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ ...p, updatedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  } catch {
    return null;
  }
}
