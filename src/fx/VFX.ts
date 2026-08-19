/**
 * Pooled combat VFX.
 *
 * Everything here is allocated ONCE and reused: rings, slash arcs, flashes,
 * ground cracks, weapon-trail ribbons. Nothing in the combat path creates a
 * Mesh, Material or Geometry mid-fight (the old Particles.ring/slash/flash
 * allocated a material per event and a geometry per slash — that is exactly
 * the churn this module removes).
 *
 * Visual language (see data/palette.ts): effects are tinted by SIGNAL
 * meanings, never decorated. The distinct impact types exist so the player
 * can read hit QUALITY without the HUD: what colour the burst is and what
 * shape the flash takes IS the information.
 */

import * as THREE from 'three';
import type { Particles } from './Particles';
import { SIGNAL, WORLD, NEON } from '../data/palette';

const RING_POOL = 28;
const ARC_POOL = 14;
const FLASH_POOL = 18;
const CRACK_POOL = 6;
const TRAIL_POOL = 8;
const TRAIL_SEGS = 30;

interface RingFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  baseOpacity: number;
  active: boolean;
}
interface ArcFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  active: boolean;
}
interface FlashFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  active: boolean;
}
interface CrackFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  active: boolean;
}

export type ImpactKind =
  | 'flesh'
  | 'armor'
  | 'parry'
  | 'perfect_parry'
  | 'crit'
  | 'posture_break'
  | 'poison'
  | 'projectile'
  | 'environment'
  | 'execute';

export class VFX {
  readonly group = new THREE.Group();

  private rings: RingFx[] = [];
  private arcs: ArcFx[] = [];
  private flashes: FlashFx[] = [];
  private cracks: CrackFx[] = [];
  private trails: TrailRibbon[] = [];

  private ringGeo = new THREE.RingGeometry(0.86, 1, 40, 1);
  private thinRingGeo = new THREE.RingGeometry(0.94, 1, 48, 1);
  private flashGeo = new THREE.IcosahedronGeometry(1, 1);
  private arcGeos = new Map<number, THREE.RingGeometry>();
  private crackTex: THREE.CanvasTexture;

