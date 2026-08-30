/**
 * Combat / animation / camera QA audit.
 *
 * Drives the real game in headless Chromium with real input, records one
 * telemetry sample per frame (see src/core/Telemetry.ts), and then measures the
 * specific defects that are hard to see by eye: animation snapping, foot
 * sliding, clipping, camera wall-punch, unreadable crowds, hits that land
 * without visually connecting, stuck enemies, instant enemy rotation.
 *
 * Findings are printed as CRITICAL / MAJOR / MINOR / POLISH.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/qa.mjs
 *
 * Simulation turn contract: npm run test:simreg
 */

import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const SHOTS = path.join(ROOT, 'qa-shots');

const findings = [];
const notes = [];
const errors = [];

function finding(sev, area, title, detail) {
  findings.push({ sev, area, title, detail });
  console.log(`[qa] ${sev.padEnd(8)} ${area.padEnd(9)} ${title}${detail ? '  — ' + detail : ''}`);
}
function note(...a) {
  console.log('[qa]', ...a);
  notes.push(a.join(' '));
}

/* ============================================================
   analysis helpers
   ============================================================ */

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const state = () => page.evaluate(() => window.SHDOWPIT.__state());
  const dbg = (fn, ...args) => page.evaluate(fn, ...args);

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await (await page.$('#title-descend')).click();
  await page.waitForTimeout(2500);

  const s0 = await state();
  note(`booted: ${s0.enemiesAlive} enemies, ${Math.round(s0.fps)} fps (software GL)`);

  await page.evaluate(() => window.SHDOWPIT.__qaStart());

  /* ============================================================
     PLAYER LOCOMOTION + ACTION PASS
     ============================================================ */

  note('--- player locomotion ---');
  // idle
  await page.waitForTimeout(1200);
  // run forward, strafe, stop
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1400);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyD');
  // sprint
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(1400);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1000); // deceleration
  // rotate hard while running — camera vs character fight
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(640 + (i % 2 ? 260 : -260), 360);
    await page.waitForTimeout(90);
  }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(700);
  await shot('01-locomotion.png');

  note('--- player actions ---');
  await page.evaluate(() => window.SHDOWPIT.__godMode(true));
  const doAction = async (fn, label, ms = 1100) => {
    await fn();
    await page.waitForTimeout(ms);
    note(`  ${label}: action=${(await state()).playerAction}`);
  };
  // light combo x3
  for (let i = 0; i < 3; i++) {
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(230);
  }
  await page.waitForTimeout(600);
  await doAction(async () => {
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(50);
    await page.mouse.up({ button: 'right' });
  }, 'heavy');
  await doAction(async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(50);
    await page.keyboard.up('Space');
  }, 'dodge');
  await doAction(async () => {
    await page.keyboard.down('KeyQ');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyQ');
  }, 'parry');
  // attack while moving — the classic foot-slide case
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 4; i++) {
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(260);
  }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(800);
  await shot('02-attacking.png');

  /* ============================================================
     ENEMY PASS — one of each archetype
     ============================================================ */

  note('--- enemy archetypes ---');
  const archetypes = await dbg(() => {
    const g = window.SHDOWPIT;
    const out = [];
    for (const n of g.__debug().listNemeses()) {
      out.push(n.id);
    }
    return out;
  });
  void archetypes;

  // Clear the field, then bring in one fighter-ish, one heavy, one archer.
  await dbg(() => window.SHDOWPIT.__smiteEnemies());
  await page.waitForTimeout(1500);
  const spawned = await dbg(() => window.SHDOWPIT.__qaSpawnArchetypes());
  note(`  spawned: ${JSON.stringify(spawned)}`);
  await page.waitForTimeout(600);

  // Fight for a while. God mode stays ON for the first stretch so the sample
  // of enemy attack variety cannot be cut short by an early death; the last
  // stretch runs un-godded so real hits and real deaths are recorded too.
  const combatStart = Date.now();
  let ungodded = false;
  while (Date.now() - combatStart < 26000) {
    if (!ungodded && Date.now() - combatStart > 16000) {
      ungodded = true;
      await page.evaluate(() => window.SHDOWPIT.__godMode(false));
    }
    const st = await state();
    if (st.mode === 'power' || st.mode === 'choice') {
      // A kill-streak boon offer, vendetta prompt or nemesis trophy paused
      // the fight — take the first card, exactly as a player would.
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(400);
      continue;
    }
    if (st.mode !== 'playing') break;
    // simple loop: face nearest, swing, occasionally dodge and parry
    await dbg(() => window.SHDOWPIT.__faceNearest());
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(220);
    if (Math.random() < 0.25) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(40);
      await page.keyboard.up('Space');
      await page.waitForTimeout(200);
    }
    if (Math.random() < 0.2) {
      await page.keyboard.down('KeyQ');
      await page.waitForTimeout(40);
      await page.keyboard.up('KeyQ');
      await page.waitForTimeout(200);
    }
  }
  await shot('03-three-enemies.png');
  const midState = await state();
  note(`  after 22s of fighting: mode=${midState.mode} hp=${midState.playerHp} enemies=${midState.enemiesAlive}`);

  /* ============================================================
     CROWD PASS
     ============================================================ */

  note('--- crowd readability ---');
  await page.evaluate(() => window.SHDOWPIT.__godMode(true));
  await dbg(() => window.SHDOWPIT.__qaSpawnCrowd(7));
  await page.waitForTimeout(9000);
  await shot('04-crowd.png');

  /* ============================================================
     CAMERA PASS — walls and corners
     ============================================================ */

  note('--- camera vs geometry ---');
  await dbg(() => window.SHDOWPIT.__qaSeekWall());
  await page.waitForTimeout(600);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2600);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600);
  await shot('05-camera-wall.png');
  // pitch fully down and up against the wall
  for (const dy of [-300, 300, -300]) {
    await page.mouse.move(640, 360 + dy);
    await page.waitForTimeout(500);
  }
  await shot('06-camera-pitch.png');

  const dump = await page.evaluate(() => window.SHDOWPIT.__qaStop());
  note(`recorded ${dump.frames.length} frames over ${dump.wallSeconds.toFixed(1)}s`);

  /* ============================================================
     ANALYSIS
     ============================================================ */

  const F = dump.frames;
  if (F.length < 200) {
    finding('CRITICAL', 'harness', 'too few frames recorded to analyse', `${F.length}`);
  }

  /* --- 1. animation snapping: frame-to-frame rig deltas --- */
  const armDeltas = [];
  const bodyDeltas = [];
  const yawDeltas = [];
  const snaps = [];
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1];
    const b = F[i];
    const dt = Math.max(1e-4, b.t - a.t);
    if (dt > 0.25) continue; // frame hitch, not an animation event
    // Arm strikes carry over the top, so rotation values legitimately pass
    // ±π and can sit whole turns apart while rendering the same pose. Judge
    // the VISUAL delta (wrapped), which is what a snap actually is.
    const dArm = Math.abs(wrapPi(b.armR - a.armR));
    const dBody = Math.abs(b.bodyX - a.bodyX);
    const dYaw = Math.abs(wrapPi(b.rigYaw - a.rigYaw));
    armDeltas.push(dArm);
    bodyDeltas.push(dBody);
    yawDeltas.push(dYaw);
    // A snap is a large pose change in one frame that is NOT explained by a
    // state change (state changes are allowed to be sharp, but not teleporty).
    // Only judgeable at a real frame rate. Below ~30fps a single frame can
    // legitimately span an entire 0.07s active window, so a big delta says
    // nothing about whether the animation is continuous.
    if (dArm > 1.2 && a.action === b.action && dt < 0.034) {
      snaps.push({ t: b.t.toFixed(2), from: a.action, d: dArm.toFixed(2), phase: `${a.phase}->${b.phase}` });
    }
  }
  note(`arm delta p50=${percentile(armDeltas, 0.5).toFixed(3)} p99=${percentile(armDeltas, 0.99).toFixed(3)} max=${Math.max(...armDeltas).toFixed(3)}`);
  note(`body delta p99=${percentile(bodyDeltas, 0.99).toFixed(3)}  yaw delta p99=${percentile(yawDeltas, 0.99).toFixed(3)}`);
  const fastFrames = F.filter((f, i) => i > 0 && f.t - F[i - 1].t < 0.034).length;
  if (fastFrames < 60) {
    note(
      `animation snapping: INCONCLUSIVE — only ${fastFrames} frames were fast enough to judge ` +
        `(software GL runs at ~12fps here). Pose blending makes the rig continuous by construction; ` +
        `verify on real hardware.`
    );
  } else if (snaps.length > 0) {
    finding(
      'MAJOR',
      'animation',
      'arm pose snaps within a single action',
      `${snaps.length} snaps > 1.2 rad in one frame; e.g. ${JSON.stringify(snaps.slice(0, 3))}`
    );
  }

  /* --- 2. rig yaw vs logical facing: character fighting the camera --- */
  let yawLag = 0;
  let yawLagMax = 0;
  for (const f of F) {
    const d = Math.abs(wrapPi(f.rigYaw - f.facing));
    yawLag += d;
    if (d > yawLagMax) yawLagMax = d;
  }
  const yawLagAvg = yawLag / Math.max(1, F.length);
  note(`rig-vs-logical yaw: avg=${yawLagAvg.toFixed(3)} rad, max=${yawLagMax.toFixed(3)} rad`);
  // A lag is expected and desirable now that the rig turns at a finite rate.
  // Only a *sustained* lag is a problem, so judge the average, not the peak.
  if (yawLagAvg > 0.25) {
    finding(
      'MINOR',
      'animation',
      'rendered facing lags logical facing on average',
      `avg ${(yawLagAvg * 57.3).toFixed(0)}deg — attacks resolve along logical facing, so hits can look off-axis`
    );
  } else {
    note(`turn smoothing healthy: avg lag ${(yawLagAvg * 57.3).toFixed(1)}deg`);
  }
  // Only count a rig-yaw jump as a snap if the LOGICAL facing did not jump with
  // it. When both move together the player was teleported (test hooks do this),
  // which says nothing about the turn smoothing.
  let instantYaw = 0;
  for (let i = 1; i < F.length; i++) {
    const dRig = Math.abs(wrapPi(F[i].rigYaw - F[i - 1].rigYaw));
    const dLogical = Math.abs(wrapPi(F[i].facing - F[i - 1].facing));
    if (dRig > 0.8 && dLogical < 0.4) instantYaw++;
  }
  if (instantYaw > 0) {
    finding('MINOR', 'animation', 'player yaw jumps without a facing change', `${instantYaw} frames > 0.8 rad`);
  } else {
    note('no unexplained rig-yaw snaps');
  }

  /* --- 3. foot sliding: moving fast while the walk cycle is frozen --- */
  let slideFrames = 0;
  let slideWorst = 0;
  let locoFrames = 0;
  let actionSlide = 0;
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1];
    const b = F[i];
    const dt = Math.max(1e-4, b.t - a.t);
    if (dt > 0.25) continue;
    const phaseRate = Math.abs(b.walkPhase - a.walkPhase) / dt;
    const moving = b.speed > 1.6;
    // A dodge, attack lunge or skill dash plays its OWN clip and moves by
    // design — that is root motion, not foot slide. Real foot slide is the
    // locomotion state failing to cycle while the character runs, so only
    // free-movement frames count toward the defect.
    const freeMove = b.action === 'idle';
    if (moving && freeMove) {
      locoFrames++;
      if (phaseRate < 0.4) {
        slideFrames++;
        if (b.speed > slideWorst) slideWorst = b.speed;
      }
    } else if (moving && phaseRate < 0.4) {
      actionSlide++;
    }
  }
  const slidePct = (slideFrames / Math.max(1, locoFrames)) * 100;
  note(
    `foot slide: ${slideFrames}/${locoFrames} free-movement frames (${slidePct.toFixed(1)}%), ` +
      `worst ${slideWorst.toFixed(1)} m/s; ${actionSlide} action-clip frames excluded (root motion)`
  );
  if (slidePct > 4) {
    finding(
      'MAJOR',
      'animation',
      'feet stop cycling while the body keeps moving',
      `${slidePct.toFixed(1)}% of frames, up to ${slideWorst.toFixed(1)} m/s — dodges and attacks slide`
    );
  }

  /* --- 4. player grounding --- */
  const ys = F.map((f) => f.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  note(`player y range: ${yMin.toFixed(3)} .. ${yMax.toFixed(3)}`);
  if (yMin < -0.05) finding('MAJOR', 'player', 'player sinks below the floor', `min y ${yMin.toFixed(3)}`);
  if (yMax > 0.6) finding('MINOR', 'player', 'player floats', `max y ${yMax.toFixed(3)}`);

  /* --- 5. clipping into enemies --- */
  const overlaps = F.map((f) => f.overlap).filter((o) => o > 0);
  const worstOverlap = overlaps.length ? Math.max(...overlaps) : 0;
  const overlapFrames = F.filter((f) => f.overlap > 0.25).length;
  note(`enemy overlap: worst ${worstOverlap.toFixed(2)}m, ${overlapFrames} frames > 0.25m`);
  if (worstOverlap > 0.7) {
    finding(
      'MAJOR',
      'collision',
      'player and enemies interpenetrate',
      `up to ${worstOverlap.toFixed(2)}m of overlap — capsules are not separated`
    );
  } else if (worstOverlap > 0.3) {
    finding('MINOR', 'collision', 'mild player/enemy interpenetration', `${worstOverlap.toFixed(2)}m`);
  }

  /* --- 6. crowd readability: simultaneous attackers --- */
  const attackHist = {};
  let maxAttackers = 0;
  let framesWith3Plus = 0;
  for (const f of F) {
    attackHist[f.attackers] = (attackHist[f.attackers] ?? 0) + 1;
    if (f.attackers > maxAttackers) maxAttackers = f.attackers;
    if (f.attackers >= 3) framesWith3Plus++;
  }
  note(`simultaneous attackers histogram: ${JSON.stringify(attackHist)}`);
  // The director caps melee and ranged separately (2 + 1 by default), so 3 is
  // the intended ceiling and 4 is the failure.
  if (maxAttackers >= 4) {
    finding(
      'MAJOR',
      'combat',
      'more simultaneous attackers than the director permits',
      `up to ${maxAttackers} at once, ${framesWith3Plus} frames with 3+`
    );
  } else {
    note(`attacker cap holding: max ${maxAttackers} simultaneous (director allows 2 melee + 1 ranged)`);
  }

  /* --- 7. camera: wall punch-in and framing --- */
  const camDists = F.map((f) => f.camToPlayer);
  const camMin = Math.min(...camDists);
  const camP01 = percentile(camDists, 0.01);
  note(`camera distance: min ${camMin.toFixed(2)}m, p1 ${camP01.toFixed(2)}m, p50 ${percentile(camDists, 0.5).toFixed(2)}m`);
  // When the orbit has to come in tight the game dissolves the player rather
  // than shoving the lens into the wall, so "close" is only a defect if the
  // fade did NOT engage and the frame really is full of torso.
  const closeFrames = F.filter((f) => f.camToPlayer < 2.6);
  const fadedWhenClose = closeFrames.length
    ? closeFrames.filter((f) => (f.playerFade ?? 1) < 0.85).length / closeFrames.length
    : 1;
  note(
    `close-camera frames: ${closeFrames.length}, faded on ${(fadedWhenClose * 100).toFixed(0)}% of them`
  );
  if (camMin < 1.2) {
    finding(
      'MAJOR',
      'camera',
      'camera pushes inside the player against walls',
      `min distance ${camMin.toFixed(2)}m — near plane is 0.1 so geometry clips through`
    );
  } else if (camMin < 2.2 && closeFrames.length > 3 && fadedWhenClose < 0.6) {
    finding(
      'MINOR',
      'camera',
      'camera gets close at walls without the player fading out',
      `${camMin.toFixed(2)}m, faded on only ${(fadedWhenClose * 100).toFixed(0)}% of close frames`
    );
  }
  // camera jitter: large frame-to-frame distance changes
  let camJumps = 0;
  for (let i = 1; i < F.length; i++) {
    const dt = Math.max(1e-4, F[i].t - F[i - 1].t);
    if (dt > 0.25) continue;
    if (Math.abs(F[i].camToPlayer - F[i - 1].camToPlayer) / dt > 45) camJumps++;
  }
  if (camJumps > 6) {
    finding('MINOR', 'camera', 'camera distance snaps', `${camJumps} frames with >45 m/s distance change`);
  }

  /* --- 8. hits that land without visually connecting --- */
  const playerHits = dump.hits.filter((h) => h.attacker === 'player' && h.amount > 0);
  const enemyHits = dump.hits.filter((h) => h.target === 'player' && h.amount > 0);
  const stretched = enemyHits.filter((h) => h.reach > 0 && h.dist > h.reach * 0.95);
  note(`hits recorded: ${playerHits.length} by player, ${enemyHits.length} on player`);
  // Lunging attacks (thrust, charge) legitimately connect near full
  // extension, so this is only meaningful as a PATTERN — judge it on a real
  // sample, not on one or two hits.
  if (enemyHits.length >= 6 && stretched.length / enemyHits.length > 0.25) {
    finding(
      'MAJOR',
      'combat',
      'enemy hits land at the very edge of reach',
      `${stretched.length}/${enemyHits.length} at >95% of reach — reads as being hit from too far away`
    );
  }
  // Hits landing while the player was mid-dodge but outside i-frames
  const dodgedThrough = enemyHits.filter((h) => h.victimAction === 'dodge');
  if (dodgedThrough.length) {
    finding(
      'MINOR',
      'combat',
      'hits land during the dodge animation',
      `${dodgedThrough.length} — i-frames cover 0.03..0.26 of a 0.36s dodge, so the tail is exposed`
    );
  }

  /* --- 9. enemy behaviour --- */
  const byUid = {};
  for (const e of dump.enemies) {
    (byUid[e.uid] ??= []).push(e);
  }
  let stuckEnemies = 0;
  let instantTurners = 0;
  let slidingAttackers = 0;
  let attackingThroughWalls = 0;
  for (const [uid, samples] of Object.entries(byUid)) {
    if (samples.length < 60) continue;
    // stuck: wants to chase, is far, but has not moved
    let chaseFrames = 0;
    let movedWhileChasing = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const dt = Math.max(1e-4, b.t - a.t);
      if (dt > 0.25) continue;
      const moved = Math.hypot(b.x - a.x, b.z - a.z);
      if ((b.state === 'chase' || b.state === 'hunt_player') && b.distToPlayer > 4) {
        chaseFrames++;
        if (moved > 0.004) movedWhileChasing++;
      }
      const dYaw = Math.abs(wrapPi(b.facing - a.facing)) / dt;
      if (dYaw > 14) instantTurners++;
      if (b.combatState === 'active' && moved / dt > 5.5) slidingAttackers++;
    }
    if (chaseFrames > 40 && movedWhileChasing / chaseFrames < 0.25) {
      stuckEnemies++;
      note(`  enemy ${uid} appears stuck: moved in ${movedWhileChasing}/${chaseFrames} chase frames`);
    }
  }
  // attacks landing with no line of sight
  const losBlocked = F.filter((f) => !f.nearestLos && f.nearestDist > 0 && f.nearestDist < 3).length;
  attackingThroughWalls = losBlocked;

  if (stuckEnemies > 0) {
    finding('MAJOR', 'enemy', 'enemies get stuck while chasing', `${stuckEnemies} enemies barely moved while in chase state`);
  }
  if (instantTurners > 30) {
    finding(
      'MAJOR',
      'enemy',
      'enemies rotate instantly',
      `${instantTurners} samples turning faster than 14 rad/s — no visible turn animation`
    );
  }
  if (slidingAttackers > 20) {
    finding('MINOR', 'enemy', 'enemies slide during the active frame of a swing', `${slidingAttackers} samples > 5.5 m/s`);
  }
  if (attackingThroughWalls > 30) {
    finding('MINOR', 'enemy', 'enemies close to melee range with no line of sight', `${attackingThroughWalls} frames`);
  }

  /* --- 10. telegraph readability --- */
  // How long is a windup, in practice?
  const windupRuns = [];
  for (const samples of Object.values(byUid)) {
    let start = null;
    for (const s of samples) {
      if (s.combatState === 'windup' && start === null) start = s.t;
      else if (s.combatState !== 'windup' && start !== null) {
        windupRuns.push(s.t - start);
        start = null;
      }
    }
  }
  if (windupRuns.length) {
    note(
      `windup duration: n=${windupRuns.length} p05=${percentile(windupRuns, 0.05).toFixed(2)}s ` +
        `p50=${percentile(windupRuns, 0.5).toFixed(2)}s p95=${percentile(windupRuns, 0.95).toFixed(2)}s`
    );
    const shortOnes = windupRuns.filter((w) => w < 0.35).length;
    if (shortOnes / windupRuns.length > 0.2) {
      finding(
        'MAJOR',
        'combat',
        'many attack telegraphs are too short to read',
        `${shortOnes}/${windupRuns.length} windups under 0.35s`
      );
    }
  } else {
    finding('MINOR', 'harness', 'no enemy windups captured', 'enemies may not have engaged');
  }

  /* --- 10b. attack variety and intent mix --- */
  const attackIds = {};
  const intents = {};
  let postureBreaks = 0;
  let lastPosture = {};
  for (const e of dump.enemies) {
    if (e.attackId) attackIds[e.attackId] = (attackIds[e.attackId] ?? 0) + 1;
    if (e.intent) intents[e.intent] = (intents[e.intent] ?? 0) + 1;
    const prev = lastPosture[e.uid] ?? 0;
    if (prev > 0.7 && e.postureFrac === 0) postureBreaks++;
    lastPosture[e.uid] = e.postureFrac;
  }
  const distinctAttacks = Object.keys(attackIds).length;
  note(`distinct enemy attacks used: ${distinctAttacks} -> ${JSON.stringify(attackIds)}`);
  note(`telegraph intent mix: ${JSON.stringify(intents)}`);
  note(`posture breaks observed: ${postureBreaks}`);
  if (distinctAttacks < 3) {
    finding('MAJOR', 'combat', 'enemies are using very few distinct attacks', `${distinctAttacks} seen`);
  }
  if (!intents.parryable) {
    finding('MINOR', 'combat', 'no parryable attack was offered during the run', 'cyan never appeared');
  }

  /* --- 11. deaths --- */
  if (dump.deaths.length) {
    note(`--- player deaths (${dump.deaths.length}) ---`);
    for (const d of dump.deaths) {
      note(
        `  killed by ${d.killerName} via ${d.attackSource} for ${Math.round(d.damage)} ` +
          `(hp ${Math.round(d.hpBefore)}) while ${d.playerAction}` +
          `${d.unblockable ? ' [UNBLOCKABLE]' : ''} at ${d.distance.toFixed(1)}m`
      );
    }
  }

  /* --- 12. frame rate sanity --- */
  const fpsVals = F.map((f) => f.fps).filter((v) => v > 0);
  note(`fps p50=${percentile(fpsVals, 0.5).toFixed(0)} p05=${percentile(fpsVals, 0.05).toFixed(0)} (software GL, not indicative)`);

  await browser.close();

  /* ============================================================
     report
     ============================================================ */

  const order = { CRITICAL: 0, MAJOR: 1, MINOR: 2, POLISH: 3 };
  findings.sort((a, b) => order[a.sev] - order[b.sev]);
  console.log('\n================ QA REPORT ================');
  for (const sev of ['CRITICAL', 'MAJOR', 'MINOR', 'POLISH']) {
    const list = findings.filter((f) => f.sev === sev);
    console.log(`\n${sev} (${list.length})`);
    if (!list.length) console.log('  none');
    for (const f of list) console.log(`  [${f.area}] ${f.title}\n      ${f.detail}`);
  }
  console.log('\nconsole errors:', errors.length);
  for (const e of errors.slice(0, 10)) console.log('  ERR', e);
  console.log('screenshots in', SHOTS);

  fs.writeFileSync(path.join(SHOTS, 'qa-report.json'), JSON.stringify({ findings, notes }, null, 2));

  /* ---- simulation regression gate ---- */
  try {
    const { spawnSync } = await import('node:child_process');
    const sim = spawnSync(process.execPath, [path.join(ROOT, 'tools/simregtest.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PLAYTEST_URL: URL_BASE },
    });
    if (sim.stdout) note(sim.stdout.trim());
    if (sim.status !== 0) {
      finding('CRITICAL', 'simreg', 'simulation regression failed', (sim.stderr || sim.stdout || '').slice(0, 200));
    } else {
      note('simreg: PASS');
    }
  } catch (err) {
    finding('CRITICAL', 'simreg', 'simreg harness threw', String(err));
  }

  const critical = findings.filter((f) => f.sev === 'CRITICAL').length;
  if (critical > 0 || errors.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error('qa failed:', e);
  process.exit(2);
});
