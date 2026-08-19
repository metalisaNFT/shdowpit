/**
 * Deterministic layouts for the six areas. Pure data: the Arena turns these
 * into InstancedMeshes and colliders. Combat plazas stay open; roads keep
 * their gates; landmarks sit where a player can learn them.
 */

import { RNG } from '../core/RNG';
import { CONNECTIONS, angleNear, exitAngles, getArea, type AreaDef } from '../data/areas';

export interface Block {
  x: number;
  z: number;
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rot: number;
  collide: 'none' | 'circle' | 'box';
  tall: boolean;
  r: number;
  hx: number;
  hz: number;
}

export interface Point {
  x: number;
  z: number;
}

export interface AreaLayout {
  pieces: Block[];
  accents: Block[];
  shrines: Point[];
  caches: Point[];
  lights: Array<{ x: number; y: number; z: number }>;
  landmark: { name: string; x: number; z: number };
  extract: Point;
  banner: Point;
}

export interface CorridorLayout {
  pieces: Block[];
  accents: Block[];
  gates: Array<{ areaId: string; x: number; z: number; rot: number; shortcut: boolean }>;
}

export function layoutArea(a: AreaDef, rng: RNG): AreaLayout {
  switch (a.id) {
    case 'pit':
      return layoutPit(a, rng);
    case 'ruins':
      return layoutRuins(a, rng);
    case 'forest':
      return layoutForest(a, rng);
    case 'caves':
      return layoutCaves(a, rng);
    case 'tower':
      return layoutTower(a, rng);
    default:
      return layoutFortress(a, rng);
  }
}

export function layoutCorridors(rng: RNG): CorridorLayout {
  const pieces: Block[] = [];
  const accents: Block[] = [];
  const gates: CorridorLayout['gates'] = [];

  for (const [aId, bId] of CONNECTIONS) {
    const a = getArea(aId);
    const b = getArea(bId);
    const dx = b.cx - a.cx;
    const dz = b.cz - a.cz;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const rot = Math.atan2(dx, dz);

    const aEdge = a.radius * 0.98;
    const bEdge = len - b.radius * 0.98;
    const road = bEdge - aEdge;

    // Way-markers every ~28m, offset off the walking lane.
    const marks = Math.max(2, Math.floor(road / 28));
    for (let i = 1; i <= marks; i++) {
      const t = aEdge + (road * i) / (marks + 1);
      const side = i % 2 === 0 ? 1 : -1;
      const x = a.cx + ux * t + px * side * 7.2;
      const z = a.cz + uz * t + pz * side * 7.2;
      pieces.push(block(x, z, 1.1, rng.range(2.4, 4.2), 1.1, rot, { collide: 'circle', r: 0.85, tall: true }));
      if (rng.chance(0.45)) {
        accents.push(block(x, z, 0.35, 0.22, 0.35, 0, { y: rng.range(2.6, 4.4), collide: 'none' }));
      }
      // Low rubble that does not block a dodge.
      if (rng.chance(0.55)) {
        const rx = a.cx + ux * (t + rng.range(-4, 4)) + px * side * rng.range(9, 12);
        const rz = a.cz + uz * (t + rng.range(-4, 4)) + pz * side * rng.range(9, 12);
        pieces.push(block(rx, rz, rng.range(1.6, 3.2), rng.range(0.5, 1.1), rng.range(1.4, 2.6), rot, { collide: 'none' }));
      }
    }

    const shortcut = aId !== 'pit' && bId !== 'pit';
    placeGate(pieces, accents, gates, a.cx, a.cz, ux, uz, px, pz, rot, aEdge, aId, shortcut);
    placeGate(pieces, accents, gates, a.cx, a.cz, ux, uz, px, pz, rot + Math.PI, bEdge, bId, shortcut);
  }

  return { pieces, accents, gates };
}

