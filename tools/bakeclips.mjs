/**
 * bakeclips.mjs — offline animation baker for the SHADOW PIT HUMANOID RIG.
 *
 * Reads the CC0 KayKit character GLB (assets-src/kaykit/Knight.glb — see
 * THIRD_PARTY_ASSETS.md), retargets a curated set of clips onto the game's
 * rig standard, and writes src/anim/clips.json. The game never loads GLTF at
 * runtime; this file IS the animation import pipeline.
 *
 * What "retarget" means here, concretely:
 *   - bones are renamed to the SHADOW PIT names (docs/RIG.md)
 *   - the `wrist` bones are folded into `hand` (composed rotations)
 *   - THE FORWARD AXIS IS FIXED HERE, ONCE: the source rig faces +Z, the game
 *     faces -Z (yaw 0 = -Z everywhere), so the hips are pre-rotated 180 deg
 *     about Y. Shipped clip data is natively -Z; NOTHING at runtime
 *     compensates. Never add a 180 anywhere else.
 *   - root translation (root motion) is stripped from the skeleton tracks and
 *     kept per-clip as a separate `rootMotion` curve, so movement always goes
 *     through the character controller (controlled root motion).
 *   - everything is resampled to a uniform 24 Hz and quantized to int16.
 *
 * Zero dependencies. Run: node tools/bakeclips.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_GLB = path.join(HERE, '..', 'assets-src', 'kaykit', 'Knight.glb');
const OUT = path.join(HERE, '..', 'src', 'anim', 'clips.json');

const FPS = 24;
const DT = 1 / FPS;

/* ---------------- source -> SHADOW PIT bone names ---------------- */

const BONE_MAP = {
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Chest',
  head: 'Head',
  'upperarm.l': 'UpperArm_L',
  'lowerarm.l': 'LowerArm_L',
  'hand.l': 'Hand_L',
  'handslot.l': 'HandSlot_L',
  'upperarm.r': 'UpperArm_R',
  'lowerarm.r': 'LowerArm_R',
  'hand.r': 'Hand_R',
  'handslot.r': 'HandSlot_R',
  'upperleg.l': 'UpperLeg_L',
  'lowerleg.l': 'LowerLeg_L',
  'foot.l': 'Foot_L',
  'toes.l': 'Toes_L',
  'upperleg.r': 'UpperLeg_R',
  'lowerleg.r': 'LowerLeg_R',
  'foot.r': 'Foot_R',
  'toes.r': 'Toes_R',
};
// wrist.l / wrist.r are folded into hand.l / hand.r (see fold step below).

/* ---------------- clips to bake: source name -> game name ---------------- */