  constructor(private particles: Particles) {
    const mkMat = () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });

    for (let i = 0; i < RING_POOL; i++) {
      const mat = mkMat();
      const mesh = new THREE.Mesh(i % 3 === 2 ? this.thinRingGeo : this.ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, life: 0, maxLife: 1, from: 0, to: 1, baseOpacity: 0.85, active: false });
    }
    for (let i = 0; i < ARC_POOL; i++) {
      const mat = mkMat();
      const mesh = new THREE.Mesh(this.arcGeo(1.0), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.arcs.push({ mesh, mat, life: 0, maxLife: 1, active: false });
    }
    for (let i = 0; i < FLASH_POOL; i++) {
      const mat = mkMat();
      const mesh = new THREE.Mesh(this.flashGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.flashes.push({ mesh, mat, life: 0, maxLife: 1, from: 1, to: 2, active: false });
    }

    this.crackTex = makeCrackTexture();
    const crackGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < CRACK_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.crackTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(crackGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.cracks.push({ mesh, mat, life: 0, maxLife: 1, active: false });
    }

    for (let i = 0; i < TRAIL_POOL; i++) {
      const t = new TrailRibbon();
      this.group.add(t.mesh);
      this.trails.push(t);
    }
  }

  /** arc geometries cached at quantized half-arc widths */
  private arcGeo(halfArc: number): THREE.RingGeometry {
    const q = Math.max(0.3, Math.min(1.8, Math.round(halfArc / 0.15) * 0.15));
    let g = this.arcGeos.get(q);
    if (!g) {
      g = new THREE.RingGeometry(0.34, 1, 18, 1, Math.PI / 2 - q, q * 2);
      this.arcGeos.set(q, g);
    }
    return g;
  }

  /* ============================================================
     primitives
     ============================================================ */

  /** Expanding (from<to) or contracting (from>to) ground ring. */
  ring(x: number, y: number, z: number, color: number, from: number, to: number, life = 0.42, opacity = 0.85): void {
    const r = this.rings.find((r) => !r.active);
    if (!r) return;
    r.active = true;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    r.mesh.scale.setScalar(Math.max(0.01, from));
    r.mat.color.setHex(color);
    r.mat.opacity = opacity;
    r.life = r.maxLife = life;
    r.from = from;
    r.to = to;
    r.baseOpacity = opacity;
  }

  /** A swing arc drawn flat, oriented along a facing. */
  slash(x: number, y: number, z: number, facing: number, reach: number, halfArc: number, color: number, life = 0.16): void {
    const a = this.arcs.find((a) => !a.active);
    if (!a) return;
    a.active = true;
    a.mesh.geometry = this.arcGeo(halfArc);
    a.mesh.visible = true;
    a.mesh.position.set(x, y, z);
    a.mesh.scale.setScalar(reach);
    a.mesh.rotation.z = -facing;
    a.mat.color.setHex(color);
    a.mat.opacity = 0.6;
    a.life = a.maxLife = life;
  }

  /** Momentary bright core at a point of impact. */
  flash(x: number, y: number, z: number, color: number, size = 0.7, life = 0.14): void {
    const f = this.flashes.find((f) => !f.active);
    if (!f) return;
    f.active = true;
    f.mesh.visible = true;
    f.mesh.position.set(x, y, z);
    f.mesh.scale.setScalar(size);
    f.mat.color.setHex(color);
    f.mat.opacity = 0.9;
    f.life = f.maxLife = life;
    f.from = size;
    f.to = size * 2.1;
  }

  /** Glowing ground cracks that fade — the scar a slam leaves. */
  crackDecal(x: number, z: number, radius: number, color: number, life = 1.3): void {
    const c = this.cracks.find((c) => !c.active);
    if (!c) return;
    c.active = true;
    c.mesh.visible = true;
    c.mesh.position.set(x, 0.04, z);
    c.mesh.scale.setScalar(radius);
    c.mesh.rotation.z = Math.random() * Math.PI * 2;
    c.mat.color.setHex(color);
    c.mat.opacity = 0.95;
    c.life = c.maxLife = life;
  }

  /* ============================================================
     compositions
     ============================================================ */

  /**
   * The full slam payoff: expanding shockwave ring + white leading edge +
   * glowing cracks + debris + dust. The camera impulse and hit-stop stay with
   * the caller (they touch game systems, not the scene).
   */
  shockwave(x: number, z: number, radius: number, color: number = SIGNAL.areaWarning): void {
    this.ring(x, 0.07, z, color, 0.5, radius, 0.38, 0.95);
    this.ring(x, 0.09, z, 0xffffff, 0.3, radius * 0.6, 0.22, 0.8);
    this.crackDecal(x, z, radius * 0.55, color, 1.25);
    this.flash(x, 0.5, z, color, 0.9, 0.16);
    this.particles.burst(x, 0.4, z, 26, color, 11, { size: 0.15, life: 0.55 });
    this.particles.burst(x, 0.3, z, 18, WORLD.metal, 9, { size: 0.15, life: 0.7, gravity: -26 });
    this.particles.dust(x, 0.3, z, 14);
  }

  /**
   * Distinct impact effects — hit QUALITY as colour + shape:
   *   flesh          small accent-red chips, quick
   *   armor          grey sparks, flat white flash (blocked / armoured)
   *   parry          cyan sparks
   *   perfect_parry  cyan starburst + ground ring
   *   crit           toxic-gold star flash
   *   posture_break  white blowout + cyan ring
   *   poison         acid droplets, sluggish gravity
   *   projectile     small lime prick (player needle lands)
   *   environment    dull grey puff
   *   execute        magenta-red eruption
   */
  impact(kind: ImpactKind, x: number, y: number, z: number, dirX = 0, dirZ = 0, power = 1): void {
    switch (kind) {
      case 'flesh':
        this.particles.burst(x, y, z, Math.round(9 * power), 0xff5a4a, 7, { size: 0.11, life: 0.4, dirX, dirZ });
        this.flash(x, y, z, 0xff8a5a, 0.45 * power, 0.09);
        break;
      case 'armor':
        this.particles.burst(x, y, z, 7, 0xbfc6d2, 6, { size: 0.08, life: 0.28, dirX, dirZ, gravity: -30 });
        this.flash(x, y, z, 0xffffff, 0.35, 0.07);
        break;
      case 'parry':
        this.particles.burst(x, y, z, 20, SIGNAL.parryable, 10, { size: 0.12, life: 0.42 });
        this.flash(x, y, z, SIGNAL.parryable, 0.85, 0.14);
        break;
      case 'perfect_parry':
        this.particles.burst(x, y, z, 40, SIGNAL.parryable, 15, { size: 0.16, life: 0.42 });
        this.flash(x, y, z, SIGNAL.parryable, 1.35, 0.2);
        this.flash(x, y, z, 0xffffff, 0.7, 0.1);
        this.ring(x, 0.05, z, SIGNAL.parryable, 0.4, 4.6, 0.4, 0.9);
        break;
      case 'crit':
        this.flash(x, y + 0.3, z, SIGNAL.critical, 0.9 * power, 0.12);
        this.particles.burst(x, y, z, 12, SIGNAL.critical, 9, { size: 0.1, life: 0.35 });
        break;
      case 'posture_break':
        this.flash(x, y, z, SIGNAL.postureBreak, 1.5, 0.22);
        this.particles.burst(x, y, z, 34, SIGNAL.postureBreak, 13, { size: 0.15, life: 0.55 });
        this.ring(x, 0.05, z, SIGNAL.posture, 0.5, 5.5, 0.5, 0.85);
        break;
      case 'poison':
        this.particles.burst(x, y, z, 14, SIGNAL.poison, 6, { size: 0.12, life: 0.6, gravity: -2 });
        this.flash(x, y, z, SIGNAL.poison, 0.5, 0.12);
        break;
      case 'projectile':
        this.particles.burst(x, y, z, 8, SIGNAL.player, 6, { size: 0.09, life: 0.3 });
        this.flash(x, y, z, SIGNAL.player, 0.5, 0.1);
        break;
      case 'environment':
        this.particles.burst(x, y, z, 5, 0x8a8a94, 4, { size: 0.07, life: 0.25 });
        break;
      case 'execute':
        this.particles.burst(x, y, z, 46, NEON.red, 15, { size: 0.2, life: 0.8 });
        this.flash(x, y, z, 0xffffff, 1.3, 0.2);
        this.flash(x, y, z, SIGNAL.execute, 1.7, 0.26);
        this.ring(x, 0.05, z, NEON.red, 0.4, 5.2, 0.5, 0.85);
        break;
    }
  }

  /**
   * Named-NPC story bursts. Accent is identity colour; telegraph hues are
   * never used here so combat remains readable.
   */
  story(kind: 'arrival' | 'escape' | 'death' | 'resurrection' | 'promotion' | 'overlord' | 'betrayal', x: number, z: number, accent: number): void {
    switch (kind) {
      case 'arrival':
        this.ring(x, 0.06, z, accent, 0.4, 6.5, 0.55, 0.55);
        this.flash(x, 1.2, z, accent, 0.7, 0.18);
        this.particles.burst(x, 0.4, z, 16, accent, 7, { size: 0.1, life: 0.5 });
        break;
      case 'escape':
        this.particles.dust(x, 0.2, z, 18);
        this.ring(x, 0.05, z, 0x8a8a94, 0.3, 4.2, 0.35, 0.4);
        break;
      case 'death':
        this.flash(x, 1.1, z, accent, 1.1, 0.22);
        this.ring(x, 0.05, z, accent, 0.4, 5.0, 0.4, 0.7);
        this.particles.burst(x, 1.0, z, 22, accent, 10, { size: 0.14, life: 0.55 });
        break;
      case 'resurrection':
        this.ring(x, 0.06, z, NEON.acid, 0.3, 7.2, 0.8, 0.7);
        this.ring(x, 0.08, z, NEON.violet, 0.2, 4.4, 0.55, 0.55);
        this.flash(x, 0.8, z, NEON.acid, 1.2, 0.28);
        this.particles.burst(x, 0.3, z, 28, NEON.acid, 8, { size: 0.12, life: 0.8, gravity: -4 });
        this.particles.burst(x, 1.0, z, 14, NEON.violet, 6, { size: 0.1, life: 0.7 });
        this.crackDecal(x, z, 2.2, NEON.violet, 1.6);
        break;
      case 'promotion':
        this.ring(x, 0.06, z, SIGNAL.critical, 0.4, 5.5, 0.5, 0.6);
        this.flash(x, 1.4, z, SIGNAL.critical, 0.8, 0.2);
        break;
      case 'overlord':
        this.ring(x, 0.06, z, NEON.violet, 0.5, 8.5, 0.7, 0.65);
        this.ring(x, 0.08, z, accent, 0.3, 5.0, 0.45, 0.5);
        this.flash(x, 1.6, z, accent, 1.3, 0.28);
        this.particles.burst(x, 0.4, z, 24, NEON.violet, 8, { size: 0.13, life: 0.7 });
        break;
      case 'betrayal':
        this.flash(x, 1.2, z, NEON.magenta, 0.9, 0.16);
        this.particles.burst(x, 1.0, z, 12, NEON.magenta, 8, { size: 0.1, life: 0.4 });
        break;
    }
  }

  /* ============================================================
     weapon trails
     ============================================================ */

  /** Claim a ribbon. Returns a handle (-1 if none free). */
  trailStart(color: number, width: number): number {
    for (let i = 0; i < this.trails.length; i++) {
      if (!this.trails[i].active) {
        this.trails[i].start(color, width);
        return i;
      }
    }
    return -1;
  }

  /** Feed the blade segment for this frame (base = guard, tip = point). */
  trailPoint(handle: number, base: THREE.Vector3, tip: THREE.Vector3): void {
    if (handle >= 0) this.trails[handle]?.push(base, tip);
  }

  trailEnd(handle: number): void {
    if (handle >= 0) this.trails[handle]?.end();
  }

  /* ============================================================
     tick
     ============================================================ */

  update(dt: number, rdt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(Math.max(0.01, r.from + (r.to - r.from) * e));
      // contracting rings brighten toward the end (the countdown accelerates)
      r.mat.opacity = r.from > r.to ? r.baseOpacity * (0.45 + t * 0.55) : r.baseOpacity * (1 - t);
    }
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      const t = 1 - a.life / a.maxLife;
      a.mat.opacity = 0.6 * (1 - t);
      a.mesh.scale.multiplyScalar(1 + dt * 0.9);
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      f.mesh.scale.setScalar(f.from + (f.to - f.from) * (1 - Math.pow(1 - t, 3)));
      f.mat.opacity = 0.9 * (1 - t);
    }
    for (const c of this.cracks) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }
      const t = 1 - c.life / c.maxLife;
      c.mat.opacity = 0.95 * (1 - t * t);
    }
    for (const t of this.trails) t.update(rdt);
  }

  clear(): void {
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const a of this.arcs) {
      a.active = false;
      a.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.active = false;
      f.mesh.visible = false;
    }
    for (const c of this.cracks) {
      c.active = false;
      c.mesh.visible = false;
    }
    for (const t of this.trails) t.end(true);
  }

  dispose(): void {
    this.clear();
    this.ringGeo.dispose();
    this.thinRingGeo.dispose();
    this.flashGeo.dispose();
    for (const g of this.arcGeos.values()) g.dispose();
    this.crackTex.dispose();
    this.group.parent?.remove(this.group);
  }
}

