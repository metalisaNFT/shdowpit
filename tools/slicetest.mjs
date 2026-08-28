/**
 * Tower Commander vertical slice.
 *
 *   npm run build && npx vite preview --port 4173
 *   node tools/slicetest.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'slice-shots');

const checks = [];
const errors = [];
function log(...a) {
  console.log('[slice]', ...a);
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
    await page.waitForTimeout(1600);
  }

  const slice = await page.evaluate(() => window.SHDOWPIT.__sim('verticalSlice'));
  check('commander assigned', typeof slice.commander === 'string' && !!slice.commanderName, slice.commanderName);
  check('loyalist assigned', typeof slice.loyalist === 'string', slice.loyalistName);
  check('tower owned by commander', slice.territory === slice.commander);
  check('stolen spear', Array.isArray(slice.stolen) && slice.stolen.includes('spear'));
  check('signature order_pulse', slice.signature === 'order_pulse');
  check('vendetta committed', !!slice.vendetta && slice.vendetta.committed);
  check('heat raised', slice.heat >= 20);

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '01-tower-slice.png') });

  const hud = await page.evaluate(() => {
    const purpose = document.querySelector('.hud-purpose');
    const tut = document.querySelector('.hud-tutorial');
    return {
      purpose: purpose && !purpose.classList.contains('hidden') ? purpose.textContent : '',
      tutorial: tut && !tut.classList.contains('hidden') ? tut.textContent : '',
      remnants: document.body.innerText.includes('REMNANTS') || document.body.innerText.includes('NOW'),
    };
  });
  check('purpose or remnants visible', !!(hud.purpose || hud.remnants || hud.tutorial), (hud.purpose || hud.tutorial || '').slice(0, 80));

  const archetypes = await page.evaluate(() => window.SHDOWPIT.__qaSpawnArchetypes());
  check('spawn duelist', archetypes.some((s) => s.startsWith('duelist:')));
  check('spawn commander', archetypes.some((s) => s.startsWith('commander:')));
  await page.screenshot({ path: path.join(SHOTS, '02-archetypes.png') });

  await page.evaluate(() => {
    const g = window.SHDOWPIT;
    g.__debug().unlockAllSkills();
    g.__debug().fillSurge();
  });
  await page.keyboard.down('Digit3');
  await page.waitForTimeout(200);
  await page.keyboard.up('Digit3');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, '03-ultimate.png') });

  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, '04-story-web.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const recap = await page.evaluate(() => window.SHDOWPIT.__storyAction('recap'));
  check('recap inspector available', typeof recap === 'string' && recap.length > 0, String(recap).slice(0, 80));

  const proc = await page.evaluate(() => window.SHDOWPIT.__sim('procStress'));
  check('procStress secondary cannot refund CD', proc.secondaryNoCd === true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const pause = await page.evaluate(() => document.getElementById('pause-screen')?.textContent ?? '');
  check('pause teaching or remnants copy', /TEACHING|REMNANTS|ESSENCE|HELP|SKIP TUTORIAL/i.test(pause), pause.slice(0, 80));
  await page.screenshot({ path: path.join(SHOTS, '05-pause-help.png') });
  await page.keyboard.press('Escape');

  const st = await page.evaluate(() => window.SHDOWPIT.__state());
  check('multi staging id present or solo', st.multiRule === 'loyalist_guard' || st.multiRule === null || typeof st.multiRule === 'string', String(st.multiRule));

  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  const failed = checks.filter((c) => !c.ok);
  log(`${checks.length - failed.length}/${checks.length} passed`);
  await browser.close();
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
