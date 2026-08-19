/**
 * THE SHADOW PIT HUMANOID RIG — the one skeleton every humanoid in the game
 * uses. Full standard in docs/RIG.md; the short version:
 *
 *   Root                      ground level; owns yaw and uniform scale
 *    └─ Hips                  clips write position (bob) + rotation
 *        ├─ Spine ─ Chest ─ Head
 *        │            ├─ UpperArm_L ─ LowerArm_L ─ Hand_L ─ HandSlot_L
 *        │            └─ UpperArm_R ─ LowerArm_R ─ Hand_R ─ HandSlot_R
 *        ├─ UpperLeg_L ─ LowerLeg_L ─ Foot_L ─ Toes_L
 *        └─ UpperLeg_R ─ LowerLeg_R ─ Foot_R ─ Toes_R
 *
 *   FORWARD IS -Z. The rest pose ships already facing -Z (the 180° flip from
 *   the source pack happens once, in tools/bakeclips.mjs). Nothing at runtime
 *   compensates, ever. yaw 0 = -Z, forward = (-sin yaw, 0, -cos yaw).
 *
 *   The skeleton's bone offsets are IDENTICAL for every character (that is
 *   what makes every baked clip valid on every body). Character size comes
 *   from Root.scale; character variety comes from the meshes attached to the
 *   bones, never from moving the bones.
 *
 *   HandSlot_R / HandSlot_L are the weapon mounts. At rest their local +Y
 *   points along the character's forward (-Z world): a weapon modelled with
 *   its blade along +Y sits correctly in the grip.
 */

import * as THREE from 'three';
import { REST_POSE, RIG_MEASUREMENTS } from './ClipLibrary';

export type BoneName =
  | 'Hips'
  | 'Spine'
  | 'Chest'
  | 'Head'
  | 'UpperArm_L'
  | 'LowerArm_L'
  | 'Hand_L'
  | 'HandSlot_L'
  | 'UpperArm_R'
  | 'LowerArm_R'
  | 'Hand_R'
  | 'HandSlot_R'
  | 'UpperLeg_L'
  | 'LowerLeg_L'
  | 'Foot_L'
  | 'Toes_L'
  | 'UpperLeg_R'
  | 'LowerLeg_R'
  | 'Foot_R'
  | 'Toes_R';

export const RIG_HIERARCHY: Record<BoneName, BoneName | null> = {
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

/** Segment lengths in source units, useful when sizing attached meshes. */
export const SEG = {
  /** hips height above ground at rest */
  hipsY: REST_POSE.Hips.t[1],
  spineLen: len(REST_POSE.Spine.t),
  chestLen: len(REST_POSE.Chest.t),
  headLen: len(REST_POSE.Head.t),
  upperArm: len(REST_POSE.LowerArm_R.t),
  lowerArm: len(REST_POSE.Hand_R.t),
  upperLeg: len(REST_POSE.LowerLeg_R.t),
  lowerLeg: len(REST_POSE.Foot_R.t),
  foot: len(REST_POSE.Toes_R.t),
  shoulderX: Math.abs(REST_POSE.UpperArm_R.t[0]),
  hipX: Math.abs(REST_POSE.UpperLeg_R.t[0]),
  /** top of the head at rest, source units */
  headTop: RIG_MEASUREMENTS.headTop,
} as const;

function len(v: number[]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export interface SPRig {
  /** ground-level node: position + yaw + uniform scale live here */
  root: THREE.Group;
  bones: Record<BoneName, THREE.Object3D>;
  /** uniform character scale applied at the root */
  scale: number;
  /** world height of the head top at rest (metres) */
  height: number;
}

/**
 * Build the standard skeleton. Every bone is a plain Object3D named exactly
 * after its BoneName — that name is the contract the animation clips bind to.
 */
export function buildSkeleton(scale: number): SPRig {
  const root = new THREE.Group();
  root.name = 'Root';
  root.scale.setScalar(scale);

  const bones = {} as Record<BoneName, THREE.Object3D>;
  for (const name of Object.keys(RIG_HIERARCHY) as BoneName[]) {
    const b = new THREE.Object3D();
    b.name = name;
    const rest = REST_POSE[name];
    b.position.fromArray(rest.t);
    b.quaternion.fromArray(rest.r);
    bones[name] = b;
  }
  for (const [name, parent] of Object.entries(RIG_HIERARCHY) as Array<[BoneName, BoneName | null]>) {
    if (parent) bones[parent].add(bones[name]);
    else root.add(bones[name]);
  }

  return { root, bones, scale, height: SEG.headTop * scale };
}

/** Reset every bone to the rest pose (used before snapshots / QA). */
export function resetToRest(rig: SPRig): void {
  for (const name of Object.keys(RIG_HIERARCHY) as BoneName[]) {
    const rest = REST_POSE[name];
    rig.bones[name].position.fromArray(rest.t);
    rig.bones[name].quaternion.fromArray(rest.r);
  }
}

/**
 * Convenience: a box mesh sized/positioned to sheath a bone segment.
 * `along` is the segment length (source units); the box is centred halfway
 * along the bone's +Y (bones point at their child along local +Y).
 */
export function limbMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  w: number,
  along: number,
  d: number
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(w, along, d);
  m.position.y = along * 0.5;
  m.castShadow = true;
  return m;
}