const CLIP_MAP = {
  Idle: { name: 'Idle', loop: true },
  Walking_A: { name: 'Walk', loop: true, stride: true },
  Walking_C: { name: 'WalkProud', loop: true, stride: true }, // arrogant nemesis walk
  Walking_Backwards: { name: 'WalkBack', loop: true, stride: true },
  Running_A: { name: 'Run', loop: true, stride: true },
  Running_Strafe_Left: { name: 'StrafeL', loop: true, stride: true },
  Running_Strafe_Right: { name: 'StrafeR', loop: true, stride: true },
  Dodge_Forward: { name: 'DodgeF', loop: false, stripRoot: true },
  Dodge_Backward: { name: 'DodgeB', loop: false, stripRoot: true },
  Dodge_Left: { name: 'DodgeL', loop: false, stripRoot: true },
  Dodge_Right: { name: 'DodgeR', loop: false, stripRoot: true },
  '1H_Melee_Attack_Slice_Horizontal': { name: 'Atk1H_A', loop: false, impact: true },
  '1H_Melee_Attack_Slice_Diagonal': { name: 'Atk1H_B', loop: false, impact: true },
  '1H_Melee_Attack_Chop': { name: 'Atk1H_C', loop: false, impact: true },
  '1H_Melee_Attack_Stab': { name: 'AtkThrust', loop: false, impact: true },
  '2H_Melee_Attack_Chop': { name: 'Atk2H_Slam', loop: false, impact: true },
  '2H_Melee_Attack_Slice': { name: 'Atk2H_Sweep', loop: false, impact: true },
  '2H_Melee_Attack_Spin': { name: 'Atk2H_Spin', loop: false, impact: true },
  '2H_Melee_Attack_Stab': { name: 'AtkExecute', loop: false, impact: true },
  Block: { name: 'BlockIn', loop: false },
  Blocking: { name: 'BlockLoop', loop: true },
  Block_Attack: { name: 'Parry', loop: false, impact: true },
  Block_Hit: { name: 'BlockHit', loop: false },
  Hit_A: { name: 'HitLight', loop: false },
  Hit_B: { name: 'HitHeavy', loop: false },
  Death_A: { name: 'DeathA', loop: false },
  Death_B: { name: 'DeathB', loop: false },
  Lie_Down: { name: 'Knockdown', loop: false },
  Lie_StandUp: { name: 'GetUp', loop: false },
  Spellcast_Shoot: { name: 'CastShoot', loop: false, impact: true },
  '2H_Ranged_Aiming': { name: 'BowAim', loop: true },
  '2H_Ranged_Shoot': { name: 'BowShoot', loop: false, impact: true },
  Throw: { name: 'Throw', loop: false, impact: true },
  Cheer: { name: 'Taunt', loop: false },
  Unarmed_Melee_Attack_Punch_A: { name: 'Shove', loop: false, impact: true },
};

/* ================= GLB parsing (no deps) ================= */

function readGlb(file) {
  const d = fs.readFileSync(file);
  if (d.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = d.readUInt32LE(12);
  const json = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen + 8;
  const bin = d.subarray(binOff, binOff + d.readUInt32LE(20 + jsonLen));
  return { json, bin };
}

function accessorData(g, bin, idx) {
  const a = g.accessors[idx];
  const bv = g.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  if (a.componentType !== 5126) throw new Error('expected float32 accessor');
  const out = new Float32Array(a.count * comps);
  for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(off + i * 4);
  return { data: out, comps, count: a.count };
}

/* ================= tiny quaternion / vec math ================= */

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qRotV = (q, v) => {
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1] + w * v[0];
  const cy = z * v[0] - x * v[2] + w * v[1];
  const cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
};
const qNorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
const nlerp = (a, b, t) => {
  // shortest arc
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  return qNorm([
    a[0] + (b[0] * s - a[0]) * t,
    a[1] + (b[1] * s - a[1]) * t,
    a[2] + (b[2] * s - a[2]) * t,
    a[3] + (b[3] * s - a[3]) * t,
  ]);
};
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * THE flip: 180 degrees about Y, applied once, here — as a CONJUGATION of
 * every joint (q' = F q F^-1, t' = F t). Conjugating the whole skeleton both
 * turns the geometry to face -Z AND keeps each bone's local axes aligned with
 * the character (head-local -Z stays "out the face"), which is what lets the
 * runtime attach visors/masks/weapons on -Z with zero compensation.
 * Premultiplying only the hips would turn the model but leave every bone
 * frame mirrored — the classic "everything renders backwards" trap.
 */
const flipQ = (q) => [-q[0], q[1], -q[2], q[3]];
const flipV = (v) => [-v[0], v[1], -v[2]];

/* ================= main ================= */

const { json: g, bin } = readGlb(SRC_GLB);
const nodes = g.nodes;
const byName = new Map(nodes.map((n, i) => [n.name, i]));
const parentOf = new Map();
for (let i = 0; i < nodes.length; i++) for (const c of nodes[i].children ?? []) parentOf.set(c, i);

const nodeRest = (i) => ({
  t: nodes[i].translation ?? [0, 0, 0],
  r: nodes[i].rotation ?? [0, 0, 0, 1],
});

/* ---- rest pose of the SHADOW PIT rig ---- */

