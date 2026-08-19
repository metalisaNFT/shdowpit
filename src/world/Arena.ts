/**
 * The region geometry and its collision.
 *
 * One flat 520m square containing six areas of brutalist primitives. All the
 * props for an area go into a couple of InstancedMeshes so the whole map costs
 * a handful of draw calls, and collision is a uniform grid of circles and
 * axis-aligned boxes.
 */

import * as THREE from 'three';
import { RNG, mixSeed } from '../core/RNG';
import { AREAS, CONNECTIONS, WORLD_HALF, type AreaDef, getArea } from '../data/areas';
import { WORLD, NEON, shade } from '../data/palette';
import type { AgeModifier } from '../data/ages';

export type Collider =
  | { kind: 'circle'; x: number; z: number; r: number; tall: boolean }
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; tall: boolean };

const CELL = 20;
const LIGHT_POOL_SIZE = 4;
/** half-size of the box the dust cloud occupies around the player */
const DUST_RANGE = 34;

export interface Shrine {
  id: string;
  position: THREE.Vector3;
  used: boolean;
  mesh: THREE.Object3D;
  glow: THREE.Mesh;
  area: string;
}

export class Arena {
  readonly scene = new THREE.Scene();
  readonly group = new THREE.Group();

  colliders: Collider[] = [];
  private grid = new Map<number, number[]>();
  private lightScratch: Array<{ i: number; d: number }> = [];

  shrines: Shrine[] = [];

  keyLight!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  /**
   * A fixed pool of point lights. Three.js recompiles every material when the
   * light *count* changes, so instead of adding one light per accent we keep a
   * constant handful and move them to whichever sources are nearest the player.
   */
  private lightPool: THREE.PointLight[] = [];
  private lightSources: Array<{ x: number; y: number; z: number; color: number; base: number; phase: number }> = [];
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  private fog!: THREE.FogExp2;
  /** 0 disables shadows entirely */
  private shadowSize = 2048;

  /** floating contaminated motes drifting around the player */
  private dust: THREE.Points | null = null;
  private dustGeo: THREE.BufferGeometry | null = null;

  constructor() {
    this.scene.add(this.group);
  }

  /* ============================================================
     build
     ============================================================ */

