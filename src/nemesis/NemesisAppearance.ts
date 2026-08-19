/**
 * Procedural enemy bodies from primitives — on the standard skeleton.
 *
 * Goal: the player should be able to identify an important enemy from across
 * the arena by silhouette and colour alone. Everything is built from a handful
 * of shared unit geometries scaled into place, so a crowd is cheap.
 *
 * Every enemy uses THE SHADOW PIT HUMANOID RIG (src/anim/Rig.ts). The bones
 * never move per character — that is what makes every baked animation clip
 * valid on every body. Character size comes from the root scale; character
 * identity comes from the meshes this file hangs on the bones (heads, masks,
 * horns, capes, scars) — all still deterministic from `appearanceSeed`.
 *
 * THE RIG FACES -Z. A yaw of 0 means -Z everywhere in the game (forward is
 * (-sin yaw, 0, -cos yaw); see combat/Hitbox.ts), so masks, eyes and chest
 * markings sit on the bones' -Z side and capes hang on +Z. The 180° flip from
 * the source animation pack is baked in tools/bakeclips.mjs — never
 * compensate for the axis anywhere else.
 */

import * as THREE from 'three';
import { ENEMY_BODY, ENEMY_TRIM, NEMESIS_ACCENTS, WORLD, SIGNAL } from '../data/palette';
import { RNG, mixSeed } from '../core/RNG';
import type { Nemesis } from './Nemesis';
import { hasScar, rankIndex } from './Nemesis';
import { enemyWeapon } from '../data/weapons';
import { buildSkeleton, limbMesh, SEG, type SPRig } from '../anim/Rig';
import { CharacterAnimator } from '../anim/Animator';

/* ---------------- shared geometry ---------------- */

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 5),
  cone4: new THREE.ConeGeometry(0.5, 1, 4),
  octa: new THREE.OctahedronGeometry(0.5, 0),
  icosa: new THREE.IcosahedronGeometry(0.5, 0),
  tetra: new THREE.TetrahedronGeometry(0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  plane: new THREE.PlaneGeometry(1, 1),
  sphere: new THREE.SphereGeometry(0.5, 6, 4),
};

/* ---------------- shared materials ---------------- */

const solidCache = new Map<number, THREE.MeshLambertMaterial>();
const glowCache = new Map<number, THREE.MeshBasicMaterial>();

function solid(color: number): THREE.MeshLambertMaterial {
  let m = solidCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    solidCache.set(color, m);
  }
  return m;
}

function glow(color: number): THREE.MeshBasicMaterial {
  let m = glowCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false });
    glowCache.set(color, m);
  }
  return m;
}

/* ---------------- palettes ---------------- */

const BODY_COLORS = ENEMY_BODY;
const ACCENTS = NEMESIS_ACCENTS;

const HEAD_SHAPES = ['box', 'wedge', 'cone', 'octa', 'tall', 'sphere'] as const;
type HeadShape = (typeof HEAD_SHAPES)[number];

/** enemy rigs sit slightly under the player's 1.5 so YOU read biggest-bright */
const ENEMY_BASE_SCALE = 1.42;

