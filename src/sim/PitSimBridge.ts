/**
 * Bridge live pit combat into SimState so god resume and descent reports stay accurate.
 */

import type { NemesisManager } from '../nemesis/NemesisManager';
import type { Nemesis } from '../nemesis/Nemesis';
import type { Enemy } from '../enemy/Enemy';
import type { VendettaInstance } from '../nemesis/Vendetta';
import { simOf } from '../god/GodTypes';
import { applyCombatOutcome, applyPitKill, applyPitScar, applyPlayerKilledBy } from './CombatOutcome';

export function onPitEnemyKilled(mgr: NemesisManager, e: Enemy, fakedDeath: boolean, playerAsKiller = true): void {
  if (!e.named) return;
  const n = e.nemesis;
  if (fakedDeath) {
    applyPitKill(mgr, null, n, true);
    return;
  }
  if (playerAsKiller) {
    simOf(n).fear = Math.min(100, simOf(n).fear + 16);
    for (const allyId of n.allies) {
      const ally = mgr.byId(allyId);
      if (ally?.alive) simOf(ally).fear = Math.min(100, simOf(ally).fear + 8);
    }
  }
}

export function onPitPlayerKilled(mgr: NemesisManager, killer: Nemesis | null): void {
  if (!killer) return;
  applyPlayerKilledBy(mgr, killer);
}

export function onPitEnemyEscape(mgr: NemesisManager, n: Nemesis): void {
  applyCombatOutcome(mgr, { winner: n, loser: n, aftermath: 'escaped' });
  simOf(n).flights++;
}

export function onPitScarApplied(n: Nemesis, scarCount: number): void {
  applyPitScar(n, Math.min(3, scarCount));
}

export function onVendettaProgress(mgr: NemesisManager, vendetta: VendettaInstance): void {
  const target = mgr.byId(vendetta.targetId);
  if (!target) return;
  const s = simOf(target);
  s.fear = Math.min(100, s.fear + 6);
  s.ambition = Math.min(100, s.ambition + 8);
}

export function onPitHumiliation(mgr: NemesisManager, n: Nemesis): void {
  applyCombatOutcome(mgr, { winner: null, loser: n, aftermath: 'humiliated' });
}