function placeGate(
  pieces: Block[],
  accents: Block[],
  gates: CorridorLayout['gates'],
  ox: number,
  oz: number,
  ux: number,
  uz: number,
  px: number,
  pz: number,
  rot: number,
  dist: number,
  areaId: string,
  shortcut: boolean
): void {
  const gx = ox + ux * dist;
  const gz = oz + uz * dist;
  // Two posts, 10m apart, leaving an 8m walking gap.
  for (const side of [-1, 1]) {
    const x = gx + px * side * 6.2;
    const z = gz + pz * side * 6.2;
    pieces.push(block(x, z, 2.2, 7.5, 2.2, rot, { collide: 'circle', r: 1.5, tall: true }));
  }
  // Lintel — visual only, so the camera can look through the gate.
  pieces.push(block(gx, gz, 13, 1.4, 1.6, rot, { y: 8.2, collide: 'none' }));
  accents.push(block(gx, gz, 2.4, 0.28, 2.4, rot, { y: 9.1, collide: 'none' }));
  gates.push({ areaId, x: gx, z: gz, rot, shortcut });
}

/* ============================================================
   per-area
   ============================================================ */

function layoutPit(a: AreaDef, rng: RNG): AreaLayout {
  const d = draft(a);
  const exits = exitAngles(a.id);

  // Stepped ring — skip the roads so THE PIT is not a closed bowl.
  const segs = 36;
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    if (angleNear(t, exits, 0.28)) continue;
    const rad = a.radius * rng.range(0.93, 1.0);
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    const h = rng.range(4.2, 9.5);
    d.piece(x, z, rng.range(6, 10), h, rng.range(6, 10), t, { collide: 'circle', r: 4.2, tall: true });
  }

  // Inner terrace — low, readable as a drop, not a maze.
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2 + 0.2;
    if (angleNear(t, exits, 0.4)) continue;
    const rad = a.radius * 0.62;
    d.piece(a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, 5.5, 1.6, 3.4, t, { collide: 'box', hx: 2.4, hz: 1.4, tall: false });
  }

  // Arrival cages — history of who got thrown in.
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 + 0.7;
    const rad = 22 + (i % 2) * 6;
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    d.piece(x, z, 2.4, 3.2, 2.4, t, { collide: 'circle', r: 1.5, tall: true });
    d.accent(x, z, 1.6, 0.2, 1.6, 0, 3.4);
  }

  // The Drop — cracked dais, no collision so the first fight has a floor.
  d.piece(a.cx, a.cz, 11, 0.45, 11, 0.2, { y: 0.22, collide: 'none' });
  d.accent(a.cx, a.cz, 3.2, 0.18, 3.2, 0, 0.55);

  d.landmark = { name: a.landmark, x: a.cx, z: a.cz };
  d.banner = { x: a.cx + 8, z: a.cz + 8 };
  d.extract = polar(a, Math.PI * 0.15, 16);
  d.shrine(polar(a, -0.9, 20));
  d.shrine(polar(a, 2.2, 24));
  d.cache(polar(a, 3.5, 28));
  d.light(a.cx, 7, a.cz);
  d.light(a.cx + 18, 5, a.cz - 10);
  d.light(a.cx - 14, 5, a.cz + 12);
  return d.done();
}

function layoutRuins(a: AreaDef, rng: RNG): AreaLayout {
  const d = draft(a);
  const exits = exitAngles(a.id);

  // Colonnade grid with a nave down the middle — aisles you can actually fight in.
  const cols = [-28, -18, -8, 8, 18, 28];
  const rows = [-30, -18, -6, 6, 18, 30];
  for (const ox of cols) {
    for (const oz of rows) {
      if (Math.hypot(ox, oz) < 10) continue; // plaza
      const x = a.cx + ox + rng.range(-0.6, 0.6);
      const z = a.cz + oz + rng.range(-0.6, 0.6);
      const t = Math.atan2(ox, oz);
      if (angleNear(t, exits, 0.18) && Math.hypot(ox, oz) > 26) continue;
      const broken = rng.chance(0.32);
      const h = broken ? rng.range(2.4, 5.5) : rng.range(11, 18);
      const w = rng.range(2.0, 2.8);
      d.piece(x, z, w, h, w, rng.range(-0.08, 0.08), { collide: 'circle', r: w * 0.72, tall: true });
      if (!broken && rng.chance(0.4)) d.accent(x, z, w * 1.15, 0.28, w * 1.15, 0, h + 0.3);
    }
  }

  // Fallen lintels as low cover in the plaza ring.
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 + 0.4;
    const rad = 16;
    d.piece(a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, rng.range(7, 12), 1.15, 2.2, t + Math.PI / 2, {
      y: 0.58,
      collide: 'box',
      hx: 4.5,
      hz: 1.1,
      tall: false,
    });
  }

  // The Broken Nave — two tall piers and a collapsed arch toward the fortress.
  const naveT = Math.atan2(0 - a.cx, -212 - a.cz);
  const nx = a.cx + Math.cos(naveT) * 20;
  const nz = a.cz + Math.sin(naveT) * 20;
  d.piece(nx + Math.cos(naveT + 1.2) * 5, nz + Math.sin(naveT + 1.2) * 5, 3.4, 16, 3.4, naveT, { collide: 'circle', r: 2.1, tall: true });
  d.piece(nx + Math.cos(naveT - 1.2) * 5, nz + Math.sin(naveT - 1.2) * 5, 3.4, 11, 3.4, naveT, { collide: 'circle', r: 2.1, tall: true });
  d.piece(nx, nz, 12, 1.6, 2.8, naveT, { y: 0.8, collide: 'none' });
  d.accent(nx, nz, 4, 0.3, 4, 0, 2.1);

  d.landmark = { name: a.landmark, x: nx, z: nz };
  d.banner = { x: nx, z: nz };
  d.extract = polar(a, naveT + Math.PI, 18);
  d.shrine(polar(a, 1.1, 26));
  d.shrine(polar(a, -2.4, 22));
  d.cache(polar(a, 2.8, 34));
  d.light(nx, 6, nz);
  d.light(a.cx, 8, a.cz);
  return d.done();
}

