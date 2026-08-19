/**
 * The single event map for the game bus. Keeping it in one file means the
 * systems that talk through the bus never have to import each other.
 */

import { EventBus } from './EventBus';
import type { WorldEvent } from '../world/WorldEvent';
import type { Nemesis } from '../nemesis/Nemesis';

export type ToastTone = 'neutral' | 'hot' | 'gold' | 'good';

export interface GameEvents {
  toast: { text: string; tone?: ToastTone };
  worldEvent: WorldEvent;
  nemesisPromoted: { nemesis: Nemesis; from: string; to: string };
  nemesisDied: { nemesis: Nemesis; byPlayer: boolean };
  nemesisReturned: { nemesis: Nemesis };
  rosterChanged: void;
  saveRequested: void;
  sfx: { name: string; volume?: number; pitch?: number };
  hudDirty: void;
}

export type Bus = EventBus<GameEvents>;

export function createBus(): Bus {
  return new EventBus<GameEvents>();
}
