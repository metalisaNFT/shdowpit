/**
 * Mid-descent checkpoint for full pit run resume.
 */

import type { DescentBrief } from '../god/GodTypes';
import { migrateRunState, type RunState } from './RunState';

export interface EnemySnapshot {
  nemesisId: string;
  uid: number;
  hp: number;
  areaId: string;
  position: { x: number; z: number };
  facing: number;
  state: string;
  protectTargetId?: string;
}

export interface RunCheckpoint extends RunState {
  version: 1;
  savedAt: number;
  player: { x: number; z: number; facing: number; hp: number; maxHp: number };
  areaId: string;
  runTime: number;
  enemies: EnemySnapshot[];
  resolvedThisRun: string[];
  activeNamedIds: string[];
  encounterSalt: number;
  descent?: DescentBrief;
}

export function isRunCheckpoint(raw: RunState | null | undefined): raw is RunCheckpoint {
  if (!raw || !raw.started) return false;
  const ck = raw as Partial<RunCheckpoint>;
  return ck.version === 1 && typeof ck.savedAt === 'number' && !!ck.player && !!ck.areaId;
}

export function migrateCheckpoint(raw: unknown, runSeed = 1): RunCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const base = migrateRunState(raw, runSeed) as RunCheckpoint;
  const r = raw as Partial<RunCheckpoint>;
  if (r.version !== 1) return null;
  return {
    ...base,
    version: 1,
    savedAt: r.savedAt ?? Date.now(),
    player: r.player ?? { x: 0, z: 0, facing: 0, hp: 100, maxHp: 100 },
    areaId: r.areaId ?? 'pit',
    runTime: r.runTime ?? 0,
    enemies: Array.isArray(r.enemies) ? r.enemies : [],
    resolvedThisRun: Array.isArray(r.resolvedThisRun) ? r.resolvedThisRun : [],
    activeNamedIds: Array.isArray(r.activeNamedIds) ? r.activeNamedIds : [],
    encounterSalt: r.encounterSalt ?? 0,
    descent: r.descent,
  };
}
