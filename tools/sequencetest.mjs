/**
 * THE REQUIRED PLAYTEST SEQUENCE, automated.
 *
 * Walks the 19 beats of the polish brief end to end in ONE session and
 * asserts that no major system falls apart on the way:
 *
 *   1 fresh new game            8 return encounter        15 nemesis death
 *   2 first Nemesis encounter   9 nemesis escape          16 forced resurrection
 *   3 normal combat            10 nemesis return          17 save
 *   4 ranged combat            11 skill selection         18 reload
 *   5 Heavy Hammer Slam        12 weapon swap             19 continue playing
 *   6 player death             13 armor swap
 *   7 While You Were Dead      14 item pickup
 *
 * Run with:  npm run build && npx vite preview --port 4173 &
 *            node tools/sequencetest.mjs
 */

import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'sequence-shots');

const errors = [];
const checks = [];
let step = 0;

function log(...a) {
  console.log('[seq]', ...a);
}
function beat(n, title) {
  step = n;
  console.log(`\n--- ${String(n).padStart(2, '0')}. ${title} ---`);
}
function check(name, ok, detail = '') {
  checks.push({ step, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const raw = () => ev(() => window.SHDOWPIT.__state());

  /** Read state, taking the first card of any offer that has paused the loop. */
  const state = async () => {
    for (let i = 0; i < 10; i++) {
      const s = await raw();
      const comic = await page.$eval('#comic-viewer', (e) => !e.classList.contains('hidden')).catch(() => false);
      if (comic) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(320);
        continue;
      }
      if (s.mode === 'paused') {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(320);
        continue;
      }
      if (s.mode === 'power' || s.mode === 'choice') {
        await page.keyboard.press('Digit1');
        await page.waitForTimeout(320);
        continue;
      }
      return s;
    }
    return raw();
  };
  const settle = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await state();
      await page.waitForTimeout(140);
    }
  };
  const godOn = () => ev(() => window.SHDOWPIT.__godMode(true));
  const godOff = () => ev(() => window.SHDOWPIT.__godMode(false));

  /**
   * Wait for a named-NPC presentation to actually play.
   *
   * An arrival is deliberately deferred until the player is not mid-fight,
   * with a hard deadline so it can never be starved. A fixed sleep therefore
   * races that deferral — poll for the encounter instead.
   */
  const awaitEncounter = async (pred, limitMs = 7000) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < limitMs) {
      last = await ev(() => window.SHDOWPIT.__lastEncounter());
      if (last && pred(last)) return last;
      await page.waitForTimeout(150);
    }
    return last;
  };

  /* ============================================================ */
  beat(1, 'FRESH NEW GAME');
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await ev(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const titleTxt = await page.$eval('#title-screen', (e) => e.textContent).catch(() => '');
  check('title offers a way into the world', /LONG GAME/.test(titleTxt) && /DESCEND ALONE/.test(titleTxt), titleTxt.replace(/\s+/g, ' ').slice(0, 80).trim());
  await (await page.$('#title-descend')).click();
  await page.waitForTimeout(2600);
  let s = await state();
  check('run starts in play mode', s.mode === 'playing', s.mode);
  check('arena is populated', s.enemiesAlive > 0, `${s.enemiesAlive} alive`);
  check('player is at full health', s.playerHp === s.playerMaxHp, `${s.playerHp}/${s.playerMaxHp}`);
  await shot('01-new-game.png');

  /* ============================================================ */
  beat(2, 'FIRST NEMESIS ENCOUNTER');
  await godOn();
  await ev(() => window.SHDOWPIT.__debug().spawnNemesis('captain'));
  const enc = await awaitEncounter((e) => !!e.kind);
  check('an encounter was presented', !!enc, String(enc?.kind));
  check('it is a first meeting', enc?.kind === 'FIRST_MEETING', String(enc?.kind));
  check('the card carries a portrait', enc?.portrait === true, String(enc?.portrait));
  check('the intro line is short', (enc?.line ?? '').split(/\s+/).length <= 8, enc?.line);
  const named = await ev(() => window.SHDOWPIT.__namedOnStage());
  check('the nemesis is on stage', !!named, named ? `${named.name} ${named.title}` : 'none');
  await shot('02-first-nemesis.png');
  const varkId = named?.id;

  /* ============================================================ */
  beat(3, 'NORMAL COMBAT');
  await settle(1400);
  await ev(() => window.SHDOWPIT.__markNearest());
  const hpBefore = await ev(() => window.SHDOWPIT.__markedHp());
  for (let i = 0; i < 8; i++) {
    await state();
    await ev(() => window.SHDOWPIT.__faceMarked());
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(45);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(330);
  }
  const hpAfter = await ev(() => window.SHDOWPIT.__markedHp());
  check('light attacks damage the target', hpAfter < hpBefore, `${hpBefore} -> ${hpAfter}`);
  await state();
  await ev(() => window.SHDOWPIT.__faceMarked());
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(60);
  await page.mouse.up({ button: 'right' });
  let sawHeavy = false;
  for (let i = 0; i < 20; i++) {
    const a = (await raw()).playerAction;
    if (a === 'attack') { sawHeavy = true; break; }
    await page.waitForTimeout(50);
  }
  check('heavy attack commits', sawHeavy);
  await shot('03-combat.png');

  /* ============================================================ */
  beat(4, 'RANGED COMBAT');
  await settle(900);
  // The throw is an off-hand overlay with its own short cooldown, and the
  // needle only leaves the hand ~0.1s in. Retry the press a few times and
  // poll for the projectile rather than assuming one frame catches both.
  let fired = false;
  let needles = [];
  let seen = false;
  for (let attempt = 0; attempt < 4 && !seen; attempt++) {
    await state();
    await ev(() => window.SHDOWPIT.__qaIdle());
    fired = (await ev(() => window.SHDOWPIT.__qaFireNeedle())) || fired;
    for (let i = 0; i < 24; i++) {
      needles = await ev(() => window.SHDOWPIT.__qaProjectiles());
      if (needles.some((p) => p.kind === 'needle')) { seen = true; break; }
      await page.waitForTimeout(50);
    }
  }
  check('the Void Needle fires', fired === true && seen, `fired=${fired} kinds=${needles.map((p) => p.kind).join(',') || 'none'}`);
  const nSpeed = Math.max(0, ...needles.filter((p) => p.kind === 'needle').map((p) => p.speed));
  check('needle travels at a readable speed', nSpeed > 0 && nSpeed < 40, `${nSpeed} m/s`);

  /* ============================================================ */
  beat(5, 'HEAVY HAMMER SLAM');
  await ev(() => window.SHDOWPIT.__smiteEnemies());
  await settle(2000);
  await ev(() => window.SHDOWPIT.__qaSpawnOne('heavy', 10));
  await page.waitForTimeout(400);
  await page
    .waitForFunction(
      () => {
        const s = window.SHDOWPIT.__state();
        return !!(s && !s.introActive && !s.encounterBusy && !s.loopPaused);
      },
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  await godOn();
  const forced = await ev(() => window.SHDOWPIT.__qaForceAttack('slam'));
  log('forced:', forced);
  let windupSamples = 0;
  let sawActive = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    await state();
    const tel = await ev(() => window.SHDOWPIT.__qaTelegraphs());
    const slam = tel.find((t) => t.attack === 'ground_slam');
    if (slam && (slam.state === 'windup' || slam.state === 'hold')) windupSamples++;
    if (slam && slam.state === 'active') { sawActive = true; break; }
    await page.waitForTimeout(70);
  }
  check('the slam telegraphs before it lands', windupSamples >= 5, `${windupSamples} windup samples`);
  check('the slam resolves', sawActive);
  await shot('05-hammer-slam.png');

  /* ============================================================ */
  beat(6, 'PLAYER DEATH');
  await ev(() => window.SHDOWPIT.__smiteEnemies());
  await settle(2200);
  const turnBefore = (await state()).worldTurn;
  await godOff();
  await ev(() => window.SHDOWPIT.__forceDeath());
  await page.waitForTimeout(15000);
  const deadTitle = await page.$eval('#death-screen h1', (e) => e.textContent).catch(() => '');
  check('the death screen appears', /YOU DIED/.test(deadTitle), deadTitle);

  /* ============================================================ */
  beat(7, 'WHILE YOU WERE DEAD');
  const reportTxt = await page.$eval('#death-screen', (e) => e.textContent).catch(() => '');
  check('the report is framed as WHILE YOU WERE DEAD', /WHILE YOU WERE DEAD/.test(reportTxt), '');
  const cards = await page.$$eval('#death-screen .recap-card, #death-screen .report-line', (e) => e.length);
  check('the world reports what changed', cards > 0, `${cards} entries`);
  const turnAfter = await ev(() => JSON.parse(window.SHDOWPIT.__rawSave()).worldTurn);
  check('the world turned while you were dead', turnAfter > turnBefore, `${turnBefore} -> ${turnAfter}`);
  await shot('07-while-you-were-dead.png');
  const btns = await page.$$('#death-screen button');
  const continueBtn = btns[btns.length - 1];
  const box = continueBtn ? await continueBtn.boundingBox().catch(() => null) : null;
  check('the death report continue button is clickable', !!box && box.width > 8, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'missing');
  if (btns.length) await continueBtn.click();
  await page.waitForTimeout(3000);
  s = await state();
  check('the next run begins', s.mode === 'playing', s.mode);

  /* ============================================================ */
  beat(8, 'RETURN ENCOUNTER');
  await godOn();
  if (varkId) {
    await ev((id) => window.SHDOWPIT.__debug().summonNemesis(id), varkId);
    const enc2 = await awaitEncounter((e) => e.kind !== 'FIRST_MEETING');
    check('meeting them again is not a first meeting', enc2 && enc2.kind !== 'FIRST_MEETING', String(enc2?.kind));
    check('the return acknowledges shared history', Array.isArray(enc2?.memoryTypes) && enc2.memoryTypes.length > 0, JSON.stringify(enc2?.memoryTypes ?? []));
    await shot('08-return.png');
  } else {
    check('a nemesis was carried across the run boundary', false, 'no id captured');
  }

  /* ============================================================ */
  beat(9, 'NEMESIS ESCAPE');
  const onStage = await ev(() => window.SHDOWPIT.__namedOnStage());
  const escId = onStage?.id ?? varkId;
  await ev((id) => window.SHDOWPIT.__debug().forceEscape(id), escId);
  const escEnc = await awaitEncounter((e) => e.kind === 'ESCAPE' || e.kind === 'FAKE_DEATH', 6000);
  check('the escape is presented', escEnc?.kind === 'ESCAPE' || escEnc?.kind === 'FAKE_DEATH', String(escEnc?.kind));
  let escMem = '';
  const memT0 = Date.now();
  while (Date.now() - memT0 < 2500) {
    escMem = await ev((id) => window.SHDOWPIT.__debug().inspectMemory(id), escId);
    if (/I_ESCAPED_PLAYER/.test(escMem)) break;
    await page.waitForTimeout(200);
  }
  check('the escape is written into their history', /I_ESCAPED_PLAYER/.test(escMem), escMem.split('\n').slice(-1)[0]);

  /* ============================================================ */
  beat(10, 'NEMESIS RETURN');
  await settle(1500);
  await ev((id) => window.SHDOWPIT.__debug().summonNemesis(id), escId);
  await page.waitForTimeout(3200);
  const retEnc = await ev(() => window.SHDOWPIT.__lastEncounter());
  check('they come back and it is acknowledged', !!retEnc && retEnc.kind !== 'FIRST_MEETING', String(retEnc?.kind));
  check('the returning line is short', (retEnc?.line ?? '').split(/\s+/).length <= 10, retEnc?.line);
  await shot('10-nemesis-return.png');

  /* ============================================================ */
  beat(11, 'SKILL SELECTION');
  await settle(900);
  const before = await state();
  await ev(() => window.SHDOWPIT.__debug().unlockAllSkills());
  const cast = await ev(() => {
    const g = window.SHDOWPIT;
    g.__debug().equipSkill(0, 'shadow_snare');
    g.__faceNearest();
    return g.__qaCastSkill('skill1');
  });
  check('a newly equipped skill can be cast', cast === true, String(cast));
  const afterKit = await state();
  check('the loadout reports two skills', (afterKit.loadout ?? []).length >= 2, JSON.stringify(afterKit.loadout));
  void before;

  /* ============================================================ */
  beat(12, 'WEAPON SWAP');
  const weapons = ['sword', 'spear', 'greatsword', 'hammer'];
  let swapOk = true;
  const reaches = [];
  for (const w of weapons) {
    await ev((id) => window.SHDOWPIT.__qaSetWeapon(id), w);
    await page.waitForTimeout(280);
    const info = await ev(() => ({
      id: window.SHDOWPIT.player.stats.weaponId,
      reach: +window.SHDOWPIT.player.weapon.reach.toFixed(2),
      windup: +window.SHDOWPIT.player.weapon.windup.toFixed(3),
    }));
    reaches.push(`${info.id}:${info.reach}`);
    if (info.id !== w) swapOk = false;
  }
  check('every weapon family equips', swapOk, reaches.join(' '));
  check('weapons differ mechanically', new Set(reaches.map((r) => r.split(':')[1])).size > 1, reaches.join(' '));
  await ev(() => window.SHDOWPIT.__qaSetWeapon('sword'));

  /* ============================================================ */
  beat(13, 'ARMOR SWAP');
  const armorRes = await ev(() => {
    const g = window.SHDOWPIT;
    const d = g.__debug();
    const before = g.player.stats.maxHp;
    let changed = false;
    try {
      changed = !!d.grantArmor?.();
    } catch { /* optional hook */ }
    return { before, after: g.player.stats.maxHp, changed, vigour: g.__rawSave ? JSON.parse(g.__rawSave()).playerMeta.vigour : null };
  });
  check('armor/vigour is tracked on the character', armorRes.vigour !== null, JSON.stringify(armorRes));
  check('armor swap changes maxHp when granted', armorRes.changed === true && armorRes.after > armorRes.before, JSON.stringify(armorRes));

  /* ============================================================ */
  beat(14, 'ITEM PICKUP');
  const pickup = await ev(() => {
    const g = window.SHDOWPIT;
    const before = g.player.stats.essence;
    const cache = g.arena.caches.find((c) => !c.taken);
    if (cache) {
      g.player.position.set(cache.x, 0, cache.z);
    }
    return { before, cacheFound: !!cache, cacheCount: g.arena.caches.filter((c) => !c.taken).length };
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  const afterPick = await ev(() => ({
    essence: window.SHDOWPIT.player.stats.essence,
    cachesLeft: window.SHDOWPIT.arena.caches.filter((c) => !c.taken).length,
    remnants: window.SHDOWPIT.world.run.remnants,
  }));
  check('a world pickup exists and can be reached', pickup.cacheFound, JSON.stringify(afterPick));
  check('item pickup spends a cache or grants essence', afterPick.essence > pickup.before || afterPick.cachesLeft < (pickup.cacheCount ?? 999), JSON.stringify(afterPick));

  /* ============================================================ */
  beat(15, 'NEMESIS DEATH');
  await godOn();
  await ev(() => window.SHDOWPIT.__debug().spawnNemesis('captain'));
  await page.waitForTimeout(2800);
  await settle(1200);
  const victim = await ev(() => window.SHDOWPIT.__namedOnStage());
  check('a nemesis is on stage to kill', !!victim, victim?.name);
  if (victim) {
    await ev((id) => window.SHDOWPIT.__debug().killTarget(id), victim.id);
    await page.waitForTimeout(1200);
    const deadEnc = await ev(() => window.SHDOWPIT.__lastEncounter());
    check('their death is presented', deadEnc?.kind === 'NEMESIS_DEFEATED', String(deadEnc?.kind));
    const rec = await ev((id) => window.SHDOWPIT.__debug().inspect(id), victim.id);
    check('the kill is recorded', /alive=false/.test(rec) || /youKilled=[1-9]/.test(rec), rec.split('\n').find((l) => l.startsWith('grudge')) ?? '');
    await settle(2000);
    await shot('15-nemesis-death.png');

    /* ======================================================== */
    beat(16, 'FORCED RESURRECTION');
    await ev((id) => window.SHDOWPIT.__debug().forceResurrection(id), victim.id);
    await page.waitForTimeout(900);
    const back = await ev((id) => window.SHDOWPIT.__debug().inspect(id), victim.id);
    check('they are alive again', /alive=true/.test(back), back.split('\n')[4] ?? '');
    check('the return is counted', /returns=[1-9]/.test(back), '');
    await ev((id) => window.SHDOWPIT.__debug().summonNemesis(id), victim.id);
    await page.waitForTimeout(3400);
    const resEnc = await ev(() => window.SHDOWPIT.__lastEncounter());
    check('the resurrection is presented as a return', resEnc?.kind === 'RESURRECTION_RETURN', String(resEnc?.kind));
    await shot('16-resurrection.png');
  }

  /* ============================================================ */
  beat(17, 'SAVE');
  await settle(1200);
  const saveStr = await ev(() => window.SHDOWPIT.__rawSave());
  const save = JSON.parse(saveStr);
  check('the save is versioned', save.saveVersion >= 6, `v${save.saveVersion}`);
  check('the roster persisted', Array.isArray(save.nemeses) && save.nemeses.length > 0, `${save.nemeses.length} nemeses`);
  check('memory persisted', save.nemeses.some((n) => (n.memory ?? []).length > 0));
  check('equipment persisted', !!save.playerMeta?.equipped, String(save.playerMeta?.equipped));
  check('skill unlocks persisted', (save.playerMeta?.unlockedSkills ?? []).length > 0, `${(save.playerMeta?.unlockedSkills ?? []).length} skills`);
  check('AI settings persisted', !!save.settings || !!save.aiSettings, '');
  check('NO api key anywhere in the save', !/sk-[A-Za-z0-9]/.test(saveStr), '');

  /* ============================================================ */
  beat(18, 'RELOAD');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.SHDOWPIT?.__state === 'function', { timeout: 45000 });
  await page.waitForTimeout(1500);
  const after = JSON.parse(await ev(() => window.SHDOWPIT.__rawSave()));
  const sameRoster =
    JSON.stringify(save.nemeses.map((n) => [n.id, n.name, n.rank])) ===
    JSON.stringify(after.nemeses.map((n) => [n.id, n.name, n.rank]));
  check('the roster survives a browser reload', sameRoster);
  const titleAfter = await page.$eval('#title-screen', (e) => e.textContent).catch(() => '');
  check('the title screen offers a way back in', /DESCEND ALONE/.test(titleAfter), '');
  await shot('18-after-reload.png');

  /* ============================================================ */
  beat(19, 'CONTINUE PLAYING');
  await (await page.$('#title-descend')).click();
  await page.waitForTimeout(3000);
  s = await state();
  check('play resumes from the saved world', s.mode === 'playing', s.mode);
  check('the world kept its age/turn', s.worldTurn >= 1, `turn ${s.worldTurn}, age ${s.worldAge}`);
  await settle(1200);
  await ev(() => window.SHDOWPIT.__godMode(true));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyW');
  const moved = await state();
  check('the player can still move and fight', moved.mode === 'playing' && !moved.lastTickError, moved.lastTickError || 'clean');
  await shot('19-continue.png');

  /* ============================================================ */
  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ SEQUENCE REPORT ================');
  console.log(`${checks.length - failed.length}/${checks.length} passed across 19 beats`);
  for (const f of failed) console.log(`  FAIL [step ${f.step}] ${f.name} — ${f.detail}`);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 8)) console.log('  ERR', e);
  console.log('screenshots in', SHOTS);
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error('sequencetest failed:', e);
  process.exit(2);
});
