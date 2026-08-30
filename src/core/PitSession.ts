/**
 * Pit play session — playing/dying tick delegation extracted from Game.ts.
 */

import type { UIMode } from './UIOrchestrator';

export interface PitTickHost {
  tickPlaying(dt: number, rdt: number): void;
  tickDying(dt: number, rdt: number): void;
}

/** Delegates pit-mode frame work so Game.ts owns wiring, not mode dispatch. */
export class PitSession {
  tick(mode: UIMode, host: PitTickHost, dt: number, rdt: number): void {
    switch (mode) {
      case 'playing':
        host.tickPlaying(dt, rdt);
        break;
      case 'dying':
        host.tickDying(dt, rdt);
        break;
      default:
        break;
    }
  }
}
