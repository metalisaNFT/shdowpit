/**
 * LOCAL AI ENGINE — installer & manager.
 *
 *   node local-ai-engine/install.mjs            install everything + start
 *   node local-ai-engine/install.mjs --status   JSON status (also progress)
 *   node local-ai-engine/install.mjs --start    start the engine
 *   node local-ai-engine/install.mjs --stop     stop the engine
 *   node local-ai-engine/install.mjs --restart
 *   node local-ai-engine/install.mjs --remove [--purge-models]
 *   node local-ai-engine/install.mjs --fake     test install (no downloads;
 *                                               wires the fake runtime)
 *
 * The installer is idempotent: models and runtimes that already exist with
 * the expected size (and checksum, where pinned) are never re-downloaded, and
 * interrupted downloads resume from their .part files. The one-button UI in
 * the game runs exactly this script and reads logs/install-progress.json.
 *
 * The game's own files, saves and OpenAI configuration are never touched —
 * everything lives inside local-ai-engine/.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DIRS,
  ENGINE_DIR,
  CONFIG_PATH,
  ensureDirs,
  defaultConfig,
  loadConfig,
  saveConfig,
  detectPlatform,
  detectGPU,
  deviceLabel,
  freeDiskBytes,
  gb,
  download,
  fileLooksValid,
  extract,
  findBinary,
  httpJson,
  readPortFile,
  readPid,
  pidAlive,
  isOurEngine,
  stopEngine,
  spawnEngineDetached,
  writeProgress,
  readProgress,
  sleep,
  logLine,
} from './lib.mjs';
import { TEXT_MODEL, IMAGE_MODEL, TEXT_RUNTIMES, IMAGE_RUNTIMES, runtimeCandidates, ENGINE_VERSION } from './manifest.mjs';

const args = new Set(process.argv.slice(2));
const FAKE = args.has('--fake');

/* ============================================================
   the 12 installation steps (names match the sprint brief)
   ============================================================ */

const STEP_NAMES = [
  'detect operating system',
  'detect hardware',
  'create local AI runtime directory',
  'install required lightweight dependencies',
  'download text runtime',
  'download text model',
  'download image runtime',
  'download image model',
  'configure local server',
  'start server',
  'health check',
  'report readiness',
];

const progress = {
  state: 'installing',
  component: '',
  downloaded: 0,
  total: 0,
  pct: 0,
  error: '',
  errorCode: '',
  steps: STEP_NAMES.map((name, i) => ({ step: i + 1, name, status: 'pending' })),
};

function step(n, status, detail = '') {
  progress.steps[n - 1].status = status;
  if (detail) progress.steps[n - 1].detail = detail;
  writeProgress(progress);
  const mark = status === 'complete' ? 'ok' : status === 'skipped' ? '--' : status === 'failed' ? 'XX' : '..';
  console.log(`[${mark}] ${n}/12 ${STEP_NAMES[n - 1]}${detail ? ` — ${detail}` : ''}`);
}

function fail(n, code, message) {
  progress.state = 'failed';
  progress.error = message;
  progress.errorCode = code;
  step(n, 'failed', `${code}: ${message}`);
  console.error(`\n${code}\n${message}`);
  process.exit(1);
}

function onDownloadProgress({ label, downloaded, total }) {
  progress.component = label;
  progress.downloaded = downloaded;
  progress.total = total;
  progress.pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  writeProgress(progress);
  const bar = renderBar(progress.pct);
  process.stdout.write(`\r  ${label} ${bar} ${progress.pct}%  ${(downloaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB   `);
}

function renderBar(pct) {
  const filled = Math.round(pct / 5);
  return `[${'█'.repeat(filled)}${'-'.repeat(20 - filled)}]`;
}

/* ============================================================
   runtime install helper
   ============================================================ */

