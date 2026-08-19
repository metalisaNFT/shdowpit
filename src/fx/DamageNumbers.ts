/**
 * Pooled floating combat numbers. Allocated once, reused, projected onto
 * the HUD so they stay sharp at any resolution.
 *
 * Colour follows SIGNAL: white is a normal connect, toxic yellow is a crit,
 * red is damage you took, cyan is a deny (block / miss / parry).
 */

import * as THREE from 'three';
import { div } from '../ui/Dom';
import type { Combatant } from '../combat/Types';

const POOL = 36;
const LIFE = 0.82;

export type DamageFloatKind = 'hit' | 'crit' | 'hurt' | 'fire' | 'poison' | 'block' | 'miss' | 'parry';

interface Slot {
  el: HTMLDivElement;
  active: boolean;
  kind: DamageFloatKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class DamageNumbers {
  readonly root = div();
  private slots: Slot[] = [];
  private tmp = new THREE.Vector3();
  private cursor = 0;

  constructor() {
    this.root.id = 'dmg-layer';
    for (let i = 0; i < POOL; i++) {
      const el = div('dmg');
      el.style.display = 'none';
      this.root.append(el);
      this.slots.push({
        el,
        active: false,
        kind: 'hit',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: LIFE,
      });
    }
  }

  spawnOn(target: Combatant, text: string, kind: DamageFloatKind): void {
    this.spawn(target.position.x, target.position.y + target.height * 0.72, target.position.z, text, kind);
  }

  spawn(x: number, y: number, z: number, text: string, kind: DamageFloatKind): void {
    const s = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    s.active = true;
    s.kind = kind;
    s.x = x + (Math.random() - 0.5) * 0.55;
    s.y = y;
    s.z = z + (Math.random() - 0.5) * 0.55;
    s.vx = (Math.random() - 0.5) * 0.7;
    s.vy = kind === 'crit' || kind === 'hurt' ? 1.55 : 1.15;
    s.maxLife = kind === 'parry' || kind === 'crit' ? 1.05 : LIFE;
    s.life = s.maxLife;
    s.el.textContent = text;
    s.el.className = `dmg ${kind}`;
    s.el.style.display = 'block';
    s.el.style.opacity = '1';
  }

  update(dt: number, camera: THREE.Camera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.el.style.display = 'none';
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy *= 1 - 2.4 * dt;
      this.tmp.set(s.x, s.y, s.z).project(camera);
      if (this.tmp.z > 1) {
        s.el.style.opacity = '0';
        continue;
      }
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      const fade = t < 0.12 ? t / 0.12 : 1 - Math.pow(Math.max(0, (t - 0.45) / 0.55), 1.4);
      const pop = kindScale(s.kind, t);
      s.el.style.opacity = String(Math.max(0, fade));
      s.el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%) scale(${pop})`;
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.el.style.display = 'none';
    }
  }
}

function kindScale(kind: DamageFloatKind, t: number): number {
  const punch = 1 + Math.max(0, 1 - t * 8) * 0.22;
  if (kind === 'crit') return punch * 1.18;
  if (kind === 'hurt') return punch * 1.08;
  if (kind === 'parry') return punch * 1.05;
  return punch;
}
