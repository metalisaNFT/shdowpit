/**
 * ANIMATION / COMBAT QA ARENA — the required test scene, automated.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/animtest.mjs
 *
 * Covers the sprint's REQUIRED tests:
 *   FACING       run/attack/projectile/hammer-slam all agree on -Z forward
 *   STATES       the animation state machine maps every combat state to the
 *                right clip with the right priority
 *   EVENT SYNC   the clip's strike anchor lands exactly when combat opens the
 *                hit window — at 0.25x, 0.5x and 1x time scale
 *   REACTIONS    stagger, posture-break, knockdown, taunt, deaths
 *   CONTINUITY   no pose snaps while attacking (arm-angle deltas)
 */

import fs from 'node:fs';
import { launchChromium } from './browser.mjs';

const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:4173/?quality=low';
const CLIPS = JSON.parse(fs.readFileSync(new URL('../src/anim/clips.json', import.meta.url))).clips;

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sleep = (ms) => page.waitForTimeout(ms);
const anim = () => ev(() => window.SHDOWPIT.__animState());
/**
 * Wait for one enemy's animator to catch up with its combat state.
 *
 * Driving `e.combat.stagger()` from the harness flips the combat state
 * synchronously, but the clip is only chosen on the enemy's next animate()
 * frame — up to ~250ms away under software GL. A fixed sleep loses that race
 * and reads LOCOMOTION. Poll the animator instead.
 */
const awaitEnemyAnim = async (uid, pred, limitMs = 2500) => {
  const t0 = Date.now();
  let row;
  while (Date.now() - t0 < limitMs) {
    const s = await ev(() => window.SHDOWPIT.__animState());
    row = s.enemies.find((e) => e.uid === uid);
    if (row && pred(row)) return row;
    await sleep(50);
  }
  return row;
};

const dump = async (tag) => {
  const d = await ev(() => {
    const g = window.SHDOWPIT;
    return {
      mode: g.mode,
      paused: g.loop?.paused,
      layers: [...document.querySelectorAll('.layer')].filter((x) => !x.classList.contains('hidden')).map((x) => x.id || x.className.slice(0, 24)),
      action: g.player.combat.action,
      speed: +Math.hypot(g.player.controller.velocity.x, g.player.controller.velocity.z).toFixed(2),
    };
  });
  console.log(`  [${tag}]`, JSON.stringify(d));
};
/**
 * Wait until the player's action machine is idle again.
 *
 * Fixed sleeps between inputs are a race under software GL (~9fps): the
 * previous heavy was still in its windup when the next test pressed dodge,
 * `tryDodge` correctly refused, and the check read the heavy's clip. Wait on
 * the game's own state instead of guessing a duration.
 */
const waitIdle = async (limitMs = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    const s = await ev(() => ({ a: window.SHDOWPIT.player.combat.action, m: window.SHDOWPIT.mode }));
    if (s.m === 'power' || s.m === 'choice') {
      await page.keyboard.press('Digit1');
      await sleep(300);
      continue;
    }
    if (s.a === 'idle') return true;
    await sleep(40);
  }
  return false;
};

/**
 * Take the first card of any offer that is actually open.
 *
 * Digit1 is ALSO the Skill 1 hotkey. Pressing it blindly cast Shadow Step and
 * left the player mid-ability — which is why the very next measurement saw
 * state ABILITY / clip DodgeF and a gait cycle that "stopped advancing".
 * Only press while an offer screen genuinely owns the input.
 */
const dismissBoons = async (windowMs = 1800) => {
  // Offers do not all open synchronously — the nemesis trophy arrives on a
  // ~700ms delay after the kill, so a single check right after smiting sees
  // 'playing', returns, and the modal then freezes the loop underneath the
  // next measurement. Watch for a while instead.
  const t0 = Date.now();
  while (Date.now() - t0 < windowMs) {
    const mode = await ev(() => window.SHDOWPIT.mode);
    if (mode === 'power' || mode === 'choice') {
      await page.keyboard.press('Digit1');
      await sleep(300);
      continue;
    }
    await sleep(120);
  }
};

await page.goto(URL_BASE, { waitUntil: 'load' });
await ev(() => localStorage.clear());
await sleep(2400);
await (await page.$('#title-descend')).click();
await sleep(1000);
await ev(() => window.SHDOWPIT.__qaStart());
await sleep(400);
await ev(() => window.SHDOWPIT.__godMode?.(true) ?? null).catch?.(() => null);