async function installRuntime(kind, table, keys, destDir, stepNo) {
  for (const key of keys) {
    const spec = table[key];
    const markerDir = path.join(destDir, key);
    const existing = findBinary(markerDir, spec.parts[0].binary);
    if (existing) {
      step(stepNo, 'complete', `${key} already installed`);
      return { key, binary: existing, accel: spec.accel, spec };
    }
    let ok = true;
    for (const part of spec.parts) {
      const archive = path.join(DIRS.cache, part.file);
      const r = await download(part.url, archive, { label: `${kind} runtime (${key})`, onProgress: onDownloadProgress });
      process.stdout.write('\n');
      if (!r.ok) {
        ok = false;
        console.log(`  ${key}: download failed (${r.code}) — trying next candidate`);
        break;
      }
      if (!(await extract(archive, markerDir))) {
        ok = false;
        console.log(`  ${key}: extraction failed — trying next candidate`);
        break;
      }
    }
    if (!ok) continue;
    const binary = findBinary(markerDir, spec.parts[0].binary);
    if (!binary) {
      console.log(`  ${key}: binary not found after extraction — trying next candidate`);
      continue;
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(binary, 0o755);
      } catch {
        /* ignore */
      }
    }
    step(stepNo, 'complete', key);
    return { key, binary, accel: spec.accel, spec };
  }
  return null;
}

/* ============================================================
   install
   ============================================================ */

