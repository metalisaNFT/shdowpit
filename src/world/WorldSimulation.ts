/**
 * The offscreen world.
 *
 * When the player dies (or kills the Overlord) the world takes a turn without
 * them: duels are fought, people are promoted, allies are betrayed, and some
 * of the dead decide they are not finished. This is where most of the game's
 * stories are actually written.
 *
 * Determinism: every roll comes off the manager's seeded turn RNG, so the same
 * save advanced from the same state produces the same history.
 */

import type { RNG } from '../core/RNG';
import { getPersonality } from '../data/personalities';
import { traitsOfKind } from '../data/traits';
import { AREAS } from '../data/areas';
import { AREA_NAMES, chooseTitle } from '../data/names';
import { makeEvent, type WorldEvent } from './WorldEvent';
import type { Nemesis, ScarId } from '../nemesis/Nemesis';
import { fullName, rankIndex } from '../nemesis/Nemesis';
import { NemesisManager } from '../nemesis/NemesisManager';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar, remember, recomputeRevenge } from '../nemesis/NemesisMemory';
import { breakBond, makeAllies, makeRivals, setMaster } from '../nemesis/NemesisRelationships';

const SCARS: ScarId[] = [
  'burn',
  'missing_eye',
  'broken_mask',
  'metal_jaw',
  'damaged_arm',
  'cracked_armor',
  'corruption',
  'shattered_horn',
];

interface Action {
  weight: number;
  run: () => WorldEvent | WorldEvent[] | null;
}

export interface SimulationResult {
  events: WorldEvent[];
  turn: number;
}

/**
 * Advance the world one turn. `eventCount` controls how eventful the gap was —
 * more turns pass in one go after an Overlord dies.
 */
export function simulateTurn(mgr: NemesisManager, eventCount = 0): SimulationResult {
  mgr.advanceTurn();
  const rng = mgr.simRng;
  const events: WorldEvent[] = [];
  const mods = mgr.data.territoryMods ?? {};
  for (const id of Object.keys(mods)) {
    if (mods[id].untilTurn < mgr.turn) delete mods[id];
  }
  mgr.data.territoryMods = mods;

  const n = eventCount || 3 + Math.floor(rng.next() * 4);

  // 1. The dead get their chance first.
  events.push(...rollResurrections(mgr, rng));

  // 2. Then the living make trouble.
  for (let i = 0; i < n; i++) {
    const actions = buildActions(mgr, rng);
    if (!actions.length) break;
    const total = actions.reduce((s, a) => s + a.weight, 0);
    if (total <= 0) break;
    let r = rng.next() * total;
    let chosen = actions[actions.length - 1];
    for (const a of actions) {
      r -= a.weight;
      if (r <= 0) {
        chosen = a;
        break;
      }
    }
    const out = chosen.run();
    if (Array.isArray(out)) events.push(...out);
    else if (out) events.push(out);
  }

  // 3. Reconcile the hierarchy after all that violence.
  events.push(...mgr.fillRanks());
  mgr.pruneDead();
  for (const nem of mgr.roster) recomputePower(nem);
  mgr.persist();

  return { events, turn: mgr.turn };
}

/* ============================================================
   resurrections
   ============================================================ */

function rollResurrections(mgr: NemesisManager, rng: RNG): WorldEvent[] {
  const out: WorldEvent[] = [];
  const base = mgr.mods.resurrection;
  for (const n of mgr.dead()) {
    const since = mgr.turn - (n.diedOnTurn ?? mgr.turn);
    // A return has to feel like an event, not a mechanic: they stay buried for
    // a couple of turns, only the ones with a reason come back, and never more
    // than one per turn.
    if (since < 2) continue;
    const p = getPersonality(n.personality);
    let chance = base * 0.16;
    chance += n.revengeChance * 0.16;
    chance *= p.survival;
    if (n.personality === 'survivor') chance += 0.05;
    if (n.returns >= 1) chance *= 0.4;
    chance = Math.min(chance, 0.22);
    if (!rng.chance(chance)) continue;

    const scar = rng.pick(SCARS);
    const label = applyScar(n, scar, mgr.turn, 'death');
    // A returned enemy always comes back with something new.
    const pool = traitsOfKind(rng.chance(0.35) ? 'mutation' : 'strength').filter(
      (t) => !n.strengths.includes(t.id)
    );
    if (pool.length && n.strengths.length < 5) n.strengths.push(rng.pick(pool).id);
    out.push(mgr.resurrect(n, label));
    break; // at most one per turn
  }
  return out;
}

