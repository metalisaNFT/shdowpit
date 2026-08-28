/**
 * Persistent 3D roster population for THE LONG GAME oracle viewport.
 *
 * The sim roster always has bodies on the board — the overview should too,
 * not only during duel replays.
 */

import * as THREE from 'three';
import { getArea, AREAS } from '../data/areas';
import { buildEnemyRig } from '../nemesis/NemesisAppearance';
import { rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { generateGrunt } from '../nemesis/NemesisGenerator';
import { mixSeed } from '../core/RNG';
import type { Arena } from '../world/Arena';
import { AreaNav } from '../world/AreaNav';
import { actorWorldPosition } from '../world/MapDraw';
import type { GodRun } from '../god/GodRun';
import { mapTerritoryFor } from './GodMap';

interface PopEntry {
  id: string;
  areaId: string;
  rig: ReturnType<typeof buildEnemyRig>;
  home: THREE.Vector3;
  waypoint: THREE.Vector3;
  facing: number;
  speed: number;
  moveState: 'idle' | 'toWaypoint' | 'toHome';
  wanderT: number;
  idleUntil: number;
  path: { x: number; z: number }[];
  pathIdx: number;
  stuckT: number;
  lastX: number;
  lastZ: number;
  navSeed: number;
}

export class GodWorldPop {
  private scene: THREE.Group;
  private parent: THREE.Scene;
  private arena: Arena;
  private nav = new AreaNav();
  private entries = new Map<string, PopEntry>();
  private rabbleEntries: PopEntry[] = [];
  private suppressed = false;
  private active = false;

  constructor(parent: THREE.Scene, arena: Arena) {
    this.parent = parent;
    this.arena = arena;
    this.scene = new THREE.Group();
    this.scene.name = 'god-world-pop';
    parent.add(this.scene);
  }

  invalidateNav(): void {
    this.nav.invalidate();
  }

  /** Average spawn position for NPCs in an area — used to aim the oracle camera. */
  areaCentroid(areaId: string): { x: number; z: number } | null {
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.areaId !== areaId) continue;
      sx += e.home.x;
      sz += e.home.z;
      n++;
    }
    return n ? { x: sx / n, z: sz / n } : null;
  }

  /** Live centroid from current positions — tracks patrolling bodies. */
  areaLiveCentroid(areaId: string): { x: number; z: number } | null {
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.areaId !== areaId) continue;
      sx += e.rig.root.position.x;
      sz += e.rig.root.position.z;
      n++;
    }
    return n ? { x: sx / n, z: sz / n } : null;
  }

  /** Bounding span of live NPC positions — used for camera framing. */
  areaLiveBounds(areaId: string): { cx: number; cz: number; span: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.areaId !== areaId) continue;
      const p = e.rig.root.position;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      n++;
    }
    if (!n) return null;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const span = Math.max(maxX - minX, maxZ - minZ, 4);
    return { cx, cz, span };
  }

  countInArea(areaId: string): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.areaId === areaId) n++;
    }
    return n;
  }

  /** Live position for a named roster body — used for intervention VFX. */
  positionOf(id: string): { x: number; y: number; z: number } | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const p = entry.rig.root.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Brief reaction when the player writes a condition on someone. */
  reactToMark(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.rig.anim.playOneShot('TAUNT', 'Taunt', 1.08);
  }

  sync(run: GodRun): void {
    this.ensureAttached();
    this.active = true;
    const living = new Set(run.mgr.living().map((n) => n.id));

    for (const [id, entry] of this.entries) {
      if (!living.has(id)) this.removeEntry(id, entry);
    }

    for (const n of run.mgr.namedLiving()) {
      const areaId = mapTerritoryFor(n, run);
      const existing = this.entries.get(n.id);
      if (existing && existing.areaId === areaId) continue;
      if (existing) this.removeEntry(n.id, existing);
      this.addEntry(n, areaId);
    }

    this.rebuildRabble(run);

    this.applyVisibility();
  }

  setSuppressed(on: boolean): void {
    this.suppressed = on;
    this.applyVisibility();
  }

  update(dt: number): void {
    if (!this.active || this.suppressed) return;
    this.ensureAttached();

    for (const entry of this.entries.values()) {
      entry.wanderT += dt;
      const pos = entry.rig.root.position;
      let vx = 0;
      let vz = 0;
      let speed = 0;

      if (entry.moveState === 'idle') {
        if (entry.wanderT >= entry.idleUntil) {
          this.assignPatrol(entry);
          entry.moveState = 'toWaypoint';
          this.planPath(entry, entry.waypoint);
        }
      } else {
        const finalGoal = entry.moveState === 'toWaypoint' ? entry.waypoint : entry.home;
        if (!entry.path.length) this.planPath(entry, finalGoal);

        const node = entry.path[entry.pathIdx] ?? { x: finalGoal.x, z: finalGoal.z };
        const dx = node.x - pos.x;
        const dz = node.z - pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.55) {
          if (entry.pathIdx < entry.path.length - 1) {
            entry.pathIdx++;
          } else if (Math.hypot(finalGoal.x - pos.x, finalGoal.z - pos.z) < 0.75) {
            if (entry.moveState === 'toWaypoint') {
              entry.moveState = 'toHome';
              this.planPath(entry, entry.home);
            } else {
              entry.moveState = 'idle';
              entry.path = [];
              entry.pathIdx = 0;
              entry.idleUntil = entry.wanderT + 0.8 + (entry.id.length % 5) * 0.3;
            }
          } else {
            entry.pathIdx = entry.path.length;
          }
        }

        const steer = entry.path[entry.pathIdx] ?? { x: finalGoal.x, z: finalGoal.z };
        const sdx = steer.x - pos.x;
        const sdz = steer.z - pos.z;
        const sdist = Math.hypot(sdx, sdz);
        if (sdist > 0.05) {
          speed = entry.speed;
          vx = (sdx / sdist) * speed;
          vz = (sdz / sdist) * speed;
          entry.facing = Math.atan2(-sdx, -sdz);
        }

        const moved = Math.hypot(pos.x - entry.lastX, pos.z - entry.lastZ);
        if (speed > 0.05 && moved < 0.04) entry.stuckT += dt;
        else entry.stuckT = 0;
        if (entry.stuckT > 0.55) {
          entry.stuckT = 0;
          this.planPath(entry, finalGoal);
        }
      }

      entry.lastX = pos.x;
      entry.lastZ = pos.z;

      if (speed > 0.05) {
        const nextX = pos.x + vx * dt;
        const nextZ = pos.z + vz * dt;
        const resolved = { x: nextX, z: nextZ };
        this.arena.resolve(nextX, nextZ, 0.65, resolved);
        pos.x = resolved.x;
        pos.z = resolved.z;
        pos.y = 0;
        entry.rig.root.rotation.y = entry.facing;
        entry.rig.anim.clearSustained();
        const cos = Math.cos(-entry.facing);
        const sin = Math.sin(-entry.facing);
        const localX = vx * cos - vz * sin;
        const localZ = vx * sin + vz * cos;
        entry.rig.anim.setLocomotion(localX, localZ, speed, dt);
      } else {
        entry.rig.root.rotation.y = entry.facing;
        entry.rig.anim.clearSustained();
        entry.rig.anim.setLocomotion(0, 0, 0, dt);
      }

      entry.rig.anim.update(dt, dt);
    }

    for (const entry of this.rabbleEntries) {
      entry.wanderT += dt;
      const pos = entry.rig.root.position;
      let vx = 0;
      let vz = 0;
      let speed = 0;

      if (entry.moveState === 'idle') {
        if (entry.wanderT >= entry.idleUntil) entry.moveState = 'toWaypoint';
      } else {
        const target = entry.moveState === 'toWaypoint' ? entry.waypoint : entry.home;
        const node = entry.path[entry.pathIdx] ?? { x: target.x, z: target.z };
        const sdx = node.x - pos.x;
        const sdz = node.z - pos.z;
        const sdist = Math.hypot(sdx, sdz);
        if (sdist < 0.55) {
          if (entry.pathIdx < entry.path.length - 1) entry.pathIdx++;
          else if (Math.hypot(target.x - pos.x, target.z - pos.z) < 0.75) {
            entry.moveState = entry.moveState === 'toWaypoint' ? 'toHome' : 'idle';
            entry.idleUntil = entry.wanderT + 0.4 + (entry.id.length % 4) * 0.15;
          } else entry.pathIdx = entry.path.length;
        }
        if (sdist > 0.05) {
          speed = entry.speed;
          vx = (sdx / sdist) * speed;
          vz = (sdz / sdist) * speed;
          entry.facing = Math.atan2(-sdx, -sdz);
        }
      }

      if (speed > 0.05) {
        const resolved = { x: pos.x + vx * dt, z: pos.z + vz * dt };
        this.arena.resolve(resolved.x, resolved.z, 0.6, resolved);
        pos.x = resolved.x;
        pos.z = resolved.z;
        pos.y = 0;
        entry.rig.root.rotation.y = entry.facing;
        entry.rig.anim.clearSustained();
        const cos = Math.cos(-entry.facing);
        const sin = Math.sin(-entry.facing);
        entry.rig.anim.setLocomotion(vx * cos - vz * sin, vx * sin + vz * cos, speed, dt);
      } else {
        entry.rig.anim.clearSustained();
        entry.rig.anim.setLocomotion(0, 0, 0, dt);
      }
      entry.rig.anim.update(dt, dt);
    }
  }

  clear(): void {
    for (const [id, entry] of this.entries) this.removeEntry(id, entry);
    this.entries.clear();
    for (const entry of this.rabbleEntries) this.disposeRig(entry);
    this.rabbleEntries = [];
    this.active = false;
    this.suppressed = false;
  }

  dispose(): void {
    this.clear();
    this.scene.parent?.remove(this.scene);
  }

  private addEntry(n: Nemesis, areaId: string): void {
    const area = getArea(areaId);
    const pos = actorWorldPosition(area, n.id, (x, z, r, out) => this.arena.resolve(x, z, r, out));
    const rig = buildEnemyRig(n);
    const ri = rankIndex(n.rank);
    rig.root.scale.setScalar(1.35 + ri * 0.1);
    rig.root.position.set(pos.x, 0, pos.z);

    let h = 0;
    for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0;
    const facing = ((h >>> 8) & 0xffff) / 0xffff * Math.PI * 2;
    rig.root.rotation.y = facing;

    const home = new THREE.Vector3(pos.x, 0, pos.z);
    const wpPt =
      this.nav.pickPatrolPoint(this.arena, areaId, pos.x, pos.z, h >>> 0) ??
      (() => {
        const fallback = { x: pos.x, z: pos.z };
        const patrolDist = 8 + (h & 5);
        const patrolAng = facing + Math.PI * 0.45;
        this.arena.resolve(
          pos.x + Math.cos(patrolAng) * patrolDist,
          pos.z + Math.sin(patrolAng) * patrolDist,
          0.65,
          fallback
        );
        return fallback;
      })();
    const waypoint = new THREE.Vector3(wpPt.x, 0, wpPt.z);

    this.scene.add(rig.root);

    const entry: PopEntry = {
      id: n.id,
      areaId,
      rig,
      home,
      waypoint,
      facing,
      speed: 2.8 + (h & 3) * 1.2,
      moveState: 'toWaypoint',
      wanderT: (h & 255) * 0.01,
      idleUntil: 0,
      path: [],
      pathIdx: 0,
      stuckT: 0,
      lastX: pos.x,
      lastZ: pos.z,
      navSeed: h >>> 0,
    };
    this.planPath(entry, waypoint);
    this.entries.set(n.id, entry);
  }

  private assignPatrol(entry: PopEntry): void {
    entry.navSeed = (entry.navSeed * 1664525 + 1013904223 + Math.floor(entry.wanderT * 1000)) >>> 0;
    const pos = entry.rig.root.position;
    const pt = this.nav.pickPatrolPoint(this.arena, entry.areaId, pos.x, pos.z, entry.navSeed);
    if (pt) entry.waypoint.set(pt.x, 0, pt.z);
  }

  private planPath(entry: PopEntry, goal: THREE.Vector3): void {
    const pos = entry.rig.root.position;
    entry.path = this.nav.findPath(this.arena, entry.areaId, pos.x, pos.z, goal.x, goal.z);
    entry.pathIdx = 0;
    entry.stuckT = 0;
  }

  private removeEntry(id: string, entry: PopEntry): void {
    this.scene.remove(entry.rig.root);
    this.disposeRig(entry);
    this.entries.delete(id);
  }

  private disposeRig(entry: PopEntry): void {
    entry.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  private rebuildRabble(run: GodRun): void {
    for (const entry of this.rabbleEntries) {
      this.scene.remove(entry.rig.root);
      this.disposeRig(entry);
    }
    this.rabbleEntries = [];

    for (const area of AREAS) {
      const count = 2 + Math.floor(area.population / 5);
      for (let i = 0; i < count; i++) this.addRabble(area.id, i, run);
    }
  }

  private addRabble(areaId: string, index: number, run: GodRun): void {
    const area = getArea(areaId);
    const seed = mixSeed(mixSeed(mixSeed(run.mgr.data.worldSeed, run.god.cycle), areaId.charCodeAt(0)), index) >>> 0;
    const grunt = generateGrunt(seed, 1 + (seed & 3), run.mgr.mods, areaId);
    const pos = actorWorldPosition(area, `rabble:${areaId}:${index}`, (x, z, r, out) => this.arena.resolve(x, z, r, out));
    const rig = buildEnemyRig(grunt);
    rig.root.scale.setScalar(1.05 + (seed & 7) * 0.02);
    rig.root.position.set(pos.x, 0, pos.z);

    const facing = ((seed >>> 8) & 0xffff) / 0xffff * Math.PI * 2;
    const patrolDist = 4 + (seed & 5);
    const patrolAng = facing + Math.PI * 0.5;
    const wp = { x: 0, z: 0 };
    this.arena.resolve(pos.x + Math.cos(patrolAng) * patrolDist, pos.z + Math.sin(patrolAng) * patrolDist, 0.55, wp);

    this.scene.add(rig.root);
    const entry: PopEntry = {
      id: `rabble:${areaId}:${index}`,
      areaId,
      rig,
      home: new THREE.Vector3(pos.x, 0, pos.z),
      waypoint: new THREE.Vector3(wp.x, 0, wp.z),
      facing,
      speed: 3.2 + (seed & 3) * 0.9,
      moveState: 'toWaypoint',
      wanderT: (seed & 127) * 0.01,
      idleUntil: 0,
      path: [],
      pathIdx: 0,
      stuckT: 0,
      lastX: pos.x,
      lastZ: pos.z,
      navSeed: seed,
    };
    this.planPath(entry, entry.waypoint);
    this.rabbleEntries.push(entry);
  }

  private applyVisibility(): void {
    const show = this.active && !this.suppressed;
    this.scene.visible = show;
  }

  /** Arena rebuild strips overlay groups from the scene — reattach when needed. */
  private ensureAttached(): void {
    if (this.scene.parent !== this.parent) this.parent.add(this.scene);
  }
}