  /** Call before build(); 0 turns shadows off. */
  setShadowQuality(size: number): void {
    this.shadowSize = size;
    if (this.keyLight) {
      this.keyLight.castShadow = size > 0;
      if (size > 0) {
        this.keyLight.shadow.mapSize.set(size, size);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    }
  }

  build(seed: number, age: AgeModifier): void {
    this.clear();

    const tint = new THREE.Color(age.tint);

    this.fog = new THREE.FogExp2(WORLD.void, 0.0075 * age.fog);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(WORLD.void).lerp(tint, 0.25);

    /* ---- lighting ---- */
    // The age tint is a mood bias, not the ambient level. Using it raw made the
    // world almost black once ACES tone mapping went in, because the tints are
    // deliberately dark. Lift it toward a cold neutral and keep the tint as a
    // 45% influence on hue.
    const hemiSky = new THREE.Color(0x8b94a6).lerp(tint, 0.45);
    this.hemi = new THREE.HemisphereLight(hemiSky.getHex(), WORLD.shadow, 1.15);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(0xdfe4ff, 2.1);
    key.position.set(-60, 48, 34);
    key.castShadow = this.shadowSize > 0;
    key.shadow.mapSize.set(this.shadowSize || 512, this.shadowSize || 512);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 260;
    const S = 62;
    key.shadow.camera.left = -S;
    key.shadow.camera.right = S;
    key.shadow.camera.top = S;
    key.shadow.camera.bottom = -S;
    key.shadow.bias = -0.0016;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;

    // A toxic rim from behind. This is the single cheapest readability win in
    // the game: every silhouette in the arena gets a faint contaminated edge
    // that separates it from whatever is behind it.
    const rim = new THREE.DirectionalLight(new THREE.Color(NEON.acid).lerp(tint, 0.55).getHex(), 1.05);
    rim.position.set(50, 22, -60);
    this.scene.add(rim);

    if (!this.lightPool.length) {
      for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
        const l = new THREE.PointLight(0xffffff, 0, 90, 2);
        l.position.set(0, 8, 0);
        this.lightPool.push(l);
      }
    }
    for (const l of this.lightPool) {
      l.intensity = 0;
      this.scene.add(l);
    }

    /* ---- floating neon dust ----
       A sparse cloud of contaminated motes that drifts around the player.
       Subtle on purpose: the darkness is what makes the glow read, and the
       dust exists to make the air feel thick, not to fill the screen. */
    {
      const COUNT = 240;
      const pos = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] = (Math.random() - 0.5) * DUST_RANGE * 2;
        pos[i * 3 + 1] = 0.2 + Math.random() * 6.5;
        pos[i * 3 + 2] = (Math.random() - 0.5) * DUST_RANGE * 2;
      }
      this.dustGeo = new THREE.BufferGeometry();
      this.dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dustMat = new THREE.PointsMaterial({
        color: 0x9dff6a,
        size: 0.05,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        fog: true,
      });
      this.disposables.push(this.dustGeo, dustMat);
      this.dust = new THREE.Points(this.dustGeo, dustMat);
      this.dust.frustumCulled = false;
      this.group.add(this.dust);
    }

    /* ---- ground ---- */
    const groundGeo = new THREE.PlaneGeometry(WORLD_HALF * 2 + 40, WORLD_HALF * 2 + 40);
    const groundMat = new THREE.MeshLambertMaterial({ color: WORLD.ground });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(groundGeo, groundMat);

    /* ---- paths between areas ---- */
    const pathMat = new THREE.MeshLambertMaterial({ color: WORLD.path });
    this.disposables.push(pathMat);
    for (const [aId, bId] of CONNECTIONS) {
      const a = getArea(aId);
      const b = getArea(bId);
      const dx = b.cx - a.cx;
      const dz = b.cz - a.cz;
      const len = Math.hypot(dx, dz);
      const geo = new THREE.PlaneGeometry(18, len);
      const m = new THREE.Mesh(geo, pathMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(dx, dz);
      m.position.set((a.cx + b.cx) / 2, 0.02, (a.cz + b.cz) / 2);
      m.receiveShadow = true;
      this.group.add(m);
      this.disposables.push(geo);
    }

    /* ---- area floors ---- */
    for (const a of AREAS) {
      const geo = new THREE.CircleGeometry(a.radius, 26);
      const mat = new THREE.MeshLambertMaterial({ color: a.ground });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(a.cx, 0.04, a.cz);
      m.receiveShadow = true;
      this.group.add(m);
      this.disposables.push(geo, mat);
    }

    /* ---- structures ---- */
    for (const a of AREAS) {
      this.buildArea(a, mixSeed(seed, hashId(a.id)), age);
    }

    /* ---- world boundary ---- */
    this.buildBoundary();

    this.rebuildGrid();
  }

  private buildArea(a: AreaDef, seed: number, age: AgeModifier): void {
    const r = new RNG(seed);

    interface Piece {
      x: number;
      z: number;
      y: number;
      sx: number;
      sy: number;
      sz: number;
      rot: number;
    }
    const pieces: Piece[] = [];
    const accents: Piece[] = [];

    const push = (x: number, z: number, sx: number, sy: number, sz: number, rot = 0, y = sy / 2) => {
      pieces.push({ x, z, y, sx, sy, sz, rot });
    };

    switch (a.id) {
      case 'pit': {
        // A sunken bowl suggested by a stepped ring of blocks.
        const ringCount = 34;
        for (let i = 0; i < ringCount; i++) {
          const t = (i / ringCount) * Math.PI * 2;
          const rad = a.radius * r.range(0.94, 1.02);
          const h = r.range(3, 9);
          push(a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, r.range(6, 11), h, r.range(6, 11), t);
          this.addCircle(a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, 4.4, true);
        }
        for (let i = 0; i < 5; i++) {
          const t = r.range(0, Math.PI * 2);
          const rad = r.range(10, a.radius * 0.6);
          const x = a.cx + Math.cos(t) * rad;
          const z = a.cz + Math.sin(t) * rad;
          push(x, z, r.range(2, 4), r.range(1.2, 3.4), r.range(2, 4), r.range(0, 3));
          this.addCircle(x, z, 2, false);
        }
        break;
      }
      case 'ruins': {
        for (let i = 0; i < 30; i++) {
          const t = r.range(0, Math.PI * 2);
          const rad = r.range(6, a.radius * 0.94);
          const x = a.cx + Math.cos(t) * rad;
          const z = a.cz + Math.sin(t) * rad;
          const broken = r.chance(0.4);
          const h = broken ? r.range(2, 6) : r.range(9, 20);
          const w = r.range(2.2, 3.6);
          push(x, z, w, h, w, r.range(0, 0.4));
          this.addCircle(x, z, w * 0.75, true);
          if (!broken && r.chance(0.35)) {
            accents.push({ x, z, y: h + 0.4, sx: w * 1.2, sy: 0.35, sz: w * 1.2, rot: 0 });
          }
        }
        // A few toppled lintels.
        for (let i = 0; i < 6; i++) {
          const t = r.range(0, Math.PI * 2);
          const rad = r.range(10, a.radius * 0.8);
          push(a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, r.range(8, 16), 1.4, 2.6, r.range(0, 3), 0.7);
        }
        break;
      }
      case 'forest': {
        for (let i = 0; i < 64; i++) {
          const t = r.range(0, Math.PI * 2);
          const rad = r.range(4, a.radius * 0.98);
          const x = a.cx + Math.cos(t) * rad;
          const z = a.cz + Math.sin(t) * rad;
          const w = r.range(0.9, 2.1);
          const h = r.range(10, 26);
          push(x, z, w, h, w, r.range(0, 0.35));
          this.addCircle(x, z, w * 0.8, true);
          if (r.chance(0.22)) accents.push({ x, z, y: r.range(3, 9), sx: w * 1.5, sy: 0.22, sz: w * 1.5, rot: 0 });
        }
        break;
      }
      case 'caves': {
        // Chunky masses that form corridors, plus a low ceiling slab.
        for (let i = 0; i < 22; i++) {
          const t = r.range(0, Math.PI * 2);
          const rad = r.range(8, a.radius * 0.95);
          const x = a.cx + Math.cos(t) * rad;
          const z = a.cz + Math.sin(t) * rad;
          const sx = r.range(6, 15);
          const sz = r.range(6, 15);
          push(x, z, sx, r.range(7, 14), sz);
          this.addBox(x, z, sx / 2, sz / 2, true);
        }
        const ceilGeo = new THREE.PlaneGeometry(a.radius * 2, a.radius * 2);
        const ceilMat = new THREE.MeshLambertMaterial({ color: WORLD.shadow, side: THREE.DoubleSide });
        const ceil = new THREE.Mesh(ceilGeo, ceilMat);
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(a.cx, 15, a.cz);
        this.group.add(ceil);
        this.disposables.push(ceilGeo, ceilMat);
        break;
      }
      case 'tower': {
        push(a.cx, a.cz, 16, 74, 16);
        this.addCircle(a.cx, a.cz, 11.5, true);
        for (let i = 0; i < 5; i++) {
          const h = 60 - i * 11;
          accents.push({ x: a.cx, z: a.cz, y: h, sx: 19, sy: 0.7, sz: 19, rot: r.range(0, 1) });
        }
        for (let i = 0; i < 16; i++) {
          const t = (i / 16) * Math.PI * 2 + r.range(-0.1, 0.1);
          const rad = r.range(22, a.radius * 0.95);
          const x = a.cx + Math.cos(t) * rad;
          const z = a.cz + Math.sin(t) * rad;
          const w = r.range(3, 6);
          push(x, z, w, r.range(5, 16), w, t);
          this.addCircle(x, z, w * 0.75, true);
        }
        break;
      }
      case 'fortress': {
        // Perimeter wall with four gaps.
        const segs = 28;
        for (let i = 0; i < segs; i++) {
          const t = (i / segs) * Math.PI * 2;
          if (i % 7 === 0) continue; // gates
          const rad = a.radius * 0.96;
          const x = a.cx + Math.cos(t) * rad;
          const z = a.cz + Math.sin(t) * rad;
          push(x, z, 10, r.range(14, 19), 6, t);
          this.addCircle(x, z, 4.6, true);
        }
        // Inner keep.
        push(a.cx, a.cz - 8, 26, 12, 20);
        this.addBox(a.cx, a.cz - 8, 13, 10, true);
        for (let i = 0; i < 4; i++) {
          const x = a.cx + (i % 2 ? 1 : -1) * 15;
          const z = a.cz + (i < 2 ? 1 : -1) * 22;
          push(x, z, 6, r.range(18, 24), 6);
          this.addCircle(x, z, 4.2, true);
          accents.push({ x, z, y: 24, sx: 7, sy: 0.6, sz: 7, rot: 0 });
        }
        // The seat.
        push(a.cx, a.cz + 14, 7, 2.2, 7, 0, 1.1);
        accents.push({ x: a.cx, z: a.cz + 14, y: 2.6, sx: 6, sy: 0.4, sz: 6, rot: 0 });
        break;
      }
    }

    this.addInstanced(pieces, a.structure, false, age);
    if (accents.length) this.addInstanced(accents, a.accent, true, age);

    // Accent light *sources* — the pool above decides which ones are lit.
    const lightCount = a.id === 'pit' ? 3 : 2;
    for (let i = 0; i < lightCount; i++) {
      const t = r.range(0, Math.PI * 2);
      const rad = r.range(0, a.radius * 0.6);
      this.lightSources.push({
        x: a.cx + Math.cos(t) * rad,
        y: r.range(4, 12),
        z: a.cz + Math.sin(t) * rad,
        color: a.accent,
        base: 30,
        phase: r.range(0, 10),
      });
    }

    // Shrines: where the player picks up run powers.
    const shrineCount = a.id === 'fortress' ? 1 : 2;
    for (let i = 0; i < shrineCount; i++) {
      const t = r.range(0, Math.PI * 2);
      const rad = r.range(a.radius * 0.25, a.radius * 0.75);
      this.addShrine(a.id, a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, a.accent);
    }
  }

  private addInstanced(
    pieces: Array<{ x: number; z: number; y: number; sx: number; sy: number; sz: number; rot: number }>,
    color: number,
    emissive: boolean,
    age: AgeModifier
  ): void {
    if (!pieces.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ color: shade(color, 0.7), toneMapped: false })
      : new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(age.tint), 0.18), flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, pieces.length);
    im.castShadow = !emissive;
    im.receiveShadow = !emissive;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    pieces.forEach((p, i) => {
      e.set(0, p.rot, 0);
      q.setFromEuler(e);
      pos.set(p.x, p.y, p.z);
      scl.set(p.sx, p.sy, p.sz);
      m.compose(pos, q, scl);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    this.group.add(im);
    this.disposables.push(geo, mat);
  }

  private addShrine(area: string, x: number, z: number, color: number): void {
    const g = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(1.5, 1.9, 0.5, 6);
    const baseMat = new THREE.MeshLambertMaterial({ color: WORLD.metal, flatShading: true });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.25;
    base.castShadow = true;
    const shardGeo = new THREE.OctahedronGeometry(0.58, 0);
    const shardMat = new THREE.MeshBasicMaterial({ color: shade(color, 0.62), toneMapped: false });
    const shard = new THREE.Mesh(shardGeo, shardMat);
    shard.position.y = 2.1;
    g.add(base, shard);
    this.lightSources.push({ x, y: 2.4, z, color, base: 14, phase: x * 0.1 });
    g.position.set(x, 0, z);
    this.group.add(g);
    this.disposables.push(baseGeo, baseMat, shardGeo, shardMat);
    this.shrines.push({
      id: `${area}-${this.shrines.length}`,
      position: new THREE.Vector3(x, 0, z),
      used: false,
      mesh: g,
      glow: shard,
      area,
    });
  }

  private buildBoundary(): void {
    const h = 26;
    const t = 4;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: WORLD.boundary, flatShading: true });
    const specs: Array<[number, number, number, number]> = [
      [0, WORLD_HALF, WORLD_HALF * 2, t],
      [0, -WORLD_HALF, WORLD_HALF * 2, t],
      [WORLD_HALF, 0, t, WORLD_HALF * 2],
      [-WORLD_HALF, 0, t, WORLD_HALF * 2],
    ];
    for (const [x, z, sx, sz] of specs) {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, h, sz);
      m.position.set(x, h / 2, z);
      this.group.add(m);
      this.addBox(x, z, sx / 2, sz / 2, true);
    }
    this.disposables.push(geo, mat);
  }

  /* ============================================================
     collision
     ============================================================ */

  private addCircle(x: number, z: number, r: number, tall: boolean): void {
    this.colliders.push({ kind: 'circle', x, z, r, tall });
  }

  private addBox(x: number, z: number, hx: number, hz: number, tall: boolean): void {
    this.colliders.push({ kind: 'box', x, z, hx, hz, tall });
  }

  private rebuildGrid(): void {
    this.grid.clear();
    this.colliders.forEach((c, i) => {
      const ext = c.kind === 'circle' ? c.r : Math.max(c.hx, c.hz);
      const x0 = Math.floor((c.x - ext) / CELL);
      const x1 = Math.floor((c.x + ext) / CELL);
      const z0 = Math.floor((c.z - ext) / CELL);
      const z1 = Math.floor((c.z + ext) / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const key = cellKey(gx, gz);
          let arr = this.grid.get(key);
          if (!arr) {
            arr = [];
            this.grid.set(key, arr);
          }
          arr.push(i);
        }
      }
    });
  }

  /**
   * Push a circle out of anything it overlaps. Mutates and returns `out`.
   * Two iterations is enough to handle a corner without jitter.
   */
  resolve(x: number, z: number, radius: number, out: { x: number; z: number }): { x: number; z: number } {
    let px = x;
    let pz = z;
    for (let iter = 0; iter < 2; iter++) {
      const gx = Math.floor(px / CELL);
      const gz = Math.floor(pz / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = this.grid.get(cellKey(gx + dx, gz + dz));
          if (!arr) continue;
          for (const i of arr) {
            const c = this.colliders[i];
            if (c.kind === 'circle') {
              const ddx = px - c.x;
              const ddz = pz - c.z;
              const dist = Math.hypot(ddx, ddz);
              const min = c.r + radius;
              if (dist < min && dist > 1e-5) {
                const push = (min - dist) / dist;
                px += ddx * push;
                pz += ddz * push;
              } else if (dist <= 1e-5) {
                px += min;
              }
            } else {
              const ddx = px - c.x;
              const ddz = pz - c.z;
              const ox = c.hx + radius - Math.abs(ddx);
              const oz = c.hz + radius - Math.abs(ddz);
              if (ox > 0 && oz > 0) {
                if (ox < oz) px += Math.sign(ddx || 1) * ox;
                else pz += Math.sign(ddz || 1) * oz;
              }
            }
          }
        }
      }
    }
    const lim = WORLD_HALF - 6;
    px = Math.max(-lim, Math.min(lim, px));
    pz = Math.max(-lim, Math.min(lim, pz));
    out.x = px;
    out.z = pz;
    return out;
  }

  /** Is the straight line between two points clear of tall obstacles? */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const steps = Math.min(40, Math.ceil(dist / 3));
    const tmp = { x: 0, z: 0 };
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = ax + dx * t;
      const pz = az + dz * t;
      tmp.x = px;
      tmp.z = pz;
      this.resolve(px, pz, 0.35, tmp);
      if (Math.hypot(tmp.x - px, tmp.z - pz) > 0.05) return false;
    }
    return true;
  }

  /** A free spot inside an area. */
  spawnPoint(areaId: string, rng: RNG, minR = 0.25, maxR = 0.92): THREE.Vector3 {
    const a = getArea(areaId);
    const out = { x: 0, z: 0 };
    for (let i = 0; i < 24; i++) {
      const t = rng.range(0, Math.PI * 2);
      const rad = a.radius * rng.range(minR, maxR);
      const x = a.cx + Math.cos(t) * rad;
      const z = a.cz + Math.sin(t) * rad;
      this.resolve(x, z, 1.1, out);
      if (Math.hypot(out.x - x, out.z - z) < 0.02) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(a.cx, 0, a.cz);
  }

  /* ============================================================
     per-frame
     ============================================================ */

  update(dt: number, elapsed: number, focusX: number, focusZ: number): void {
    // Keep the shadow frustum tight around the player.
    this.keyLight.position.set(focusX - 60, 48, focusZ + 34);
    this.keyLight.target.position.set(focusX, 0, focusZ);
    this.keyLight.target.updateMatrixWorld();

    // Light the nearest sources with the fixed pool.
    if (this.lightSources.length) {
      this.lightScratch.length = 0;
      for (let i = 0; i < this.lightSources.length; i++) {
        const src = this.lightSources[i];
        const d = (src.x - focusX) ** 2 + (src.z - focusZ) ** 2;
        if (d < 130 * 130) this.lightScratch.push({ i, d });
      }
      this.lightScratch.sort((a, b) => a.d - b.d);
      for (let k = 0; k < this.lightPool.length; k++) {
        const l = this.lightPool[k];
        const entry = this.lightScratch[k];
        if (!entry) {
          l.intensity = 0;
          continue;
        }
        const src = this.lightSources[entry.i];
        l.position.set(src.x, src.y, src.z);
        l.color.setHex(src.color);
        const falloff = 1 - Math.min(1, Math.sqrt(entry.d) / 130);
        l.intensity = src.base * (0.82 + Math.sin(elapsed * 1.7 + src.phase) * 0.18) * falloff;
      }
    }
    for (const s of this.shrines) {
      if (s.used) continue;
      s.glow.rotation.y += dt * 1.2;
      s.glow.rotation.x += dt * 0.5;
      s.glow.position.y = 2.1 + Math.sin(elapsed * 2 + s.position.x) * 0.16;
    }

    /* dust: rise slowly, sway, and wrap around the player so the cloud is
       always present without ever being simulated at world scale */
    if (this.dust && this.dustGeo) {
      const pos = this.dustGeo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += Math.sin(elapsed * 0.32 + i) * dt * 0.35;
        arr[i + 1] += dt * (0.14 + ((i / 3) % 5) * 0.03);
        arr[i + 2] += Math.cos(elapsed * 0.27 + i * 0.7) * dt * 0.35;
        if (arr[i + 1] > 7) arr[i + 1] = 0.2;
        const dx = arr[i] - focusX;
        if (dx > DUST_RANGE) arr[i] -= DUST_RANGE * 2;
        else if (dx < -DUST_RANGE) arr[i] += DUST_RANGE * 2;
        const dz = arr[i + 2] - focusZ;
        if (dz > DUST_RANGE) arr[i + 2] -= DUST_RANGE * 2;
        else if (dz < -DUST_RANGE) arr[i + 2] += DUST_RANGE * 2;
      }
      pos.needsUpdate = true;
    }
  }

  markShrineUsed(s: Shrine): void {
    s.used = true;
    s.glow.visible = false;
  }

  resetShrines(): void {
    for (const s of this.shrines) {
      s.used = false;
      s.glow.visible = true;
    }
  }

  nearestShrine(x: number, z: number, maxDist: number): Shrine | null {
    let best: Shrine | null = null;
    let bestD = maxDist * maxDist;
    for (const s of this.shrines) {
      if (s.used) continue;
      const d = (s.position.x - x) ** 2 + (s.position.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.lightSources = [];
    this.shrines = [];
    this.colliders = [];
    this.dust = null;
    this.dustGeo = null;
    this.grid.clear();
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    // Remove non-group children (lights) too.
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const c = this.scene.children[i];
      if (c !== this.group) this.scene.remove(c);
    }
  }
}

function cellKey(x: number, z: number): number {
  return ((x + 4096) << 13) | (z + 4096);
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}
