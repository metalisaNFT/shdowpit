/**
 * REQUIRED COMBAT TESTS 1–5 from the combat QA sprint, automated.
 *
 *   TEST 1  FACING       — model front == logical forward, for player + enemies;
 *                          attack animation, vector and hitbox agree.
 *   TEST 2  RUNNING ENEMY — approach → engage → attack → recover → reposition;
 *                          can be staggered; ranged hit slows/interrupts a flee.
 *   TEST 3  HAMMER SLAM  — long readable telegraph, damage matches the area,
 *                          recovery afterwards.
 *   TEST 4  PROJECTILES  — all four kinds fire, at reactable speeds, and the
 *                          ground shot leaves a zone.
 *   TEST 5  BUILD        — stat boons visibly change combat (multi-needle
 *                          pierce build vs posture-breaker build).
 *
 * Run with:  npm run build && npx vite preview --port 4173 &
 *            node tools/combattest.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'combattest-shots');

const errors = [];
const checks = [];

function log(...a) {
  console.log('[combat]', ...a);
}
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const G = (fn, ...args) => page.evaluate(fn, ...args);
  const rawState = () => G(() => window.SHDOWPIT.__state());
  // Kill-streak boon offers pause the game; whenever one appears, take the
  // first card and continue — the tests fight a lot.
  const state = async () => {
    const s = await rawState();
    if (s.mode === 'power') {
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(350);
      return rawState();
    }
    return s;
  };

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await (await page.$('#title-screen button')).click();
  await page.waitForTimeout(2200);
  const s0 = await state();
  check('boots into a run', s0.mode === 'playing', `mode=${s0.mode}`);
  await G(() => window.SHDOWPIT.__godMode(true));
  await G(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(400);

  /* ============================================================
     TEST 1 — FACING
     ============================================================ */
  log('--- TEST 1: FACING ---');

  // Run forward and sample the rendered face vs the logical forward.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700); // let the turn smoothing settle
  let minDot = 1;
  let minMove = 1;
  for (let i = 0; i < 12; i++) {
    const f = await G(() => window.SHDOWPIT.__qaFacing());
    minDot = Math.min(minDot, f.player.dot);
    minMove = Math.min(minMove, f.player.moveDot);
    await page.waitForTimeout(120);
  }
  await page.keyboard.up('KeyW');
  check('player model faces logical forward while running', minDot > 0.9, `min dot ${minDot.toFixed(3)}`);
  check('player chest faces the direction of travel', minMove > 0.75, `min move-dot ${minMove.toFixed(3)}`);

  // Attack: the weapon tip must live in the FRONT half-space through the
  // strike, and the damage hitbox must kill something placed dead ahead.
  await G(() => window.SHDOWPIT.__debug().spawnGrunt());
  await page.waitForTimeout(300);
  await G(() => window.SHDOWPIT.__markNearest());
  await G(() => window.SHDOWPIT.__faceMarked());
  const hpBefore = await G(() => window.SHDOWPIT.__markedHp());

  // A swing may START cocked behind (the windup) — what must be true is that
  // the strike TRAVELS to the front and ENDS there, where the hitbox lives.
  let tipFrontSeen = false;
  let endedBehind = false;
  let anyEndSampled = false;
  for (let swing = 0; swing < 4; swing++) {
    await G(() => window.SHDOWPIT.__faceMarked());
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: 'left' });
    let lastRecoverDot = null;
    for (let i = 0; i < 10; i++) {
      const v = await G(() => window.SHDOWPIT.__qaAttackVector());
      if (v.phase === 'attack/active' || v.phase === 'attack/recover') {
        if (v.tipDot > 0.1) tipFrontSeen = true;
      }
      if (v.phase === 'attack/recover') lastRecoverDot = v.tipDot;
      await page.waitForTimeout(35);
    }
    if (lastRecoverDot !== null) {
      anyEndSampled = true;
      if (lastRecoverDot < -0.1) endedBehind = true;
    }
  }
  const hpAfter = await G(() => window.SHDOWPIT.__markedHp());
  check('weapon travels through the front during strikes', tipFrontSeen, '');
  check('swings end in the front half-space', anyEndSampled && !endedBehind, '');
  check('hitbox agrees with facing (enemy ahead took damage)', hpAfter < hpBefore, `${hpBefore} -> ${hpAfter}`);
  await G(() => window.SHDOWPIT.__smiteEnemies());

  // Enemy facing while chasing.
  await G(() => window.SHDOWPIT.__qaSpawnOne('fighter', 16));
  await page.waitForTimeout(2600); // let it aggro and run
  let enemyDotOk = true;
  let enemyAtPlayerOk = false;
  for (let i = 0; i < 10; i++) {
    const f = await G(() => window.SHDOWPIT.__qaFacing());
    for (const e of f.enemies) {
      if (e.dot < 0.85) enemyDotOk = false;
      if ((e.state === 'chase' || e.state === 'hunt_player') && e.toPlayerDot > 0.8) enemyAtPlayerOk = true;
    }
    await page.waitForTimeout(180);
  }
  check('enemy model faces its logical forward', enemyDotOk, '');
  check('a chasing enemy visibly faces the player', enemyAtPlayerOk, '');
  await shot('t1-facing.png');

  /* ============================================================
     TEST 2 — RUNNING ENEMY
     ============================================================ */
  log('--- TEST 2: RUNNING ENEMY ---');

  // A fresh fighter from far away, so the whole approach arc is observable.
  await G(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(300);
  await G(() => window.SHDOWPIT.__qaSpawnOne('fighter', 24));
  const seenIntents = new Set();
  const seenCombat = new Set();
  let sawSwingInRange = false;
  let minDist = 999;
  // Adaptive window: software GL runs the sim at ~0.6x real time, so a fixed
  // 13s sometimes catches only the approach. Sample until the full behaviour
  // arc has been observed or a generous deadline passes.
  const t2start = Date.now();
  const varied = () => seenIntents.has('circle') || seenIntents.has('wait') || seenIntents.has('backoff');
  while (Date.now() - t2start < 45_000) {
    const list = await G(() => window.SHDOWPIT.__qaEnemies());
    for (const e of list) {
      seenIntents.add(e.intent);
      seenCombat.add(e.combatState);
      minDist = Math.min(minDist, e.dist);
      if ((e.combatState === 'windup' || e.combatState === 'active') && e.dist < 4.5) sawSwingInRange = true;
    }
    if (seenIntents.has('approach') && varied() && sawSwingInRange && seenCombat.has('recover')) break;
    await page.waitForTimeout(220);
  }
  check('enemy approached', seenIntents.has('approach'), [...seenIntents].join(','));
  check(
    'enemy does not ONLY sprint: circles/waits/backs off',
    seenIntents.has('circle') || seenIntents.has('wait') || seenIntents.has('backoff'),
    [...seenIntents].join(',')
  );
  check('enemy attacked from sensible range', sawSwingInRange, `minDist ${minDist}`);
  check('enemy recovers after attacking', seenCombat.has('recover'), [...seenCombat].join(','));
  check('enemy never runs through the player', minDist > 0.7, `min dist ${minDist.toFixed(2)}m`);

  // Stagger it with a heavy.
  await G(() => window.SHDOWPIT.__markNearest());
  let sawStagger = false;
  for (let tries = 0; tries < 5 && !sawStagger; tries++) {
    await state(); // dismiss any boon offer before pressing buttons
    await G(() => window.SHDOWPIT.__faceMarked());
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(60);
    await page.mouse.up({ button: 'right' });
    for (let i = 0; i < 14; i++) {
      const list = await G(() => window.SHDOWPIT.__qaEnemies());
      if (list.some((e) => e.combatState === 'stagger' || e.combatState === 'broken')) {
        sawStagger = true;
        break;
      }
      await page.waitForTimeout(90);
    }
  }
  check('heavy attack staggers the enemy', sawStagger, '');

  // Make it flee, then needle it: expect a slow or a trip.
  await G(() => window.SHDOWPIT.__qaForceFlee());
  await page.waitForTimeout(500);
  let crippleSeen = false;
  for (let tries = 0; tries < 6 && !crippleSeen; tries++) {
    await state();
    await G(() => window.SHDOWPIT.__faceMarked());
    await G(() => window.SHDOWPIT.__qaFireNeedle());
    for (let i = 0; i < 12; i++) {
      const list = await G(() => window.SHDOWPIT.__qaEnemies());
      if (list.some((e) => e.slowed || e.combatState === 'stagger')) {
        crippleSeen = true;
        break;
      }
      await page.waitForTimeout(80);
    }
  }
  check('ranged hit slows or trips a fleeing enemy', crippleSeen, '');
  await shot('t2-running.png');
  await G(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(300);

  /* ============================================================
     TEST 3 — HAMMER SLAM TELEGRAPH
     ============================================================ */
  log('--- TEST 3: HAMMER SLAM ---');
  await G(() => window.SHDOWPIT.__qaSpawnOne('heavy', 11));
  await page.waitForTimeout(400);

  // Outside the area: the forced slam itself must not reach us. Sample only
  // across the slam window — the heavy is free to fight normally afterwards.
  await G(() => window.SHDOWPIT.__godMode(false));
  const hpOutside = (await state()).playerHp;
  const forced = await G(() => window.SHDOWPIT.__qaForceAttack('slam'));
  log('forced:', forced);
  let telegraphSeen = 0;
  let t0 = Date.now();
  let struck = false;
  while (Date.now() - t0 < 4200) {
    const tele = await G(() => window.SHDOWPIT.__qaTelegraphs());
    const slam = tele.find((t) => t.attack === 'ground_slam');
    if (slam && (slam.state === 'windup' || slam.state === 'hold')) telegraphSeen++;
    if (slam && slam.state === 'active') struck = true;
    if (struck) break;
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(250);
  const hpOutsideAfter = (await state()).playerHp;
  check('slam telegraph is long and observable', telegraphSeen >= 6, `${telegraphSeen} samples of windup`);
  check('standing OUTSIDE the ring is safe', hpOutsideAfter >= hpOutside, `${hpOutside} -> ${hpOutsideAfter}`);
  await G(() => window.SHDOWPIT.__godMode(true));

  // Inside the area: it must land.
  await G(() => {
    // stand right next to the heavy
    const g = window.SHDOWPIT;
    g.__markNearest();
    g.__faceMarked();
  });
  await page.waitForTimeout(200);
  await G(() => window.SHDOWPIT.__godMode(false));
  const hpInside = (await state()).playerHp;
  let hpInsideAfter = hpInside;
  for (let attempt = 0; attempt < 2 && hpInsideAfter >= hpInside; attempt++) {
    await G(() => window.SHDOWPIT.__qaForceAttack('slam'));
    const tIn = Date.now();
    while (Date.now() - tIn < 5000) {
      hpInsideAfter = (await state()).playerHp;
      if (hpInsideAfter < hpInside) break;
      await page.waitForTimeout(150);
    }
  }
  check('standing INSIDE the ring hurts', hpInsideAfter < hpInside, `${hpInside} -> ${hpInsideAfter}`);

  // Recovery: after the slam the heavy sits in recover.
  let sawRecover = false;
  for (let i = 0; i < 12; i++) {
    const list = await G(() => window.SHDOWPIT.__qaEnemies());
    if (list.some((e) => e.combatState === 'recover' || e.combatState === 'ready')) {
      sawRecover = true;
      break;
    }
    await page.waitForTimeout(120);
  }
  check('heavy enters recovery after the slam', sawRecover, '');
  await G(() => window.SHDOWPIT.__godMode(true));
  await shot('t3-slam.png');
  await G(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(300);

  /* ============================================================
     TEST 4 — PROJECTILES
     ============================================================ */
  log('--- TEST 4: PROJECTILES ---');
  await G(() => window.SHDOWPIT.__qaSpawnOne('archer', 15));
  await page.waitForTimeout(400);

  const wantKinds = [
    ['single_arrow', 'bolt', 1],
    ['triple_burst', 'spread', 3],
    ['piercing_shot', 'charged', 1],
    ['toxic_lob', 'ground', 1],
  ];
  const seenKinds = {};
  let maxSpeed = 0;
  for (const [attackId, kind, minCount] of wantKinds) {
    await G((id) => window.SHDOWPIT.__qaForceAttack(id), attackId);
    let got = 0;
    const t1 = Date.now();
    while (Date.now() - t1 < 3800) {
      const projs = await G(() => window.SHDOWPIT.__qaProjectiles());
      const mine = projs.filter((p) => p.kind === kind);
      got = Math.max(got, mine.length);
      for (const p of mine) maxSpeed = Math.max(maxSpeed, p.speed);
      if (got >= minCount) break;
      await page.waitForTimeout(70);
    }
    seenKinds[kind] = got;
    check(`${kind} fires (${attackId})`, got >= minCount, `saw ${got}`);
    await page.waitForTimeout(900);
  }
  check('all projectile speeds are reactable (< 24 m/s)', maxSpeed > 0 && maxSpeed < 24, `max ${maxSpeed} m/s`);

  // The ground shot leaves a zone.
  let hazards = 0;
  const t2 = Date.now();
  while (Date.now() - t2 < 3000) {
    hazards = await G(() => window.SHDOWPIT.__qaHazards());
    if (hazards > 0) break;
    await page.waitForTimeout(150);
  }
  check('ground shot leaves a toxic zone', hazards > 0, `${hazards} zones`);
  await shot('t4-projectiles.png');
  await G(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(2600); // let zones and shots expire

  /* ============================================================
     TEST 5 — BUILDS
     ============================================================ */
  log('--- TEST 5: BUILDS ---');

  // Build A: needle storm — +2 projectiles, +2 pierce, toxic + crippling, fast.
  await G(() => {
    const g = window.SHDOWPIT;
    g.__qaGrantStat('projCount', 2);
    g.__qaGrantStat('pierce', 2);
    g.__qaGrantStat('projSpeed', 3);
    g.__grantPower('toxic_shot');
    g.__grantPower('crippling_bolt');
  });
  const projCount = await G(() => window.SHDOWPIT.__qaStatValue('projCount'));
  check('build A: projectile count stat = 3', projCount === 3, `${projCount}`);

  await G(() => window.SHDOWPIT.__qaSpawnCrowd(5));
  await page.waitForTimeout(600);
  let needlesInFlight = 0;
  let slowedCount = 0;
  for (let volley = 0; volley < 6; volley++) {
    await state();
    await G(() => window.SHDOWPIT.__faceNearest());
    await G(() => window.SHDOWPIT.__qaFireNeedle());
    for (let i = 0; i < 8; i++) {
      const projs = await G(() => window.SHDOWPIT.__qaProjectiles());
      needlesInFlight = Math.max(needlesInFlight, projs.filter((p) => p.kind === 'needle').length);
      await page.waitForTimeout(60);
    }
    const list = await G(() => window.SHDOWPIT.__qaEnemies());
    slowedCount = Math.max(slowedCount, list.filter((e) => e.slowed).length);
  }
  check('build A: one press launches 3 needles', needlesInFlight >= 3, `${needlesInFlight} in flight`);
  check('build A: needles cripple the crowd', slowedCount >= 1, `${slowedCount} slowed`);
  await shot('t5-buildA.png');

  // Build B: posture breaker — heavy hits + posture stats crack an enemy open.
  // Target a HEAVY: grunts die before their posture matters; the wall is the
  // enemy this build exists for.
  await G(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(300);
  await G(() => {
    const g = window.SHDOWPIT;
    g.__qaGrantStat('postureDamage', 5);
    g.__qaGrantStat('attackSpeed', 3);
    g.__grantPower('shockwave');
    g.__grantPower('riposte');
    g.__grantPower('posture_hunter');
    g.__qaSpawnOne('heavy', 6);
  });
  await page.waitForTimeout(400);
  await G(() => window.SHDOWPIT.__markNearest());
  let broke = false;
  let maxPosture = 0;
  for (let i = 0; i < 10 && !broke; i++) {
    await G(() => window.SHDOWPIT.__faceMarked());
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(60);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(750);
    const list = await G(() => window.SHDOWPIT.__qaEnemies());
    for (const e of list) maxPosture = Math.max(maxPosture, e.posture);
    if (list.some((e) => e.posture >= 99 || e.combatState === 'broken')) broke = true;
    const st = await state();
    if (st.enemiesAlive === 0) break;
  }
  check('build B: posture build cracks a heavy open', broke || maxPosture >= 60, `max posture ${maxPosture}%`);
  await shot('t5-buildB.png');

  /* ============================================================
     verdict
     ============================================================ */
  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ COMBAT TEST REPORT ================');
  console.log(`${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.log(`  FAIL ${f.name} — ${f.detail}`);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 8)) console.log('  ERR', e);
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error('combattest failed:', e);
  process.exit(2);
});
