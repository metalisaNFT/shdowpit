/**
 * The region geometry and its collision.
 *
 * One compact 520m square: six named places, dressed roads, and a handful of
 * InstancedMeshes. Collision is a uniform grid of circles and boxes. Territory
 * ownership is painted onto banners and shortcut locks without a rebuild.
 */

import * as THREE from 'three';
import { RNG, mixSeed } from '../core/RNG';
import { AREAS, CONNECTIONS, WORLD_HALF, areaAt, nearestArea, type AreaDef, getArea } from '../data/areas';
import { WORLD, NEON, shade } from '../data/palette';
import type { AgeModifier } from '../data/ages';
import { layoutArea, layoutCorridors, type Block } from './AreaLayouts';
import type { OccupancyMap } from './WorldOccupancy';

export type Collider =
  | { kind: 'circle'; x: number; z: number; r: number; tall: boolean; active: boolean }
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; tall: boolean; active: boolean };

const CELL = 20;
const LIGHT_POOL_SIZE = 4;
const DUST_RANGE = 34;

export interface Shrine {
  id: string;
  position: THREE.Vector3;
  used: boolean;
  mesh: THREE.Object3D;
  glow: THREE.Mesh;
  area: string;
}

export interface CacheSite {
  id: string;
  position: THREE.Vector3;
  taken: boolean;
  mesh: THREE.Object3D;
  glow: THREE.Mesh;
  area: string;
}

export interface Landmark {
  areaId: string;
  name: string;
  x: number;
  z: number;
}

interface Banner {
  areaId: string;
  cloth: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

interface ShortcutLock {
  areaId: string;
  colliderIndex: number;
  mesh: THREE.Object3D;
}

export class Arena {
  readonly scene = new THREE.Scene();
  readonly group = new THREE.Group();

  colliders: Collider[] = [];
  private grid = new Map<number, number[]>();
  private lightScratch: Array<{ i: number; d: number }> = [];

  shrines: Shrine[] = [];
  caches: CacheSite[] = [];
  landmarks: Landmark[] = [];
  extractAnchors: Array<{ areaId: string; x: number; z: number }> = [];

  keyLight!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  private lightPool: THREE.PointLight[] = [];
  private lightSources: Array<{ x: number; y: number; z: number; color: number; base: number; phase: number }> = [];
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  private fog!: THREE.FogExp2;
  private ageFog = 1;
  private targetFog = 0.0075;
  private shadowSize = 2048;

  private dust: THREE.Points | null = null;
  private dustGeo: THREE.BufferGeometry | null = null;
  private dustMat: THREE.PointsMaterial | null = null;
  private dustTint = new THREE.Color();

  private banners: Banner[] = [];
  private locks: ShortcutLock[] = [];
  private extractMeshes: THREE.Object3D[] = [];

  constructor() {
    this.scene.add(this.group);
  }

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

  /* ============================================================
     build
     ============================================================ */

  build(seed: number, age: AgeModifier, occupancy: OccupancyMap | null = null): void {
    this.clear();

    const tint = new THREE.Color(age.tint);
    this.ageFog = age.fog;
    this.targetFog = 0.0075 * age.fog;
    this.fog = new THREE.FogExp2(WORLD.void, this.targetFog);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(WORLD.void).lerp(tint, 0.25);

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
      this.dustMat = new THREE.PointsMaterial({
        color: 0x9dff6a,
        size: 0.05,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        fog: true,
      });
      this.disposables.push(this.dustGeo, this.dustMat);
      this.dust = new THREE.Points(this.dustGeo, this.dustMat);
      this.dust.frustumCulled = false;
      this.group.add(this.dust);
    }

    const groundGeo = new THREE.PlaneGeometry(WORLD_HALF * 2 + 40, WORLD_HALF * 2 + 40);
    const groundMat = new THREE.MeshLambertMaterial({ color: WORLD.ground });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(groundGeo, groundMat);

