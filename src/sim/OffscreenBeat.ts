/**
 * Unified offscreen beat resolver — pit death, succession, and background ticks
 * all use the same god simulation engine in silent mode.
 */

import { RNG, mixSeed } from '../core/RNG';
import { simulateCycle, type CycleResult } from '../god/Autonomy';
import { actForCycle, effectiveAct } from '../god/Arc';
import { GodContext } from '../god/Context';
import { seedFactions } from '../god/Factions';
import { emptyGodState } from '../god/GodRun';
import { simOf, type ActDef, type GodState as GodStateType } from '../god/GodTypes';
import { rankIndex, fullName } from '../nemesis/Nemesis';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { makeEvent } from '../world/WorldEvent';
import { reconcileWorld } from './Reconcile';
import { trimEventLog } from './ChronicleArchive';
import { tickBiomes } from '../world/BiomeState';
import type { WorldEvent } from '../world/WorldEvent';

export interface OffscreenOptions {
  /** skip feed beats / UI hooks */
  silent: true;
  /** use mgr.simRng after advanceTurn — do not touch GodState.rngState */
  rng: 'world' | 'god';
  actOverride?: ActDef;
}

export interface OffscreenResult extends CycleResult {
  events: WorldEvent[];
  turn: number;
}

const EARLY_LETHALITY_CAP = 0.72;

function worldTurnAct(turn: number): ActDef {
  const base = actForCycle(Math.max(1, turn));
  const profile: ActDef = {
    ...base,
    name: 'OFFSCREEN',
    blurb: 'The world turns without a witness.',
  };
  if (turn < 8) profile.lethality = Math.min(profile.lethality, EARLY_LETHALITY_CAP);
  return profile;
}

/** Map world-turn bands to act pressure for pit/background beats. */
export function offscreenActFor(mgr: NemesisManager): ActDef {
  return worldTurnAct(mgr.turn);
}

/** @deprecated use offscreenActFor(mgr) */
export function actForWorldTurn(turn: number): ActDef {
  return worldTurnAct(turn);
}

function resolveAct(mgr: NemesisManager, opts: OffscreenOptions, god: GodStateType): ActDef {
  if (opts.actOverride) return opts.actOverride;
  if (opts.rng === 'god' && mgr.data.god) return effectiveAct(god);
  return offscreenActFor(mgr);
}

function buildEphemeralGod(mgr: NemesisManager, rng: RNG): GodStateType {
  const seed = mixSeed(mgr.data.worldSeed, mgr.turn * 31337) >>> 0;
  const god = emptyGodState(seed, 0);
  seedFactions(god, mgr, rng);
  return god;
}

function resolveGod(mgr: NemesisManager, opts: OffscreenOptions): { god: GodStateType; ephemeral: boolean; rng: RNG } {
  const persisted = mgr.data.god;
  if (persisted && opts.rng === 'god') {
    return { god: persisted, ephemeral: false, rng: new RNG(persisted.rngState) };
  }
  const rng = opts.rng === 'world' ? mgr.simRng : new RNG(mixSeed(mgr.data.worldSeed, mgr.turn));
  return { god: buildEphemeralGod(mgr, rng), ephemeral: true, rng };
}

/** Run one silent world beat through the god engine. */
export function resolveOffscreenBeat(mgr: NemesisManager, opts: OffscreenOptions): OffscreenResult {
  const mods = mgr.data.territoryMods ?? {};
  for (const id of Object.keys(mods)) {
    if (mods[id].untilTurn < mgr.turn) delete mods[id];
  }
  mgr.data.territoryMods = mods;

  const { god, ephemeral, rng } = resolveGod(mgr, opts);
  const act = resolveAct(mgr, opts, god);
  const ctx = new GodContext(mgr, god, rng, mgr.mods, act);
  ctx.silent = opts.silent;

  const result = simulateCycle(ctx);
  tickBiomes(mgr, mgr.turn);
  const events = mgr.recentEvents(1);
  mgr.advanceTurn();
  reconcileWorld(mgr);
  trimEventLog(mgr);

  if (!ephemeral && opts.rng === 'god') {
    god.rngState = rng.state;
  }

  mgr.persist();

  return { ...result, events, turn: mgr.turn };
}

/** Convenience wrapper matching old simulateTurn signature. */
export function simulateOffscreenTurn(mgr: NemesisManager, rounds = 1): OffscreenResult {
  let last: OffscreenResult = { cycle: 0, deaths: [], decisions: [], fights: 0, skirmishes: 0, blessedLosers: [], events: [], turn: mgr.turn };
  for (let i = 0; i < rounds; i++) {
    last = resolveOffscreenBeat(mgr, { silent: true, rng: 'world' });
  }
  return last;
}

/** @deprecated use simulateOffscreenTurn */
export const simulateTurn = simulateOffscreenTurn;

/**
 * A larger upheaval after the Overlord falls — several scrambling turns.
 */
export function simulateSuccession(mgr: NemesisManager): WorldEvent[] {
  const events: WorldEvent[] = [];
  mgr.suppressOverlordReturnsUntilTurn = mgr.turn + 3;
  events.push(
    mgr.log(
      makeEvent(mgr.turn, mgr.age, 'succession', 'The seat is empty. Everyone can see it.', [], true, 'gold')
    )
  );
  const rounds = 2 + Math.floor(mgr.simRng.next() * 2);
  for (let i = 0; i < rounds; i++) {
    const res = simulateOffscreenTurn(mgr);
    events.push(...res.events);
  }
  const ov = mgr.overlord();
  if (ov) {
    events.push(
      mgr.log(
        makeEvent(mgr.turn, mgr.age, 'succession', `${fullName(ov)} sits in it now.`, [ov.id], true, 'gold')
      )
    );
  }
  return events;
}

/** Seed sim dimensions from pit history when starting a god run. */
export function seedSimFromPitHistory(mgr: NemesisManager): void {
  const log = mgr.data.eventLog;
  for (const n of mgr.living()) {
    const s = simOf(n);
    const touched = n.killsAgainstPlayer + n.defeatsByPlayer + n.escapedPlayer + (n.metPlayer ? 1 : 0);
    if (touched === 0 && !n.memory.some((m) => m.type.includes('PLAYER'))) continue;
    if (s.lastCycle > 0 || s.reputation > 5) continue;

    s.confidence = Math.min(100, 45 + n.killsAgainstPlayer * 8 - n.defeatsByPlayer * 6);
    s.fear = Math.min(100, 10 + n.defeatsByPlayer * 10);
    s.injury = Math.min(100, n.scars.length * 12);
    s.reputation = Math.min(200, n.killsAgainstPlayer * 15 + rankIndex(n.rank) * 8);

    for (const m of n.memory) {
      if (m.type === 'I_KILLED_PLAYER') s.confidence = Math.min(100, s.confidence + 15);
      if (m.type === 'PLAYER_KILLED_ME') s.goal = 'revenge';
      if (m.type === 'I_ESCAPED_PLAYER') s.flights++;
    }

    for (const ev of log) {
      if (!ev.actors.includes(n.id)) continue;
      if (ev.type === 'player_kill' && ev.actors[0] === n.id) s.kills.push('player');
      if (ev.type === 'betrayal' && ev.actors.includes(n.id)) s.ambition = Math.min(100, s.ambition + 10);
      if (ev.type === 'weapon_theft' && ev.actors[0] === n.id) s.reputation = Math.min(200, s.reputation + 12);
    }

    const rival = n.rivalries[0];
    if (rival && s.goal === 'survive') {
      s.goal = 'revenge';
      s.goalTargetId = rival;
    }
  }
}
