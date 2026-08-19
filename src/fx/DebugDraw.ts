/**
 * Scene-space debug rendering, driven from the F1 panel.
 *
 * Four independent overlays, each answering one QA question:
 *
 *   vectors       do the model, the movement and the attack agree on forward?
 *   hitboxes      where do swings actually test?
 *   hurtboxes     what circle does each body occupy?
 *   trajectories  where is every projectile going?
 *
 * Everything is pooled; when no flag is on this costs nothing (Game skips the
 * update entirely). This is a developer tool — clarity beats prettiness.
 */

import * as THREE from 'three';
import type { Player } from '../player/Player';
import type { Enemy } from '../enemy/Enemy';
import { SIGNAL } from '../data/palette';

export interface DebugDrawFlags {
  vectors: boolean;
  hitboxes: boolean;
  hurtboxes: boolean;
  trajectories: boolean;
}

interface ProjectileView {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  kind: string;
}

const ARROW_POOL = 24;
const RING_POOL = 26;
const WEDGE_POOL = 10;
const LINE_POOL = 20;

/** yaw 0 = -Z, matching the game-wide convention. */
function forwardOf(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export class DebugDraw {
  readonly group = new THREE.Group();
  flags: DebugDrawFlags = { vectors: false, hitboxes: false, hurtboxes: false, trajectories: false };

  private arrows: THREE.ArrowHelper[] = [];
  private rings: THREE.LineLoop[] = [];
  private wedges: THREE.Line[] = [];
  private lines: THREE.Line[] = [];
  private built = false;
  private tmp = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  get any(): boolean {
    return this.flags.vectors || this.flags.hitboxes || this.flags.hurtboxes || this.flags.trajectories;
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    for (let i = 0; i < ARROW_POOL; i++) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 2, 0xffffff, 0.4, 0.22);
      a.visible = false;
      this.group.add(a);
      this.arrows.push(a);
    }
    const circle: THREE.Vector3[] = [];
    for (let i = 0; i < 28; i++) {
      const t = (i / 28) * Math.PI * 2;
      circle.push(new THREE.Vector3(Math.cos(t), 0, Math.sin(t)));
    }
    const circleGeo = new THREE.BufferGeometry().setFromPoints(circle);
    for (let i = 0; i < RING_POOL; i++) {
      const r = new THREE.LineLoop(circleGeo, new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
      r.visible = false;
      this.group.add(r);
      this.rings.push(r);
    }
    for (let i = 0; i < WEDGE_POOL; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 20 }, () => new THREE.Vector3())
      );
      const w = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
      w.visible = false;
      this.group.add(w);
      this.wedges.push(w);
    }
    for (let i = 0; i < LINE_POOL; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
      l.visible = false;
      this.group.add(l);
      this.lines.push(l);
    }
  }

  clear(): void {
    for (const a of this.arrows) a.visible = false;
    for (const r of this.rings) r.visible = false;
    for (const w of this.wedges) w.visible = false;
    for (const l of this.lines) l.visible = false;
  }

  update(player: Player, enemies: Enemy[], projectiles: ReadonlyArray<ProjectileView>): void {
    this.build();
    this.clear();
    let arrow = 0;
    let ring = 0;
    let wedge = 0;
    let line = 0;

    const useArrow = (
      x: number,
      y: number,
      z: number,
      dir: THREE.Vector3,
      len: number,
      color: number
    ): void => {
      if (arrow >= ARROW_POOL || dir.lengthSq() < 1e-6) return;
      const a = this.arrows[arrow++];
      a.visible = true;
      a.position.set(x, y, z);
      a.setDirection(this.tmpB.copy(dir).normalize());
      a.setLength(len, Math.min(0.4, len * 0.25), Math.min(0.25, len * 0.14));
      a.setColor(color);
    };

    const useRing = (x: number, z: number, r: number, color: number, y = 0.12): void => {
      if (ring >= RING_POOL) return;
      const m = this.rings[ring++];
      m.visible = true;
      m.position.set(x, y, z);
      m.scale.set(r, 1, r);
      (m.material as THREE.LineBasicMaterial).color.setHex(color);
    };

    const useWedge = (x: number, z: number, facing: number, reach: number, halfArc: number, color: number): void => {
      if (wedge >= WEDGE_POOL) return;
      const m = this.wedges[wedge++];
      m.visible = true;
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = pos.count;
      // centre → arc → centre
      pos.setXYZ(0, x, 0.14, z);
      for (let i = 1; i < n - 1; i++) {
        const t = (i - 1) / (n - 3);
        const a = facing - halfArc + t * halfArc * 2;
        pos.setXYZ(i, x - Math.sin(a) * reach, 0.14, z - Math.cos(a) * reach);
      }
      pos.setXYZ(n - 1, x, 0.14, z);
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      (m.material as THREE.LineBasicMaterial).color.setHex(color);
    };

    const useLine = (x: number, y: number, z: number, dx: number, dy: number, dz: number, color: number): void => {
      if (line >= LINE_POOL) return;
      const m = this.lines[line++];
      m.visible = true;
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, x, y, z);
      pos.setXYZ(1, x + dx, y + dy, z + dz);
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      (m.material as THREE.LineBasicMaterial).color.setHex(color);
    };

    const p = player;
    if (this.flags.vectors) {
      // PLAYER FORWARD (logical facing) — lime
      useArrow(p.position.x, 0.25, p.position.z, forwardOf(p.facing, this.tmp), 2.4, SIGNAL.player);
      // MOVEMENT VECTOR — white
      const v = p.controller.velocity;
      if (Math.hypot(v.x, v.z) > 0.5) {
        useArrow(p.position.x, 0.45, p.position.z, this.tmp.set(v.x, 0, v.z), 1.6, 0xffffff);
      }
      // VISUAL FORWARD (what the model actually shows) — cyan
      useArrow(p.position.x, 1.7, p.position.z, p.faceDirection(this.tmp), 1.6, SIGNAL.parryable);
      // ATTACK VECTOR — magenta, while a swing is live
      if (p.combat.action === 'attack') {
        useArrow(p.position.x, 1.1, p.position.z, forwardOf(p.facing, this.tmp), 2.8, SIGNAL.execute);
      }
      // ENEMY FORWARD — amber
      for (const e of enemies) {
        if (!e.alive) continue;
        useArrow(e.position.x, 0.25, e.position.z, forwardOf(e.facing, this.tmp), 2, SIGNAL.enemyAttack);
      }
    }

    if (this.flags.hurtboxes) {
      useRing(p.position.x, p.position.z, p.radius, SIGNAL.player);
      for (const e of enemies) {
        if (!e.alive) continue;
        useRing(e.position.x, e.position.z, e.radius, e.combat.broken ? 0xffffff : SIGNAL.unblockable);
      }
    }

    if (this.flags.hitboxes) {
      // The player's melee envelope, always; brighter while the window is hot.
      const w = p.weapon;
      useWedge(
        p.position.x,
        p.position.z,
        p.facing,
        w.reach,
        w.arc,
        p.combat.action === 'attack' && p.combat.phase === 'active' ? 0xffffff : SIGNAL.player
      );
      for (const e of enemies) {
        if (!e.alive || !e.combat.attacking || !e.combat.current) continue;
        const def = e.combat.current;
        if (def.areaRadius > 0) {
          useRing(e.position.x, e.position.z, def.areaRadius, SIGNAL.areaWarning, 0.16);
        } else if (!def.ranged) {
          useWedge(
            e.position.x,
            e.position.z,
            e.facing,
            e.weapon.reach * def.reachMul,
            e.weapon.arc * def.arcMul,
            e.combat.state === 'active' ? 0xffffff : SIGNAL.enemyAttack
          );
        }
      }
    }

    if (this.flags.trajectories) {
      for (const a of projectiles) {
        const s = Math.hypot(a.vx, a.vy, a.vz) || 1;
        useLine(a.x, a.y, a.z, (a.vx / s) * 6, (a.vy / s) * 6, (a.vz / s) * 6, a.kind === 'needle' ? SIGNAL.player : SIGNAL.unblockable);
      }
    }
  }
}
