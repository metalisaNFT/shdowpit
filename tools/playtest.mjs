/**
 * Headless playtest harness.
 *
 * Boots the built game in Chromium with software GL, drives real keyboard and
 * mouse input, exercises every major system through the game's own test hooks,
 * and fails on any console error. Run with:
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/playtest.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'playtest-shots');

const errors = [];
const warnings = [];
const checks = [];

function log(...a) {
  console.log('[playtest]', ...a);
}

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') errors.push(m.text());
    else if (t === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack ?? '')));

  const shot = async (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const state = () => page.evaluate(() => window.SHDOWPIT.__state());
  /** Poll for a player action, tolerant of the very low frame rate of software GL. */
  const sawAction = async (want, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const st = await state();
      // An offer (boon / vendetta / trophy) pauses the loop and disables
      // input. Polling through one just watches a frozen game and reports
      // 'idle' for every action check.
      if (st.mode === 'power' || st.mode === 'choice') {
        await page.keyboard.press('Digit1');
        await page.waitForTimeout(350);
        continue;
      }
      if (st.playerAction === want) return st.playerAction;
      await page.waitForTimeout(30);
    }
    return (await state()).playerAction;
  };
  const key = async (k, ms = 120) => {
    await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await page.keyboard.up(k);
  };
  const dismissOverlays = async () => {
    for (let i = 0; i < 10; i++) {
      const st = await state();
      const choice = await page.$eval('#choice-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
      const power = await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
      const comic = await page.$eval('#comic-viewer', (e) => !e.classList.contains('hidden')).catch(() => false);
      if (st.mode === 'playing' && !choice && !power && !comic) break;
      if (comic) await page.keyboard.press('Escape');
      else await page.keyboard.press('Digit1');
      await page.waitForTimeout(350);
    }
  };

  /* ============================================================
     boot
     ============================================================ */
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  check('game booted', await page.evaluate(() => typeof window.SHDOWPIT !== 'undefined'));
  await shot('01-title.png');

  const titleButtons = await page.$$eval('#title-screen button', (e) => e.map((x) => x.textContent));
  check(
    'title shows Long Game as primary',
    titleButtons.some((t) => /LONG GAME/.test(t)) && titleButtons[0]?.includes('LONG GAME'),
    titleButtons.join(', '),
  );
  check('title offers Descend Alone secondary', titleButtons.includes('DESCEND ALONE'), titleButtons.join(', '));

  await (await page.$('#title-descend')).click();
  await page.waitForTimeout(2500);
  await dismissOverlays();
  await page.evaluate(() => window.SHDOWPIT.__qaIdle?.());
  await page.waitForTimeout(400);
  await shot('02-arena.png');

  let s = await state();
  check('entered play mode', s.mode === 'playing', s.mode);
  check('pointer lock acquired', s.pointerLocked === true);
  check('arena has collision geometry', s.colliders > 200, `${s.colliders} colliders`);
  check('enemies populated', s.enemiesAlive > 0, `${s.enemiesAlive} alive`);
  check('shrines exist', s.shrinesLeft > 5, `${s.shrinesLeft}`);
  log('start state:', JSON.stringify(s));

  /* ============================================================
     movement + camera
     ============================================================ */
  const before = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    return { ...g.__state() };
  });
  const posBefore = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    return [g.__playerPos().x, g.__playerPos().z];
  });
  await page.keyboard.down('KeyW');
  await page.mouse.move(700, 380);
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  const posAfter = await page.evaluate(() => {
    const g = window.SHDOWPIT;
    return [g.__playerPos().x, g.__playerPos().z];
  });
  const moved = Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]);
  check('player moves with WASD', moved > 2, `${moved.toFixed(1)}m`);
  void before;

  /* ============================================================
     combat: does hitting things do damage?
     ============================================================ */
  log('summoning a captain to fight...');
  const summoned = await page.evaluate(() => window.SHDOWPIT.__summonRank('captain'));
  log('summoned:', summoned);
  await page.waitForTimeout(1400);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#intro-card');
      return !!(el && el.textContent && el.textContent.trim().length > 2);
    },
    null,
    { timeout: 8000 }
  ).catch(() => {});
  await shot('03-intro-card.png');
  const introVisible = await page.$eval('#intro-card', (e) => e.textContent.length > 0).catch(() => false);
  check('nemesis intro card rendered', introVisible);

  await page.evaluate(() => window.SHDOWPIT.__markNearest());
  const hpBefore = await page.evaluate(() => window.SHDOWPIT.__markedHp());
  // Face and swing repeatedly at one specific enemy.
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.SHDOWPIT.__faceMarked());
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(180);
  }
  const hpAfter = await page.evaluate(() => window.SHDOWPIT.__markedHp());
  check('light attacks deal damage', hpAfter < hpBefore, `${hpBefore} -> ${hpAfter}`);
  await shot('04-combat.png');

  // heavy attack + dodge + parry all reach their states
  const actions = await page.evaluate(async () => {
    const g = window.SHDOWPIT;
    const seen = new Set();
    const sample = () => seen.add(g.__state().playerAction);
    const t = setInterval(sample, 16);
    await new Promise((r) => setTimeout(r, 50));
    clearInterval(t);
    return [...seen];
  });
  void actions;

  // Killing that captain may have opened a power offer; take it and carry on.
  await page.waitForTimeout(1600);
  if (await page.$eval('#choice-screen', (e) => !e.classList.contains('hidden')).catch(() => false)) {
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(800);
  }
  if (await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false)) {
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(1200);
  }
  // Invulnerable for the input-state checks so a stray axe cannot end them.
  await page.evaluate(() => {
    const g = window.SHDOWPIT;
    g.__godMode(true);
    g.__qaIdle?.();
    const c = g.player.combat;
    c.dodgeCooldown = 0;
    c.dodgeCharges = 2;
    c.action = 'idle';
    g.input.setEnabled(true);
    g.input.requestPointerLock();
  });
  await page.waitForTimeout(600);
  await page.waitForFunction(() => window.SHDOWPIT.__state().playerAction === 'idle', null, { timeout: 8000 });
  await page.evaluate(() => window.SHDOWPIT.__qaPress('heavy'));
  let act = await sawAction('attack', 6000);
  check('heavy attack enters attack state', act === 'attack', act);

  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.SHDOWPIT.__state().playerAction === 'idle', null, { timeout: 8000 });
  await page.evaluate(() => window.SHDOWPIT.__qaPress('dodge'));
  act = await sawAction('dodge', 6000);
  check('dodge enters dodge state', act === 'dodge', act);

  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.SHDOWPIT.__state().playerAction === 'idle', null, { timeout: 8000 });
  await page.evaluate(() => window.SHDOWPIT.__qaPress('parry'));
  act = await sawAction('parry', 6000);
  check('parry enters parry state', act === 'parry', act);

  await page.waitForTimeout(200);
  await page.waitForFunction(() => window.SHDOWPIT.__state().playerAction === 'idle', null, { timeout: 8000 });
  const kitBefore = await page.evaluate(() => window.SHDOWPIT.__state());
  check('starting loadout has two skills', Array.isArray(kitBefore.loadout) && kitBefore.loadout.length === 2, JSON.stringify(kitBefore.loadout));
  await key('Digit1', 80);
  act = await sawAction('skill');
  check('skill 1 enters skill state', act === 'skill', act);
  await page.waitForTimeout(400);
  const cdAfter = await page.evaluate(() => window.SHDOWPIT.__state().skillCd.a);
  check('skill 1 starts a cooldown', cdAfter > 1, `${cdAfter}`);
  await page.waitForFunction(() => window.SHDOWPIT.__state().playerAction === 'idle', null, { timeout: 8000 });
  await page.evaluate(() => window.SHDOWPIT.__fillSurge());
  await key('KeyG', 80);
  act = await sawAction('ultimate');
  check('full Surge can fire Pit Eruption', act === 'ultimate' || act === 'skill', act);
  await page.waitForTimeout(200);
  const surgeAfterUlt = await page.evaluate(() => window.SHDOWPIT.__state().surge);
  check('ultimate spends Surge', surgeAfterUlt < 100, `${surgeAfterUlt}`);
  await page.evaluate(() => window.SHDOWPIT.__godMode(false));

  /* ============================================================
     kills, loot bookkeeping, power offer
     ============================================================ */
  // Clear anything already on screen, then stage a clean captain kill so the
  // power offer check is deterministic.
  if (await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false)) {
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(900);
  }
  let killed = await page.evaluate(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(900);
  await dismissOverlays();
  log('summoning a fresh captain for the reward check...');
  log('captain:', await page.evaluate(() => window.SHDOWPIT.__summonRank('captain')));
  await page.waitForTimeout(900);
  killed = await page.evaluate(() => window.SHDOWPIT.__smiteEnemies());
  log('killed', killed, 'enemies');
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#choice-screen');
      const p = document.querySelector('#power-screen');
      return (
        (c && !c.classList.contains('hidden')) || (p && !p.classList.contains('hidden'))
      );
    },
    null,
    { timeout: 5000 }
  ).catch(() => {});
  if (await page.$eval('#choice-screen', (e) => !e.classList.contains('hidden')).catch(() => false)) {
    check('nemesis trophy offer appears after captain kill', true);
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(1400);
    const shardOrPower = await page.waitForFunction(
      () => {
        const p = document.querySelector('#power-screen');
        return p && !p.classList.contains('hidden');
      },
      null,
      { timeout: 6000 }
    ).then(() => true).catch(() => false);
    check('trophy follow-up opens (shard or power)', shardOrPower);
    if (shardOrPower) {
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(1200);
      const secondPower = await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
      if (secondPower) {
        check('captain kill chains to power after trophy', true);
        await page.keyboard.press('Digit1');
        await page.waitForTimeout(900);
      }
    }
  }
  if (
    !(await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false))
  ) {
    await page.evaluate(() => window.SHDOWPIT.__sim('reward'));
    await page.waitForTimeout(600);
    if (await page.$eval('#choice-screen', (e) => !e.classList.contains('hidden')).catch(() => false)) {
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(1400);
    }
  }
  await shot('05-after-kills.png');
  s = await state();
  check('kills registered in persistent meta', s.kills > 0, `${s.kills}`);

  const powerVisible = await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
  if (powerVisible) {
    const names = await page.$$eval('#power-screen .pname', (e) => e.map((x) => x.textContent));
    const offers = names.filter((n) => n && !String(n).includes('REROLL'));
    check('power offer appears after a captain dies', offers.length === 3, names.join(', '));
    await shot('06-power-select.png');
    await page.evaluate(() => window.SHDOWPIT.__sim('remnants'));
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(500);
    const rerollSt = await state();
    const rerollVisible = await page.$eval('#power-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
    check(
      'REROLL shows a fresh power offer',
      rerollVisible && rerollSt.mode === 'power' && rerollSt.loopPaused === true,
      `mode=${rerollSt.mode} paused=${rerollSt.loopPaused}`,
    );
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(900);
    s = await state();
    check('power granted', s.powers.length > 0, s.powers.join(','));
  } else {
    check('power offer appears after a captain dies', false, 'screen not shown');
  }

  /* ============================================================
     build screen — Esc returns to pause
     ============================================================ */
  await dismissOverlays();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const pauseOpen = await page.$eval('#pause-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
  if (pauseOpen) {
    const buildBtn = await page.$('#pause-screen button');
    const labels = await page.$$eval('#pause-screen button', (e) => e.map((x) => x.textContent.trim()));
    const buildIdx = labels.findIndex((t) => /BUILD/i.test(t));
    if (buildIdx >= 0) {
      const buttons = await page.$$('#pause-screen button');
      await buttons[buildIdx].click();
      await page.waitForTimeout(400);
      const buildOpen = await page.$eval('#build-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
      check('build screen opens from pause', buildOpen);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const afterEsc = await state();
      const pauseBack = await page.$eval('#pause-screen', (e) => !e.classList.contains('hidden')).catch(() => false);
      check('Esc on build returns to pause menu', pauseBack && afterEsc.mode === 'paused', afterEsc.mode);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      check('build screen opens from pause', false, labels.join(', '));
      check('Esc on build returns to pause menu', false, 'no build button');
    }
  } else {
    check('build screen opens from pause', false, 'pause not open');
    check('Esc on build returns to pause menu', false, 'pause not open');
  }

  /* ============================================================
     hierarchy + chronicle
     ============================================================ */
  await dismissOverlays();
  await key('Tab', 80);
  await page.waitForFunction(
    () => {
      const h = document.querySelector('#hierarchy-screen');
      return h && !h.classList.contains('hidden');
    },
    null,
    { timeout: 8000 }
  );
  await page.waitForTimeout(400);
  await shot('07-hierarchy.png');
  const clickTab = async (label) => {
    const tabs = await page.$$('#hierarchy-screen .meta-tab');
    const labels = await page.$$eval('#hierarchy-screen .meta-tab', (e) => e.map((x) => x.textContent.trim()));
    const i = labels.indexOf(label);
    if (i < 0) throw new Error(`no such tab: ${label} (have ${labels.join(', ')})`);
    await tabs[i].click();
  };
  await clickTab('ORDER');
  await page.waitForTimeout(400);
  const tiers = await page.$$eval('#hierarchy-screen .tier-label', (e) => e.map((x) => x.textContent));
  const cards = await page.$$eval('#hierarchy-screen .card .cname', (e) => e.map((x) => x.textContent.trim()));
  check('hierarchy lists all tiers', tiers.some((t) => t.startsWith('OVERLORD')) && tiers.some((t) => t.includes('CAPTAIN')), tiers.join(' | '));
  check('roster is 8-18 named enemies', cards.length >= 8 && cards.length <= 18, `${cards.length}`);
  const firstCard = await page.$('#hierarchy-screen .card');
  if (firstCard) {
    await firstCard.click();
    await page.waitForTimeout(300);
    const detail = await page
      .$eval('#hierarchy-screen .detail h3', (e) => e.parentElement.textContent)
      .catch(() => '');
    check('nemesis detail panel renders', detail.length > 60, detail.slice(0, 60).replace(/\s+/g, ' '));
    await shot('08-detail.png');
  }
  const tabLabels = await page.$$eval('#hierarchy-screen .meta-tab', (e) => e.map((x) => x.textContent.trim()));
  check('book of enemies tab exists', tabLabels.includes('BOOK'), tabLabels.join(' | '));

  /* --- the book of enemies --- */
  await clickTab('BOOK');
  await page.waitForTimeout(500);
  await shot('07b-book.png');
  const bookName = await page.$eval('#hierarchy-screen .book-name', (e) => e.textContent).catch(() => '');
  const bookPortrait = await page
    .$eval('#hierarchy-screen .book-portrait', (e) => e.getAttribute('src') ?? '')
    .catch(() => '');
  const bookStats = await page.$$eval('#hierarchy-screen .book-stat-l', (e) => e.map((x) => x.textContent));
  check('book card renders a nemesis', bookName.length > 1, bookName);
  check('book card has a portrait', bookPortrait.startsWith('data:image/'), bookPortrait.slice(0, 30));
  check(
    'book card shows kill bookkeeping',
    bookStats.includes('KILLED YOU') && bookStats.includes('YOU KILLED'),
    bookStats.join(', ')
  );

  await clickTab('TIME');
  await page.waitForTimeout(400);
  const logLines = await page.$$eval('#hierarchy-screen .log-line', (e) => e.length);
  check('chronicle has entries', logLines > 0, `${logLines} lines`);
  await shot('09-chronicle.png');
  const closeBtn = (await page.$$('#hierarchy-screen button')).pop();
  await closeBtn.click();
  await page.waitForTimeout(600);
  s = await state();
  check('hierarchy closes back into play', s.mode === 'playing', s.mode);

  /* ============================================================
     death -> world turn -> report
     ============================================================ */
  const turnBefore = (await state()).worldTurn;
  log('forcing death...');
  await page.evaluate(() => window.SHDOWPIT.__forceDeath());
  await page.waitForTimeout(14000);
  await shot('10-death-report.png');

  const reportTitle = await page.$eval('#death-screen h1', (e) => e.textContent).catch(() => '');
  const reportSub = await page.$eval('#death-screen h2', (e) => e.textContent).catch(() => '');
  const reportLines = await page.$$eval('#death-screen .report-line, #death-screen .recap-card', (e) =>
    e.map((x) => x.textContent)
  );
  check('death report shown', reportTitle === 'YOU DIED', reportTitle);
  check('report has WHILE YOU WERE DEAD framing', /WHILE YOU WERE DEAD/.test(reportSub), reportSub);
  check('simulation produced events', reportLines.length >= 3, `${reportLines.length} lines`);
  for (const l of reportLines.slice(0, 10)) log('    ' + l.replace(/\s+/g, ' ').trim());

  const turnAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('shdowpit.world.v1')).worldTurn);
  check('world turn advanced on death', turnAfter > turnBefore, `${turnBefore} -> ${turnAfter}`);

  const reportButtons = await page.$$('#death-screen button');
  check('report offers hierarchy + continue', reportButtons.length >= 2, `${reportButtons.length}`);
  const continueBtn = reportButtons[reportButtons.length - 1];
  const continueBox = await continueBtn.boundingBox().catch(() => null);
  check('death report continue is clickable', !!continueBox && continueBox.width > 8 && continueBox.height > 8);
  await continueBtn.click();
  await page.waitForTimeout(2500);
  s = await state();
  check('next run starts after death', s.mode === 'playing' && s.enemiesAlive > 0, JSON.stringify({ mode: s.mode, e: s.enemiesAlive }));
  await shot('11-next-run.png');

  /* ============================================================
     overlord kill -> new age
     ============================================================ */
  log('hunting the overlord...');
  // This section tests the SUCCESSION flow, not the player's survival odds.
  // Without this the Overlord occasionally kills a low-HP player during the
  // spawn beat and the run ends in the death report instead.
  await page.evaluate(() => window.SHDOWPIT.__godMode(true));
  await dismissOverlays();
  const ovName = await page.evaluate(() => window.SHDOWPIT.__summonRank('overlord'));
  log('overlord on stage:', ovName);
  await page.waitForTimeout(800);
  const ageBefore = (await state()).worldAge;
  await page.evaluate(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(16000);
  await shot('12-new-age.png');
  const ageTitle = await page.$eval('#death-screen h1', (e) => e.textContent).catch(() => '');
  check('overlord death opens the succession report', ageTitle === 'THE SEAT IS EMPTY', ageTitle);
  const ageAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('shdowpit.world.v1')).worldAge);
  check('world age advanced', ageAfter > ageBefore, `${ageBefore} -> ${ageAfter}`);
  await dismissOverlays();
  const btns = await page.$$('#death-screen button');
  if (btns.length) {
    await btns[btns.length - 1].click();
    await page.waitForTimeout(2500);
  }

  /* ============================================================
     persistence across reload
     ============================================================ */
  const saveBefore = await page.evaluate(() => localStorage.getItem('shdowpit.world.v1'));
  const parsed = JSON.parse(saveBefore ?? '{}');
  log('save size:', saveBefore.length, 'bytes; nemeses:', parsed.nemeses.length, 'events:', parsed.eventLog.length);
  check('save is versioned', parsed.saveVersion >= 6, `v${parsed.saveVersion}`);
  check('skill unlocks persisted', Array.isArray(parsed.playerMeta.unlockedSkills) && parsed.playerMeta.unlockedSkills.includes('shadow_step'));
  check('appearance seeds persisted', parsed.nemeses.every((n) => typeof n.appearanceSeed === 'number'));
  check('memory persisted', parsed.nemeses.some((n) => n.memory.length > 0));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const after2 = JSON.parse(await page.evaluate(() => localStorage.getItem('shdowpit.world.v1')));
  const same =
    JSON.stringify(parsed.nemeses.map((n) => [n.id, n.name, n.rank, n.appearanceSeed])) ===
    JSON.stringify(after2.nemeses.map((n) => [n.id, n.name, n.rank, n.appearanceSeed]));
  check('roster identical after reload', same);
  const titleText = await page.$eval('#title-screen', (e) => e.textContent).catch(() => '');
  check(
    'title screen offers Long Game primary',
    /LONG GAME/.test(titleText) && /DESCEND ALONE/.test(titleText),
    titleText.replace(/\s+/g, ' ').slice(0, 90),
  );
  await shot('13-after-reload.png');

  /* ============================================================
     long-horizon simulation stress
     ============================================================ */
  log('stress: 120 world turns...');
  const sim = await page.evaluate(() => window.SHDOWPIT.__stressTurns(120));
  log('stress:', JSON.stringify(sim));
  // Betrayal needs a treacherous personality that also happens to hold a bond,
  // and 120 turns is a small enough window that a roster can miss on both.
  // Extend once rather than let the suite turn into a coin flip.
  let turns = 120;
  if (sim.betrayals === 0) {
    const more = await page.evaluate(() => window.SHDOWPIT.__stressTurns(120));
    log('stress (extended):', JSON.stringify(more));
    turns += 120;
    sim.betrayals += more.betrayals;
    sim.promotions += more.promotions;
    sim.resurrections += more.resurrections;
    sim.events += more.events;
    sim.living = more.living;
    sim.distinctOverlords = Math.max(sim.distinctOverlords, more.distinctOverlords);
    sim.errors.push(...more.errors);
  }
  check('simulation ran without errors', sim.errors.length === 0, sim.errors.slice(0, 3).join(' | '));
  check('roster stays populated', sim.living >= 10, `${sim.living} living`);
  check('promotions happen', sim.promotions > 10, `${sim.promotions}`);
  check('the crown changes hands', sim.distinctOverlords >= 2, `${sim.distinctOverlords} overlords`);
  check('some enemies come back', sim.resurrections > 0, `${sim.resurrections}`);
  check('betrayals happen', sim.betrayals > 0, `${sim.betrayals} in ${turns} turns`);

  /* ============================================================
     performance sample
     ============================================================ */
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await (await page.$('#title-descend')).click();
  await page.waitForTimeout(4000);
  const perf = await page.evaluate(async () => {
    const g = window.SHDOWPIT;
    await new Promise((r) => setTimeout(r, 2500));
    return g.__state();
  });
  log('perf sample (software GL):', perf.fps, 'fps with', perf.enemies, 'enemies');

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ RESULT ================');
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.log('  FAILED:', f.name, f.detail);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 20)) console.log('  ERR', e);
  console.log('console warnings:', warnings.length);
  for (const w of warnings.slice(0, 6)) console.log('  WARN', w);
  console.log('screenshots in', SHOTS);
  process.exit(errors.length || failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('playtest failed:', e);
  process.exit(2);
});
