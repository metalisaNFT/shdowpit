/**
 * Everything that lives only for the current descent. Persisted so a reload
 * mid-run does not invent a new Vendetta or wipe Heat.
 */

import type { VendettaInstance } from '../nemesis/Vendetta';
import type { TerritoryMod } from '../world/TerritoryRules';
import type { ExtractionState } from '../world/Extraction';

export interface HeatPulse {
  kind: string;
  until: number;
  budgetUsed: number;
}

export interface RunState {
  heat: number;
  heatPeak: number;
  heatCooldown: number;
  lastThreshold: number;
  spawnBudget: number;
  spawnBudgetRegen: number;
  remnants: number;
  remnantUnstable: number;
  rerolls: number;
  healedBySource: Record<string, number>;
  severeDamage: number;
  healLocked: boolean;
  vendetta: VendettaInstance | null;
  offeredVendettaId: string | null;
  extraction: ExtractionState;
  territoryMods: Record<string, TerritoryMod>;
  loudCombatTimer: number;
  areaDwell: number;
  lastAreaId: string;
  executionPayload: string | null;
  reactionCooldowns: Record<string, number>;
  markedUids: number[];
  pursuitTargetId: string | null;
  informantIds: string[];
  lockedExits: boolean;
  outcomeOpen: boolean;
  outcomeEnemyId: string | null;
  outcomeProtect: number;
  lastProcNote: string;
  runSeed: number;
  started: boolean;
  blockFakeDeath: boolean;
  skillLoadout: [string, string];
}

export function emptyRunState(runSeed = 1): RunState {
  return {
    heat: 0,
    heatPeak: 0,
    heatCooldown: 0,
    lastThreshold: 0,
    spawnBudget: 4,
    spawnBudgetRegen: 0,
    remnants: 0,
    remnantUnstable: 0,
    rerolls: 0,
    healedBySource: {},
    severeDamage: 0,
    healLocked: false,
    vendetta: null,
    offeredVendettaId: null,
    extraction: { active: false, siteId: null, progress: 0, unlocked: false, paid: false },
    territoryMods: {},
    loudCombatTimer: 0,
    areaDwell: 0,
    lastAreaId: 'pit',
    executionPayload: null,
    reactionCooldowns: {},
    markedUids: [],
    pursuitTargetId: null,
    informantIds: [],
    lockedExits: false,
    outcomeOpen: false,
    outcomeEnemyId: null,
    outcomeProtect: 0,
    lastProcNote: '',
    runSeed,
    started: false,
    blockFakeDeath: false,
    skillLoadout: ['shadow_step', 'ground_rupture'],
  };
}

export function migrateRunState(raw: unknown, runSeed = 1): RunState {
  const base = emptyRunState(runSeed);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<RunState>;
  return {
    ...base,
    ...r,
    healedBySource: { ...base.healedBySource, ...(r.healedBySource ?? {}) },
    reactionCooldowns: { ...base.reactionCooldowns, ...(r.reactionCooldowns ?? {}) },
    markedUids: Array.isArray(r.markedUids) ? r.markedUids : [],
    informantIds: Array.isArray(r.informantIds) ? r.informantIds : [],
    territoryMods: r.territoryMods ?? {},
    extraction: { ...base.extraction, ...(r.extraction ?? {}) },
    vendetta: r.vendetta ?? null,
    skillLoadout: Array.isArray(r.skillLoadout) && r.skillLoadout.length === 2
      ? [String(r.skillLoadout[0]), String(r.skillLoadout[1])]
      : base.skillLoadout,
  };
}
