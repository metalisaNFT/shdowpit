/**
 * Pooled particles and one-shot effect meshes.
 *
 * With geometry this simple, particles and timing are doing most of the work
 * of making a hit feel like a hit, so this is deliberately generous.
 */

import * as THREE from 'three';

const MAX_PARTICLES = 900;

interface P {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  drag: number;
  rx: number;
  ry: number;
  rz: number;
  spin: number;
  color: THREE.Color;
  fade: boolean;
}

interface Effect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  kind: 'ring' | 'slash' | 'flash' | 'pillar';
  from: number;
  to: number;
}

export class Particles {
  readonly group = new THREE.Group();

  private pool: P[] = [];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private effects: Effect[] = [];
  private tmpColor = new THREE.Color();

  private ringGeo: THREE.RingGeometry;
  private sphereGeo: THREE.IcosahedronGeometry;

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: false,
      toneMapped: false,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const colors = new Float32Array(MAX_PARTICLES * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0.1,
        gravity: -18,
        drag: 0.9,
        rx: 0,
        ry: 0,
        rz: 0,
        spin: 0,
        color: new THREE.Color(),
        fade: true,
      });
    }

    this.ringGeo = new THREE.RingGeometry(0.86, 1, 40, 1);
    this.sphereGeo = new THREE.IcosahedronGeometry(1, 1);
  }

  private take(): P | null {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) return this.pool[i];
    }
    return null;
  }

  /** Generic burst of chips. */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: number | THREE.Color,
    speed = 8,
    opts: { size?: number; life?: number; gravity?: number; spread?: number; dirX?: number; dirZ?: number; up?: number } = {}
  ): void {
    const size = opts.size ?? 0.12;
    const life = opts.life ?? 0.5;
    const gravity = opts.gravity ?? -20;
    const spread = opts.spread ?? 1;
    const dirX = opts.dirX ?? 0;
    const dirZ = opts.dirZ ?? 0;
    const up = opts.up ?? 0.6;
    for (let i = 0; i < count; i++) {
      const p = this.take();
      if (!p) return;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.9);
      p.vx = (Math.cos(a) * spread + dirX * 1.6) * s;
      p.vz = (Math.sin(a) * spread + dirZ * 1.6) * s;
      p.vy = (Math.random() * 0.9 + up) * s;
      p.life = life * (0.6 + Math.random() * 0.8);
      p.maxLife = p.life;
      p.size = size * (0.5 + Math.random());
      p.gravity = gravity;
      p.drag = 0.86;
      p.rx = Math.random() * 6;
      p.ry = Math.random() * 6;
      p.rz = Math.random() * 6;
      p.spin = (Math.random() - 0.5) * 22;
      p.fade = true;
      if (typeof color === 'number') p.color.setHex(color);
      else p.color.copy(color);
    }
  }

  /** Slow rising embers, used for burning enemies. */
  embers(x: number, y: number, z: number, count = 3): void {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      if (!p) return;
      p.active = true;
      p.x = x + (Math.random() - 0.5) * 0.8;
      p.y = y + Math.random() * 0.8;
      p.z = z + (Math.random() - 0.5) * 0.8;
      p.vx = (Math.random() - 0.5) * 1.2;
      p.vz = (Math.random() - 0.5) * 1.2;
      p.vy = 1.6 + Math.random() * 2.2;
      p.life = 0.7 + Math.random() * 0.7;
      p.maxLife = p.life;
      p.size = 0.07 + Math.random() * 0.07;
      p.gravity = 1.5;
      p.drag = 0.96;
      p.spin = 4;
      p.rx = Math.random() * 6;
      p.ry = Math.random() * 6;
      p.rz = Math.random() * 6;
      p.fade = true;
      p.color.setHex(Math.random() < 0.4 ? 0xffd15a : 0xff5a10);
    }
  }

  /** Dust kicked up by a dodge or a landing. */
  dust(x: number, y: number, z: number, count = 8): void {
    this.burst(x, y, z, count, 0x3a3a44, 3.5, { size: 0.16, life: 0.45, gravity: -4, up: 0.2 });
  }

  /** Expanding ground ring — shockwaves, executions, arrivals. */
  ring(x: number, y: number, z: number, color: number, from: number, to: number, life = 0.42, opacity = 0.85): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.08, z);
    m.scale.setScalar(from);
    this.group.add(m);
    this.effects.push({ mesh: m, life, maxLife: life, kind: 'ring', from, to });
  }

  /** A quick arc drawn along a swing. */
  slash(x: number, y: number, z: number, facing: number, reach: number, halfArc: number, color: number): void {
    const geo = new THREE.RingGeometry(reach * 0.32, reach, 16, 1, -halfArc, halfArc * 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -facing + Math.PI / 2;
    m.position.set(x, y, z);
    this.group.add(m);
    this.effects.push({ mesh: m, life: 0.16, maxLife: 0.16, kind: 'slash', from: 1, to: 1.12 });
  }

  /** Momentary bright sphere at a point of impact. */
  flash(x: number, y: number, z: number, color: number, size = 0.7, life = 0.14): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    this.group.add(m);
    this.effects.push({ mesh: m, life, maxLife: life, kind: 'flash', from: size, to: size * 2.1 });
  }

  /** Vertical beam used for nemesis arrivals and shrines. */
  pillar(x: number, z: number, color: number, life = 1.1): void {
    // Thin and tall: a shaft of contaminated light, not a wall. It used to be
    // 2.5m across and 22m tall, which with bloom filled a third of the screen
    // and buried the arrival card behind it.
    const geo = new THREE.CylinderGeometry(0.45, 0.85, 15, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 7.5, z);
    this.group.add(m);
    this.effects.push({ mesh: m, life, maxLife: life, kind: 'pillar', from: 1, to: 1.35 });
  }

  update(dt: number): void {
    if (dt <= 0) dt = 0.0001;
    let count = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy *= -0.28;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.7 * dt;
      p.rz += p.spin * 1.3 * dt;

      const t = p.life / p.maxLife;
      const s = p.size * (p.fade ? 0.25 + t * 0.75 : 1);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rx, p.ry, p.rz);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);
      this.tmpColor.copy(p.color).multiplyScalar(0.35 + t * 0.65);
      this.mesh.setColorAt(count, this.tmpColor);
      count++;
      if (count >= MAX_PARTICLES) break;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const t = 1 - e.life / e.maxLife;
      const mat = e.mesh.material as THREE.MeshBasicMaterial;
      if (e.life <= 0) {
        this.group.remove(e.mesh);
        mat.dispose();
        if (e.kind === 'slash' || e.kind === 'pillar') e.mesh.geometry.dispose();
        this.effects.splice(i, 1);
        continue;
      }
      const s = e.from + (e.to - e.from) * easeOut(t);
      if (e.kind === 'pillar') {
        e.mesh.scale.set(s, 1, s);
        e.mesh.rotation.y += dt * 2.4;
      } else {
        e.mesh.scale.setScalar(s);
      }
      mat.opacity = (1 - t) * (e.kind === 'ring' ? 0.85 : e.kind === 'pillar' ? 0.36 : 0.8);
    }
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    this.mesh.count = 0;
    for (const e of this.effects) {
      this.group.remove(e.mesh);
      (e.mesh.material as THREE.Material).dispose();
      if (e.kind === 'slash' || e.kind === 'pillar') e.mesh.geometry.dispose();
    }
    this.effects.length = 0;
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