const rest = {};
for (const [src, dst] of Object.entries(BONE_MAP)) {
  const i = byName.get(src);
  if (i === undefined) throw new Error(`missing source bone ${src}`);
  let { t, r } = nodeRest(i);
  // hand: parent changes from wrist to lowerarm -> fold the wrist rest in.
  if (src === 'hand.l' || src === 'hand.r') {
    const w = nodeRest(byName.get(src.replace('hand', 'wrist')));
    r = qMul(w.r, r);
    t = [w.t[0] + qRotV(w.r, t)[0], w.t[1] + qRotV(w.r, t)[1], w.t[2] + qRotV(w.r, t)[2]];
  }
  // conjugate EVERY joint by the -Z flip
  t = flipV(t);
  r = qNorm(flipQ(r));
  rest[dst] = { t: t.map((v) => +v.toFixed(5)), r: r.map((v) => +v.toFixed(6)) };
}

/* ---- channel samplers ---- */

function samplerFor(g, bin, anim, nodeIdx, pathName) {
  const ch = anim.channels.find((c) => c.target.node === nodeIdx && c.target.path === pathName);
  if (!ch) return null;
  const s = anim.samplers[ch.sampler];
  const inp = accessorData(g, bin, s.input);
  const out = accessorData(g, bin, s.output);
  const step = (s.interpolation ?? 'LINEAR') === 'STEP';
  const times = inp.data;
  const comps = out.comps;
  return (t) => {
    if (t <= times[0]) return Array.from(out.data.subarray(0, comps));
    const last = times.length - 1;
    if (t >= times[last]) return Array.from(out.data.subarray(last * comps, last * comps + comps));
    let i = 0;
    while (i < last && times[i + 1] < t) i++;
    const a = Array.from(out.data.subarray(i * comps, i * comps + comps));
    if (step) return a;
    const b = Array.from(out.data.subarray((i + 1) * comps, (i + 1) * comps + comps));
    const k = (t - times[i]) / (times[i + 1] - times[i]);
    return comps === 4 ? nlerp(a, b, k) : lerpV(a, b, k);
  };
}

const animByName = new Map(g.animations.map((a) => [a.name, a]));

/** duration = latest input key across the clip's channels */
function clipDuration(anim) {
  let d = 0;
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    d = Math.max(d, g.accessors[s.input].max?.[0] ?? 0);
  }
  return d;
}

/* ---- FK in game space (post-flip), for impact/stride metadata ---- */

const CHAIN = {
  Hips: null,
  Spine: 'Hips',
  Chest: 'Spine',
  Head: 'Chest',
  UpperArm_L: 'Chest',
  LowerArm_L: 'UpperArm_L',
  Hand_L: 'LowerArm_L',
  HandSlot_L: 'Hand_L',
  UpperArm_R: 'Chest',
  LowerArm_R: 'UpperArm_R',
  Hand_R: 'LowerArm_R',
  HandSlot_R: 'Hand_R',
  UpperLeg_L: 'Hips',
  LowerLeg_L: 'UpperLeg_L',
  Foot_L: 'LowerLeg_L',
  Toes_L: 'Foot_L',
  UpperLeg_R: 'Hips',
  LowerLeg_R: 'UpperLeg_R',
  Foot_R: 'LowerLeg_R',
  Toes_R: 'Foot_R',
};
const FK_ORDER = Object.keys(CHAIN);

function fkWorld(pose) {
  // pose: {bone: {t, r}} local -> returns {bone: worldPos}
  const world = {};
  for (const b of FK_ORDER) {
    const p = CHAIN[b];
    const local = pose[b] ?? rest[b];
    if (!p) {
      world[b] = { t: local.t, r: local.r };
    } else {
      const pw = world[p];
      world[b] = { t: addV(pw.t, qRotV(pw.r, local.t)), r: qNorm(qMul(pw.r, local.r)) };
    }
  }
  return world;
}
const addV = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/* ---- bake every clip ---- */

const outClips = {};
let totalKeys = 0;
const report = [];