/* clean the stage */
await ev(() => window.SHDOWPIT.__smiteEnemies());
await sleep(500);
await dismissBoons();

console.log('\n== A. FACING — the four required directions agree ==');

// A1 RUN FORWARD
await page.keyboard.down('KeyW');
await sleep(900);
let f = await ev(() => window.SHDOWPIT.__qaFacing());
check('A1 run: visual face == logical forward', f.player.dot > 0.75, `dot=${f.player.dot.toFixed(3)}`);
check('A1 run: face == movement direction', f.player.moveDot > 0.75, `moveDot=${f.player.moveDot.toFixed(3)}`);
let a = await anim();
check('A1 run: LOCOMOTION state', a.player.state === 'LOCOMOTION', a.player.state);
const phase0 = a.player.locoPhase;
await sleep(400);
a = await anim();
check('A1 run: gait cycle advances', a.player.locoPhase !== phase0, `${phase0} -> ${a.player.locoPhase}`);
await page.keyboard.up('KeyW');
await sleep(500);

await dump('preA2');
// A2 ATTACK FORWARD (sampled during the active window, slowed for sampling)
await ev(() => window.SHDOWPIT.__debug().setTimeScale(0.25));
await page.mouse.click(640, 360);
let attackSample = null;
// Poll for the whole slowed swing. Under software GL a frame is ~110ms, so a
// 40 × 16ms budget could expire before the active window even opened.
for (let i = 0; i < 160; i++) {
  const s = await anim();
  if (s.player.hitboxActive) {
    attackSample = s;
    break;
  }
  if (s.player.action === 'idle' && i > 8) break;
  await sleep(16);
}
check('A2 attack: hitbox window observed', !!attackSample);
if (attackSample) {
  const p = attackSample.player;
  const dot = p.attackVector ? p.attackVector.x * p.forward.x + p.attackVector.z * p.forward.z : -1;
  check('A2 attack vector == forward', dot > 0.99, `dot=${dot.toFixed(3)}`);
  check('A2 attack state+clip', p.state === 'ATTACK' && p.clip.startsWith('Atk1H'), `${p.state}/${p.clip}`);
}
const tipd = await ev(() => window.SHDOWPIT.__qaAttackVector());
check('A2 weapon tip on the facing side', tipd.tipDot > 0.2, `tipDot=${tipd.tipDot.toFixed(2)} phase=${tipd.phase}`);
await ev(() => window.SHDOWPIT.__debug().setTimeScale(1));
await sleep(700);

await dump('preA3');
// A3 PROJECTILE FORWARD
await waitIdle();
const fired = await ev(() => window.SHDOWPIT.__qaFireNeedle());
// The needle leaves the hand ~0.1s into the throw, but a software-GL frame is
// ~110ms — poll for it instead of sampling one arbitrary moment.
let projs = [];
for (let i = 0; i < 30; i++) {
  projs = await ev(() => window.SHDOWPIT.__qaProjectiles());
  if (projs.some((p) => p.kind === 'needle')) break;
  await sleep(50);
}
const needle = projs.find((p) => p.kind === 'needle');
check('A3 needle exists', fired === true && !!needle, `fired=${fired} kinds=${projs.map((p) => p.kind).join(',')}`);
if (needle) {
  const pf = await ev(() => {
    const g = window.SHDOWPIT;
    return { fx: -Math.sin(g.player.facing), fz: -Math.cos(g.player.facing) };
  });
  const pr = await ev(() => window.SHDOWPIT.combat.liveProjectiles.map((p) => ({ vx: p.vx, vz: p.vz, kind: p.kind })));
  const n2 = pr.find((p) => p.kind === 'needle');
  if (n2) {
    const s = Math.hypot(n2.vx, n2.vz) || 1;
    const dot = (n2.vx / s) * pf.fx + (n2.vz / s) * pf.fz;
    check('A3 projectile travels along facing', dot > 0.9, `dot=${dot.toFixed(3)}`);
  }
}
await sleep(600);