async function install() {
  console.log(`LOCAL AI ENGINE installer v${ENGINE_VERSION}${FAKE ? ' (FAKE test mode)' : ''}\n`);
  ensureDirs();
  writeProgress(progress);

  /* 1 — operating system */
  const plat = detectPlatform();
  step(1, 'complete', `${plat.os} ${plat.arch}`);

  /* 2 — hardware */
  const gpu = FAKE ? { kind: 'none', name: '' } : await detectGPU();
  const device = deviceLabel(gpu);
  step(2, 'complete', device);

  /* 3 — directories */
  ensureDirs();
  step(3, 'complete', ENGINE_DIR);

  /* 4 — dependencies: there are none to install. Node built-ins only. */
  step(4, 'complete', 'none required (Node built-ins + prebuilt binaries)');

  const cand = runtimeCandidates(plat.os, plat.arch, gpu.kind);
  const cfg = { ...defaultConfig(), ...(loadConfig() ?? {}) };
  cfg.device = device;
  cfg.fakeRuntime = FAKE;

  if (FAKE) {
    // Test mode: no downloads. The engine speaks to fake-runtime.mjs instead.
    for (const n of [5, 6, 7, 8]) step(n, 'skipped', 'fake test mode');
    cfg.text = {
      ...cfg.text,
      enabled: true,
      runtimeKey: 'fake',
      binary: 'fake',
      model: path.join(DIRS.modelsText, 'fake.gguf'),
      modelName: `${TEXT_MODEL.name} (fake)`,
      quantization: TEXT_MODEL.quantization,
    };
    cfg.image = {
      ...cfg.image,
      enabled: true,
      runtimeKey: 'fake',
      binary: 'fake',
      model: path.join(DIRS.modelsImage, 'fake.gguf'),
      modelName: `${IMAGE_MODEL.name} (fake)`,
      quantization: IMAGE_MODEL.quantization,
      cfgScale: IMAGE_MODEL.cfgScale,
    };
    cfg.textAccel = 'CPU';
    cfg.imageAccel = 'CPU';
  } else {
    /* ---- disk space check BEFORE any download ---- */
    let needed = 0;
    if (!(await fileLooksValid(path.join(DIRS.modelsText, TEXT_MODEL.file), TEXT_MODEL.size))) needed += TEXT_MODEL.size;
    if (!(await fileLooksValid(path.join(DIRS.modelsImage, IMAGE_MODEL.file), IMAGE_MODEL.size))) needed += IMAGE_MODEL.size;
    const textKey = cand.text[0];
    const imageKey = cand.image[0];
    if (textKey) for (const p of TEXT_RUNTIMES[textKey].parts) needed += p.approxMB * 1e6 * 2; // archive + extracted
    if (imageKey) for (const p of IMAGE_RUNTIMES[imageKey].parts) needed += p.approxMB * 1e6 * 2;
    needed = Math.round(needed * 1.1 + 200e6); // slack

    const avail = await freeDiskBytes(ENGINE_DIR);
    if (avail >= 0 && avail < needed) {
      fail(5, 'INSUFFICIENT_DISK_SPACE', `Required: ${gb(needed)}\nAvailable: ${gb(avail)}`);
    }
    console.log(`  disk: need ~${gb(needed)}, available ${avail < 0 ? 'unknown' : gb(avail)}\n`);

    /* 5 — text runtime */
    const textRt = await installRuntime('text', TEXT_RUNTIMES, cand.text, DIRS.runtimeText, 5);
    if (!textRt) fail(5, 'MODEL_DOWNLOAD_FAILED', 'No text runtime could be downloaded for this platform.');

    /* 6 — text model */
    const textModelPath = path.join(DIRS.modelsText, TEXT_MODEL.file);
    const tm = await download(TEXT_MODEL.url, textModelPath, {
      expectedSize: TEXT_MODEL.size,
      sha256: TEXT_MODEL.sha256,
      label: 'text model',
      onProgress: onDownloadProgress,
    });
    process.stdout.write('\n');
    if (!tm.ok) fail(6, tm.code, `Could not download ${TEXT_MODEL.file}.`);
    step(6, tm.skipped ? 'complete' : 'complete', tm.skipped ? 'already downloaded (verified)' : TEXT_MODEL.file);

    cfg.text = {
      ...cfg.text,
      enabled: true,
      runtimeKey: textRt.key,
      binary: textRt.binary,
      model: textModelPath,
      modelName: TEXT_MODEL.name,
      quantization: TEXT_MODEL.quantization,
      ctx: TEXT_MODEL.ctx,
      gpuLayers: textRt.spec.gpuLayers ?? 0,
    };
    cfg.textAccel = textRt.accel;

    /* 7 — image runtime (failure here must NOT stop the text engine) */
    const imageRt = cand.image.length
      ? await installRuntime('image', IMAGE_RUNTIMES, cand.image, DIRS.runtimeImage, 7)
      : null;
    if (!imageRt) {
      step(7, 'skipped', 'no image runtime available for this platform — text-only install');
    }

    /* 8 — image model */
    if (imageRt) {
      const imageModelPath = path.join(DIRS.modelsImage, IMAGE_MODEL.file);
      const im = await download(IMAGE_MODEL.url, imageModelPath, {
        expectedSize: IMAGE_MODEL.size,
        sha256: IMAGE_MODEL.sha256,
        label: 'image model',
        onProgress: onDownloadProgress,
      });
      process.stdout.write('\n');
      if (!im.ok) {
        step(8, 'skipped', `${im.code} — continuing text-only`);
      } else {
        step(8, 'complete', im.skipped ? 'already downloaded (verified)' : IMAGE_MODEL.file);
        cfg.image = {
          ...cfg.image,
          enabled: true,
          runtimeKey: imageRt.key,
          binary: imageRt.binary,
          model: imageModelPath,
          modelName: IMAGE_MODEL.name,
          quantization: IMAGE_MODEL.quantization,
          cfgScale: IMAGE_MODEL.cfgScale,
        };
        cfg.imageAccel = imageRt.accel;
      }
    } else {
      step(8, 'skipped', 'image runtime unavailable');
    }
  }

  /* 9 — configure. CPU boxes get gentler defaults; GPU boxes get speed. */
  const cpuOnly = cfg.textAccel === 'CPU';
  if (cpuOnly) {
    cfg.text.timeoutMs = Math.max(cfg.text.timeoutMs, 30_000);
    cfg.image.timeoutMs = Math.max(cfg.image.timeoutMs, 240_000);
    cfg.image.steps = Math.min(cfg.image.steps, 2);
  }
  cfg.threads = Math.max(1, Math.min(8, os.cpus().length));
  saveConfig(cfg);
  step(9, 'complete', `port ${cfg.port}, ${cpuOnly ? 'CPU profile' : 'GPU profile'}`);

  /* 10 — start server */
  await startCmd(false);
  step(10, 'complete');

  /* 11 — health check */
  const health = await waitForHealth(FAKE ? 20_000 : 240_000);
  if (!health) fail(11, 'SERVER_START_FAILED', 'The engine did not answer /health in time. See logs/engine.out.log.');
  if (!health.text?.ready) {
    fail(11, health.text?.error ?? 'TEXT_MODEL_LOAD_FAILED', 'Text model failed to load. See logs/engine.out.log.');
  }
  step(11, 'complete', `status=${health.status}`);

  /* 12 — report readiness */
  progress.state = health.status === 'ready' ? 'ready' : 'partial';
  progress.component = '';
  progress.pct = 100;
  step(12, 'complete', progress.state);

  console.log('\nLOCAL AI ENGINE');
  console.log(`  Status:  ${progress.state.toUpperCase()}`);
  console.log(`  Text:    ${health.text?.ready ? 'READY' : `UNAVAILABLE (${health.text?.error ?? ''})`}`);
  console.log(`  Images:  ${health.image?.ready ? 'READY' : `UNAVAILABLE (${health.image?.error ?? ''})`}`);
  console.log(`  URL:     http://127.0.0.1:${health.port}/v1`);
}

