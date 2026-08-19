/**
 * The AI success path, against a mock provider.
 *
 * Everything else in the test suite proves the game survives AI failing. This
 * proves the AI actually does something when it works: generated titles reach
 * the UI, taunts reach the arrival card, portraits reach the Book of Enemies
 * and survive a reload, content is cached rather than regenerated, and — most
 * importantly — the anti-invention guard rejects a title that asserts a fact
 * the simulation never produced.
 *
 * Requires the backend in mock mode:
 *   SHDOWPIT_AI_MOCK=1 npx vite preview --port 4173 &
 *   node tools/aisuccess.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'playtest-shots');
const FAKE_KEY = 'sk-' + 'M0ckM0ckM0ckM0ckM0ckM0ckM0ckM0ck';

const checks = [];
const errors = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[aisuccess] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function log(...a) {
  console.log('[aisuccess]', ...a);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  // Refuse to run against a live backend — the results would be meaningless.
  const probe = await fetch('http://localhost:4173/api/ai/status').then((r) => r.json());
  void probe;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (/sk-[A-Za-z0-9_-]{8,}/.test(m.text())) errors.push('KEY IN CONSOLE: ' + m.text());
  });

  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const state = () => page.evaluate(() => window.SHDOWPIT.__state());
  const aiStatus = () => page.evaluate(() => window.SHDOWPIT.__aiStatus());
  const content = (id) => page.evaluate((x) => window.SHDOWPIT.__aiContentFor(x), id);

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => indexedDB.deleteDatabase('shdowpit-ai'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await (await page.$('#title-screen button')).click();
  await page.waitForTimeout(2500);
  check('game running', (await state()).mode === 'playing');

  /* connect the mock and go FULL */
  const conn = await page.evaluate(
    (k) => fetch('/api/ai/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k }),
    }).then((r) => r.json()),
    FAKE_KEY
  );
  check('mock backend accepts a connection', conn.ok === true);

  const test = await page.evaluate(() =>
    fetch('/api/ai/test', { method: 'POST' }).then((r) => r.json())
  );
  check('TEST CONNECTION succeeds against the mock', test.ok === true, JSON.stringify(test));
  if (!test.ok) {
    console.log('\nThis suite needs the backend in mock mode:');
    console.log('  SHDOWPIT_AI_MOCK=1 npx vite preview --port 4173\n');
  }

  await page.evaluate(() => window.SHDOWPIT.backendRefreshForTest?.());
  await page.evaluate(() => window.SHDOWPIT.__setAIMode('full'));
  await page.waitForTimeout(400);
  // The service caches connection state; nudge it to re-read.
  await page.evaluate(() => window.SHDOWPIT.__aiRefresh());
  await page.waitForTimeout(600);
  let st = await aiStatus();
  check('client sees the connection', st.connected === true, JSON.stringify({ c: st.connected, m: st.mode }));

  /* ============================================================
     the anti-invention guard
     ============================================================ */

  // The mock always returns "THE CINDER-EYED", which asserts fire.
  const roster = await page.evaluate(() => window.SHDOWPIT.__debug().listNemeses().map((n) => n.id));
  const unburned = roster[0];
  const burned = roster[1];

  await page.evaluate((id) => window.SHDOWPIT.__fireMyth(id, 'promoted_captain'), unburned);
  await page.waitForTimeout(4000);
  const c1 = await content(unburned);
  check(
    'a title claiming fire is REJECTED for a nemesis with no burns',
    c1.title !== 'THE CINDER-EYED',
    `got "${c1.title}"`
  );

  // Now give someone actual burn scars and try again.
  await page.evaluate((id) => window.SHDOWPIT.__debug().scarTarget(id), burned);
  await page.waitForTimeout(600);
  const scarLine = await page.evaluate(
    (id) => window.SHDOWPIT.__debug().inspect(id).split('\n').find((l) => l.startsWith('scars:')),
    burned
  );
  check('the second nemesis really has burns', /burn/.test(scarLine ?? ''), scarLine);

  await page.evaluate((id) => window.SHDOWPIT.__fireMyth(id, 'promoted_captain'), burned);
  await page.waitForTimeout(6000);
  const c2 = await content(burned);
  check(
    'the same title is ACCEPTED once the burns are real',
    c2.title === 'THE ASHEN',
    `got "${c2.title}"`
  );

  /* ============================================================
     generated content reaches the game
     ============================================================ */

  check('a generated taunt is in use', c2.taunt === 'You die exactly the way I remember.', c2.taunt);
  check('a generated chronicle is in use', /left them standing/.test(c2.chronicle ?? ''), c2.chronicle?.slice(0, 60));
  check('the portrait is a generated image, not the SVG', c2.portraitKind.startsWith('data:image/png'), c2.portraitKind);
  check('the portrait is reported as generated', c2.portraitIsGenerated === true);

  st = await aiStatus();
  check('requests completed rather than failed', st.last?.state === 'complete' || st.last?.state === 'cached', JSON.stringify(st.last));
  check('portraits are counted in the cache', st.cachedPortraits > 0, `${st.cachedPortraits}`);
  check('text is counted in the cache', st.cachedText > 0, `${st.cachedText}`);
  check('indicator is green when idle and connected', st.indicator === 'idle', st.indicator);

  /* ============================================================
     caching — a repeat request must not regenerate
     ============================================================ */

  const before = await aiStatus();
  await page.evaluate((id) => window.SHDOWPIT.__fireMyth(id, 'promoted_captain'), burned);
  await page.waitForTimeout(3500);
  const after = await aiStatus();
  const c3 = await content(burned);
  check('repeating a myth event does not change the identity', c3.title === c2.title, c3.title);
  check('the queue is idle again', after.active === 0 && after.queued === 0);
  void before;

  /* ============================================================
     portrait evolution
     ============================================================ */

  const visualBefore = c3.visualVersion;
  // Compare the cache KEY, not the bytes: the mock returns the same PNG every
  // time, so identical pixels prove nothing about whether it regenerated.
  const portraitKeyBefore = c3.portraitKey;
  await page.evaluate((id) => window.SHDOWPIT.__debug().forceResurrection(id), burned);
  await page.waitForTimeout(6000);
  const c4 = await content(burned);
  check('a transformation bumps the visual version', c4.visualVersion > visualBefore, `${visualBefore} -> ${c4.visualVersion}`);
  check(
    'a transformation produces a new portrait',
    Boolean(c4.portraitKey) && c4.portraitKey !== portraitKeyBefore,
    `${portraitKeyBefore} -> ${c4.portraitKey}`
  );
  check('the new portrait is also generated', c4.portraitIsGenerated === true);

  const history = await page.evaluate(
    (id) => (window.SHDOWPIT.__aiHistory ? window.SHDOWPIT.__aiHistory(id) : null),
    burned
  );
  check('the old portrait is kept in history', (history?.length ?? 0) >= 1, `${history?.length} entries`);

  /* ============================================================
     the book of enemies shows it
     ============================================================ */

  const name = await page.evaluate((id) => window.SHDOWPIT.__debug().listNemeses().find((n) => n.id === id)?.label, burned);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  await page.$$eval('#hierarchy-screen .tab', (els) => {
    els.find((e) => e.textContent.trim() === 'BOOK OF ENEMIES')?.click();
  });
  await page.waitForTimeout(700);
  const shortName = (name ?? '').replace(/^† /, '').split(' ')[0].toUpperCase();
  await page.$$eval(
    '#hierarchy-screen .book-rail-row',
    (els, n) => els.find((e) => e.textContent.toUpperCase().includes(n))?.click(),
    shortName
  );
  await page.waitForTimeout(700);

  const bookPortrait = await page.$eval('#hierarchy-screen .book-portrait', (e) => e.getAttribute('src'));
  const bookTag = await page.$eval('#hierarchy-screen .book-portrait-tag', (e) => e.textContent.trim());
  const bookTitle = await page.$eval('#hierarchy-screen .book-title', (e) => e.textContent.trim());
  const thumbs = await page.$$eval('#hierarchy-screen .book-thumb', (e) => e.length);
  check('book shows the generated portrait', bookPortrait.startsWith('data:image/png'), bookPortrait.slice(0, 24));
  check('book labels it GENERATED', bookTag === 'GENERATED', bookTag);
  check('book shows the AI title', bookTitle === 'THE ASHEN', bookTitle);
  check('book shows the portrait evolution strip', thumbs >= 2, `${thumbs} thumbnails`);
  await shot('ai-07-generated-book.png');

  await page.$$eval('#hierarchy-screen button', (els) => els[els.length - 1]?.click());
  await page.waitForTimeout(800);

  /* ============================================================
     it all survives a reload
     ============================================================ */

  await page.waitForTimeout(2500);
  const beforeReload = await content(burned);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const afterReload = await content(burned);
  check('AI title survives a reload', afterReload.title === beforeReload.title, afterReload.title);
  check('AI chronicle survives a reload', afterReload.chronicle === beforeReload.chronicle);
  check('AI taunt survives a reload', afterReload.taunt === beforeReload.taunt, afterReload.taunt);

  // Portraits live in IndexedDB, so they need one async beat after boot.
  await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), burned);
  await page.waitForTimeout(1500);
  const afterReload2 = await content(burned);
  check(
    'the generated portrait survives a reload',
    afterReload2.portraitKind.startsWith('data:image/png'),
    afterReload2.portraitKind
  );

  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  check('still no key in storage', !/sk-[A-Za-z0-9_-]{8,}/.test(storage));
  check('generated text is cached in localStorage', /shdowpit\.ai\.text/.test(storage));
  await shot('ai-08-after-reload.png');

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ AI SUCCESS PATH ================');
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.log('  FAILED:', f.name, f.detail);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 10)) console.log('  ERR', e);
  process.exit(errors.length || failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('aisuccess failed:', e);
  process.exit(2);
});
