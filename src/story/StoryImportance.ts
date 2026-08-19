/**
 * Deterministic importance. Inspectable: every score is a sum of named factors.
 */

import type { Nemesis } from '../nemesis/Nemesis';
import { rankIndex } from '../nemesis/Nemesis';
import type { WorldEvent, WorldEventType } from '../world/WorldEvent';
import { PLAYER_ID } from './StoryTypes';

export interface ScoreFactor {
  id: string;
  value: number;
}

export interface Scored {
  total: number;
  factors: ScoreFactor[];
}

const TYPE_BASE: Partial<Record<WorldEventType, number>> = {
  betrayal: 42,
  resurrection: 38,
  overlord_slain: 55,
  succession: 48,
  age_begins: 50,
  weapon_theft: 36,
  player_death: 46,
  player_kill: 34,
  vendetta: 32,
  extraction: 28,
  promotion: 22,
  demotion: 18,
  territory: 24,
  revenge: 26,
  assassination: 28,
  player_spared: 20,
  enemy_escape: 18,
  player_escape: 16,
  humiliation: 22,
  death: 16,
  alliance: 12,
  injury: 10,
  mutation: 14,
  recruitment: 8,
  birth: 6,
  duel: 8,
  bargain: 12,
  heat: 6,
};

function add(factors: ScoreFactor[], id: string, value: number): void {
  if (value) factors.push({ id, value });
}

export function scoreEvent(ev: WorldEvent, nowTurn: number, roster: Map<string, Nemesis>): Scored {
  const factors: ScoreFactor[] = [];
  add(factors, 'type', TYPE_BASE[ev.type] ?? 6);
  if (ev.important) add(factors, 'flagged', 16);
  if (ev.witnessed) add(factors, 'witnessed', 22);
  const recency = Math.max(0, 18 - (nowTurn - ev.turn));
  add(factors, 'recency', recency);
  let named = 0;
  let rankBoost = 0;
  const playerish =
    ev.witnessed ||
    ev.type.startsWith('player_') ||
    ev.type === 'extraction' ||
    ev.type === 'overlord_slain' ||
    ev.type === 'vendetta';
  for (const id of ev.actors) {
    const n = roster.get(id);
    if (!n) continue;
    if (n.persistent) named += 1;
    rankBoost = Math.max(rankBoost, rankIndex(n.rank) * 6);
  }
  add(factors, 'named', named * 6);
  add(factors, 'rank', rankBoost);
  if (playerish) add(factors, 'player', 28);
  if (ev.type === 'promotion' && (ev.payload?.rankTo === 'overlord' || ev.payload?.rankTo === 'warlord')) {
    add(factors, 'high_office', 18);
  }
  const total = factors.reduce((s, f) => s + f.value, 0);
  return { total, factors };
}

export function scoreNode(n: Nemesis, nowTurn: number, isOverlord: boolean): Scored {
  const factors: ScoreFactor[] = [];
  add(factors, 'rank', rankIndex(n.rank) * 10);
  if (isOverlord) add(factors, 'overlord', 40);
  add(factors, 'kills_you', n.killsAgainstPlayer * 28);
  add(factors, 'you_killed', n.defeatsByPlayer * 12);
  add(factors, 'escapes', n.escapedPlayer * 10);
  add(factors, 'returns', n.returns * 18);
  add(factors, 'stolen', n.stolen.length * 26);
  add(factors, 'grudge', Math.min(30, Math.round(Math.max(0, n.playerRelationship) * 0.18)));
  add(factors, 'scars', n.scars.length * 4);
  if (!n.alive) {
    const age = nowTurn - (n.diedOnTurn ?? nowTurn);
    add(factors, 'dead', -12);
    if (n.killsAgainstPlayer > 0 || n.stolen.length || n.returns > 0) add(factors, 'memorable_dead', 24);
    else if (age > 8) add(factors, 'faded', -20);
  }
  const total = Math.max(0, factors.reduce((s, f) => s + f.value, 0));
  return { total, factors };
}

export function scorePlayerNode(meta: { deaths: number; namedKills: number; overlordsSlain: number }): Scored {
  const factors: ScoreFactor[] = [
    { id: 'anchor', value: 80 },
    { id: 'deaths', value: Math.min(20, meta.deaths * 2) },
    { id: 'named_kills', value: Math.min(20, meta.namedKills) },
    { id: 'overlords', value: meta.overlordsSlain * 12 },
  ];
  return { total: factors.reduce((s, f) => s + f.value, 0), factors };
}

export function scoreEdge(
  kind: string,
  a: Nemesis | null,
  b: Nemesis | null,
  playerInvolved: boolean
): number {
  let s = 8;
  if (kind === 'revenge' || kind === 'betrayal' || kind === 'stolen_weapon') s += 28;
  if (kind === 'master') s += 18;
  if (kind === 'rival') s += 14;
  if (kind === 'ally') s += 8;
  if (kind === 'former_ally') s += 16;
  if (kind === 'territory_war') s += 12;
  if (playerInvolved) s += 22;
  const rank = Math.max(a ? rankIndex(a.rank) : 0, b ? rankIndex(b.rank) : 0);
  s += rank * 3;
  return s;
}

export function playerInvolvedEvent(ev: WorldEvent): boolean {
  if (ev.witnessed) return true;
  return (
    ev.type.startsWith('player_') ||
    ev.type === 'extraction' ||
    ev.type === 'overlord_slain' ||
    ev.type === 'vendetta' ||
    ev.actors.includes(PLAYER_ID)
  );
}