function layoutForest(a: AreaDef, rng: RNG): AreaLayout {
  const d = draft(a);
  const exits = exitAngles(a.id);

  // The Pale Tree — one giant trunk you can see above the fog.
  d.piece(a.cx, a.cz, 5.4, 32, 5.4, 0.2, { collide: 'circle', r: 3.4, tall: true });
  d.accent(a.cx, a.cz, 7.2, 0.35, 7.2, 0, 14);
  d.accent(a.cx, a.cz, 2.2, 0.4, 2.2, 0, 31);

  // Three groves, three clearings. Trees packed in arcs, not a random field.
  const groves = [
    { t: 0.4, rad: 28, spread: 0.9, n: 16 },
    { t: 2.5, rad: 32, spread: 0.85, n: 18 },
    { t: 4.4, rad: 30, spread: 0.9, n: 16 },
  ];
  for (const g of groves) {
    for (let i = 0; i < g.n; i++) {
      const t = g.t + rng.range(-g.spread, g.spread);
      if (angleNear(t, exits, 0.22)) continue;
      const rad = g.rad + rng.range(-8, 10);
      if (rad < 14 || rad > a.radius * 0.96) continue;
      const x = a.cx + Math.cos(t) * rad;
      const z = a.cz + Math.sin(t) * rad;
      if (Math.hypot(x - a.cx, z - a.cz) < 12) continue;
      const w = rng.range(0.85, 1.9);
      const h = rng.range(12, 26);
      d.piece(x, z, w, h, w, rng.range(0, 0.4), { collide: 'circle', r: w * 0.78, tall: true });
      if (rng.chance(0.2)) d.accent(x, z, w * 1.6, 0.18, w * 1.6, 0, rng.range(4, 10));
    }
  }

  // Outer belt so the forest still reads as a wall from the road.
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    if (angleNear(t, exits, 0.26)) continue;
    const rad = a.radius * rng.range(0.88, 0.98);
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    const w = rng.range(1.1, 2.2);
    d.piece(x, z, w, rng.range(10, 22), w, t, { collide: 'circle', r: w * 0.75, tall: true });
  }

  d.landmark = { name: a.landmark, x: a.cx, z: a.cz };
  d.banner = { x: a.cx + 7, z: a.cz };
  d.extract = polar(a, 1.8, 18);
  d.shrine(polar(a, 0.4, 20));
  d.shrine(polar(a, 3.6, 24));
  d.cache(polar(a, 2.5, 36));
  d.cache(polar(a, 5.1, 32));
  d.light(a.cx, 10, a.cz);
  d.light(a.cx - 16, 4, a.cz + 18);
  return d.done();
}

