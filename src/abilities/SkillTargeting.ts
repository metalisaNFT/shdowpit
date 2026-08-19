/**
 * Deterministic skill queries: lock-on, nearest, LOS, cones, disks.
 */

import type { Arena } from '../world/Arena';
import type { Enemy } from '../enemy/Enemy';
import { arcHits, radiusHits } from '../combat/Hitbox';
import type { SkillDef, WeaponSkillProfile } from '../data/skills';

export interface Aim {
  x: number;
  z: number;
  facing: number;
  lockUid: number | null;
}

export function scaledRadius(def: SkillDef, profile: WeaponSkillProfile, momentumReach = 1): number {
  return def.radius * profile.radiusMul * momentumReach;
}

export function scaledDistance(def: SkillDef, profile: WeaponSkillProfile, momentumReach = 1): number {
  return def.distance * profile.reachMul * momentumReach;
}

export function hasLos(arena: Arena, ax: number, az: number, bx: number, bz: number): boolean {
  return arena.lineOfSight(ax, az, bx, bz);
}

export function pickTetherTarget(
  enemies: Enemy[],
  aim: Aim,
  arena: Arena,
  range: number,
  halfArc: number
): Enemy | null {
  if (aim.lockUid !== null) {
    const locked = enemies.find((e) => e.alive && e.uid === aim.lockUid) ?? null;
    if (locked) {
      const d = Math.hypot(locked.position.x - aim.x, locked.position.z - aim.z);
      if (d <= range + locked.radius && hasLos(arena, aim.x, aim.z, locked.position.x, locked.position.z)) {
        return locked;
      }
    }
  }
  let best: Enemy | null = null;
  let bestScore = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.position.x - aim.x, e.position.z - aim.z);
    if (d > range + e.radius) continue;
    if (!arcHits({ x: aim.x, z: aim.z, facing: aim.facing, reach: range, halfArc }, e.position.x, e.position.z, e.radius)) {
      continue;
    }
    if (!hasLos(arena, aim.x, aim.z, e.position.x, e.position.z)) continue;
    const score = d - (e.named ? 0.4 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

export function enemiesInDisk(enemies: Enemy[], x: number, z: number, r: number, max = 99): Enemy[] {
  const hits: Array<{ e: Enemy; d: number }> = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!radiusHits(x, z, r, e.position.x, e.position.z, e.radius)) continue;
    hits.push({ e, d: Math.hypot(e.position.x - x, e.position.z - z) });
  }
  hits.sort((a, b) => a.d - b.d);
  return hits.slice(0, max).map((h) => h.e);
}

export function enemiesInCone(
  enemies: Enemy[],
  x: number,
  z: number,
  facing: number,
  reach: number,
  halfArc: number
): Enemy[] {
  const out: Enemy[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    if (arcHits({ x, z, facing, reach, halfArc }, e.position.x, e.position.z, e.radius)) out.push(e);
  }
  return out;
}

export function enemiesAlongSegment(
  enemies: Enemy[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  radius: number
): Enemy[] {
  const out: Enemy[] = [];
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  for (const e of enemies) {
    if (!e.alive) continue;
    const px = e.position.x - ax;
    const pz = e.position.z - az;
    const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / (len * len)));
    const cx = ax + dx * t;
    const cz = az + dz * t;
    if (Math.hypot(e.position.x - cx, e.position.z - cz) <= radius + e.radius) out.push(e);
  }
  return out;
}
