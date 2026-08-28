/**
 * Lightweight grid pathfinding scoped to a single area.
 *
 * Uses the arena collision resolver for walkability — no nav mesh bake.
 * Built for god-layer roster patrol, not combat AI.
 */

import { getArea } from '../data/areas';
import type { Arena } from './Arena';

const CELL = 3;
const BODY_R = 0.65;
const AREA_FRAC = 0.88;

interface NavGrid {
  areaId: string;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  walkable: Uint8Array;
}

interface Cell {
  col: number;
  row: number;
}

export class AreaNav {
  private grids = new Map<string, NavGrid>();
  private arenaGen = -1;

  invalidate(): void {
    this.grids.clear();
    this.arenaGen = -1;
  }

  findPath(
    arena: Arena,
    areaId: string,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number
  ): { x: number; z: number }[] {
    this.ensureFresh(arena);
    const grid = this.getGrid(arena, areaId);
    if (!grid) return [{ x: toX, z: toZ }];

    const start = this.cellFor(grid, fromX, fromZ);
    const goal = this.cellFor(grid, toX, toZ);
    if (!start || !goal) return [{ x: toX, z: toZ }];

    let gx = goal.col;
    let gz = goal.row;
    if (!this.isWalkable(grid, gx, gz)) {
      const near = this.nearestWalkable(grid, gx, gz, 8);
      if (!near) return [{ x: toX, z: toZ }];
      gx = near.col;
      gz = near.row;
    }

    let sx = start.col;
    let sz = start.row;
    if (!this.isWalkable(grid, sx, sz)) {
      const near = this.nearestWalkable(grid, sx, sz, 8);
      if (!near) return [{ x: toX, z: toZ }];
      sx = near.col;
      sz = near.row;
    }

    if (sx === gx && sz === gz) return [{ x: toX, z: toZ }];

    const raw = this.astar(grid, sx, sz, gx, gz);
    if (!raw.length) return [{ x: toX, z: toZ }];

    const world = raw.map((c) => this.cellCenter(grid, c.col, c.row));
    world.push({ x: toX, z: toZ });
    return this.smoothPath(arena, world);
  }