    const pathMat = new THREE.MeshLambertMaterial({ color: WORLD.path });
    this.disposables.push(pathMat);
    for (const [aId, bId] of CONNECTIONS) {
      const a = getArea(aId);
      const b = getArea(bId);
      const dx = b.cx - a.cx;
      const dz = b.cz - a.cz;
      const len = Math.hypot(dx, dz);
      const geo = new THREE.PlaneGeometry(14, len);
      const m = new THREE.Mesh(geo, pathMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(dx, dz);
      m.position.set((a.cx + b.cx) / 2, 0.02, (a.cz + b.cz) / 2);
      m.receiveShadow = true;
      this.group.add(m);
      this.disposables.push(geo);
    }

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

    const roadPieces: Block[] = [];
    const roadAccents: Block[] = [];
    const corridors = layoutCorridors(new RNG(mixSeed(seed, 0x51a1)));
    roadPieces.push(...corridors.pieces);
    roadAccents.push(...corridors.accents);

    for (const a of AREAS) {
      const layout = layoutArea(a, new RNG(mixSeed(seed, hashId(a.id))));
      this.commitBlocks(layout.pieces, a.structure, false, age);
      if (layout.accents.length) this.commitBlocks(layout.accents, a.accent, true, age);
      this.landmarks.push({ areaId: a.id, name: layout.landmark.name, x: layout.landmark.x, z: layout.landmark.z });
      this.extractAnchors.push({ areaId: a.id, x: layout.extract.x, z: layout.extract.z });
      this.addBanner(a.id, layout.banner.x, layout.banner.z);
      this.addExtractGate(layout.extract.x, layout.extract.z, a.accent);
      for (const s of layout.shrines) this.addShrine(a.id, s.x, s.z, a.accent);
      for (const c of layout.caches) this.addCache(a.id, c.x, c.z, a.accent);
      for (const l of layout.lights) {
        this.lightSources.push({ x: l.x, y: l.y, z: l.z, color: a.accent, base: a.id === 'pit' ? 30 : 24, phase: l.x * 0.1 });
      }
      if (a.id === 'caves') this.addCaveCeiling(a);
    }

    this.commitBlocks(roadPieces, WORLD.metal, false, age);
    if (roadAccents.length) this.commitBlocks(roadAccents, WORLD.rust, false, age);

    for (const g of corridors.gates) {
      if (g.shortcut) this.addShortcutLock(g.areaId, g.x, g.z, g.rot);
    }

    this.buildBoundary();
    this.rebuildGrid();
    if (occupancy) this.applyOccupancy(occupancy);
  }

  applyOccupancy(occ: OccupancyMap): void {
    for (const b of this.banners) {
      const o = occ[b.areaId];
      const color = o ? (o.liberated ? shade(o.accent, 0.35) : o.accent) : WORLD.metal;
      b.mat.color.setHex(shade(color, o?.liberated ? 0.5 : 0.85));
      b.cloth.visible = true;
    }
    const locked = new Set<string>();
    for (const id of Object.keys(occ)) {
      if (occ[id].ruleIds.includes('locked_shortcuts') && !occ[id].liberated) locked.add(id);
    }
    for (const lock of this.locks) {
      const on = locked.has(lock.areaId);
      lock.mesh.visible = on;
      const c = this.colliders[lock.colliderIndex];
      if (c) c.active = on;
    }
  }

  /* ============================================================
     commit helpers
     ============================================================ */

  private commitBlocks(pieces: Block[], color: number, emissive: boolean, age: AgeModifier): void {
    if (!pieces.length) return;
    this.addInstanced(pieces, color, emissive, age);
    for (const p of pieces) {
      if (p.collide === 'none') continue;
      if (p.collide === 'circle') this.addCircle(p.x, p.z, p.r, p.tall);
      else this.addBox(p.x, p.z, p.hx, p.hz, p.tall);
    }
  }

