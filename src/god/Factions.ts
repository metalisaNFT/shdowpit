/**
 * Houses.
 *
 * The roster already had a hierarchy and territories; what it did not have was
 * anything for two groups to disagree about. A faction is thin on purpose: a
 * leader, members, ground, and a stability number that erodes when the world
 * goes badly for it. When stability reaches zero the house comes apart and its
 * people scatter — which is usually the most interesting thing that can happen
 * to it.
 */

import type { RNG } from '../core/RNG';
import { AREA_NAMES } from '../data/names';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import type { Faction, GodState } from './GodTypes';
import { simOf } from './GodTypes';

const HOUSE_A = ['ASH', 'IRON', 'BLACK', 'PALE', 'SPLIT', 'LOW', 'RED', 'HOLLOW', 'STILL', 'BROKEN', 'LAST'];
const HOUSE_B = ['CROWN', 'THROAT', 'GATE', 'HAND', 'BANNER', 'CHOIR', 'YOKE', 'TEETH', 'MARCH', 'KENNEL', 'VIGIL'];
const HOUSE_COLOURS = [0xc4ff2e, 0xa14cff, 0x2ff2ff, 0xff2f9c, 0xe4ff2b, 0x76ff35];

export function houseName(rng: RNG, taken: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const n = `THE ${rng.pick(HOUSE_A)} ${rng.pick(HOUSE_B)}`;
    if (!taken.has(n)) return n;
  }
  return `THE ${rng.pick(HOUSE_A)} ${rng.pick(HOUSE_B)} ${taken.size}`;
}

/**
 * Build the houses a run starts with, out of whoever is actually at the top.
 * The Overlord always has one; every warlord gets one; anyone else falls in
 * behind whoever they already serve, or whoever holds the ground they live on.
 */
export function seedFactions(god: GodState, mgr: NemesisManager, rng: RNG): Faction[] {
  god.factions = [];
  god.nextFactionId = 1;
  const taken = new Set<string>();

  const leaders: Nemesis[] = [];
  const ov = mgr.overlord();
  if (ov) leaders.push(ov);
  for (const w of mgr.ofRank('warlord')) leaders.push(w);
  // A world with nothing but captains still needs two sides.
  if (leaders.length < 2) {
    for (const c of mgr.ofRank('captain').sort((a, b) => b.power - a.power).slice(0, 2 - leaders.length)) {
      leaders.push(c);
    }
  }

  for (const leader of leaders) {
    const f: Faction = {
      id: 'f' + god.nextFactionId.toString(36),
      name: houseName(rng, taken),
      colour: HOUSE_COLOURS[god.nextFactionId % HOUSE_COLOURS.length],
      leaderId: leader.id,
      memberIds: [leader.id],
      territories: [],
      strength: leader.power,
      stability: 70 + rng.int(0, 20),
      aggression: 35 + rng.int(0, 40),
      warWith: [],
      bornCycle: god.cycle,
      destroyedCycle: null,
    };
    god.nextFactionId++;
    taken.add(f.name);
    god.factions.push(f);
    simOf(leader).factionId = f.id;
  }

  for (const n of mgr.living()) {
    const s = simOf(n);
    if (s.factionId) continue;
    let f: Faction | null = null;
    const master = mgr.byId(n.master);
    if (master) f = factionOf(god, simOf(master).factionId);
    if (!f) {
      const holder = mgr.territoryHolder(n.territory);
      if (holder) f = factionOf(god, simOf(holder).factionId);
    }
    if (!f) f = god.factions[rng.int(0, god.factions.length - 1)] ?? null;
    if (!f) continue;
    s.factionId = f.id;
    f.memberIds.push(n.id);
  }

  // Two houses that share a border and a temperament will find a reason.
  if (god.factions.length >= 2 && rng.chance(0.55)) {
    const a = god.factions[0];
    const b = god.factions[1];
    a.warWith.push(b.id);
    b.warWith.push(a.id);
  }

  reconcileFactions(god, mgr);
  return god.factions;
}

export function factionOf(god: GodState, id: string | null | undefined): Faction | null {
  if (!id) return null;
  return god.factions.find((f) => f.id === id && !f.destroyedCycle) ?? null;
}

export function factionFor(god: GodState, n: Nemesis | null | undefined): Faction | null {
  if (!n) return null;
  return factionOf(god, simOf(n).factionId);
}

export function sameFaction(a: Nemesis, b: Nemesis): boolean {
  const fa = simOf(a).factionId;
  return !!fa && fa === simOf(b).factionId;
}

export function atWar(god: GodState, a: Nemesis, b: Nemesis): boolean {
  const fa = factionFor(god, a);
  const fb = factionFor(god, b);
  if (!fa || !fb || fa.id === fb.id) return false;
  return fa.warWith.includes(fb.id);
}

/**
 * Recompute membership, ground and strength from the roster, then find the
 * houses that no longer hold together.
 */
