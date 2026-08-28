/**
 * Story system checks. Needs a running preview:
 *
 *   npm run build && npx vite preview --port 4173
 *   node tools/storytest.mjs
 */

import { launchChromium } from './browser.mjs';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[story] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
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

  const self = await page.evaluate(() => window.SHDOWPIT.__storySelfTest());
  console.log(self.log);
  check('story self-test suite', self.failed === 0, `${self.passed} passed / ${self.failed} failed`);

  const btn = await page.$('#title-descend');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1200);
  }

  const ui = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    g.__storyAction('openWeb');
    return {
      web: !!document.querySelector('.story-web'),
      tabs: [...document.querySelectorAll('#hierarchy-screen .tab')].map((t) => t.textContent),
    };
  });
  check('web opens', ui.web, ui.tabs.join(','));

  await page.keyboard.press(']');
  await page.waitForTimeout(200);
  const tab2 = await page.evaluate(() => document.querySelector('#hierarchy-screen h1')?.textContent);
  check('keyboard tab switch', !!tab2 && tab2 !== 'THE WEB', tab2 ?? '');

  await page.evaluate(() => {
    document.documentElement.classList.add('reduced-motion');
    window.SHDOWPIT.__storyAction('openTimeline');
  });
  const time = await page.evaluate(() => document.querySelector('#hierarchy-screen h1')?.textContent);
  check('timeline mode', time === 'THE RECORD', time ?? '');

  await browser.close();
  const failed = checks.filter((c) => !c.ok).length;
  if (errors.length) console.log('[story] page errors', errors.slice(0, 8));
  console.log(`[story] ${checks.length - failed}/${checks.length} checks`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
