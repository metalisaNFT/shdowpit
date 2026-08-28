/**
 * Shared 2D world map drawing for HUD minimap and THE LONG GAME oracle map.
 */

import { AREAS, CONNECTIONS, WORLD_HALF, type AreaDef } from '../data/areas';
import { WORLD } from '../data/palette';

export const MAP_SIZE = 180;

export interface MapAreaStyle {
  id: string;
  accent: number;
  /** hex string with alpha suffix e.g. #aabbcc22 */
  fill: string;
  stroke: string;
  selected?: boolean;
  crisis?: boolean;
  focus?: boolean;
}

export interface MapActorDot {
  id?: string;
  areaId: string;
  accent: number;
  rank: number;
  marked?: boolean;
}

export interface MapWarLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  colour: number;
}

export interface MapDrawInput {
  areas: MapAreaStyle[];
  actors?: MapActorDot[];
  wars?: MapWarLine[];
  landmarks?: Array<{ x: number; z: number }>;
}

function hexAccent(n: number, alpha: string): string {
  const r = ((n >> 16) & 255).toString(16).padStart(2, '0');
  const g = ((n >> 8) & 255).toString(16).padStart(2, '0');
  const b = (n & 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}${alpha}`;
}

export function worldToMap(x: number, z: number, size = MAP_SIZE): { x: number; y: number } {
  const scale = size / (WORLD_HALF * 2.1);
  return { x: size / 2 + x * scale, y: size / 2 + z * scale };
}

export function mapToWorld(px: number, py: number, size = MAP_SIZE): { x: number; z: number } {
  const scale = size / (WORLD_HALF * 2.1);
  return { x: (px - size / 2) / scale, z: (py - size / 2) / scale };
}

export function areaAtMap(px: number, py: number, size = MAP_SIZE): AreaDef | null {
  const { x, z } = mapToWorld(px, py, size);
  let best: AreaDef | null = null;
  let bestD = Infinity;
  for (const a of AREAS) {
    const d = Math.hypot(x - a.cx, z - a.cz);
    if (d <= a.radius && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

export function drawWorldMap(ctx: CanvasRenderingContext2D, input: MapDrawInput, size = MAP_SIZE): void {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(4,4,8,0.72)';
  ctx.fillRect(0, 0, size, size);

  const styleById = new Map(input.areas.map((a) => [a.id, a]));
  const scale = size / (WORLD_HALF * 2.1);
  const cx = size / 2;
  const cy = size / 2;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (const [a, b] of CONNECTIONS) {
    const aa = AREAS.find((x) => x.id === a);
    const bb = AREAS.find((x) => x.id === b);
    if (!aa || !bb) continue;
    ctx.beginPath();
    ctx.moveTo(cx + aa.cx * scale, cy + aa.cz * scale);
    ctx.lineTo(cx + bb.cx * scale, cy + bb.cz * scale);
    ctx.stroke();
  }

  for (const a of AREAS) {
    const st = styleById.get(a.id);
    const px = cx + a.cx * scale;
    const py = cy + a.cz * scale;
    const r = a.radius * scale;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = st?.fill ?? hexAccent(a.accent, '18');
    ctx.fill();
    ctx.strokeStyle = st?.stroke ?? hexAccent(a.accent, '88');
    ctx.lineWidth = st?.selected || st?.focus ? 2.2 : 1;
    ctx.stroke();
    if (st?.crisis) {
      ctx.beginPath();
      ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,80,60,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  for (const w of input.wars ?? []) {
    const p1 = worldToMap(w.x1, w.z1, size);
    const p2 = worldToMap(w.x2, w.z2, size);
    ctx.strokeStyle = hexAccent(w.colour, 'cc');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  for (const lm of input.landmarks ?? []) {
    const p = worldToMap(lm.x, lm.z, size);
    ctx.fillStyle = 'rgba(232,230,224,0.85)';
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }

  for (const dot of input.actors ?? []) {
    const area = AREAS.find((a) => a.id === dot.areaId);
    if (!area) continue;
    const p = actorMapPosition(area, dot, size);
    const sz = 2 + Math.min(3, dot.rank);
    ctx.fillStyle = hexAccent(dot.accent, 'ff');
    ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    if (dot.marked) {
      ctx.strokeStyle = 'rgba(255,200,60,0.95)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(p.x - sz / 2 - 1, p.y - sz / 2 - 1, sz + 2, sz + 2);
    }
  }
}

/** Stable hash spread for roster placement (map + 3D world). */
export function actorPlacement(id: string): { ang: number; radFrac: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return {
    ang: ((h & 0xffff) / 0xffff) * Math.PI * 2,
    radFrac: 0.22 + (((h >>> 16) & 0xffff) / 0xffff) * 0.68,
  };
}

/** Stable spread inside an area so the full roster stays visible. */
export function actorMapPosition(area: AreaDef, dot: MapActorDot, size = MAP_SIZE): { x: number; y: number } {
  const base = worldToMap(area.cx, area.cz, size);
  const scale = size / (WORLD_HALF * 2.1);
  const maxR = area.radius * scale * 0.74;
  const key = dot.id ?? `${dot.areaId}:${dot.rank}`;
  const { ang, radFrac } = actorPlacement(key);
  const rad = maxR * radFrac;
  return {
    x: base.x + Math.cos(ang) * rad,
    y: base.y + Math.sin(ang) * rad,
  };
}

/** World XZ for a roster member inside an area (collision-resolved). */
export function actorWorldPosition(
  area: AreaDef,
  id: string,
  resolve: (x: number, z: number, r: number, out: { x: number; z: number }) => { x: number; z: number }
): { x: number; z: number } {
  const { ang, radFrac } = actorPlacement(id);
  const rad = area.radius * radFrac;
  const x = area.cx + Math.cos(ang) * rad;
  const z = area.cz + Math.sin(ang) * rad;
  const out = { x: 0, z: 0 };
  resolve(x, z, 1.1, out);
  return { x: out.x, z: out.z };
}

export function defaultAreaStyles(accents: Record<string, number>): MapAreaStyle[] {
  return AREAS.map((a) => ({
    id: a.id,
    accent: accents[a.id] ?? a.accent,
    fill: hexAccent(accents[a.id] ?? a.accent, '22'),
    stroke: hexAccent(accents[a.id] ?? a.accent, '99'),
  }));
}

export function metalAccent(): string {
  return hexAccent(WORLD.metal, '55');
}
