/**
 * Bridges god-layer conditions and legend legacies into the live third-person pit.
 * Headless duels already read tilts; this applies the same math to Enemy.
 */

import type { Enemy } from '../enemy/Enemy';
import type { Nemesis } from '../nemesis/Nemesis';
import { ARCHETYPES, type Archetype } from '../nemesis/Nemesis';
import { ARCHETYPE_WEIGHTS } from '../nemesis/NemesisGenerator';
import { neutralTilt, type CombatTilt } from './Combatant';
import { ConditionIndex, CONDITION_LABEL } from './Conditions';
import { inferLegacyEcho } from './Legends';
import type { ConditionKind, GodState, LegacyEcho, LegacyKind, LegendRecord } from './GodTypes';

const ACTIVE_KINDS: ConditionKind[] = ['blessing', 'curse', 'exposure', 'bounty', 'mark', 'ward'];

export function nemesisTilt(god: GodState | null | undefined, nemesisId: string): CombatTilt {
  if (!god) return neutralTilt();
  return new ConditionIndex(god).tiltFor(nemesisId);
}

export function activeConditionLabels(god: GodState | null | undefined, nemesisId: string): string[] {
  if (!god) return [];
  const idx = new ConditionIndex(god);
  const out: string[] = [];
  for (const kind of ACTIVE_KINDS) {
    if (idx.weight(nemesisId, kind) > 0.05) out.push(CONDITION_LABEL[kind]);
  }
  return out;
}

export function mergeCombatTilts(a: CombatTilt, b: CombatTilt): CombatTilt {
  return {
    damage: a.damage * b.damage,
    health: a.health * b.health,
    armour: a.armour * b.armour,
    resolve: a.resolve + b.resolve,
    edge: a.edge + b.edge,
  };
}

/** Lean from a legend's reach-forward — subtle, never decisive alone. */
export function legacyTiltFor(kind: LegacyKind): CombatTilt {
  switch (kind) {
    case 'relic':
      return { damage: 1.12, health: 1, armour: 1, resolve: 0.04, edge: 0.35 };
    case 'bloodline':
      return { damage: 1.08, health: 1.15, armour: 1, resolve: 0.06, edge: 0.45 };
    case 'grudge':
      return { damage: 1.18, health: 1, armour: 0.9, resolve: 0.1, edge: 0.25 };
    case 'title':
      return { damage: 1.05, health: 1, armour: 1, resolve: 0, edge: -0.35 };
    case 'rumour':
      return { damage: 1.06, health: 1, armour: 1, resolve: 0.05, edge: 0.2 };
    default:
      return neutralTilt();
  }
}

export function resolveLegacyEcho(
  nemesis: Nemesis,
  echoes: readonly LegacyEcho[] | null | undefined,
  legends: readonly LegendRecord[]
): LegacyEcho | null {
  const direct = echoes?.find((e) => e.actorId === nemesis.id);
  if (direct) return direct;
  return inferLegacyEcho(nemesis, legends);
}

export function legendOmenFor(god: GodState | null | undefined, legends: readonly LegendRecord[]): LegendRecord | null {
  if (!god) return null;
  const idx = new ConditionIndex(god);
  if (idx.worldWeight('omen') < 0.05) return null;
  const omen = idx.ofKind('omen').find((c) => c.targetKind === 'world');
  if (!omen) return null;
  const note = omen.note.toLowerCase();
  return legends.find((l) => note.includes(l.name.toLowerCase())) ?? null;
}

export function legacyArrivalToast(echo: LegacyEcho, legend?: LegendRecord): string {
  const name = legend?.name.toUpperCase() ?? 'A LEGEND';
  switch (echo.kind) {
    case 'bloodline':
      return `${name}'S NAME WALKS AGAIN`;
    case 'grudge':
      return `INHERITED ${name}'S HATRED`;
    case 'title':
      return `WEARING ${legend?.title ?? name}'S TITLE`;
    case 'relic':
      return `STEEL FROM ${name}'S RUN`;
    default:
      return echo.headline;
  }
}

/** Apply strategic marks and legend lean to a live arena enemy. */
export function applyTiltToEnemy(e: Enemy, tilt: CombatTilt): void {
  if (tilt.health !== 1) {
    e.maxHp = Math.max(8, Math.round(e.maxHp * tilt.health));
    e.hp = Math.max(1, Math.round(e.hp * tilt.health));
  }
  if (tilt.damage !== 1) e.damage *= tilt.damage;
  e.tilt = tilt;
  if (tilt.edge < -0.1) e.introDelay += Math.min(2.8, -tilt.edge * 1.4);
}

/** Behavioural nudge when a legend's echo walks into the pit. */
export function applyLegacyPresence(e: Enemy, echo: LegacyEcho): void {
  switch (echo.kind) {
    case 'grudge':
      e.engagePlayer = true;
      break;
    case 'bloodline':
      if (e.entranceKind === 'immediate') e.entranceKind = 'walk';
      e.introDelay = Math.max(e.introDelay, 1.2);
      break;
    case 'title':
      e.introDelay = Math.max(e.introDelay, 0.8);
      break;
    default:
      break;
  }
}

/** Legend history nudges grunt archetypes and hunt selection — never decisive alone. */
export interface LegendSpawnBias {
  archetypeWeights: number[];
  huntWeight: (n: Nemesis) => number;
}

export function legendSpawnBias(legends: readonly LegendRecord[]): LegendSpawnBias {
  const weights = ARCHETYPE_WEIGHTS.slice();
  const recent = legends.slice(-5);
  for (const l of recent) {
    const idx = ARCHETYPES.indexOf(l.archetype as Archetype);
    if (idx < 0) continue;
    if (l.legacy === 'bloodline' || l.legacy === 'rumour') weights[idx] *= 1.18;
    else if (l.legacy === 'grudge') weights[(idx + 2) % ARCHETYPES.length] *= 1.12;
  }
  const names = new Set(recent.map((l) => l.name.toLowerCase()));
  const titles = new Set(recent.filter((l) => l.title).map((l) => l.title!.toLowerCase()));
  return {
    archetypeWeights: weights,
    huntWeight: (n) => {
      let w = 0;
      if (names.has(n.name.toLowerCase())) w += 0.45;
      if (n.title && titles.has(n.title.toLowerCase())) w += 0.35;
      if (n.stolen.some((s) => recent.some((l) => s.name.includes(l.name.toUpperCase())))) w += 0.5;
      if (recent.some((l) => l.legacy === 'grudge') && n.playerRelationship > 40) w += 0.25;
      return w;
    },
  };
}

/** Merge kit-derived and legend-derived archetype weights. */
export function mergeArchetypeWeights(a: number[], b: number[]): number[] {
  if (a.length !== b.length) return a.length === ARCHETYPES.length ? a : b;
  return a.map((v, i) => v * b[i]);
}
