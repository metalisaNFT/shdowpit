/**
 * In-browser wiring checks. Needs a running preview:
 *
 *   npm run build && npx vite preview --port 4173
 *   node tools/wiringtest.mjs
 */

import { launchChromium } from './browser.mjs';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[wiring] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const boot = await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined');
  check('game booted', boot);
  if (!boot) {
    await browser.close();
    process.exit(1);
  }

  const self = await page.evaluate(() => window.SHDOWPIT.__wiringSelfTest());
  console.log(self.log);

  const regressionFailed = self.regressionFailed ?? 0;
  check('UI regression checks', regressionFailed === 0, `${self.regressionPassed} passed / ${regressionFailed} failed`);
  console.log(`[wiring] Known gaps (informational): ${self.knownGaps}`);

  await browser.close();
  const failed = checks.filter((c) => !c.ok).length;
  if (errors.length) console.log('[wiring] page errors', errors.slice(0, 8));
  console.log(`[wiring] ${checks.length - failed}/${checks.length} browser checks`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