/* ============================================================
   ribbon trail — follows the actual weapon path
   ============================================================ */

class TrailRibbon {
  readonly mesh: THREE.Mesh;
  active = false;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshBasicMaterial;
  private positions: Float32Array;
  private colors: Float32Array;
  private ages = new Float32Array(TRAIL_SEGS);
  private head = 0;
  private count = 0;
  private color = new THREE.Color();
  private fading = false;
  private maxAge = 0.16;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(TRAIL_SEGS * 2 * 3);
    this.colors = new Float32Array(TRAIL_SEGS * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_SEGS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  start(color: number, width: number): void {
    this.active = true;
    this.fading = false;
    this.head = 0;
    this.count = 0;
    this.color.setHex(color);
    this.maxAge = 0.1 + width * 0.1;
    this.mesh.visible = true;
  }

  push(base: THREE.Vector3, tip: THREE.Vector3): void {
    if (!this.active || this.fading) return;
    const i = this.head % TRAIL_SEGS;
    this.positions[i * 6 + 0] = base.x;
    this.positions[i * 6 + 1] = base.y;
    this.positions[i * 6 + 2] = base.z;
    this.positions[i * 6 + 3] = tip.x;
    this.positions[i * 6 + 4] = tip.y;
    this.positions[i * 6 + 5] = tip.z;
    this.ages[i] = 0;
    this.head++;
    this.count = Math.min(this.count + 1, TRAIL_SEGS);
  }

  end(hard = false): void {
    this.fading = true;
    if (hard) {
      this.active = false;
      this.mesh.visible = false;
      this.geo.setDrawRange(0, 0);
    }
  }

  update(rdt: number): void {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < TRAIL_SEGS; i++) this.ages[i] += rdt;

    // write colours by age (newest = full colour, oldest = black/additive-zero)
    const n = Math.min(this.count, TRAIL_SEGS);
    // ordered oldest -> newest so the strip is continuous
    const start = this.head - n;
    for (let k = 0; k < n; k++) {
      const i = (start + k + TRAIL_SEGS * 2) % TRAIL_SEGS;
      const fade = Math.max(0, 1 - this.ages[i] / this.maxAge);
      if (fade > 0.01) alive++;
      const o = k * 6;
      const r = this.color.r * fade;
      const g = this.color.g * fade;
      const b = this.color.b * fade;
      this.colors[o + 0] = r * 0.5;
      this.colors[o + 1] = g * 0.5;
      this.colors[o + 2] = b * 0.5;
      this.colors[o + 3] = r;
      this.colors[o + 4] = g;
      this.colors[o + 5] = b;
      // copy the segment's stored world positions into strip order
      const p = i * 6;
      this.stripPos[o + 0] = this.positions[p + 0];
      this.stripPos[o + 1] = this.positions[p + 1];
      this.stripPos[o + 2] = this.positions[p + 2];
      this.stripPos[o + 3] = this.positions[p + 3];
      this.stripPos[o + 4] = this.positions[p + 4];
      this.stripPos[o + 5] = this.positions[p + 5];
    }
    const posAttr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    (posAttr.array as Float32Array).set(this.stripPos.subarray(0, n * 6));
    posAttr.needsUpdate = true;
    const colAttr = this.geo.getAttribute('color') as THREE.BufferAttribute;
    colAttr.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));

    if (this.fading && alive === 0) {
      this.active = false;
      this.mesh.visible = false;
      this.geo.setDrawRange(0, 0);
    }
  }

  private stripPos = new Float32Array(TRAIL_SEGS * 2 * 3);
}

/** Radial crack pattern drawn once to a small canvas. */
function makeCrackTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineCap = 'round';
  const cx = S / 2;
  const cy = S / 2;
  const branches = 9;
  for (let i = 0; i < branches; i++) {
    const a0 = (i / branches) * Math.PI * 2 + Math.random() * 0.5;
    let x = cx;
    let y = cy;
    let a = a0;
    let w = 3.2;
    const steps = 5 + Math.floor(Math.random() * 3);
    for (let s = 0; s < steps; s++) {
      const len = (S * 0.5 * (0.55 + Math.random() * 0.5)) / steps;
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // little side crack
      if (Math.random() < 0.5) {
        const sa = a + (Math.random() - 0.5) * 1.8;
        ctx.lineWidth = w * 0.5;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + Math.cos(sa) * len * 0.5, ny + Math.sin(sa) * len * 0.5);
        ctx.stroke();
      }
      x = nx;
      y = ny;
      a += (Math.random() - 0.5) * 0.7;
      w *= 0.72;
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 2;
  return tex;
}