function layoutCaves(a: AreaDef, rng: RNG): AreaLayout {
  const d = draft(a);
  const exits = exitAngles(a.id);

  // Chamber walls: masses that leave a central throat and two side rooms.
  const masses = [
    { t: 0.3, rad: 28, sx: 14, sz: 12, h: 12 },
    { t: 1.4, rad: 30, sx: 12, sz: 14, h: 11 },
    { t: 2.3, rad: 26, sx: 13, sz: 11, h: 13 },
    { t: 3.5, rad: 29, sx: 15, sz: 12, h: 12 },
    { t: 4.4, rad: 27, sx: 12, sz: 13, h: 11 },
    { t: 5.4, rad: 30, sx: 14, sz: 11, h: 12 },
  ];
  for (const m of masses) {
    if (angleNear(m.t, exits, 0.34)) continue;
    const x = a.cx + Math.cos(m.t) * m.rad;
    const z = a.cz + Math.sin(m.t) * m.rad;
    d.piece(x, z, m.sx, m.h, m.sz, m.t, { collide: 'box', hx: m.sx * 0.46, hz: m.sz * 0.46, tall: true });
  }

  // Ribs along the remaining ring.
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * Math.PI * 2 + 0.15;
    if (angleNear(t, exits, 0.3)) continue;
    const rad = a.radius * 0.92;
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    d.piece(x, z, rng.range(6, 10), rng.range(8, 13), rng.range(5, 9), t, { collide: 'circle', r: 4.2, tall: true });
  }

  // The Throat — still pool, no collision.
  d.piece(a.cx, a.cz, 9, 0.28, 9, 0, { y: 0.14, collide: 'none' });
  d.accent(a.cx, a.cz, 5.5, 0.12, 5.5, 0, 0.22);

  // Stalag-columns that pinch the side rooms without sealing them.
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.5;
    const rad = 16;
    d.piece(a.cx + Math.cos(t) * rad, a.cz + Math.sin(t) * rad, 2.2, rng.range(6, 10), 2.2, t, { collide: 'circle', r: 1.4, tall: true });
  }

  d.landmark = { name: a.landmark, x: a.cx, z: a.cz };
  d.banner = { x: a.cx + 6, z: a.cz - 4 };
  d.extract = polar(a, -0.6, 14);
  d.shrine(polar(a, 1.7, 20));
  d.shrine(polar(a, 4.2, 22));
  d.cache(polar(a, 2.9, 30));
  d.light(a.cx, 4, a.cz);
  d.light(a.cx + 12, 3.5, a.cz + 10);
  return d.done();
}

function layoutTower(a: AreaDef, rng: RNG): AreaLayout {
  const d = draft(a);
  const exits = exitAngles(a.id);

  // The Spire.
  d.piece(a.cx, a.cz, 16, 74, 16, 0, { collide: 'circle', r: 11.2, tall: true });
  for (let i = 0; i < 5; i++) {
    const h = 60 - i * 11;
    d.accent(a.cx, a.cz, 19, 0.7, 19, rng.range(0, 0.4), h);
  }
  d.accent(a.cx, a.cz, 4, 1.2, 4, 0, 75);

  // Courtyard ring wall with cardinal gaps aligned to roads.
  const segs = 22;
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    if (angleNear(t, exits, 0.3)) continue;
    const rad = 24;
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    d.piece(x, z, 5.5, 3.4, 2.4, t, { collide: 'box', hx: 2.4, hz: 1.1, tall: false });
  }

  // Outer watch blocks — cover on the approach, not in the ring.
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2 + 0.12;
    if (angleNear(t, exits, 0.28)) continue;
    const rad = rng.range(38, a.radius * 0.94);
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    const w = rng.range(3.2, 5.5);
    d.piece(x, z, w, rng.range(6, 14), w, t, { collide: 'circle', r: w * 0.72, tall: true });
  }

  d.landmark = { name: a.landmark, x: a.cx, z: a.cz };
  d.banner = { x: a.cx + 14, z: a.cz };
  d.extract = polar(a, Math.PI, 20);
  d.shrine(polar(a, 0.8, 28));
  d.shrine(polar(a, 3.9, 30));
  d.cache(polar(a, 2.2, 40));
  d.light(a.cx, 18, a.cz);
  d.light(a.cx + 20, 6, a.cz - 8);
  return d.done();
}

