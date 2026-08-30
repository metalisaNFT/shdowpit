/**
 * Run browser harnesses against an auto-started vite preview server.
 *
 *   node tools/run-with-preview.mjs -- npm run test:wiring
 *   node tools/run-with-preview.mjs -- npm run test:simreg
 *   node tools/run-with-preview.mjs -- npm run test:story test:backend
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PREVIEW_PORT = 4173;
const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 400;

/** Vite prints the bound URL when the default port is already taken. */
function parsePreviewUrl(text) {
  const m = text.match(/Local:\s+(https?:\/\/[^\s/]+\/?)/i);
  if (!m) return null;
  const base = m[1].endsWith('/') ? m[1] : `${m[1]}/`;
  return base;
}

const DEFAULT_SCRIPTS = ['test:wiring', 'test:backend', 'test:simreg', 'test:story'];

const sep = process.argv.indexOf('--');
const extra = sep >= 0 ? process.argv.slice(sep + 1) : [];
const scripts = extra.length ? extra : DEFAULT_SCRIPTS;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function waitForPreview(previewUrl) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(previewUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`preview did not become ready at ${previewUrl}`);
}

async function main() {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const preview = spawn(bin, ['vite', 'preview', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  let previewLog = '';
  const onPreviewOutput = (d) => {
    previewLog += String(d);
  };
  preview.stdout?.on('data', onPreviewOutput);
  preview.stderr?.on('data', onPreviewOutput);

  const killPreview = () => {
    if (!preview.killed) preview.kill('SIGTERM');
  };
  process.on('SIGINT', killPreview);
  process.on('SIGTERM', killPreview);

  try {
    const previewUrl = await new Promise((resolve, reject) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      const tick = () => {
        const parsed = parsePreviewUrl(previewLog);
        if (parsed) {
          resolve(parsed);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error('preview did not print a Local URL'));
          return;
        }
        setTimeout(tick, POLL_MS);
      };
      tick();
    });
    await waitForPreview(previewUrl);
    const env = {
      ...process.env,
      PLAYTEST_URL: previewUrl,
      PLAYTEST_URL_BASE: previewUrl.replace(/\/$/, ''),
      SHDOWPIT_PREVIEW_URL: previewUrl,
    };
    console.log('[run-with-preview] preview ready at', previewUrl);
    for (const script of scripts) {
      console.log('[run-with-preview] running npm run', script);
      await run('npm', ['run', script], { cwd: ROOT, env });
    }
    process.exit(0);
  } finally {
    killPreview();
    if (preview.exitCode && preview.exitCode !== 0 && previewLog.trim()) {
      console.error('[run-with-preview] preview log:', previewLog.trim());
    }
  }
}

main().catch((e) => {
  console.error('[run-with-preview] failed:', e.message ?? e);
  process.exit(1);
});