export interface EnemyRig {
  root: THREE.Group;
  /** the standard skeleton + its animation brain */
  sp: SPRig;
  anim: CharacterAnimator;
  /** head bone (aim layer, telegraph placement) */
  head: THREE.Object3D;
  /** weapon mount actually used (right hand, or left for bows) */
  weaponPivot: THREE.Object3D;
  weaponMesh: THREE.Object3D | null;
  /** blade anchors for trail ribbons */
  weaponTip: THREE.Object3D;
  weaponBase: THREE.Object3D;
  /** QA marker just past the face on -Z; used to verify the rendered front */
  nose: THREE.Object3D;
  /** emissive bits used for telegraph flashes */
  glows: THREE.Mesh[];
  /** per-instance material used for damage flash */
  skin: THREE.MeshLambertMaterial;
  height: number;
  radius: number;
  accent: number;
  scale: number;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/** Build the visual for a nemesis. Deterministic from `appearanceSeed`. */
export function buildEnemyRig(n: Nemesis): EnemyRig {
  const r = new RNG(n.appearanceSeed);
  const ri = rankIndex(n.rank);

  const heavy = n.archetype === 'heavy';
  const archer = n.archetype === 'archer';

  const scale =
    ENEMY_BASE_SCALE * (heavy ? 1.24 : archer ? 0.92 : 1.0) * r.range(0.92, 1.1) * (1 + ri * 0.055);

  // visual chunkiness (meshes only — bones never change)
  const torsoW = (heavy ? 0.56 : archer ? 0.34 : 0.44) * r.range(0.9, 1.15);
  const torsoD = (heavy ? 0.4 : 0.26) * r.range(0.9, 1.1);
  const limbW = (heavy ? 0.19 : 0.13) * r.range(0.9, 1.15);

  const pal = paletteFor(n.appearanceSeed);
  const bodyColor = pal.body;
  const accent = pal.accent;
  const trimColor = r.chance(0.5) ? ENEMY_TRIM.dark : ENEMY_TRIM.light;

  const skin = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
  const trim = solid(trimColor);
  const accentGlow = glow(accent);

  const sp = buildSkeleton(scale);
  const root = sp.root;
  const B = sp.bones;
  const glows: THREE.Mesh[] = [];

  /* ---- legs ---- */
  for (const side of ['L', 'R'] as const) {
    const up = limbMesh(G.box, trim, limbW, SEG.upperLeg, limbW * 1.05);
    B[`UpperLeg_${side}`].add(up);
    const lo = limbMesh(G.box, trim, limbW * 0.85, SEG.lowerLeg, limbW * 0.9);
    B[`LowerLeg_${side}`].add(lo);
    const foot = mesh(G.box, skin, limbW * 0.9, 0.07, 0.17);
    foot.position.y = SEG.foot * 0.55;
    B[`Foot_${side}`].add(foot);
  }

  /* ---- torso ---- */
  const pelvis = mesh(G.box, trim, torsoW * 0.86, 0.18, torsoD * 0.9);
  pelvis.position.y = 0.02;
  B.Hips.add(pelvis);

  const lower = limbMesh(G.box, skin, torsoW * 0.88, SEG.chestLen * 0.96, torsoD * 0.92);
  B.Spine.add(lower);

  const chestH = SEG.headLen * 0.95;
  const chest = limbMesh(G.box, skin, torsoW, chestH, torsoD);
  B.Chest.add(chest);

  // chest marking — on the FRONT, which is -Z
  if (r.chance(0.65)) {
    const mk = mesh(G.box, accentGlow, torsoW * r.range(0.2, 0.55), chestH * r.range(0.2, 0.55), 0.02);
    mk.position.set(r.range(-torsoW * 0.18, torsoW * 0.18), chestH * r.range(0.25, 0.6), -torsoD * 0.54);
    B.Chest.add(mk);
    glows.push(mk);
  }

  /* ---- shoulders ---- */
  const shoulderStyle = r.int(0, 3);
  if (shoulderStyle > 0) {
    const sw = torsoW * r.range(0.32, 0.5) * (heavy ? 1.3 : 1);
    for (const side of ['L', 'R'] as const) {
      let sm: THREE.Mesh;
      if (shoulderStyle === 1) sm = mesh(G.box, trim, sw, sw * 0.5, sw * 1.05);
      else if (shoulderStyle === 2) sm = mesh(G.cone4, trim, sw * 1.5, sw * 1.05, sw * 1.5);
      else sm = mesh(G.tetra, trim, sw * 1.55, sw * 1.55, sw * 1.55);
      sm.position.y = 0.02;
      if (shoulderStyle === 3) sm.rotation.set(r.range(0, 3), r.range(0, 3), 0);
      B[`UpperArm_${side}`].add(sm);
    }
  }

  /* ---- arms ---- */
  for (const side of ['L', 'R'] as const) {
    const up = limbMesh(G.box, skin, limbW * 0.85, SEG.upperArm, limbW * 0.85);
    if (side === 'L' && hasScar(n, 'damaged_arm')) {
      up.scale.y *= 0.6;
      up.position.y = SEG.upperArm * 0.3;
    }
    B[`UpperArm_${side}`].add(up);
    const lo = limbMesh(G.box, skin, limbW * 0.7, SEG.lowerArm * 0.9, limbW * 0.7);
    B[`LowerArm_${side}`].add(lo);
  }

  /* ---- head ---- */
  const headBone = B.Head;
  const headSize = r.range(0.22, 0.32) * (heavy ? 1.12 : 1);
  const shape: HeadShape = r.pick(HEAD_SHAPES);
  let headMesh: THREE.Mesh;
  switch (shape) {
    case 'wedge':
      headMesh = mesh(G.cone4, skin, headSize * 1.5, headSize * 1.5, headSize * 1.5);
      headMesh.rotation.x = Math.PI;
      break;
    case 'cone':
      headMesh = mesh(G.cone, skin, headSize * 1.6, headSize * 1.8, headSize * 1.6);
      break;
    case 'octa':
      headMesh = mesh(G.octa, skin, headSize * 1.9, headSize * 2.1, headSize * 1.9);
      break;
    case 'tall':
      headMesh = mesh(G.box, skin, headSize * 0.8, headSize * 1.7, headSize * 0.9);
      break;
    case 'sphere':
      headMesh = mesh(G.icosa, skin, headSize * 1.9, headSize * 1.9, headSize * 1.9);
      break;
    default:
      headMesh = mesh(G.box, skin, headSize, headSize, headSize);
  }
  headMesh.position.y = headSize * 0.6;
  headBone.add(headMesh);

  // QA anchor: the rendered "front" of this enemy, for facing verification.
  const nose = new THREE.Object3D();
  nose.position.set(0, headSize * 0.5, -headSize * 1.6);
  headBone.add(nose);

  /* ---- mask ---- */
  const maskStyle = r.int(0, 4);
  const maskBroken = hasScar(n, 'broken_mask');
  if (maskStyle > 0) {
    const mw = headSize * r.range(0.7, 1.05);
    const mh = headSize * r.range(0.5, 0.95);
    const maskMat = r.chance(0.55) ? accentGlow : solid(r.pick(BODY_COLORS) ^ 0x111111);
    let maskMesh: THREE.Mesh;
    if (maskStyle === 1) maskMesh = mesh(G.box, maskMat, mw, mh, 0.05);
    else if (maskStyle === 2) maskMesh = mesh(G.cone4, maskMat, mw * 1.3, mh * 1.3, 0.16);
    else if (maskStyle === 3) maskMesh = mesh(G.octa, maskMat, mw * 1.2, mh * 1.4, 0.2);
    else maskMesh = mesh(G.plane, maskMat, mw, mh, 1);
    maskMesh.position.set(0, headSize * 0.55, -headSize * 0.6);
    if (maskStyle === 2) maskMesh.rotation.x = -Math.PI / 2;
    if (maskStyle === 4) maskMesh.rotation.y = Math.PI; // plane faces +Z by default
    if (maskBroken) {
      maskMesh.scale.x *= 0.5;
      maskMesh.position.x = mw * 0.24;
      maskMesh.rotation.z = 0.35;
    }
    headBone.add(maskMesh);
    if (maskMat === accentGlow) glows.push(maskMesh);
  }

  /* ---- eyes ---- */
  const eyeCount = r.chance(0.18) ? 1 : 2;
  const eyeMat = glow(r.chance(0.7) ? accent : 0xffffff);
  const eyeSize = headSize * r.range(0.12, 0.22);
  const missingEye = hasScar(n, 'missing_eye');
  for (let i = 0; i < eyeCount; i++) {
    if (missingEye && i === 1) break;
    const ex = eyeCount === 1 ? 0 : (i === 0 ? 1 : -1) * headSize * 0.26;
    const e = mesh(G.box, eyeMat, eyeSize, eyeSize * r.range(0.4, 1), 0.04);
    e.position.set(ex, headSize * r.range(0.45, 0.7), -headSize * 0.62);
    headBone.add(e);
    glows.push(e);
  }

  /* ---- horns ---- */
  const hornStyle = r.int(0, 3);
  if (hornStyle > 0) {
    const hl = headSize * r.range(0.9, 2.4);
    const hw = headSize * r.range(0.2, 0.4);
    const shattered = hasScar(n, 'shattered_horn');
    for (const sx of [1, -1]) {
      if (hornStyle === 3 && sx === -1) continue; // single horn
      const h = mesh(G.cone, solid(WORLD.bone), hw, sx === -1 && shattered ? hl * 0.35 : hl, hw);
      h.position.set(sx * headSize * 0.42, headSize * 1.0, 0);
      h.rotation.z = -sx * r.range(0.1, 0.7);
      h.rotation.x = r.range(-0.4, 0.2);
      headBone.add(h);
    }
  }

  /* ---- crest / crown by rank ---- */
  if (ri >= 2) {
    const spikes = 1 + ri;
    for (let i = 0; i < spikes; i++) {
      const t = spikes === 1 ? 0 : i / (spikes - 1) - 0.5;
      const s = mesh(G.cone, accentGlow, headSize * 0.14, headSize * (0.5 + ri * 0.22), headSize * 0.14);
      s.position.set(t * headSize * 0.9, headSize * 1.1, headSize * 0.05);
      s.rotation.z = t * 0.5;
      headBone.add(s);
      glows.push(s);
    }
  }

  /* ---- cape ---- */
  if (r.chance(0.28) || ri >= 3) {
    const capeMat = new THREE.MeshLambertMaterial({
      color: ri >= 3 ? accent : WORLD.shadow,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    // Capes hang on the BACK, which is +Z.
    const cape = mesh(G.plane, capeMat, torsoW * 2.4, 0.85, 1);
    cape.position.set(0, -0.28, torsoD * 0.7);
    cape.rotation.x = -0.12;
    B.Chest.add(cape);
  }

  /* ---- scars ---- */
  if (hasScar(n, 'burn')) {
    skin.color.multiplyScalar(0.45);
    for (let i = 0; i < 4; i++) {
      const e = mesh(G.box, glow(SIGNAL.unblockable), 0.05, 0.05, 0.05);
      e.position.set(r.range(-torsoW * 0.4, torsoW * 0.4), chestH * r.range(0.1, 0.8), -torsoD * 0.52);
      B.Chest.add(e);
      glows.push(e);
    }
  }
  if (hasScar(n, 'metal_jaw')) {
    const j = mesh(G.box, solid(WORLD.bone), headSize * 0.9, headSize * 0.28, headSize * 0.5);
    j.position.set(0, headSize * 0.2, -headSize * 0.32);
    headBone.add(j);
  }
  if (hasScar(n, 'cracked_armor')) {
    for (let i = 0; i < 3; i++) {
      const c = mesh(G.box, solid(0x000000), torsoW * r.range(0.5, 0.95), 0.03, 0.015);
      c.position.set(0, chestH * r.range(0.2, 0.8), -torsoD * 0.54);
      c.rotation.z = r.range(-0.9, 0.9);
      B.Chest.add(c);
    }
  }
  if (hasScar(n, 'corruption')) {
    for (let i = 0; i < 5; i++) {
      const c = mesh(G.icosa, glow(SIGNAL.poison), r.range(0.07, 0.16), r.range(0.07, 0.16), r.range(0.07, 0.16));
      c.position.set(r.range(-torsoW * 0.5, torsoW * 0.5), chestH * r.range(0, 0.9), r.range(-torsoD * 0.5, torsoD * 0.5));
      B.Chest.add(c);
      glows.push(c);
    }
  }

  /* ---- weapon ---- */
  const isBow = n.weapon === 'bow';
  const weaponPivot = isBow ? B.HandSlot_L : B.HandSlot_R;
  const weaponTip = new THREE.Object3D();
  const weaponBase = new THREE.Object3D();
  const weaponMesh = buildWeapon(n, r, accent, scale, weaponTip, weaponBase);
  if (weaponMesh) weaponPivot.add(weaponMesh);
  else weaponPivot.add(weaponTip, weaponBase);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  const height = 1.42 * scale + 0.28; // head top + horn allowance, world units
  const radius = Math.max(0.42, torsoW * 1.35 * scale * 0.62);

  return {
    root,
    sp,
    anim: new CharacterAnimator(sp),
    head: headBone,
    weaponPivot,
    weaponMesh,
    weaponTip,
    weaponBase,
    nose,
    glows,
    skin,
    height,
    radius,
    accent,
    scale,
  };
}

/**
 * Weapons extend along the hand slot's +Y (the character's forward at rest).
 * Sizes are divided by the rig scale so the WORLD size equals the weapon
 * def's blade length — the visual never lies about gameplay reach.
 */
function buildWeapon(
  n: Nemesis,
  r: RNG,
  accent: number,
  scale: number,
  tipAnchor: THREE.Object3D,
  baseAnchor: THREE.Object3D
): THREE.Object3D | null {
  const def = enemyWeapon(n.weapon);
  const g = new THREE.Group();
  const steel = solid(WORLD.metal);
  const haft = solid(WORLD.rust);
  const k = 1 / scale;
  const len = def.bladeLen * r.range(0.9, 1.1) * k;
  const w = def.bladeWidth * r.range(0.85, 1.3) * 1.4 * k;

  switch (n.weapon) {
    case 'sword': {
      const blade = mesh(G.box, steel, w, len, w * 0.35);
      blade.position.y = len * 0.5;
      const guard = mesh(G.box, haft, w * 3.2, w * 0.6, w * 0.8);
      g.add(blade, guard);
      break;
    }
    case 'axe': {
      const shaft = mesh(G.box, haft, w * 0.5, len, w * 0.5);
      shaft.position.y = len * 0.5;
      const head = mesh(G.cone4, steel, w * 4.5, w * 3.6, w * 1.1);
      head.position.set(w * 1.4, len * 0.86, 0);
      head.rotation.z = -Math.PI * 0.5;
      g.add(shaft, head);
      break;
    }
    case 'club': {
      const shaft = mesh(G.box, haft, w * 0.6, len * 0.75, w * 0.6);
      shaft.position.y = len * 0.4;
      const head = mesh(G.box, steel, w * 2.4, len * 0.4, w * 2.4);
      head.position.y = len * 0.9;
      g.add(shaft, head);
      break;
    }
    case 'spear': {
      const shaft = mesh(G.box, haft, w * 0.55, len, w * 0.55);
      shaft.position.y = len * 0.42;
      const tip = mesh(G.cone, steel, w * 2.4, w * 6, w * 2.4);
      tip.position.y = len * 0.98;
      g.add(shaft, tip);
      break;
    }
    case 'bow': {
      const limb = mesh(G.box, haft, w * 0.8, len * 1.3, w * 0.8);
      limb.rotation.z = 0.12;
      const string = mesh(G.box, glow(accent), 0.012, len * 1.25, 0.012);
      string.position.set(w * 1.4, 0, 0);
      g.add(limb, string);
      break;
    }
  }

  // Stolen player relics look different — that is the whole point.
  if (n.stolen.length > 0) {
    const relic = mesh(G.box, glow(SIGNAL.critical), 0.05, len * 0.9, 0.05);
    relic.position.y = len * 0.45;
    g.add(relic);
  }

  tipAnchor.position.set(0, len, 0);
  baseAnchor.position.set(0, 0.04, 0);
  g.add(tipAnchor, baseAnchor);
  return g;
}

/** Body/accent colours for a seed. Its own RNG stream, so it never drifts. */
export function paletteFor(seed: number): { body: number; accent: number } {
  const r = new RNG(mixSeed(seed, 0x9a1c33));
  return { body: r.pick(BODY_COLORS), accent: r.pick(ACCENTS) };
}

/** Small coloured chip used by the hierarchy UI so cards match the 3D model. */
export function accentColorFor(n: Nemesis): string {
  return '#' + paletteFor(n.appearanceSeed).accent.toString(16).padStart(6, '0');
}

export function disposeSharedAppearance(): void {
  for (const m of solidCache.values()) m.dispose();
  for (const m of glowCache.values()) m.dispose();
  solidCache.clear();
  glowCache.clear();
}