for (const [srcName, meta] of Object.entries(CLIP_MAP)) {
  const anim = animByName.get(srcName);
  if (!anim) {
    console.warn(`!! clip missing in source: ${srcName}`);
    continue;
  }
  const dur = clipDuration(anim);
  const frames = Math.max(2, Math.round(dur * FPS) + 1);

  // per-bone samplers
  const rotS = {};
  const posS = {};
  for (const [src, dst] of Object.entries(BONE_MAP)) {
    const i = byName.get(src);
    rotS[dst] = samplerFor(g, bin, anim, i, 'rotation');
    posS[dst] = samplerFor(g, bin, anim, i, 'translation');
  }
  const wristR = {
    Hand_L: samplerFor(g, bin, anim, byName.get('wrist.l'), 'rotation'),
    Hand_R: samplerFor(g, bin, anim, byName.get('wrist.r'), 'rotation'),
  };
  const rootPosS = samplerFor(g, bin, anim, byName.get('root'), 'translation');

  // sample all frames into {bone: {r: [...frames], p: [...frames]}}
  const boneFrames = {};
  for (const dst of Object.values(BONE_MAP)) boneFrames[dst] = { r: [], p: [] };
  const rootMotion = [];

  for (let f = 0; f < frames; f++) {
    const t = Math.min(dur, f * DT);
    for (const [src, dst] of Object.entries(BONE_MAP)) {
      // NOTE: rest[] is already flipped; raw samples are in source space, so
      // sample raw, fold wrists, THEN conjugate.
      let r = rotS[dst] ? rotS[dst](t) : null;
      if (src === 'hand.l' || src === 'hand.r') {
        const wr = wristR[dst] ? wristR[dst](t) : nodeRest(byName.get(src.replace('hand', 'wrist'))).r;
        r = qMul(wr, r ?? nodeRest(byName.get(src)).r);
      }
      r = r ? qNorm(flipQ(r)) : rest[dst].r;
      boneFrames[dst].r.push(r);
      if (dst === 'Hips') {
        const p = posS[dst] ? flipV(posS[dst](t)) : rest[dst].t;
        boneFrames[dst].p.push(p);
      }
    }
    if (rootPosS) {
      const rp = flipV(rootPosS(t));
      rootMotion.push([rp[0], rp[2]]);
    }
  }

  // metadata: impact time (peak main-hand speed) + stride (foot travel)
  let impactT;
  if (meta.impact) {
    let best = 0;
    let bestT = dur * 0.45;
    let prev = null;
    for (let f = 0; f < frames; f++) {
      const pose = {};
      for (const b of Object.values(BONE_MAP)) {
        pose[b] = { t: b === 'Hips' ? boneFrames.Hips.p[f] : rest[b].t, r: boneFrames[b].r[f] };
      }
      const w = fkWorld(pose);
      const hand = w.HandSlot_R.t;
      if (prev) {
        const speed = Math.hypot(hand[0] - prev[0], hand[1] - prev[1], hand[2] - prev[2]) / DT;
        const t = f * DT;
        if (t > dur * 0.12 && t < dur * 0.9 && speed > best) {
          best = speed;
          bestT = t;
        }
      }
      prev = hand;
    }
    impactT = +bestT.toFixed(3);
  }

  let stride;
  if (meta.stride) {
    let minZ = 1e9;
    let maxZ = -1e9;
    for (let f = 0; f < frames; f++) {
      const pose = {};
      for (const b of Object.values(BONE_MAP)) {
        pose[b] = { t: b === 'Hips' ? boneFrames.Hips.p[f] : rest[b].t, r: boneFrames[b].r[f] };
      }
      const w = fkWorld(pose);
      minZ = Math.min(minZ, w.Foot_L.t[2], w.Foot_R.t[2]);
      maxZ = Math.max(maxZ, w.Foot_L.t[2], w.Foot_R.t[2]);
    }
    // ground speed the cycle was authored for: one stride covers the swing
    // span twice per cycle (two steps).
    stride = +(((maxZ - minZ) * 2) / dur).toFixed(3);
  }

  // encode: drop static rotation tracks; quantize
  const bones = {};
  for (const [dst, fr] of Object.entries(boneFrames)) {
    const first = fr.r[0];
    const animated = fr.r.some((q) => Math.abs(q[0] * first[0] + q[1] * first[1] + q[2] * first[2] + q[3] * first[3]) < 0.99995);
    const entry = {};
    if (animated) {
      const flat = new Array(fr.r.length * 4);
      // keep hemisphere continuity so int16 lerp never crosses the long way
      let prevQ = fr.r[0];
      for (let f = 0; f < fr.r.length; f++) {
        let q = fr.r[f];
        if (q[0] * prevQ[0] + q[1] * prevQ[1] + q[2] * prevQ[2] + q[3] * prevQ[3] < 0) q = q.map((v) => -v);
        prevQ = q;
        for (let c = 0; c < 4; c++) flat[f * 4 + c] = Math.round(q[c] * 32767);
      }
      entry.r = flat;
      totalKeys += fr.r.length;
    } else {
      const q = first.map((v) => Math.round(v * 32767));
      // only store if it differs from rest
      const rq = rest[dst].r;
      const dot = Math.abs(first[0] * rq[0] + first[1] * rq[1] + first[2] * rq[2] + first[3] * rq[3]);
      if (dot < 0.99995) entry.r0 = q;
    }
    if (dst === 'Hips') {
      const p0 = fr.p[0];
      const moved = fr.p.some((p) => Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]) > 0.002);
      if (moved) {
        entry.p = fr.p.flatMap((p) => p.map((v) => Math.round(v * 1000)));
        totalKeys += fr.p.length;
      } else {
        entry.p0 = p0.map((v) => Math.round(v * 1000));
      }
    }
    if (entry.r || entry.r0 || entry.p || entry.p0) bones[dst] = entry;
  }

  const clip = { dur: +dur.toFixed(4), fps: FPS, loop: !!meta.loop, bones };
  if (impactT !== undefined) clip.impactT = impactT;
  if (stride !== undefined) clip.stride = stride;
  if (!meta.stripRoot && rootMotion.length) {
    const r0 = rootMotion[0];
    const moved = rootMotion.some((p) => Math.hypot(p[0] - r0[0], p[1] - r0[1]) > 0.01);
    if (moved) clip.rootMotion = rootMotion.flatMap((p) => p.map((v) => Math.round(v * 1000)));
  }
  outClips[meta.name] = clip;
  report.push(
    `${meta.name.padEnd(12)} <- ${srcName.padEnd(34)} ${dur.toFixed(2)}s ${frames}f` +
      (impactT !== undefined ? ` impact=${impactT}` : '') +
      (stride !== undefined ? ` stride=${stride}m/s` : '')
  );
}

/* ---- reference measurements for the rig factory ---- */

const restWorld = fkWorld(Object.fromEntries(Object.entries(rest).map(([b, v]) => [b, v])));
const measurements = {
  hipsHeight: +rest.Hips.t[1].toFixed(4),
  headTop: +(restWorld.Head.t[1] + 0.16).toFixed(4),
  armLen: +(
    Math.hypot(...rest.LowerArm_R.t) + Math.hypot(...rest.Hand_R.t)
  ).toFixed(4),
  legLen: +(Math.hypot(...rest.LowerLeg_R.t) + Math.hypot(...rest.Foot_R.t)).toFixed(4),
};

const out = {
  meta: {
    source: 'KayKit Adventurers 1.0 (CC0) — Kay Lousberg, kaylousberg.com',
    generator: 'tools/bakeclips.mjs',
    forward: '-Z (flip from source +Z baked in here, nowhere else)',
    fps: FPS,
    units: 'rotations int16/32767, positions int16 millimetres',
  },
  measurements,
  rest,
  clips: outClips,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(report.join('\n'));
console.log(`\nbaked ${Object.keys(outClips).length} clips, ${totalKeys} keyframes -> ${OUT} (${kb} KB)`);
console.log('measurements', measurements);