  private addInstanced(pieces: Block[], color: number, emissive: boolean, age: AgeModifier): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ color: shade(color, 0.7), toneMapped: false })
      : new THREE.MeshLambertMaterial({
          color: new THREE.Color(color).lerp(new THREE.Color(age.tint), 0.18),
          flatShading: true,
        });
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

  private addCaveCeiling(a: AreaDef): void {
    const ceilGeo = new THREE.PlaneGeometry(a.radius * 2, a.radius * 2);
    const ceilMat = new THREE.MeshLambertMaterial({ color: WORLD.shadow, side: THREE.DoubleSide });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(a.cx, 13.5, a.cz);
    this.group.add(ceil);
    this.disposables.push(ceilGeo, ceilMat);
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

  private addCache(area: string, x: number, z: number, color: number): void {
    const g = new THREE.Group();
    const crateGeo = new THREE.BoxGeometry(1.4, 1.1, 1.4);
    const crateMat = new THREE.MeshLambertMaterial({ color: WORLD.rust, flatShading: true });
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.y = 0.55;
    crate.castShadow = true;
    const gemGeo = new THREE.OctahedronGeometry(0.32, 0);
    const gemMat = new THREE.MeshBasicMaterial({ color: shade(color, 0.55), toneMapped: false });
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.position.y = 1.35;
    g.add(crate, gem);
    g.position.set(x, 0, z);
    this.group.add(g);
    this.disposables.push(crateGeo, crateMat, gemGeo, gemMat);
    this.addCircle(x, z, 0.85, false);
    this.caches.push({
      id: `${area}-cache-${this.caches.length}`,
      position: new THREE.Vector3(x, 0, z),
      taken: false,
      mesh: g,
      glow: gem,
      area,
    });
  }

  private addBanner(areaId: string, x: number, z: number): void {
    const poleGeo = new THREE.BoxGeometry(0.35, 7.2, 0.35);
    const poleMat = new THREE.MeshLambertMaterial({ color: WORLD.metal, flatShading: true });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3.6, z);
    pole.castShadow = true;
    const clothGeo = new THREE.BoxGeometry(2.4, 3.1, 0.12);
    const clothMat = new THREE.MeshBasicMaterial({ color: WORLD.metal, toneMapped: false });
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(x + 1.1, 5.2, z);
    this.group.add(pole, cloth);
    this.disposables.push(poleGeo, poleMat, clothGeo, clothMat);
    this.addCircle(x, z, 0.55, true);
    this.banners.push({ areaId, cloth, mat: clothMat });
  }

  private addExtractGate(x: number, z: number, color: number): void {
    const g = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.7, 5.4, 0.7);
    const postMat = new THREE.MeshLambertMaterial({ color: WORLD.metal, flatShading: true });
    const glowGeo = new THREE.BoxGeometry(0.2, 4.2, 0.2);
    const glowMat = new THREE.MeshBasicMaterial({ color: shade(color, 0.7), toneMapped: false });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(side * 2.4, 2.7, 0);
      post.castShadow = true;
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(side * 2.4, 2.8, 0);
      g.add(post, glow);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.45, 0.45), postMat);
    lintel.position.set(0, 5.5, 0);
    g.add(lintel);
    g.position.set(x, 0, z);
    this.group.add(g);
    this.disposables.push(postGeo, postMat, glowGeo, glowMat, lintel.geometry);
    this.lightSources.push({ x, y: 4.2, z, color, base: 16, phase: z * 0.08 });
    this.extractMeshes.push(g);
  }

  private addShortcutLock(areaId: string, x: number, z: number, rot: number): void {
    const geo = new THREE.BoxGeometry(8.5, 5.5, 1.2);
    const mat = new THREE.MeshLambertMaterial({ color: WORLD.boundary, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 2.75, z);
    mesh.rotation.y = rot;
    mesh.visible = false;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
    this.addCircle(x, z, 5.0, true, false);
    this.locks.push({ areaId, colliderIndex: this.colliders.length - 1, mesh });
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

  private addCircle(x: number, z: number, r: number, tall: boolean, active = true): void {
    this.colliders.push({ kind: 'circle', x, z, r, tall, active });
  }

  private addBox(x: number, z: number, hx: number, hz: number, tall: boolean, active = true): void {
    this.colliders.push({ kind: 'box', x, z, hx, hz, tall, active });
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
            if (!c.active) continue;
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

  spawnPoint(areaId: string, rng: RNG, minR = 0.25, maxR = 0.92): THREE.Vector3 {
    const a = getArea(areaId);
    const out = { x: 0, z: 0 };
    let fallback: { x: number; z: number } | null = null;
    for (let i = 0; i < 40; i++) {
      const t = rng.range(0, Math.PI * 2);
      const rad = a.radius * rng.range(minR, maxR);
      const x = a.cx + Math.cos(t) * rad;
      const z = a.cz + Math.sin(t) * rad;
      this.resolve(x, z, 1.1, out);
      const pushed = Math.hypot(out.x - x, out.z - z);
      if (pushed < 0.02) return new THREE.Vector3(x, 0, z);
      if (Math.hypot(out.x - a.cx, out.z - a.cz) < a.radius * 0.92) fallback = { x: out.x, z: out.z };
    }
    const ex = this.extractAnchors.find((e) => e.areaId === areaId);
    if (ex) {
      this.resolve(ex.x, ex.z, 1.1, out);
      return new THREE.Vector3(out.x, 0, out.z);
    }
    if (fallback) return new THREE.Vector3(fallback.x, 0, fallback.z);
    return new THREE.Vector3(a.cx, 0, a.cz);
  }

  extractPoint(areaId: string): { x: number; z: number } {
    return this.extractAnchors.find((e) => e.areaId === areaId) ?? { x: getArea(areaId).cx, z: getArea(areaId).cz };
  }

  /* ============================================================
     per-frame
     ============================================================ */

  update(dt: number, elapsed: number, focusX: number, focusZ: number): void {
    this.keyLight.position.set(focusX - 60, 48, focusZ + 34);
    this.keyLight.target.position.set(focusX, 0, focusZ);
    this.keyLight.target.updateMatrixWorld();

    const here = areaAt(focusX, focusZ) ?? nearestArea(focusX, focusZ);
    this.targetFog = 0.0075 * this.ageFog * here.fog;
    this.fog.density += (this.targetFog - this.fog.density) * Math.min(1, dt * 1.6);
    if (this.dustMat) {
      this.dustTint.setHex(here.accent);
      this.dustMat.color.lerp(this.dustTint, Math.min(1, dt * 1.2));
    }

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
    for (const c of this.caches) {
      if (c.taken) continue;
      c.glow.rotation.y += dt * 1.6;
      c.glow.position.y = 1.35 + Math.sin(elapsed * 2.4 + c.position.z) * 0.1;
    }

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

  markCacheTaken(c: CacheSite): void {
    c.taken = true;
    c.glow.visible = false;
  }

  resetCaches(): void {
    for (const c of this.caches) {
      c.taken = false;
      c.glow.visible = true;
    }
  }

  nearestCache(x: number, z: number, maxDist: number): CacheSite | null {
    let best: CacheSite | null = null;
    let bestD = maxDist * maxDist;
    for (const c of this.caches) {
      if (c.taken) continue;
      const d = (c.position.x - x) ** 2 + (c.position.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.lightSources = [];
    this.shrines = [];
    this.caches = [];
    this.landmarks = [];
    this.extractAnchors = [];
    this.banners = [];
    this.locks = [];
    this.extractMeshes = [];
    this.colliders = [];
    this.dust = null;
    this.dustGeo = null;
    this.dustMat = null;
    this.grid.clear();
    while (this.group.children.length) this.group.remove(this.group.children[0]);
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
