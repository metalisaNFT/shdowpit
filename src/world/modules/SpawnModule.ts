/**
 * Grunt population drip — extracted from World.ts maintainPopulation.
 */

import type { Arena } from '../Arena';
import type { Player } from '../../player/Player';
import type { NemesisManager } from '../../nemesis/NemesisManager';
import { RNG } from '../../core/RNG';
import type { AreaDef } from '../../data/areas';
import type { Enemy } from '../../enemy/Enemy';

export const MAX_GRUNTS = 16;
export const RESPAWN_INTERVAL = 6;
export const RESPAWN_AFTER_CLEAR = 11;

export interface SpawnModuleHost {
  enemies: Enemy[];
  currentArea: AreaDef;
  mgr: NemesisManager;
  arena: Arena;
  rng: RNG;
  gruntDelta(): number;
  spawnGrunt(x: number, z: number): Enemy;
}

export interface SpawnState {
  respawnTimer: number;
  bulkFill: boolean;
}

export function tickPopulation(host: SpawnModuleHost, state: SpawnState, player: Player, dt: number): void {
  if (state.respawnTimer > 0) state.respawnTimer -= dt;
  const alive = host.enemies.filter((e) => e.alive && !e.named).length;
  const target = Math.min(
    MAX_GRUNTS,
    Math.max(2, host.currentArea.population + Math.floor(host.mgr.age / 2) + host.gruntDelta())
  );
  if (alive >= target) return;

  if (state.bulkFill) {
    state.bulkFill = false;
    for (let i = alive; i < target; i++) {
      const pt = host.arena.spawnPoint(host.currentArea.id, host.rng, 0.35, 0.98);
      if (Math.hypot(pt.x - player.position.x, pt.z - player.position.z) < 26) continue;
      host.spawnGrunt(pt.x, pt.z);
    }
    state.respawnTimer = RESPAWN_INTERVAL;
    return;
  }

  if (state.respawnTimer > 0) return;
  state.respawnTimer = alive === 0 ? RESPAWN_AFTER_CLEAR : RESPAWN_INTERVAL;

  for (let attempt = 0; attempt < 6; attempt++) {
    const pt = host.arena.spawnPoint(host.currentArea.id, host.rng, 0.35, 0.98);
    const d = Math.hypot(pt.x - player.position.x, pt.z - player.position.z);
    if (d < 26) continue;
    host.spawnGrunt(pt.x, pt.z);
    return;
  }
}

export function emptySpawnState(): SpawnState {
  return { respawnTimer: 0, bulkFill: true };
}