export function reconcileFactions(god: GodState, mgr: NemesisManager): string[] {
  const notes: string[] = [];
  const alive = new Set(mgr.living().map((n) => n.id));

  for (const f of god.factions) {
    if (f.destroyedCycle) continue;
    f.memberIds = f.memberIds.filter((id) => alive.has(id));
    f.strength = 0;
    for (const id of f.memberIds) {
      const n = mgr.byId(id);
      if (n) f.strength += n.power;
    }
    f.territories = [];

    // A leaderless house promotes its strongest, or comes apart.
    const leader = mgr.byId(f.leaderId);
    if (!leader || !leader.alive) {
      const heir = f.memberIds
        .map((id) => mgr.byId(id))
        .filter((n): n is Nemesis => !!n && n.alive)
        .sort((a, b) => b.power - a.power)[0];
      if (heir) {
        f.leaderId = heir.id;
        f.stability -= 22;
        notes.push(`${fullName(heir)} took ${f.name}.`);
      } else {
        f.leaderId = null;
        f.stability = 0;
      }
    }
  }

  for (const areaId of Object.keys(mgr.data.territories)) {
    const holder = mgr.territoryHolder(areaId);
    const f = factionFor(god, holder);
    if (f) f.territories.push(areaId);
  }

  for (const f of god.factions) {
    if (f.destroyedCycle) continue;
    f.stability = Math.max(0, Math.min(100, f.stability));
    if (f.stability <= 0 || f.memberIds.length === 0) {
      f.destroyedCycle = god.cycle;
      for (const id of f.memberIds) {
        const n = mgr.byId(id);
        if (n) simOf(n).factionId = null;
      }
      for (const other of god.factions) {
        other.warWith = other.warWith.filter((x) => x !== f.id);
      }
      notes.push(`${f.name} came apart.`);
    }
  }

  return notes;
}

export function shakeFaction(god: GodState, id: string | null | undefined, amount: number): void {
  const f = factionOf(god, id);
  if (!f) return;
  f.stability = Math.max(0, Math.min(100, f.stability + amount));
}

export function declareWar(a: Faction, b: Faction): boolean {
  if (a.id === b.id || a.warWith.includes(b.id)) return false;
  a.warWith.push(b.id);
  b.warWith.push(a.id);
  a.aggression = Math.min(100, a.aggression + 12);
  b.aggression = Math.min(100, b.aggression + 12);
  return true;
}

/**
 * Stability is not a one-way ratchet. A house that is not at war and still has
 * its leader knits itself back together — otherwise every world eventually
 * arrives at nobody being sworn to anybody, which is a flatter, duller place.
 */
export function settleFactions(god: GodState, mgr: NemesisManager): void {
  for (const f of god.factions) {
    if (f.destroyedCycle) continue;
    const leader = mgr.byId(f.leaderId);
    if (!leader || !leader.alive) continue;
    const calm = f.warWith.length === 0;
    f.stability = Math.min(100, f.stability + (calm ? 3.2 : 0.8) + f.territories.length * 0.6);
  }
}

/**
 * When the last house falls, somebody gathers people around them again. Power
 * organises; it always has. Returns a line for the feed when it happens.
 */
export function reformHouses(god: GodState, mgr: NemesisManager, rng: RNG, cycle: number): string | null {
  if (livingFactions(god).length >= 2) return null;
  const unsworn = mgr
    .living()
    .filter((n) => !factionOf(god, simOf(n).factionId))
    .sort((a, b) => b.power - a.power);
  if (unsworn.length < 4) return null;

  const leader = unsworn[0];
  const taken = new Set(god.factions.map((f) => f.name));
  const f: Faction = {
    id: 'f' + god.nextFactionId.toString(36),
    name: houseName(rng, taken),
    colour: HOUSE_COLOURS[god.nextFactionId % HOUSE_COLOURS.length],
    leaderId: leader.id,
    memberIds: [leader.id],
    territories: [],
    strength: leader.power,
    stability: 55 + rng.int(0, 20),
    aggression: 40 + rng.int(0, 30),
    warWith: [],
    bornCycle: cycle,
    destroyedCycle: null,
  };
  god.nextFactionId++;
  god.factions.push(f);
  simOf(leader).factionId = f.id;

  // Everyone nearby who has nobody else falls in behind them.
  for (const n of unsworn.slice(1)) {
    if (f.memberIds.length >= 5) break;
    if (n.territory !== leader.territory && !rng.chance(0.4)) continue;
    simOf(n).factionId = f.id;
    f.memberIds.push(n.id);
  }
  return `${fullName(leader)} gathered what was left into ${f.name}.`;
}

export function livingFactions(god: GodState): Faction[] {
  return god.factions.filter((f) => !f.destroyedCycle && f.memberIds.length > 0);
}

/** The house that is winning, for the board and the crisis. */
export function dominantFaction(god: GodState): Faction | null {
  const live = livingFactions(god);
  if (!live.length) return null;
  return live.slice().sort((a, b) => b.strength + b.territories.length * 40 - (a.strength + a.territories.length * 40))[0];
}

export function describeFaction(mgr: NemesisManager, f: Faction): string {
  const leader = mgr.byId(f.leaderId);
  const ground = f.territories.map((t) => AREA_NAMES[t] ?? t.toUpperCase()).join(', ');
  const parts = [`${f.memberIds.length} SWORN`];
  if (leader) parts.push(`UNDER ${fullName(leader)}`);
  if (ground) parts.push(ground);
  if (f.warWith.length) parts.push('AT WAR');
  if (f.stability < 30) parts.push('FRACTURING');
  return parts.join(' · ');
}

/** Sworn strength above a rank, used by the crisis and the board. */
export function seniorMembers(mgr: NemesisManager, f: Faction, minRank = 2): Nemesis[] {
  return f.memberIds
    .map((id) => mgr.byId(id))
    .filter((n): n is Nemesis => !!n && n.alive && rankIndex(n.rank) >= minRank);
}