function layoutFortress(a: AreaDef, rng: RNG): AreaLayout {
  const d = draft(a);
  const exits = exitAngles(a.id);

  // Perimeter — gates only where the roads actually arrive.
  const segs = 32;
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    if (angleNear(t, exits, 0.22)) continue;
    const rad = a.radius * 0.95;
    const x = a.cx + Math.cos(t) * rad;
    const z = a.cz + Math.sin(t) * rad;
    d.piece(x, z, 10, rng.range(14, 19), 6, t, { collide: 'circle', r: 4.5, tall: true });
  }

  // Inner keep, offset so the courtyard in front of the seat stays open.
  d.piece(a.cx, a.cz - 10, 24, 12, 18, 0, { collide: 'box', hx: 12, hz: 9, tall: true });

  for (let i = 0; i < 4; i++) {
    const x = a.cx + (i % 2 ? 1 : -1) * 16;
    const z = a.cz + (i < 2 ? 1 : -1) * 20;
    d.piece(x, z, 6, rng.range(18, 24), 6, 0, { collide: 'circle', r: 4.1, tall: true });
    d.accent(x, z, 7, 0.55, 7, 0, 24);
  }

  // The Seat.
  d.piece(a.cx, a.cz + 16, 8, 2.4, 8, 0, { y: 1.2, collide: 'box', hx: 3.6, hz: 3.6, tall: false });
  d.accent(a.cx, a.cz + 16, 6.2, 0.4, 6.2, 0, 2.7);

  d.landmark = { name: a.landmark, x: a.cx, z: a.cz + 16 };
  d.banner = { x: a.cx, z: a.cz + 16 };
  d.extract = polar(a, Math.PI, 22);
  d.shrine(polar(a, 0.9, 28));
  d.cache(polar(a, -1.4, 30));
  d.light(a.cx, 8, a.cz + 16);
  d.light(a.cx - 18, 10, a.cz);
  return d.done();
}

/* ============================================================
   draft
   ============================================================ */

interface Draft {
  pieces: Block[];
  accents: Block[];
  shrines: Point[];
  caches: Point[];
  lights: Array<{ x: number; y: number; z: number }>;
  landmark: { name: string; x: number; z: number };
  extract: Point;
  banner: Point;
  piece: (x: number, z: number, sx: number, sy: number, sz: number, rot: number, opts?: BlockOpts) => void;
  accent: (x: number, z: number, sx: number, sy: number, sz: number, rot: number, y?: number) => void;
  shrine: (p: Point) => void;
  cache: (p: Point) => void;
  light: (x: number, y: number, z: number) => void;
  done: () => AreaLayout;
}

function draft(a: AreaDef): Draft {
  const pieces: Block[] = [];
  const accents: Block[] = [];
  const shrines: Point[] = [];
  const caches: Point[] = [];
  const lights: Array<{ x: number; y: number; z: number }> = [];
  const self: Draft = {
    pieces,
    accents,
    shrines,
    caches,
    lights,
    landmark: { name: a.landmark, x: a.cx, z: a.cz },
    extract: { x: a.cx, z: a.cz },
    banner: { x: a.cx, z: a.cz },
    piece(x, z, sx, sy, sz, rot, opts) {
      pieces.push(block(x, z, sx, sy, sz, rot, opts));
    },
    accent(x, z, sx, sy, sz, rot, y) {
      accents.push(block(x, z, sx, sy, sz, rot, { y, collide: 'none' }));
    },
    shrine(p) {
      shrines.push(p);
    },
    cache(p) {
      caches.push(p);
    },
    light(x, y, z) {
      lights.push({ x, y, z });
    },
    done() {
      return {
        pieces,
        accents,
        shrines,
        caches,
        lights,
        landmark: self.landmark,
        extract: self.extract,
        banner: self.banner,
      };
    },
  };
  return self;
}

interface BlockOpts {
  y?: number;
  collide?: Block['collide'];
  tall?: boolean;
  r?: number;
  hx?: number;
  hz?: number;
}

function block(x: number, z: number, sx: number, sy: number, sz: number, rot: number, opts: BlockOpts = {}): Block {
  const collide = opts.collide ?? 'circle';
  return {
    x,
    z,
    y: opts.y ?? sy / 2,
    sx,
    sy,
    sz,
    rot,
    collide,
    tall: opts.tall ?? true,
    r: opts.r ?? Math.max(sx, sz) * 0.45,
    hx: opts.hx ?? sx / 2,
    hz: opts.hz ?? sz / 2,
  };
}

function polar(a: AreaDef, t: number, rad: number): Point {
  return { x: a.cx + Math.cos(t) * rad, z: a.cz + Math.sin(t) * rad };
}

