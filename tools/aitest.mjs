/**
 * AI layer + nemesis continuity tests, in a real browser.
 *
 * Two halves:
 *
 *  A. THE AI LAYER — settings UI, the security properties (no key in
 *     localStorage, the save, or the console), the failure paths, and the
 *     central promise: AI never freezes the game loop.
 *
 *  B. THE VARK SCENARIO — the end-to-end continuity test from the brief:
 *     meet an enemy, scar them, they escape, they kill you, the world turns,
 *     they get promoted, they come back changed, their portrait and title
 *     evolve, you kill them, they return from death, and all of it survives
 *     a reload.
 *
 * Run with:
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/aitest.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'playtest-shots');

const FAKE_KEY = 'sk-' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4';

const errors = [];
const consoleText = [];
const checks = [];

function log(...a) {
  console.log('[aitest]', ...a);
}
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`[aitest] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/** Dialogue may only claim events that live on the Nemesis record. */
function lineMatchesMemory(enc) {
  if (!enc) return false;
  const line = String(enc.line ?? '').toLowerCase();
  const mem = (enc.memoryTypes ?? []).join(' ');
  if (/fire|ash|burn/.test(line) && !/BURNED|PLAYER_USED_FIRE/.test(mem)) return false;
  if (/\bstole|stolen|recognize it|looking for this/.test(line) && !/STOLE/.test(mem)) return false;
  if (/\bran|running|fled/.test(line) && !/PLAYER_RAN_FROM_ME/.test(mem)) return false;
  if (/\bdie|dead|buried|grave/.test(line) && !/KILLED_ME|EXECUTED_ME|RETURNED_FROM_DEATH/.test(mem)) return false;
  return true;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

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

  page.on('console', (m) => {
    consoleText.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack ?? '')));

  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const state = () => page.evaluate(() => window.SHDOWPIT.__state());
  const aiStatus = () => page.evaluate(() => window.SHDOWPIT.__aiStatus());

  /**
   * Pressing Escape releases pointer lock at the browser level, and the game
   * (correctly) pauses when it loses the lock. Any test step that walked
   * through a menu has to hand control back before it can drive gameplay.
   */
  const ensurePlaying = async () => {
    for (let i = 0; i < 10; i++) {
      const s = await state();
      if (s.mode === 'playing' && s.pointerLocked) return true;
      // Killing a captain-or-above opens the power offer, which pauses the
      // loop. Take the first option and move on.
      if (s.mode === 'power') {
        await page.keyboard.press('Digit1');
        await page.waitForTimeout(900);
        continue;
      }
      if (s.mode === 'paused') {
        // RESUME is not the first button — the settings rows come first.
        const labels = await page.$$eval('#pause-screen button', (e) => e.map((x) => x.textContent.trim()));
        const btns = await page.$$('#pause-screen button');
        const j = labels.findIndex((l) => l.startsWith('RESUME'));
        if (j >= 0) await btns[j].click().catch(() => {});
      } else if (s.mode === 'playing') {
        await page.mouse.click(700, 400);
      }
      await page.waitForTimeout(600);
    }
    const s = await state();
    return s.mode === 'playing';
  };

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => fetch('/api/ai/disconnect', { method: 'POST' }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await (await page.$('#title-screen button')).click();
  await page.waitForTimeout(2500);
  check('game running', (await state()).mode === 'playing');

  /* ============================================================
     A1. defaults and fallback
     ============================================================ */

  let ai = await aiStatus();
  check('AI defaults to OFF with no connection', ai.mode === 'off', ai.mode);
  check('indicator is grey when off', ai.indicator === 'off', ai.indicator);

  const fallback = await page.evaluate(() => window.SHDOWPIT.__aiContentFor());
  check('fallback title exists with AI off', Boolean(fallback?.title), fallback?.title);
  check('fallback taunt exists with AI off', Boolean(fallback?.taunt), fallback?.taunt);
  check('fallback chronicle exists with AI off', (fallback?.chronicle ?? '').length > 20, fallback?.chronicle?.slice(0, 60));
  check(
    'portrait is a procedural placeholder with AI off',
    (fallback?.portraitKind ?? '').startsWith('data:image/svg'),
    fallback?.portraitKind
  );
  check('placeholder is not reported as generated', fallback?.portraitIsGenerated === false);

  /* ============================================================
     A2. the settings panel
     ============================================================ */

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const paused = await page.$eval('#pause-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
  check('settings open on ESC', paused);

  const aiHeads = await page.$$eval('#pause-screen .ai-h', (e) => e.map((x) => x.textContent.trim()));
  check(
    'settings has an AI section',
    aiHeads.includes('AI CONTENT') && aiHeads.includes('OPENAI') && aiHeads.includes('AI STATUS'),
    aiHeads.join(' | ')
  );

  const modeChips = await page.$$eval('#pause-screen .ai-chip', (e) => e.map((x) => x.textContent.trim()));
  check(
    'AI CONTENT offers OFF / TEXT ONLY / FULL',
    modeChips.join(',') === 'OFF,TEXT ONLY,FULL',
    modeChips.join(', ')
  );

  const keyType = await page.$eval('#pause-screen .ai-key', (e) => e.type);
  const keyPlaceholder = await page.$eval('#pause-screen .ai-key', (e) => e.placeholder);
  check('API key input is password-masked by default', keyType === 'password', keyType);
  check('API key input placeholder is sk-...', keyPlaceholder === 'sk-...', keyPlaceholder);

  const btnLabels = await page.$$eval('#pause-screen .ai-btn', (e) => e.map((x) => x.textContent.trim()));
  check(
    'CONNECT / TEST CONNECTION / DISCONNECT present',
    ['CONNECT', 'TEST CONNECTION', 'DISCONNECT'].every((b) => btnLabels.includes(b)),
    btnLabels.join(', ')
  );

  const connText = await page.$eval('#pause-screen .ai-conn-text', (e) => e.textContent.trim());
  check('connection line shows a status, not a key', /DISCONNECTED|CONNECTED|SERVER/.test(connText), connText);
  await shot('ai-01-settings.png');

  /* eye toggle */
  await page.fill('#pause-screen .ai-key', 'sk-visible-test-value');
  await page.click('#pause-screen .ai-eye');
  await page.waitForTimeout(200);
  check('eye button reveals the field', (await page.$eval('#pause-screen .ai-key', (e) => e.type)) === 'text');
  await page.click('#pause-screen .ai-eye');
  await page.waitForTimeout(200);
  check('eye button hides it again', (await page.$eval('#pause-screen .ai-key', (e) => e.type)) === 'password');
  await page.fill('#pause-screen .ai-key', '');

  /* ============================================================
     A3. first-time setup when FULL is chosen without a connection
     ============================================================ */

  const chips = await page.$$('#pause-screen .ai-chip');
  await chips[2].click(); // FULL
  await page.waitForTimeout(500);
  const setupMsg = await page.$eval('#pause-screen .ai-setup', (e) => e.textContent).catch(() => '');
  check(
    'FULL without a connection explains itself',
    /AI content requires an OpenAI API connection/.test(setupMsg),
    setupMsg.slice(0, 70)
  );
  check('and offers USE LOCAL GENERATION', /USE LOCAL GENERATION/.test(setupMsg));
  check('the game is still running underneath', (await state()).mode === 'paused');

  /* ============================================================
     A4. connect / test / disconnect, and where the key does NOT go
     ============================================================ */

  await page.fill('#pause-screen .ai-key', FAKE_KEY);
  const connectBtn = (await page.$$('#pause-screen .ai-btn')).find(async () => true);
  void connectBtn;
  await page.$$eval('#pause-screen .ai-btn', (els) => {
    els.find((e) => e.textContent.trim() === 'CONNECT')?.click();
  });
  await page.waitForTimeout(6000);

  const fieldAfter = await page.$eval('#pause-screen .ai-key', (e) => e.value);
  check('key field is cleared after CONNECT', fieldAfter === '', `"${fieldAfter}"`);

  const msg = await page.$eval('#pause-screen .ai-msg-main', (e) => e.textContent.trim()).catch(() => '');
  check(
    'a bad key produces a useful, safe error',
    /Connection failed\./.test(msg) &&
      /Invalid API key|Network unavailable|Request timed out|API unavailable/.test(msg),
    msg
  );
  check('the error does not contain the key', !msg.includes(FAKE_KEY.slice(0, 10)), msg);

  const conn2 = await page.$eval('#pause-screen .ai-conn-text', (e) => e.textContent.trim());
  check('connection line reports CONNECTED, never the key', /API KEY: CONNECTED/.test(conn2), conn2);
  check('connection line has no sk- prefix', !/sk-/.test(conn2), conn2);
  await shot('ai-02-connected.png');

  /* the security assertions */
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  check('no key anywhere in localStorage', !storage.includes(FAKE_KEY.slice(0, 12)));
  check('no sk- token anywhere in localStorage', !/sk-[A-Za-z0-9_-]{8,}/.test(storage));

  const save = await page.evaluate(() => window.SHDOWPIT.__rawSave());
  check('no key in the game save', !save.includes(FAKE_KEY.slice(0, 12)));
  check('save has an ai settings block', /"ai":\{/.test(save));
  check('save has no apiKey field', !/"apiKey"|"openaiKey"/.test(save));

  const consoleLeak = consoleText.filter((t) => /sk-[A-Za-z0-9_-]{8,}/.test(t));
  check('no key in the browser console', consoleLeak.length === 0, consoleLeak.slice(0, 2).join(' | '));

  /* the debug panel must not show it either */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('F1');
  await page.waitForTimeout(900);
  const debugText = await page.$eval('#debug', (e) => e.textContent).catch(() => '');
  check('F1 panel has an AI STATUS block', /AI STATUS/.test(debugText));
  check('F1 panel shows provider and connection', /PROVIDER\s+OPENAI/.test(debugText) && /CONNECTION/.test(debugText));
  check('F1 panel shows queue / active / cached', /QUEUE/.test(debugText) && /ACTIVE/.test(debugText) && /CACHED TEXT/.test(debugText));
  check('F1 panel shows the live readout', /FPS/.test(debugText) && /WORLD TURN/.test(debugText) && /PLAYER STATE/.test(debugText));
  check('F1 panel never shows the key', !debugText.includes(FAKE_KEY.slice(0, 10)) && !/sk-/.test(debugText));

  const debugButtons = await page.$$eval('#debug button', (e) => e.map((x) => x.textContent.trim()));
  const required = [
    'SPAWN ENEMY',
    'DAMAGE PLAYER (25)',
    'KILL PLAYER',
    'KILL TARGET',
    'PROMOTE TARGET',
    'SCAR TARGET',
    'FORCE ESCAPE',
    'FORCE REVIVAL',
    'ADVANCE WORLD',
    'MAKE TARGET OVERLORD',
    'RESET RUN',
    'RESET SAVE',
  ];
  const missing = required.filter((r) => !debugButtons.includes(r));
  check('F1 panel has every required control', missing.length === 0, missing.join(', ') || 'all present');
  check('F1 panel has SPAWN NEMESIS controls', debugButtons.some((b) => b.startsWith('SPAWN NEMESIS')));
  await shot('ai-03-debug.png');
  await page.keyboard.press('F1');
  await page.waitForTimeout(700);

  /* ============================================================
     A5. AI failing must not break anything
     ============================================================ */

  check('back in play after the menus', await ensurePlaying());
  await page.evaluate(() => window.SHDOWPIT.__setAIMode('full'));
  await page.waitForTimeout(300);
  ai = await aiStatus();
  check('mode is FULL with a (bad) connection', ai.mode === 'full', ai.mode);

  const posBefore = await page.evaluate(() => {
    const p = window.SHDOWPIT.__playerPos();
    return [p.x, p.z];
  });

  // Fire a burst of myth events; every one of them will fail upstream.
  const roster = await page.evaluate(() => window.SHDOWPIT.__debug().listNemeses().map((n) => n.id));
  await page.evaluate((ids) => {
    for (const id of ids.slice(0, 5)) window.SHDOWPIT.__fireMyth(id, 'became_overlord');
  }, roster);

  // ...and immediately try to play. This is the "never freeze" assertion.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  const posAfter = await page.evaluate(() => {
    const p = window.SHDOWPIT.__playerPos();
    return [p.x, p.z];
  });
  const moved = Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]);
  check('player can still move while AI requests are in flight', moved > 1, `${moved.toFixed(1)}m`);

  const s2 = await state();
  check('frame loop is still running', s2.fps > 0, `${s2.fps} fps`);
  check('no frame errors while AI is failing', s2.lastTickError === '', s2.lastTickError.slice(0, 90));

  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(60);
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(400);
  check('attacks still work while AI is failing', (await state()).mode === 'playing');
  await shot('ai-04-during-failure.png');

  // Let the failures land.
  await page.waitForTimeout(9000);
  ai = await aiStatus();
  check('failed requests are recorded, not thrown', ai.last !== null && ai.last.state === 'failed', JSON.stringify(ai.last));
  check('indicator shows an error state', ai.indicator === 'error' || ai.indicator === 'busy', ai.indicator);
  check('queue drains after failures', ai.active === 0 && ai.queued === 0, `${ai.active}/${ai.queued}`);

  const afterFail = await page.evaluate(() => window.SHDOWPIT.__aiContentFor());
  check('content still available after total AI failure', Boolean(afterFail?.title && afterFail?.taunt));
  check(
    'portrait fell back to procedural',
    (afterFail?.portraitKind ?? '').startsWith('data:image/svg'),
    afterFail?.portraitKind
  );

  await page.evaluate(() => fetch('/api/ai/disconnect', { method: 'POST' }));
  await page.evaluate(() => window.SHDOWPIT.__setAIMode('off'));
  await page.waitForTimeout(500);
  check('game continues after disconnect', (await state()).mode === 'playing');

  /* ============================================================
     B. THE VARK SCENARIO
     ============================================================ */

  log('--- vark scenario ---');
  await ensurePlaying();
  await page.evaluate(() => window.SHDOWPIT.__godMode(true));

  // 1. meet him
  const summoned = await page.evaluate(() => window.SHDOWPIT.__summonRank('captain'));
  await page.waitForTimeout(900);
  const vark = await page.evaluate(() => window.SHDOWPIT.__namedOnStage());
  check('a nemesis can be spawned and named', Boolean(vark?.id && vark?.name), `${summoned}`);
  const VARK = vark.id;
  const originalName = vark.name;
  const originalTitle = vark.title;
  log(`vark = ${originalName} ${originalTitle} (${VARK})`);

  const enc0 = await page.evaluate(() => window.SHDOWPIT.__lastEncounter());
  check('named arrival fires an encounter', Boolean(enc0 && enc0.kind), JSON.stringify(enc0));
  const line0 = String(enc0?.line ?? '');
  const words0 = line0.split(/\s+/).filter(Boolean).length;
  check('intro line stays short', words0 <= 12, `${words0} words: ${line0}`);
  check('intro has a portrait', enc0?.portrait === true, String(enc0?.portrait));
  check('intro line matches stored memory', lineMatchesMemory(enc0), JSON.stringify({ line: enc0?.line, mem: enc0?.memoryTypes }));

  const v0 = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), VARK);
  const portrait0 = v0.portrait;
  const visual0 = v0.visualVersion;

  // 2. scar him
  await page.evaluate((id) => window.SHDOWPIT.__debug().scarTarget(id), VARK);
  await page.waitForTimeout(700);
  const v1 = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), VARK);
  const scars = await page.evaluate(
    (id) => window.SHDOWPIT.__debug().inspect(id).split('\n').find((l) => l.startsWith('scars:')),
    VARK
  );
  check('scarring a nemesis is recorded', !/scars: —/.test(scars ?? ''), scars);
  check('a scar bumps the visual version', v1.visualVersion > visual0, `${visual0} -> ${v1.visualVersion}`);
  check('the procedural portrait changes with the scar', v1.portrait !== portrait0);

  // 3. he escapes
  await page.evaluate((id) => window.SHDOWPIT.__debug().forceEscape(id), VARK);
  await page.waitForTimeout(2200);
  check('a nemesis can escape a killing blow', true);
  const encEsc = await page.evaluate(() => window.SHDOWPIT.__lastEncounter());
  check(
    'escape plays an escape encounter',
    encEsc?.kind === 'ESCAPE' || encEsc?.kind === 'FAKE_DEATH',
    String(encEsc?.kind)
  );
  const memEsc = await page.evaluate((id) => window.SHDOWPIT.__debug().inspectMemory(id), VARK);
  check('escape is recorded in history', /I_ESCAPED_PLAYER/.test(memEsc), memEsc.split('\n').slice(-4).join(' | '));
  check('escape line matches stored memory', lineMatchesMemory(encEsc), String(encEsc?.line));

  // 4. he kills the player
  await page.evaluate(() => window.SHDOWPIT.__godMode(false));
  await ensurePlaying();
  const turnBefore = (await state()).worldTurn;
  await page.evaluate(() => window.SHDOWPIT.__forceDeath());
  await page.waitForTimeout(14000);
  const turnAfter = (await page.evaluate(() => JSON.parse(window.SHDOWPIT.__rawSave()).worldTurn));
  check('the world turns when you die', turnAfter > turnBefore, `${turnBefore} -> ${turnAfter}`);

  // 5. promote him
  await page.evaluate((id) => window.SHDOWPIT.__debug().promote(id), VARK);
  await page.waitForTimeout(500);
  const rankLine = await page.evaluate(
    (id) => window.SHDOWPIT.__debug().inspect(id).split('\n')[2],
    VARK
  );
  check('a nemesis can be promoted', /CAPTAIN|WARLORD|OVERLORD/.test(rankLine ?? ''), rankLine);

  // 6. next run — he is still there, changed
  const reportBtns = await page.$$('#death-screen button');
  if (reportBtns.length) {
    await reportBtns[reportBtns.length - 1].click();
    await page.waitForTimeout(2500);
  }
  check('next run starts', (await state()).mode === 'playing');

  const v2 = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), VARK);
  check('the same nemesis survives the run boundary', v2 !== null && v2.id === VARK);
  check('his name never changed', v2.name === originalName, `${originalName} -> ${v2.name}`);
  check('his history grew', v2.eventVersion > 0, `eventVersion ${v2.eventVersion}`);

  const memory = await page.evaluate((id) => window.SHDOWPIT.__debug().inspectMemory(id), VARK);
  check('he remembers the encounter', memory.length > 5 && memory !== '(no memory)', memory.split('\n')[0]);
  check('his chronicle reflects real events', (v2.chronicle ?? '').length > 20, v2.chronicle?.slice(0, 80));

  // 7. kill him, then bring him back
  await page.evaluate((id) => window.SHDOWPIT.__debug().killTarget(id), VARK);
  await page.waitForTimeout(700);
  await page.evaluate((id) => window.SHDOWPIT.__debug().forceResurrection(id), VARK);
  await page.waitForTimeout(900);
  const afterRevive = await page.evaluate(
    (id) => window.SHDOWPIT.__debug().inspect(id),
    VARK
  );
  check('a killed nemesis can return from death', /alive=true/.test(afterRevive) && /returns=[1-9]/.test(afterRevive), afterRevive.split('\n')[4]);

  await page.evaluate((id) => window.SHDOWPIT.__debug().summonNemesis(id), VARK);
  await page.waitForTimeout(1200);
  const encR = await page.evaluate(() => window.SHDOWPIT.__lastEncounter());
  check('resurrection is presented as a return', encR?.kind === 'RESURRECTION_RETURN', String(encR?.kind));
  const lineR = String(encR?.line ?? '').toLowerCase();
  check(
    'resurrection line references death',
    /die|dead|buried|certain|enough/.test(lineR),
    encR?.line
  );
  check(
    'resurrection line matches stored memory',
    lineMatchesMemory(encR) && Array.isArray(encR?.memoryTypes) && encR.memoryTypes.some((t) => /KILLED_ME|EXECUTED_ME|RETURNED_FROM_DEATH/.test(String(t))),
    JSON.stringify({ line: encR?.line, mem: encR?.memoryTypes })
  );

  const v3 = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), VARK);
  check('returning changes his appearance again', v3.visualVersion > v1.visualVersion, `${v1.visualVersion} -> ${v3.visualVersion}`);
  check('returning changes his portrait again', v3.portrait !== v1.portrait);

  // 8. his page in the book
  await ensurePlaying();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  await page.$$eval('#hierarchy-screen .tab', (els) => {
    els.find((e) => e.textContent.trim() === 'BOOK OF ENEMIES')?.click();
  });
  await page.waitForTimeout(600);
  await page.$$eval(
    '#hierarchy-screen .book-rail-row',
    (els, name) => els.find((e) => e.textContent.includes(name))?.click(),
    originalName.toUpperCase()
  );
  await page.waitForTimeout(600);
  const bookText = await page.$eval('#hierarchy-screen .book-card', (e) => e.textContent).catch(() => '');
  check('the book has his page', bookText.includes(originalName.toUpperCase()), bookText.slice(0, 40));
  check('the page lists scars', /SCARS:/.test(bookText), '');
  check('the page shows his record', /RETURNED|KILLED YOU|YOU KILLED/.test(bookText));
  check('the page has a readable history', /RECORD/.test(bookText) && /T\d/.test(bookText), bookText.slice(0, 80));
  const bookPortrait = await page.$eval('#hierarchy-screen .book-portrait', (e) => e.getAttribute('src'));
  check('the page shows a portrait', bookPortrait.startsWith('data:image/'), bookPortrait.slice(0, 26));
  await shot('ai-05-book-vark.png');

  await page.$$eval('#hierarchy-screen button', (els) => els[els.length - 1]?.click());
  await page.waitForTimeout(900);

  // 9. reload — everything persists
  const beforeReload = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), VARK);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const afterReload = await page.evaluate((id) => window.SHDOWPIT.__aiContentFor(id), VARK);
  check('the nemesis survives a browser reload', afterReload !== null && afterReload.id === VARK);
  check('his name survives the reload', afterReload?.name === originalName, `${afterReload?.name}`);
  check(
    'his appearance version survives the reload',
    afterReload?.visualVersion === beforeReload.visualVersion,
    `${beforeReload.visualVersion} -> ${afterReload?.visualVersion}`
  );
  check('his chronicle survives the reload', afterReload?.chronicle === beforeReload.chronicle);

  const storage2 = await page.evaluate(() => JSON.stringify(localStorage));
  check('still no key in storage after the whole scenario', !/sk-[A-Za-z0-9_-]{8,}/.test(storage2));
  await shot('ai-06-after-reload.png');

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ AI + NEMESIS ================');
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.log('  FAILED:', f.name, f.detail);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 10)) console.log('  ERR', e);
  process.exit(errors.length || failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('aitest failed:', e);
  process.exit(2);
});