/* ============================================================
   action table
   ============================================================ */

function buildActions(mgr: NemesisManager, rng: RNG): Action[] {
  const alive = mgr.living();
  if (alive.length < 2) return [];
  const actions: Action[] = [];

  const pickTwo = (): [Nemesis, Nemesis] | null => {
    if (alive.length < 2) return null;
    const a = rng.pick(alive);
    let b = rng.pick(alive);
    let guard = 0;
    while (b.id === a.id && guard++ < 8) b = rng.pick(alive);
    if (b.id === a.id) return null;
    return [a, b];
  };

  /* ---- duel: the workhorse ---- */
  actions.push({
    weight: 5,
    run: () => {
      const pair = pickTwo();
      if (!pair) return null;
      let [a, b] = pair;
      // Rivals fight far more often than strangers.
      const rivalsOf = alive.filter((x) => x.rivalries.some((id) => mgr.byId(id)?.alive));
      if (rivalsOf.length && rng.chance(0.55)) {
        a = rng.pick(rivalsOf);
        const target = a.rivalries.map((id) => mgr.byId(id)).filter((x): x is Nemesis => !!x && x.alive);
        if (target.length) b = rng.pick(target);
      }
      if (a.id === b.id) return null;
      return resolveDuel(mgr, rng, a, b, 'duel');
    },
  });

  /* ---- challenge upward (ambition) ---- */
  const climbers = alive.filter((n) => rankIndex(n.rank) < 4 && getPersonality(n.personality).ambition > 1);
  if (climbers.length) {
    actions.push({
      weight: 4,
      run: () => {
        const a = rng.pick(climbers);
        const above = alive.filter((x) => rankIndex(x.rank) === rankIndex(a.rank) + 1);
        if (!above.length) return null;
        const b = rng.pick(above);
        const evs = resolveDuel(mgr, rng, a, b, 'challenge');
        return evs;
      },
    });
  }

  /* ---- betrayal ---- */
  const betrayers = alive.filter(
    (n) => getPersonality(n.personality).betray > 0.8 && (n.master || n.allies.length > 0)
  );
  if (betrayers.length) {
    actions.push({
      weight: 2.6,
      run: () => {
        const a = rng.pick(betrayers);
        const targetId = a.master ?? rng.pick(a.allies);
        const b = mgr.byId(targetId);
        if (!b || !b.alive) return null;
        breakBond(a, b);
        makeRivals(a, b);
        remember(a, 'I_BETRAYED_ALLY', mgr.turn, b.id);
        remember(b, 'I_WAS_BETRAYED', mgr.turn, a.id);
        const ev = mgr.log(
          makeEvent(
            mgr.turn,
            mgr.age,
            'betrayal',
            `${fullName(a)} turned on ${fullName(b)}.`,
            [a.id, b.id],
            true,
            'bad'
          )
        );
        // A betrayal usually comes with a knife.
        const follow = resolveDuel(mgr, rng, a, b, 'betrayal');
        return [ev, ...follow];
      },
    });
  }

  /* ---- alliance ---- */
  actions.push({
    weight: 2,
    run: () => {
      const pair = pickTwo();
      if (!pair) return null;
      const [a, b] = pair;
      if (a.rivalries.includes(b.id)) return null;
      const pa = getPersonality(a.personality);
      if (!rng.chance(Math.min(0.9, pa.ally * 0.4))) return null;
      if (!makeAllies(a, b)) return null;
      if (rankIndex(b.rank) > rankIndex(a.rank) && a.personality === 'loyalist') setMaster(a, b);
      return mgr.log(
        makeEvent(mgr.turn, mgr.age, 'alliance', `${fullName(a)} swore to ${fullName(b)}.`, [a.id, b.id])
      );
    },
  });

  /* ---- assassination (opportunists and traitors, on the weak) ---- */
  const assassins = alive.filter((n) => ['opportunist', 'traitor', 'avenger'].includes(n.personality));
  if (assassins.length) {
    actions.push({
      weight: 2.2,
      run: () => {
        const a = rng.pick(assassins);
        const weak = alive
          .filter((x) => x.id !== a.id && x.power < a.power * 0.9)
          .sort((x, y) => x.power - y.power);
        if (!weak.length) return null;
        const b = weak[Math.min(weak.length - 1, rng.int(0, 2))];
        if (!rng.chance(0.55)) {
          return mgr.log(
            makeEvent(
              mgr.turn,
              mgr.age,
              'assassination',
              `${fullName(a)} tried to have ${fullName(b)} killed and failed.`,
              [a.id, b.id],
              false,
              'bad'
            )
          );
        }
        const evs: WorldEvent[] = [];
        evs.push(
          mgr.log(
            makeEvent(
              mgr.turn,
              mgr.age,
              'assassination',
              `${fullName(a)} had ${fullName(b)} killed in the dark.`,
              [a.id, b.id],
              true,
              'bad'
            )
          )
        );
        evs.push(...killOff(mgr, rng, b, a));
        a.level++;
        remember(a, 'I_DEFEATED_RIVAL', mgr.turn, b.id);
        recomputePower(a);
        return evs;
      },
    });
  }

  /* ---- territory ---- */
  actions.push({
    weight: 2.4,
    run: () => {
      const a = rng.pick(alive);
      if (rankIndex(a.rank) < 1) return null;
      const area = rng.pick(AREAS);
      if (area.id === 'fortress' && a.rank !== 'overlord') {
        // Only warlords and up dare.
        if (rankIndex(a.rank) < 3) return null;
      }
      const holder = mgr.territoryHolder(area.id);
      if (holder && holder.id === a.id) return null;
      if (holder && holder.alive) {
        if (holder.power > a.power * 1.15) {
          return mgr.log(
            makeEvent(
              mgr.turn,
              mgr.age,
              'territory',
              `${fullName(a)} was driven out of ${AREA_NAMES[area.id]} by ${fullName(holder)}.`,
              [a.id, holder.id]
            )
          );
        }
        makeRivals(a, holder);
      }
      mgr.data.territories[area.id] = a.id;
      a.territory = area.id;
      a.level++;
      recomputePower(a);
      return mgr.log(
        makeEvent(mgr.turn, mgr.age, 'territory', `${fullName(a)} seized ${AREA_NAMES[area.id]}.`, [a.id], true, 'gold', {
          payload: { areaId: area.id },
        })
      );
    },
  });

  /* ---- injury / accident ---- */
  actions.push({
    weight: 1.6,
    run: () => {
      const a = rng.pick(alive);
      const scar = rng.pick(SCARS);
      const label = applyScar(a, scar, mgr.turn, 'a bad night');
      if (!label) return null;
      a.title = chooseTitle(a, mgr.titlesInUse(a));
      recomputePower(a);
      return mgr.log(
        makeEvent(mgr.turn, mgr.age, 'injury', `${fullName(a)} came away with ${label.toLowerCase()}.`, [a.id])
      );
    },
  });

  /* ---- mutation (plague-flavoured ages) ---- */
  if (mgr.mods.mutation > 0.05) {
    actions.push({
      weight: mgr.mods.mutation * 4,
      run: () => {
        const a = rng.pick(alive);
        const pool = traitsOfKind('mutation').filter((t) => !a.strengths.includes(t.id));
        if (!pool.length || a.strengths.length >= 5) return null;
        const t = rng.pick(pool);
        a.strengths.push(t.id);
        recomputePower(a);
        return mgr.log(
          makeEvent(mgr.turn, mgr.age, 'mutation', `Something changed in ${fullName(a)}. ${t.name}.`, [a.id], true, 'bad')
        );
      },
    });
  }

  /* ---- weapon theft (including recovering the player's loot) ---- */
  const holders = alive.filter((n) => n.stolen.length > 0);
  if (holders.length) {
    actions.push({
      weight: 2,
      run: () => {
        const victim = rng.pick(holders);
        const thieves = alive.filter((n) => n.id !== victim.id && getPersonality(n.personality).steal > 1);
        if (!thieves.length) return null;
        const thief = rng.pick(thieves);
        const item = victim.stolen.pop();
        if (!item) return null;
        thief.stolen.push(item);
        makeRivals(thief, victim);
        thief.title = chooseTitle(thief, mgr.titlesInUse(thief));
        recomputePower(thief);
        recomputePower(victim);
        return mgr.log(
          makeEvent(
            mgr.turn,
            mgr.age,
            'weapon_theft',
            `${fullName(thief)} took ${item.name} from ${fullName(victim)}.`,
            [thief.id, victim.id],
            true,
            'gold',
            { payload: { itemName: item.name, itemKind: item.kind, weaponId: item.weaponId } }
          )
        );
      },
    });
  }

  /* ---- revenge against the player's killers is handled in-run, but rivals
          nurse grudges here ---- */
  actions.push({
    weight: 1.2,
    run: () => {
      const pair = pickTwo();
      if (!pair) return null;
      const [a, b] = pair;
      if (a.rivalries.includes(b.id)) return null;
      if (!rng.chance(getPersonality(a.personality).challenge * 0.3)) return null;
      makeRivals(a, b);
      return mgr.log(
        makeEvent(mgr.turn, mgr.age, 'revenge', `${fullName(a)} named ${fullName(b)} an enemy.`, [a.id, b.id])
      );
    },
  });

  /* ---- recruitment ---- */
  if (alive.length < 18) {
    actions.push({
      weight: 1.1,
      run: () => {
        const n = mgr.recruit('elite', false);
        return mgr.log(
          makeEvent(mgr.turn, mgr.age, 'recruitment', `${fullName(n)} came up out of the rabble.`, [n.id])
        );
      },
    });
  }

  return actions;
}

