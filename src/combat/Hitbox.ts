/**
 * Melee hit resolution.
 *
 * No physics engine, no swept volumes: a swing is an arc test against a
 * capsule's ground circle. It is cheap, predictable, and easy to tune, which
 * matters far more for feel than accuracy does.
 */

import * as THREE from 'three';

export interface ArcQuery {
  x: number;
  z: number;
  /** facing yaw, radians, 0 = -Z */
  facing: number;
  reach: number;
  /** half-angle of the arc in radians */
  halfArc: number;
}

/** Does the arc contain a circle of `radius` centred at (tx, tz)? */
export function arcHits(q: ArcQuery, tx: number, tz: number, radius: number): boolean {
  const dx = tx - q.x;
  const dz = tz - q.z;
  const dist = Math.hypot(dx, dz);
  if (dist > q.reach + radius) return false;
  if (dist < 0.001) return true;
  // Forward vector for yaw where 0 faces -Z.
  const fx = -Math.sin(q.facing);
  const fz = -Math.cos(q.facing);
  const dot = (dx * fx + dz * fz) / dist;
  const clamped = Math.max(-1, Math.min(1, dot));
  const ang = Math.acos(clamped);
  // Widen the arc for targets that are very close, so you cannot whiff a
  // point-blank swing by a couple of degrees.
  const slack = Math.min(0.65, radius / Math.max(0.6, dist));
  return ang <= q.halfArc + slack;
}

/** Radial test used by shockwaves and blasts. */
export function radiusHits(x: number, z: number, r: number, tx: number, tz: number, tRadius: number): boolean {
  return (tx - x) ** 2 + (tz - z) ** 2 <= (r + tRadius) ** 2;
}

/** Is `target` behind `attacker`-relative facing? Used for backstabs. */
export function isBehind(targetFacing: number, attackerX: number, attackerZ: number, targetX: number, targetZ: number): boolean {
  const dx = attackerX - targetX;
  const dz = attackerZ - targetZ;
  const fx = -Math.sin(targetFacing);
  const fz = -Math.cos(targetFacing);
  const dist = Math.hypot(dx, dz) || 1;
  return (dx * fx + dz * fz) / dist < -0.25;
}

export function angleTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function turnToward(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function flatDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
