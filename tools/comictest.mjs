/**
 * Generative comic combat vertical slice.
 *
 *   npm run build && npx vite preview --port 4173
 *   node tools/comictest.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'comic-shots');

const checks = [];
const errors = [];
function log(...a) {
  console.log('[comic]', ...a);
}
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const boot = await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined');
  check('game booted', boot);
  if (!boot) {
    await browser.close();
    process.exit(1);
  }

  const btn = await page.$('#title-descend');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(2000);
  }

  const slice = await page.evaluate(() => window.SHDOWPIT.__sim('comicSlice', 'potato'));
  check('comicSlice ok', !!slice && slice.ok === true, JSON.stringify(slice).slice(0, 160));
  check('four roles queued', Array.isArray(slice.roles) && slice.roles.length === 4, String(slice.roles));

  // Wait for async stylize + viewer
  let viewer = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    viewer = await page.evaluate(() => {
      const el = document.getElementById('comic-viewer');
      return !!(el && !el.classList.contains('hidden'));
    });
    if (viewer) break;
    const st = await page.evaluate(() => window.SHDOWPIT.__sim('comicStatus'));
    if (st && st.ready) {
      // force present if armed but not shown
      await page.evaluate(() => {
        const g = window.SHDOWPIT;
        if (g.__comicSlice) {/* already ran */}
      });
    }
  }
  check('comic viewer visible', viewer);

  const panelCount = await page.evaluate(() => document.querySelectorAll('.comic-panel').length);
  check('four panel nodes', panelCount === 4, String(panelCount));

  const imgs = await page.evaluate(() =>
    [...document.querySelectorAll('.comic-img')].filter((img) => img.getAttribute('src')).length
  );
  check('panel images populated', imgs >= 3, String(imgs));

  await page.screenshot({ path: path.join(SHOTS, '01-comic-slice.png') });

  // Close viewer
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#comic-viewer button')].find((x) => /CONTINUE/i.test(x.textContent || ''));
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => {
    const el = document.getElementById('comic-viewer');
    return !el || el.classList.contains('hidden');
  });
  check('viewer closes', closed);

  const status = await page.evaluate(() => window.SHDOWPIT.__sim('comicStatus'));
  check('status reports quality potato', status.quality === 'potato', JSON.stringify(status.quality));

  log('errors', errors.length, errors.slice(0, 3));
  check('no page errors', errors.length === 0, errors[0] || '');

  const failed = checks.filter((c) => !c.ok);
  await browser.close();
  if (failed.length) {
    console.error('[comic] FAILED', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  log('all checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
