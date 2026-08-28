/**
 * Hybrid world clock for THE LONG GAME.
 *
 * Pure state machine — no DOM. The simulation still advances only when
 * `onAdvance` fires; this decides when that should happen.
 */

import { BEAT_RANK, type Beat } from './GodTypes';

export type GodClockState = 'running' | 'paused' | 'intervening' | 'spectating' | 'modal';

export interface GodClockSettings {
  autoAdvance: boolean;
  cycleDurationSec: number;
  pauseOnMajor: boolean;
}

export function defaultGodClockSettings(): GodClockSettings {
  return { autoAdvance: true, cycleDurationSec: 10, pauseOnMajor: true };
}

export interface GodClockHooks {
  onAdvance?: () => void;
  onStateChange?: (state: GodClockState) => void;
}

export class GodClock {
  private settings: GodClockSettings;
  private state: GodClockState = 'paused';
  private remaining = 0;
  private hooks: GodClockHooks = {};
  /** Beat waiting for player dismiss before clock resumes. */
  private pausedBeat: Beat | null = null;

  constructor(settings: GodClockSettings = defaultGodClockSettings()) {
    this.settings = { ...settings };
    this.remaining = settings.cycleDurationSec;
  }

  bind(hooks: GodClockHooks): void {
    this.hooks = hooks;
  }

  setSettings(s: Partial<GodClockSettings>): void {
    this.settings = { ...this.settings, ...s };
  }

  getSettings(): GodClockSettings {
    return { ...this.settings };
  }

  get stateName(): GodClockState {
    return this.state;
  }

  get countdown(): number {
    return Math.max(0, this.remaining);
  }

  get countdownFrac(): number {
    const dur = Math.max(0.1, this.settings.cycleDurationSec);
    return Math.max(0, Math.min(1, this.remaining / dur));
  }

  get waitingBeat(): Beat | null {
    return this.pausedBeat;
  }

  /** Opening tutorial or fresh run — clock off until first advance lesson. */
  pauseForTutorial(): void {
    this.setState('paused');
    this.remaining = this.settings.cycleDurationSec;
  }

  /** Player spent Influence; wait for explicit advance. */
  enterIntervening(): void {
    this.setState('intervening');
  }

  /** After advance completes with no pending spend. */
  enterObserve(tempoMul = 1): void {
    this.pausedBeat = null;
    this.remaining = this.settings.cycleDurationSec / Math.max(0.5, tempoMul);
    if (this.settings.autoAdvance) this.setState('running');
    else this.setState('paused');
  }

  enterModal(): void {
    this.setState('modal');
  }

  enterSpectating(): void {
    this.setState('spectating');
  }

  /** Major/legendary beat surfaced — hybrid pause until dismiss. */
  pauseForBeat(b: Beat): void {
    if (!this.settings.pauseOnMajor) return;
    if (BEAT_RANK[b.priority] < BEAT_RANK.major) return;
    this.pausedBeat = b;
    this.setState('paused');
  }

  dismissBeat(): void {
    if (!this.pausedBeat) return;
    this.pausedBeat = null;
    if (this.settings.autoAdvance) {
      this.remaining = this.settings.cycleDurationSec;
      this.setState('running');
    } else {
      this.setState('paused');
    }
    this.hooks.onStateChange?.(this.state);
  }

  togglePause(): void {
    if (this.state === 'spectating' || this.state === 'modal') return;
    if (this.state === 'intervening') return;
    if (this.state === 'running') this.setState('paused');
    else if (this.state === 'paused' && !this.pausedBeat) {
      this.setState('running');
    }
  }

  /** Force one cycle (manual advance button). */
  forceAdvance(): void {
    this.pausedBeat = null;
    this.hooks.onAdvance?.();
  }

  tick(dt: number): void {
    if (this.state !== 'running') return;
    if (!this.settings.autoAdvance) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = this.settings.cycleDurationSec;
      this.hooks.onAdvance?.();
    }
  }

  resetCycleTimer(tempoMul = 1): void {
    this.remaining = this.settings.cycleDurationSec / Math.max(0.5, tempoMul);
  }

  private setState(s: GodClockState): void {
    if (this.state === s) return;
    this.state = s;
    this.hooks.onStateChange?.(s);
  }
}

/** Pick the loudest beat worth pausing on from a cycle batch. */
const PAUSE_KIND_BOOST: Record<string, number> = {
  act: 100,
  chaos: 90,
  heresy: 85,
  crisis: 80,
};

export function pickPauseBeat(beats: readonly Beat[]): Beat | null {
  let best: Beat | null = null;
  let bestScore = -1;
  for (const b of beats) {
    if (b.kind === 'intervention') continue;
    const r = BEAT_RANK[b.priority];
    if (r < BEAT_RANK.major) continue;
    const score = r * 10 + (PAUSE_KIND_BOOST[b.kind] ?? 0);
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}

/** Highest-priority spectacle beat in a batch. */
export function pickSpectacleBeat(beats: readonly Beat[]): Beat | null {
  let best: Beat | null = null;
  let bestRank = -1;
  for (const b of beats) {
    if (!b.spectacle) continue;
    const r = BEAT_RANK[b.priority];
    if (r > bestRank) {
      best = b;
      bestRank = r;
    }
  }
  return best;
}
