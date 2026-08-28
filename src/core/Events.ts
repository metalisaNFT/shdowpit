/**
 * The single event map for the game bus. Keeping it in one file means the
 * systems that talk through the bus never have to import each other.
 */

import { EventBus } from './EventBus';
import type { WorldEvent } from '../world/WorldEvent';
import type { Nemesis } from '../nemesis/Nemesis';

export interface GameEvents {
  worldEvent: WorldEvent;
  nemesisPromoted: { nemesis: Nemesis; from: string; to: string };
  nemesisDied: { nemesis: Nemesis; byPlayer: boolean };
  nemesisReturned: { nemesis: Nemesis };
  /** A named blow landed — comic, AI, and memory hooks listen here. */
  namedStrike: {
    nemesisId: string;
    fromPlayer: boolean;
    amount: number;
    critical: boolean;
    attackLabel: string;
  };
  /** Proc chain or reaction fired — cross-system presentation only. */
  combatProc: { note: string; nemesisId?: string; dramatic: boolean };
}

export type Bus = EventBus<GameEvents>;

export function createBus(): Bus {
  return new EventBus<GameEvents>();
}