/* ============================================================
   duel resolution
   ============================================================ */

function resolveDuel(
  mgr: NemesisManager,
  rng: RNG,
  a: Nemesis,
  b: Nemesis,
  kind: 'duel' | 'challenge' | 'betrayal'
): WorldEvent[] {
  const events: WorldEvent[] = [];
  const pa = getPersonality(a.personality);
  const pb = getPersonality(b.personality);

  // Score = power, tilted by aggression, grudges and pure luck.
  const scoreA = a.power * (0.75 + pa.aggression * 0.5) * (1 + rng.range(-0.5, 0.5)) * (kind === 'betrayal' ? 1.35 : 1);
  const scoreB = b.power * (0.75 + pb.aggression * 0.5) * (1 + rng.range(-0.5, 0.5));

  const winner = scoreA >= scoreB ? a : b;
  const loser = winner === a ? b : a;
  const margin = Math.abs(scoreA - scoreB) / Math.max(1, Math.max(scoreA, scoreB));

  makeRivals(winner, loser);
  remember(winner, 'I_DEFEATED_RIVAL', mgr.turn, loser.id);
  remember(loser, 'RIVAL_DEFEATED_ME', mgr.turn, winner.id);

  const verb = kind === 'challenge' ? 'challenged and beat' : kind === 'betrayal' ? 'cut down' : 'defeated';
  events.push(
    mgr.log(
      makeEvent(
        mgr.turn,
        mgr.age,
        'duel',
        `${fullName(winner)} ${verb} ${fullName(loser)}.`,
        [winner.id, loser.id],
        rankIndex(winner.rank) >= 2 || rankIndex(loser.rank) >= 2
      )
    )
  );

  winner.level = Math.min(30, winner.level + 1);
  recomputePower(winner);

  // A convincing win over someone above you is how you climb — and the person
  // you beat has to actually make room, or the hierarchy would never move.
  if (rankIndex(loser.rank) > rankIndex(winner.rank) && margin > 0.16) {
    const takenRank = loser.rank;
    events.push(mgr.demote(loser, `${fullName(winner)} took their place`));
    events.push(mgr.promote(winner, takenRank));
  } else if (kind === 'challenge' && rng.chance(0.4)) {
    events.push(mgr.promote(winner));
  } else if (rng.chance(0.22 + margin * 0.3)) {
    events.push(mgr.promote(winner));
  }

  // What happens to the loser?
  const survivalRoll = rng.next() * getPersonality(loser.personality).survival;
  const lethal = margin > 0.4 || kind === 'betrayal';
  if (lethal && survivalRoll < 0.55) {
    events.push(...killOff(mgr, rng, loser, winner));
  } else if (rng.chance(0.5)) {
    const scar = rng.pick(SCARS);
    const label = applyScar(loser, scar, mgr.turn, fullName(winner));
    if (label) {
      loser.title = chooseTitle(loser, mgr.titlesInUse(loser));
      events.push(
        mgr.log(
          makeEvent(mgr.turn, mgr.age, 'injury', `${fullName(loser)} kept ${label.toLowerCase()} from it.`, [loser.id])
        )
      );
    }
    if (rng.chance(0.4) && rankIndex(loser.rank) > 0) events.push(mgr.demote(loser));
  } else if (rng.chance(0.35) && rankIndex(loser.rank) > 0) {
    events.push(mgr.demote(loser));
  }

  recomputeRevenge(loser);
  recomputePower(loser);
  return events;
}