  /** Pick an open patrol point away from (ox, oz), stable per seed. */
  pickPatrolPoint(
    arena: Arena,
    areaId: string,
    ox: number,
    oz: number,
    seed: number,
    minDist = 7,
    maxDist = 22
  ): { x: number; z: number } | null {
    this.ensureFresh(arena);
    const grid = this.getGrid(arena, areaId);
    if (!grid) return null;

    const walkables: Cell[] = [];
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (!this.isWalkable(grid, c, r)) continue;
        const p = this.cellCenter(grid, c, r);
        const d = Math.hypot(p.x - ox, p.z - oz);
        if (d >= minDist && d <= maxDist) walkables.push({ col: c, row: r });
      }
    }
    if (!walkables.length) return null;

    let h = seed >>> 0;
    for (let attempt = 0; attempt < walkables.length; attempt++) {
      h = (h * 1664525 + 1013904223) >>> 0;
      const pick = walkables[h % walkables.length]!;
      return this.cellCenter(grid, pick.col, pick.row);
    }
    const fallback = walkables[0]!;
    return this.cellCenter(grid, fallback.col, fallback.row);
  }

  private ensureFresh(arena: Arena): void {
    const gen = arena.colliders.length;
    if (gen !== this.arenaGen) {
      this.grids.clear();
      this.arenaGen = gen;
    }
  }

  private getGrid(arena: Arena, areaId: string): NavGrid | null {
    const cached = this.grids.get(areaId);
    if (cached) return cached;

    const area = getArea(areaId);
    const r = area.radius * AREA_FRAC;
    const originX = area.cx - r;
    const originZ = area.cz - r;
    const cols = Math.max(1, Math.ceil((r * 2) / CELL));
    const rows = cols;
    const walkable = new Uint8Array(cols * rows);
    const out = { x: 0, z: 0 };

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = originX + (col + 0.5) * CELL;
        const z = originZ + (row + 0.5) * CELL;
        if (Math.hypot(x - area.cx, z - area.cz) > r) continue;
        arena.resolve(x, z, BODY_R, out);
        if (Math.hypot(out.x - x, out.z - z) < 0.1) {
          walkable[row * cols + col] = 1;
        }
      }
    }

    const grid: NavGrid = { areaId, originX, originZ, cols, rows, walkable };
    this.grids.set(areaId, grid);
    return grid;
  }

  private cellFor(grid: NavGrid, x: number, z: number): Cell | null {
    const col = Math.floor((x - grid.originX) / CELL);
    const row = Math.floor((z - grid.originZ) / CELL);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
    return { col, row };
  }

  private cellCenter(grid: NavGrid, col: number, row: number): { x: number; z: number } {
    return {
      x: grid.originX + (col + 0.5) * CELL,
      z: grid.originZ + (row + 0.5) * CELL,
    };
  }

  private idx(grid: NavGrid, col: number, row: number): number {
    return row * grid.cols + col;
  }

  private isWalkable(grid: NavGrid, col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
    return grid.walkable[this.idx(grid, col, row)] === 1;
  }

  private nearestWalkable(grid: NavGrid, col: number, row: number, maxR: number): Cell | null {
    for (let rad = 1; rad <= maxR; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
          const c = col + dc;
          const r = row + dr;
          if (this.isWalkable(grid, c, r)) return { col: c, row: r };
        }
      }
    }
    return null;
  }

  private astar(grid: NavGrid, sx: number, sz: number, gx: number, gz: number): Cell[] {
    const total = grid.cols * grid.rows;
    const gScore = new Float32Array(total);
    gScore.fill(Infinity);
    const fScore = new Float32Array(total);
    fScore.fill(Infinity);
    const cameFrom = new Int32Array(total);
    cameFrom.fill(-1);
    const closed = new Uint8Array(total);

    const startI = this.idx(grid, sx, sz);
    const goalI = this.idx(grid, gx, gz);
    gScore[startI] = 0;
    fScore[startI] = this.octile(sx, sz, gx, gz);

    const open: number[] = [startI];

    const neighbors = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [1, -1, 1.414],
      [-1, 1, 1.414],
      [-1, -1, 1.414],
    ] as const;

    while (open.length) {
      let bestIdx = 0;
      let bestF = fScore[open[0]!]!;
      for (let i = 1; i < open.length; i++) {
        const fi = fScore[open[i]!]!;
        if (fi < bestF) {
          bestF = fi;
          bestIdx = i;
        }
      }
      const current = open[bestIdx]!;
      if (current === goalI) return this.reconstruct(grid, cameFrom, current);

      open[bestIdx] = open[open.length - 1]!;
      open.pop();
      if (closed[current]) continue;
      closed[current] = 1;

      const col = current % grid.cols;
      const row = Math.floor(current / grid.cols);

      for (const [dc, dr, cost] of neighbors) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isWalkable(grid, nc, nr)) continue;
        const ni = this.idx(grid, nc, nr);
        if (closed[ni]) continue;

        const tentative = gScore[current]! + cost;
        if (tentative >= gScore[ni]!) continue;

        cameFrom[ni] = current;
        gScore[ni] = tentative;
        fScore[ni] = tentative + this.octile(nc, nr, gx, gz);
        if (!open.includes(ni)) open.push(ni);
      }
    }

    return [];
  }

  private octile(col: number, row: number, gCol: number, gRow: number): number {
    const dx = Math.abs(col - gCol);
    const dy = Math.abs(row - gRow);
    return dx + dy + (1.414 - 2) * Math.min(dx, dy);
  }

  private reconstruct(grid: NavGrid, cameFrom: Int32Array, current: number): Cell[] {
    const path: Cell[] = [];
    let c = current;
    while (c >= 0) {
      path.push({ col: c % grid.cols, row: Math.floor(c / grid.cols) });
      c = cameFrom[c]!;
    }
    path.reverse();
    // Drop the start cell — the agent is already there.
    if (path.length > 1) path.shift();
    return path;
  }

  private smoothPath(arena: Arena, pts: { x: number; z: number }[]): { x: number; z: number }[] {
    if (pts.length <= 2) return pts;
    const out: { x: number; z: number }[] = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      let far = i + 1;
      for (let j = pts.length - 1; j > i; j--) {
        const a = pts[i]!;
        const b = pts[j]!;
        if (arena.lineOfSight(a.x, a.z, b.x, b.z)) {
          far = j;
          break;
        }
      }
      if (far !== i) out.push(pts[far]!);
      i = far;
    }
    return out;
  }
}
