/**
 * Rolls the power offers the player picks from during a run.
 */

import type { RNG } from '../core/RNG';
import { POWERS, type PowerDef, type PowerSet } from '../data/abilities';

export class AbilityManager {
  constructor(private rng: RNG) {}

  /** Three distinct offers, biased away from what the player already has. */
  roll(owned: PowerSet, count = 3): PowerDef[] {
    const pool = owned.offerable();
    if (pool.length <= count) return pool.slice();

    const picks: PowerDef[] = [];
    const remaining = pool.slice();
    const weights = remaining.map((p) => p.weight * (owned.has(p.id) ? 0.35 : 1));

    for (let i = 0; i < count && remaining.length; i++) {
      let total = 0;
      for (const w of weights) total += w;
      let r = this.rng.next() * total;
      let idx = remaining.length - 1;
      for (let j = 0; j < remaining.length; j++) {
        r -= weights[j];
        if (r <= 0) {
          idx = j;
          break;
        }
      }
      picks.push(remaining[idx]);
      remaining.splice(idx, 1);
      weights.splice(idx, 1);
    }
    return picks;
  }

  static byId(id: string): PowerDef | undefined {
    return POWERS.find((p) => p.id === id);
  }
}
