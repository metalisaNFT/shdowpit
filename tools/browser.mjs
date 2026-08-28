/**
 * Portable Chromium launch for every Playwright harness.
 *
 * Resolution order:
 *   1. PLAYWRIGHT_CHROMIUM or PLAYWRIGHT_CHROMIUM_PATH
 *   2. Playwright-managed browser (npx playwright install chromium)
 *   3. Known platform fallbacks
 *   4. Clear error with the install command
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  '--no-sandbox',
];

function envBrowserPath() {
  const p = process.env.PLAYWRIGHT_CHROMIUM || process.env.PLAYWRIGHT_CHROMIUM_PATH || '';
  return p.trim();
}

function findWindowsMsPlaywrightChrome() {
  const root = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!fs.existsSync(root)) return '';
  let best = '';
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith('chromium')) continue;
    const candidate = path.join(root, name, 'chrome-win', 'chrome.exe');
    if (fs.existsSync(candidate) && candidate > best) best = candidate;
  }
  return best;
}

export function resolveChromiumPath() {
  const fromEnv = envBrowserPath();
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return fromEnv;
    throw new Error(
      `PLAYWRIGHT_CHROMIUM path does not exist: ${fromEnv}\n` +
        'Set it to a real chrome/chromium binary, or unset it and run: npx playwright install chromium',
    );
  }

  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* Playwright may not have a cached browser yet. */
  }

  const linux = '/opt/pw-browsers/chromium';
  if (fs.existsSync(linux)) return linux;

  if (process.platform === 'win32') {
    const win = findWindowsMsPlaywrightChrome();
    if (win) return win;
    const chrome = path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs.existsSync(chrome)) return chrome;
    const chrome86 = path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs.existsSync(chrome86)) return chrome86;
  }

  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'darwin' && fs.existsSync(mac)) return mac;

  throw new Error(
    'No Chromium found for playtests.\n' +
      'Fix: npx playwright install chromium\n' +
      'Or set PLAYWRIGHT_CHROMIUM / PLAYWRIGHT_CHROMIUM_PATH to a chrome executable.',
  );
}

export async function launchChromium(opts = {}) {
  const executablePath = resolveChromiumPath();
  const args = opts.args ?? SWIFTSHADER_ARGS;
  return chromium.launch({ ...opts, executablePath, args });
}