/** Kill someone off, moving their loot and their grudges around. */
function killOff(mgr: NemesisManager, rng: RNG, victim: Nemesis, killer: Nemesis | null): WorldEvent[] {
  const events: WorldEvent[] = [];

  // Loot changes hands. This is how the player's stolen weapon keeps moving.
  if (victim.stolen.length && killer) {
    const item = victim.stolen.pop()!;
    killer.stolen.push(item);
    events.push(
      mgr.log(
        makeEvent(
          mgr.turn,
          mgr.age,
          'weapon_theft',
          `${fullName(killer)} took ${item.name} off the body.`,
          [killer.id, victim.id],
          true,
          'gold'
        )
      )
    );
  }

  events.push(
    mgr.killNemesis(
      victim,
      false,
      killer ? `${fullName(killer)} killed ${fullName(victim)}.` : `${fullName(victim)} died.`
    )
  );

  // Avengers step forward.
  for (const aid of victim.allies) {
    const ally = mgr.byId(aid);
    if (!ally || !ally.alive || !killer) continue;
    if (getPersonality(ally.personality).revenge > 1.4 || rng.chance(0.3)) {
      makeRivals(ally, killer);
      events.push(
        mgr.log(
          makeEvent(
            mgr.turn,
            mgr.age,
            'revenge',
            `${fullName(ally)} swore to answer for ${fullName(victim)}.`,
            [ally.id, killer.id],
            false,
            'bad'
          )
        )
      );
    }
  }
  return events;
}

/**
 * A larger upheaval: run after the Overlord falls. Several turns of scrambling
 * for the empty seat.
 */
export function simulateSuccession(mgr: NemesisManager): WorldEvent[] {
  const events: WorldEvent[] = [];
  events.push(
    mgr.log(
      makeEvent(mgr.turn, mgr.age, 'succession', 'The seat is empty. Everyone can see it.', [], true, 'gold')
    )
  );
  const rounds = 2 + Math.floor(mgr.simRng.next() * 2);
  for (let i = 0; i < rounds; i++) {
    const res = simulateTurn(mgr, 4);
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