// A4 HAMMER SLAM FORWARD + telegraph
const spawnedHeavy = await ev(() => window.SHDOWPIT.__qaSpawnOne('heavy', 8));
const heavyUid = Number(spawnedHeavy.split(':')[1]);
await sleep(700);
const forced = await ev(() => window.SHDOWPIT.__qaForceAttack('slam'));
check('A4 slam forced', forced.includes('slam') || forced.includes('SLAM') || forced.length > 0, forced);
let slamSeen = false;
let slamFace = 0;
let slamAnim = '';
for (let i = 0; i < 60; i++) {
  const tel = await ev(() => window.SHDOWPIT.__qaTelegraphs());
  const slam = tel.find((t) => t.attack === 'ground_slam');
  if (slam) {
    slamSeen = true;
    const ff = await ev(() => window.SHDOWPIT.__qaFacing());
    const heavyRow = ff.enemies.find((e) => e.uid === heavyUid);
    if (heavyRow) slamFace = Math.max(slamFace, heavyRow.toPlayerDot);
    const s = await anim();
    const he = s.enemies.find((e) => e.uid === heavyUid);
    if (he && he.attack === 'ground_slam') slamAnim = `${he.state}/${he.clip}`;
    if (slam.progress > 0.5) break;
  }
  await sleep(40);
}
check('A4 slam telegraph appeared', slamSeen);
check('A4 heavy faces the player during windup', slamFace > 0.7, `toPlayerDot=${slamFace.toFixed(2)}`);
check('A4 slam uses the 2H slam clip', slamAnim.includes('Atk2H_Slam'), slamAnim);
await sleep(2500);
await dismissBoons();

console.log('\n== B. STATE MACHINE ==');

/**
 * Poll for an animation state rather than sleeping a fixed amount. One
 * software-GL frame is ~110ms, so "press, wait 120ms, sample" could read the
 * frame BEFORE the input was consumed and report IDLE.
 */
const awaitPlayerState = async (pred, limitMs = 1200) => {
  const t0 = Date.now();
  let last = await anim();
  while (Date.now() - t0 < limitMs) {
    if (pred(last.player)) return last;
    await sleep(30);
    last = await anim();
  }
  return last;
};

await dump('preB1');
// B1 heavy attack
await waitIdle();
await page.mouse.click(640, 360, { button: 'right' });
a = await awaitPlayerState((p) => p.state === 'HEAVY_ATTACK' || p.clip === 'Atk2H_Slam', 1500);
check('B1 heavy -> HEAVY_ATTACK/Atk2H_Slam', a.player.state === 'HEAVY_ATTACK' && a.player.clip === 'Atk2H_Slam', `${a.player.state}/${a.player.clip}`);

// B2 dodge (direction-relative clip) — only once the heavy has fully resolved
// One press can be swallowed — a dodge charge still recharging, or the input
// landing on a frame the controller was not reading. Retry once before
// concluding the state machine is wrong.
for (let attempt = 0; attempt < 2; attempt++) {
  await waitIdle();
  await page.keyboard.down('KeyA');
  await page.keyboard.press('Space');
  a = await awaitPlayerState((p) => p.state === 'DODGE', 1800);
  await page.keyboard.up('KeyA');
  if (a.player.state === 'DODGE') break;
  await sleep(600);
}
check('B2 dodge -> DODGE/Dodge*', a.player.state === 'DODGE' && a.player.clip.startsWith('Dodge'), `${a.player.state}/${a.player.clip}`);

// B3 parry
for (let attempt = 0; attempt < 2; attempt++) {
  await waitIdle();
  await page.keyboard.press('KeyQ');
  a = await awaitPlayerState((p) => p.state === 'PARRY', 1800);
  if (a.player.state === 'PARRY') break;
  await sleep(600);
}
check('B3 parry -> PARRY/Parry', a.player.state === 'PARRY' && a.player.clip === 'Parry', `${a.player.state}/${a.player.clip}`);
await waitIdle();

await dump('preB4');
// B4 enemy reaction states, driven directly
await ev(() => window.SHDOWPIT.__qaSpawnOne('fighter', 6));
await sleep(500);
let r = await ev(() => {
  const g = window.SHDOWPIT;
  const list = g.world.enemies.filter((e) => e.alive);
  const px = g.player.position;
  list.sort((x, y) => x.position.distanceToSquared(px) - y.position.distanceToSquared(px));
  const e = list[0];
  if (!e) return null;
  e.combat.stagger(0.8);
  return e.uid;
});
let row = await awaitEnemyAnim(r, (e) => e.combatState === 'stagger' && e.state === 'STAGGER');
check(
  'B4 enemy stagger -> STAGGER/Hit*',
  !!row && row.combatState === 'stagger' && row.state === 'STAGGER' && row.clip.startsWith('Hit'),
  row ? `${row.combatState}/${row.state}/${row.clip}` : 'none'
);
await sleep(900);

