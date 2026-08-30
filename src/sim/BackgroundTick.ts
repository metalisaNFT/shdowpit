/**
 * Background world ticks during long pit sessions.
 */

import type { Settings } from '../core/SaveSystem';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { WorldEvent } from '../world/WorldEvent';
import { resolveOffscreenBeat } from './OffscreenBeat';

/** Prefer story events over skirmish filler when surfacing a pit-absence headline. */
const HEADLINE_EVENT_TYPES = [
  'betrayal',
  'return',
  'succession',
  'promotion',
  'resurrection',
  'crisis',
  'duel',
  'revenge',
  'grudge',
  'overlord_slain',
  'weapon_theft',
  'death',
];

function headlineRank(e: WorldEvent): number {
  const i = HEADLINE_EVENT_TYPES.indexOf(e.type);
  if (i >= 0) return i;
  if (e.important) return HEADLINE_EVENT_TYPES.length;
  return HEADLINE_EVENT_TYPES.length + 5;
}

function pickHeadlineEvent(events: WorldEvent[]): WorldEvent | undefined {
  if (!events.length) return undefined;
  return [...events].sort((a, b) => headlineRank(a) - headlineRank(b))[0];
}

export const DEFAULT_TICK_MINUTES = 4;
export const MIN_TICK_INTERVAL_MS = 120_000;

export interface BackgroundTickState {
  pitAbsenceTimer: number;
  lastTickAt: number;
  ticksThisSession: number;
}

export function emptyBackgroundTickState(): BackgroundTickState {
  return { pitAbsenceTimer: 0, lastTickAt: 0, ticksThisSession: 0 };
}

export interface TickContext {
  inTutorial: boolean;
  vendettaClimax: boolean;
  extractionActive: boolean;
  encounterIntro: boolean;
  areaJustChanged: boolean;
}

export function shouldBackgroundTick(settings: Settings, ctx: TickContext): boolean {
  if (settings.backgroundTickMinutes <= 0) return false;
  if (ctx.inTutorial) return false;
  if (ctx.vendettaClimax || ctx.extractionActive || ctx.encounterIntro) return false;
  return true;
}

export interface TickResult {
  fired: boolean;
  turn?: number;
  message?: string;
  headline?: string;
  eventType?: string;
  important?: boolean;
  events?: WorldEvent[];
}

/** Accumulate real time and maybe fire one silent beat. */
export function tickBackgroundWorld(
  mgr: NemesisManager,
  settings: Settings,
  state: BackgroundTickState,
  dt: number,
  ctx: TickContext
): TickResult {
  if (!shouldBackgroundTick(settings, ctx)) return { fired: false };

  state.pitAbsenceTimer += dt;
  const threshold = settings.backgroundTickMinutes * 60;
  if (ctx.areaJustChanged) {
    state.pitAbsenceTimer = threshold;
  }
  if (state.pitAbsenceTimer < threshold) return { fired: false };

  const now = Date.now();
  if (now - state.lastTickAt < MIN_TICK_INTERVAL_MS) return { fired: false };

  state.pitAbsenceTimer = 0;
  state.lastTickAt = now;
  state.ticksThisSession++;

  const res = resolveOffscreenBeat(mgr, { silent: true, rng: 'world' });
  const events = res.events.length ? res.events : mgr.recentEvents(1);
  const lead = pickHeadlineEvent(events) ?? events.find((e) => e.important) ?? events[events.length - 1];
  return {
    fired: true,
    turn: res.turn,
    message: 'THE WORLD TURNED WITHOUT YOU',
    headline: lead?.text,
    eventType: lead?.type,
    important: lead?.important ?? false,
    events,
  };
}
