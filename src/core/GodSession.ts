/**
 * THE LONG GAME session lifecycle — god run, clock, spectator, lazy layer load.
 */

import type { NemesisManager } from '../nemesis/NemesisManager';
import type { GodState, RunOutcome } from '../god/GodTypes';
import type { Beat } from '../god/GodTypes';
import type { GodClock } from '../god/Clock';
import type { GodSpectator } from '../ui/GodSpectator';

export type GodRunModule = typeof import('../god/GodRun');
export type GodLayerModule = {
  GodRun: GodRunModule['GodRun'];
};

export interface GodRunCallbacks {
  onBeats: (beats: Beat[]) => void;
  onEnd: (outcome: RunOutcome) => void;
}

export class GodSession {
  godRun: InstanceType<GodLayerModule['GodRun']> | null = null;
  godSpectator: GodSpectator | null = null;
  godClock: GodClock | null = null;
  godBusy = false;
  godIdleCycles = 0;
  pendingSpectacleBeat: Beat | null = null;
  hierarchyFromGod = false;

  private layerPromise: Promise<GodLayerModule> | null = null;

  /** Lazy-load god run module so pit-only boot avoids the full god chunk upfront. */
  ensureLayer(): Promise<GodLayerModule> {
    if (!this.layerPromise) {
      this.layerPromise = import('../god/GodRun').then((m) => ({ GodRun: m.GodRun }));
    }
    return this.layerPromise;
  }

  async createRun(mgr: NemesisManager, callbacks: GodRunCallbacks): Promise<InstanceType<GodLayerModule['GodRun']>> {
    const { GodRun } = await this.ensureLayer();
    if (!this.godRun) {
      this.godRun = new GodRun(mgr, callbacks);
    }
    return this.godRun;
  }

  resumeOrBegin(mgr: NemesisManager, _callbacks: GodRunCallbacks, newSeed: number): { resumed: boolean } {
    const saved = mgr.data.god;
    if (saved && !saved.ended) {
      this.godRun?.resume(saved);
      return { resumed: true };
    }
    mgr.data.playerMeta.runs++;
    this.godRun?.begin(newSeed);
    this.godIdleCycles = 0;
    return { resumed: false };
  }

  get god(): GodState | null {
    return this.godRun?.god ?? null;
  }
}