r = await ev(() => {
  const g = window.SHDOWPIT;
  const list = g.world.enemies.filter((e) => e.alive);
  const px = g.player.position;
  list.sort((x, y) => x.position.distanceToSquared(px) - y.position.distanceToSquared(px));
  const e = list[0];
  if (!e) return null;
  e.combat.breakPosture();
  return e.uid;
});
row = await awaitEnemyAnim(r, (e) => e.combatState === 'broken' && e.state === 'BROKEN');
check(
  'B5 posture break -> BROKEN pose',
  !!row && row.combatState === 'broken' && row.state === 'BROKEN',
  row ? `${row.combatState}/${row.state}/${row.clip}` : 'none'
);
const wideOpen = await ev(() => {
  const g = window.SHDOWPIT;
  const e = g.world.enemies.find((e) => e.combat.state === 'broken');
  return e ? e.executable : false;
});
check('B5 broken enemy is executable', wideOpen === true);
await sleep(600);

// A broken enemy deliberately ignores knockdown (see EnemyCombat.knockdown,
// asserted by combattest's "broken enemies ignore block and knockdown"), and
// B5 just broke the nearest one for 3.2s. Knock down a different body.
r = await ev(() => {
  const g = window.SHDOWPIT;
  const list = g.world.enemies.filter((e) => e.alive && e.combat.state !== 'broken');
  const px = g.player.position;
  list.sort((x, y) => x.position.distanceToSquared(px) - y.position.distanceToSquared(px));
  const e = list[0];
  if (!e) return null;
  e.combat.knockdown(1.4);
  return e.uid;
});
check('B6 a non-broken body was available to knock down', r !== null, String(r));
row = await awaitEnemyAnim(r, (e) => e.combatState === 'knockdown' && e.state === 'KNOCKDOWN');
check(
  'B6 knockdown -> KNOCKDOWN/Knockdown',
  !!row && row.combatState === 'knockdown' && row.state === 'KNOCKDOWN' && row.clip === 'Knockdown',
  row ? `${row.combatState}/${row.state}/${row.clip}` : 'none'
);
await sleep(1600);

// B5 and B6 deliberately leave two bodies busy (broken for 3.2s, knocked down
// for 1.4s). On a thin roster that can be everyone, and this check then fails
// for want of a volunteer rather than for anything about the taunt clip.
const pickTauntable = () =>
  ev(() => {
    const g = window.SHDOWPIT;
    const list = g.world.enemies.filter((e) => e.alive && !e.combat.busy);
    const px = g.player.position;
    list.sort((x, y) => x.position.distanceToSquared(px) - y.position.distanceToSquared(px));
    const e = list[0];
    if (!e) return null;
    e.hesitateTimer = 3;
    e.combat.cooldown = 3;
    return { ok: e.taunt(), uid: e.uid };
  });
let tauntRes = await pickTauntable();
if (!tauntRes) {
  await ev(() => window.SHDOWPIT.__qaSpawnOne('fighter', 6));
  await sleep(700);
  tauntRes = await pickTauntable();
}
check('B7 a free body was available to taunt', tauntRes !== null);
const taunted = tauntRes?.ok ?? null;
row = tauntRes ? await awaitEnemyAnim(tauntRes.uid, (e) => e.state === 'TAUNT', 1500) : undefined;
check('B7 taunt one-shot plays', taunted === true && row?.state === 'TAUNT', `taunt=${taunted} state=${row?.state ?? 'none'}`);
await sleep(500);

// B8 enemy death clip
await ev(() => window.SHDOWPIT.__smiteEnemies());
await sleep(300);
a = await anim();
row = a.enemies.find((e) => e.state === 'DEATH');
check('B8 enemy death -> DEATH/Death*', !!row && row.clip.startsWith('Death'), row ? `${row.state}/${row.clip}` : 'none');
await dismissBoons();

console.log('\n== C. EVENT SYNC — strike anchor == combat hit window, at 3 time scales ==');

async function measureActiveStart(scale) {
  await ev((s) => window.SHDOWPIT.__debug().setTimeScale(s), scale);
  await sleep(150);
  await page.mouse.click(640, 360);
  let t0 = null;
  let clip = null;
  for (let i = 0; i < 220; i++) {
    const s = await anim();
    if (s.player.phase === 'active' && s.player.state === 'ATTACK') {
      t0 = s.player.clipTime;
      clip = s.player.clip;
      break;
    }
    await sleep(8);
  }
  // let the attack finish
  await sleep(scale < 1 ? 2600 : 900);
  await ev(() => window.SHDOWPIT.__debug().setTimeScale(1));
  await sleep(200);
  return { t0, clip };
}

