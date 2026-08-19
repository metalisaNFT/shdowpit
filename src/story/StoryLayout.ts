/**
 * Hybrid layout: player at centre, Overlord north, ranks on rings,
 * territories as angular sectors. Seeded — no live physics.
 */

import type { SaveData } from '../core/SaveSystem';
import { mixSeed } from '../core/RNG';
import { AREAS } from '../data/areas';
import { RANK_ORDER, type Rank } from '../nemesis/Nemesis';
import { PLAYER_ID, type StoryNode } from './StoryTypes';

export interface NodePos {
  x: number;
  y: number;
}

const W = 1100;
const H = 780;
const CX = W / 2;
const CY = H / 2 + 20;

function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function layoutStoryNodes(data: SaveData, nodes: StoryNode[]): Record<string, NodePos> {
  const pos: Record<string, NodePos> = {};
  pos[PLAYER_ID] = { x: CX, y: CY };

  const areaIndex = new Map<string, number>();
  AREAS.forEach((a, i) => areaIndex.set(a.id, i));

  const living = nodes.filter((n) => n.kind === 'nemesis' && n.alive);
  const dead = nodes.filter((n) => n.kind === 'nemesis' && !n.alive);
  const ov = living.find((n) => n.rank === 'overlord');
  if (ov) pos[ov.id] = { x: CX, y: 88 };

  const byRank: Record<string, StoryNode[]> = {};
  for (const n of living) {
    if (ov && n.id === ov.id) continue;
    const r = String(n.rank);
    (byRank[r] ??= []).push(n);
  }

  const rankRadius: Partial<Record<Rank, number>> = {
    warlord: 210,
    captain: 300,
    elite: 390,
    grunt: 460,
  };

  for (const rank of RANK_ORDER) {
    const list = byRank[rank];
    if (!list?.length) continue;
    const R = rankRadius[rank] ?? 340;
    list.sort((a, b) => a.id.localeCompare(b.id));
    list.forEach((n, i) => {
      const sector = (areaIndex.get(n.territory) ?? 0) / Math.max(1, AREAS.length);
      let hid = 0;
      for (let k = 0; k < n.id.length; k++) hid = (hid * 31 + n.id.charCodeAt(k)) | 0;
      const jitter = (hash01(mixSeed(data.worldSeed, hid + i * 17)) - 0.5) * 0.18;
      const angle = -Math.PI / 2 + (sector + i * 0.07 + jitter) * Math.PI * 1.6;
      pos[n.id] = { x: CX + Math.cos(angle) * R, y: CY + Math.sin(angle) * R * 0.78 };
    });
  }

  dead.sort((a, b) => b.importance - a.importance);
  dead.forEach((n, i) => {
    const angle = (i / Math.max(1, dead.length)) * Math.PI * 2 + 0.4;
    const R = 470 + (i % 3) * 18;
    pos[n.id] = { x: CX + Math.cos(angle) * R, y: CY + Math.sin(angle) * R * 0.72 };
  });

  // Simple overlap push (2 iterations, deterministic order)
  const ids = Object.keys(pos);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]];
        const b = pos[ids[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = ids[i] === PLAYER_ID || ids[j] === PLAYER_ID ? 86 : 62;
        if (d2 < min * min && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const p = ((min - d) / d) * 0.45;
          if (ids[i] !== PLAYER_ID) {
            a.x -= dx * p;
            a.y -= dy * p;
          }
          if (ids[j] !== PLAYER_ID) {
            b.x += dx * p;
            b.y += dy * p;
          }
        }
      }
    }
  }

  for (const id of ids) {
    pos[id].x = Math.max(40, Math.min(W - 40, pos[id].x));
    pos[id].y = Math.max(40, Math.min(H - 40, pos[id].y));
  }
  return pos;
}

export const STORY_CANVAS = { w: W, h: H };