async function waitForHealth(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const port = readPortFile();
    const r = await httpJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 1500 });
    if (r.status === 200 && r.json?.server === 'shdowpit-local-ai') {
      // Wait for text to finish loading (or definitively fail).
      if (r.json.text?.ready || r.json.text?.error) return r.json;
    }
    await sleep(700);
  }
  return null;
}

/* ============================================================
   manage commands
   ============================================================ */

async function startCmd(verbose = true) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error('LOCAL_AI_NOT_INSTALLED');
    process.exit(1);
  }
  const port = readPortFile();
  const r = await httpJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 1200 });
  if (r.status === 200 && r.json?.server === 'shdowpit-local-ai') {
    if (verbose) console.log(`already running on port ${port}`);
    return;
  }
  // Dead pid files, leftover llama-server, previous partial installs — reap
  // them before we spawn, otherwise Windows holds ggml-cuda.dll and the new
  // start (or Vite's file watcher) dies with EBUSY.
  await stopEngine();
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    if (!(await isOurEngine(readPortFile()))) break;
    await sleep(200);
  }
  await sleep(200);
  const pid = spawnEngineDetached(FAKE || cfg.fakeRuntime ? { SHDOWPIT_LOCAL_AI_FAKE: '1' } : {});
  logLine('install.log', `spawned engine pid=${pid}`);
  if (verbose) {
    const h = await waitForHealth(FAKE || cfg.fakeRuntime ? 20_000 : 240_000);
    console.log(h ? `running (status=${h.status}) on port ${h.port}` : 'engine did not become healthy — see logs/');
    if (!h) process.exit(1);
  }
}

async function statusCmd() {
  const cfg = loadConfig();
  const pid = readPid();
  const port = readPortFile();
  const running = pid ? pidAlive(pid.pid) : false;
  const health = running ? (await httpJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 1500 })).json : null;
  console.log(
    JSON.stringify(
      {
        installed: Boolean(cfg),
        fake: Boolean(cfg?.fakeRuntime),
        running: Boolean(health?.server === 'shdowpit-local-ai'),
        port,
        health,
        progress: readProgress(),
      },
      null,
      2
    )
  );
}

async function removeCmd() {
  await stopEngine();
  const purge = args.has('--purge-models');
  const doomed = [DIRS.runtime, DIRS.cache, DIRS.logs, DIRS.config];
  if (purge) doomed.push(DIRS.models);
  for (const d of doomed) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  console.log(`removed local AI engine${purge ? ' including models' : ' (models kept — rerun with --purge-models to delete)'}`);
  console.log('game files, saves and OpenAI configuration were not touched.');
}

/* ============================================================
   entry
   ============================================================ */

const cmd = args.has('--status')
  ? 'status'
  : args.has('--stop')
    ? 'stop'
    : args.has('--restart')
      ? 'restart'
      : args.has('--start')
        ? 'start'
        : args.has('--remove')
          ? 'remove'
          : 'install';

try {
  if (cmd === 'status') await statusCmd();
  else if (cmd === 'stop') {
    await stopEngine();
    console.log('stopped');
  } else if (cmd === 'start') await startCmd();
  else if (cmd === 'restart') {
    await stopEngine();
    await sleep(300);
    await startCmd();
  } else if (cmd === 'remove') await removeCmd();
  else await install();
} catch (err) {
  progress.state = 'failed';
  progress.error = String(err?.message ?? err);
  progress.errorCode = progress.errorCode || 'SERVER_START_FAILED';
  writeProgress(progress);
  console.error('installer error:', err);
  process.exit(1);
}