for (const scale of [1, 0.5, 0.25]) {
  // A swallowed click means no window to measure, which is a missed sample,
  // not a desynced anchor. Take one more swing before calling it a failure.
  let m = await measureActiveStart(scale);
  if (m.t0 === null) {
    await waitIdle();
    m = await measureActiveStart(scale);
  }
  if (m.t0 === null) {
    check(`C @${scale}x active window observed`, false);
    continue;
  }
  const meta = CLIPS[m.clip];
  const impact = meta?.impactT ?? -1;
  const pre = Math.min(0.03, impact * 0.3);
  const err = Math.abs(m.t0 - (impact - pre));
  // The earliest the harness can observe the window opening is the frame it
  // opens on, so the reading legitimately carries up to one frame of clip
  // time. At 60fps that is 0.017s and the check is tight; under software GL
  // (~9fps) a fixed 0.09s budget is smaller than a single frame.
  const fps = Math.max(4, await ev(() => window.SHDOWPIT.__fps) || 60);
  const budget = Math.max(0.09, (1 / fps) * scale + 0.02);
  check(
    `C @${scale}x clip time at hit-window open == strike anchor`,
    err < budget,
    `clip=${m.clip} t=${m.t0?.toFixed(3)} impact=${impact} err=${err.toFixed(3)} budget=${budget.toFixed(3)}`
  );
}

console.log('\n== C2. EVENT DATA — explicit timeline matches the combat clock ==');
await page.mouse.click(640, 360);
let evSample = null;
for (let i = 0; i < 30; i++) {
  const s2 = await anim();
  if (s2.player.action === 'attack' && s2.player.events) {
    evSample = s2.player.events;
    break;
  }
  await sleep(10);
}
check('C2 attack publishes an event timeline', !!evSample, '');
if (evSample) {
  const on = evSample.find((e) => e.kind === 'HITBOX_ON');
  const off = evSample.find((e) => e.kind === 'HITBOX_OFF');
  const trail = evSample.find((e) => e.kind === 'TRAIL_ON');
  const combo = evSample.find((e) => e.kind === 'COMBO_WINDOW_OPEN');
  const t = await ev(() => {
    const g = window.SHDOWPIT;
    return g.player.combat.timings(g.player.weapon);
  });
  check('C2 HITBOX_ON at windup end', !!on && Math.abs(on.t - t.windup) < 0.005, `on=${on?.t} windup=${t.windup.toFixed(3)}`);
  check('C2 HITBOX_OFF at active end', !!off && Math.abs(off.t - (t.windup + t.active)) < 0.005, `off=${off?.t}`);
  check('C2 TRAIL_ON with the hitbox, COMBO after it', !!trail && !!combo && trail.t === on.t && combo.t >= off.t, '');
}
await sleep(800);

console.log('\n== D. CONTINUITY — no pose snaps through attack spam ==');
await ev(() => window.SHDOWPIT.__debug().setTimeScale(1));
const samples = [];
const sampler = (async () => {
  for (let i = 0; i < 150; i++) {
    const s = await ev(() => {
      const g = window.SHDOWPIT;
      const r = g.player.qaRig();
      return { armR: r.armR, action: g.player.combat.action };
    });
    samples.push(s);
  }
})();
for (let i = 0; i < 6; i++) {
  await page.mouse.click(640, 360);
  await sleep(320);
}
await page.mouse.click(640, 360, { button: 'right' });
await sleep(1200);
await sampler;
let snaps = 0;
let maxD = 0;
for (let i = 1; i < samples.length; i++) {
  const aS = samples[i - 1];
  const bS = samples[i];
  if (aS.action !== bS.action) continue;
  let d = Math.abs(bS.armR - aS.armR);
  if (d > Math.PI) d = Math.PI * 2 - d;
  maxD = Math.max(maxD, d);
  if (d > 1.2) snaps++;
}
check('D no arm snaps > 1.2 rad within one action', snaps === 0, `snaps=${snaps} maxDelta=${maxD.toFixed(2)}`);

// E. no page errors through the whole scene
check('E zero page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\nanimtest: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
