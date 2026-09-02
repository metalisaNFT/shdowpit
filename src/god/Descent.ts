/**
 * DESCEND, as the board sees it.
 *
 * The third-person run is the one time the god is in the room. Before this
 * file existed, what happened down there reached the simulation as a
 * snapshot diff in Game.ts — alive or not, power up or down — and the world
 * moved two cycles the same way whether you had killed the warlord or died
 * on the stairs. That is a time skip, not an intervention.
 *
 * Now the return is a world event. A kill in person is a legendary beat that
 * shakes a house, gives the dead's allies a name to hate (yours), and is
 * remembered by everyone who saw it. A death in person is the world learning
 * the god can bleed. Sparing somebody is remembered as mercy from something
 * enormous, which is not the same as being liked.
 *
 * Everything here goes through GodContext so it lands in the feed, the
 * chronicle, memory and faction stability the way any other consequence does.
 */

import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { remember } from '../nemesis/NemesisMemory';
import { removeConditions } from './Conditions';
import type { GodContext } from './Context';
import { factionFor, shakeFaction } from './Factions';
import { simOf, type Beat, type DescentBrief, type DescentReport } from './GodTypes';

export interface DescentSnapshot {
  alive: boolean;
  power: number;
  territory: string;
  scars: number;
  injury: number;
  stolen: number;
  holder: string | null;
}

export interface DescentFacts {
  nemesisId: string;
  brief: DescentBrief;
  snapshot: DescentSnapshot;
  playerDied: boolean;
  extracted: boolean;
  /** who killed the player, when somebody did */
  killerId?: string | null;
}

/**
 * Write the consequences of what the player did below. Called BEFORE the
 * cycles-while-gone run, so the world reacts to it during those cycles.
 * Returns the outcome the report will carry.
 */
export function applyDescentOutcome(ctx: GodContext, facts: DescentFacts): DescentReport['outcome'] {
  const target = ctx.mgr.byId(facts.nemesisId);
  const name = target ? fullName(target) : 'the one you went for';

  if (facts.playerDied) {
    const killer = ctx.mgr.byId(facts.killerId);
    if (killer && killer.alive) {
      const ks = simOf(killer);
      ks.confidence = 100;
      ks.reputation = Math.min(200, ks.reputation + 40);
      ks.ambition = Math.min(100, ks.ambition + 20);
      ctx.deed(killer, 'put the god on the ground', 7);
      // Everyone saw something enormous fall. Fear of it drops; fear of the
      // one who did it rises.
      for (const n of ctx.living()) {
        if (n.id === killer.id) continue;
        const s = simOf(n);
        s.fear = Math.min(100, s.fear + (n.allies.includes(killer.id) ? 0 : 6));
        if (n.playerRelationship > 0) n.playerRelationship = Math.max(0, n.playerRelationship - 10);
      }
      ctx.emit(
        'descent',
        'legendary',
        `${fullName(killer)} PUT YOU ON THE GROUND.`,
        [
          'The world saw the thing that has been arranging it bleed.',
          `${fullName(killer)} will be talked about for this for the rest of the run.`,
          'Whatever you had half-arranged is still half-arranged.',
        ],
        [killer.id],
        'bad'
      );
      ctx.chronicle('player_death', `${fullName(killer)} killed the god below.`, [killer.id], true, 'bad');
    } else {
      ctx.emit('descent', 'major', 'YOU DIED BELOW.', ['Nobody in particular gets the credit. The world moves on without you for a while.'], [], 'bad');
    }
    return 'player_died';
  }

  if (facts.extracted) {
    if (target && target.alive) {
      remember(target, 'GOD_CAME_FOR_ME', ctx.mgr.turn);
      const s = simOf(target);
      s.confidence = Math.min(100, s.confidence + 10);
      ctx.deed(target, 'watched the god turn back', 3);
      ctx.emit('descent', 'major', `YOU LEFT ${name.toUpperCase()} STANDING.`, [`${name} knows something came for them and did not finish.`, 'That is a story they will tell.'], [target.id], 'neutral');
    } else {
      ctx.emit('descent', 'notable', 'YOU CAME BACK UP.', ['Nothing below was settled.'], []);
    }
    return 'escaped';
  }

  if (target && !target.alive) {
    // A kill in person. The world does not get to wonder who did it.
    removeConditions(ctx.god, target.id, 'exposure');
    const ts = simOf(target);
    ts.killedById = null;
    ctx.god.descentKills.push(target.id);
    shakeFaction(ctx.god, ts.factionId, -10 - rankIndex(target.rank) * 3);
    const house = factionFor(ctx.god, target);
    const grieving: Nemesis[] = [];
    for (const n of ctx.living()) {
      const bonded = n.allies.includes(target.id) || n.master === target.id || (house && simOf(n).factionId === house.id && rankIndex(n.rank) >= 2);
      if (!bonded) continue;
      remember(n, 'GOD_KILLED_MY_ALLY', ctx.mgr.turn, target.id);
      const s = simOf(n);
      s.fear = Math.min(100, s.fear + 14);
      if (n.master === target.id) remember(n, 'MY_MASTER_FELL', ctx.mgr.turn, target.id);
      grieving.push(n);
    }
    // Their rivals take heart. Their ground is open.
    for (const rid of target.rivalries) {
      const r = ctx.mgr.byId(rid);
      if (!r || !r.alive) continue;
      const rs = simOf(r);
      rs.confidence = Math.min(100, rs.confidence + 12);
      rs.revengeTargets = rs.revengeTargets.filter((x) => x !== target.id);
      if (rs.goalTargetId === target.id) {
        rs.goal = 'survive';
        rs.goalTargetId = null;
      }
    }
    const crisis = ctx.god.crisis;
    const wasCrisis = !!crisis && crisis.resolved === 'none' && crisis.bodyId === target.id;
    ctx.emit(
      'descent',
      'legendary',
      `YOU KILLED ${name.toUpperCase()} YOURSELF.`,
      [
        wasCrisis ? 'The thing the world could not hold, you held.' : 'A piece is off the board and everybody knows whose hand did it.',
        grieving.length ? `${grieving.map((n) => fullName(n)).slice(0, 3).join(', ')} will not forget who it was.` : 'Nobody was close enough to them to mourn.',
        'Twelve chaos, and every heretic in the world just got a better argument.',
      ],
      [target.id, ...grieving.slice(0, 2).map((n) => n.id)],
      'gold'
    );
    ctx.chronicle('player_kill', `The god came down and killed ${name}.`, [target.id], true, 'gold');
    return 'killed';
  }

  if (target && target.alive) {
    const hurt = simOf(target).injury > facts.snapshot.injury + 15 || target.scars.length > facts.snapshot.scars;
    remember(target, 'GOD_CAME_FOR_ME', ctx.mgr.turn);
    const s = simOf(target);
    if (hurt) {
      s.fear = Math.min(100, s.fear + 20);
      s.confidence = Math.max(0, s.confidence - 15);
      ctx.deed(target, 'was spared by something enormous', 3);
      ctx.emit(
        'descent',
        'major',
        `YOU LEFT ${name.toUpperCase()} ALIVE.`,
        ['Mercy from something enormous is not the same as being liked.', `${name} is afraid now, and will be for a while.`],
        [target.id],
        'neutral'
      );
      return 'spared';
    }
    s.confidence = Math.min(100, s.confidence + 8);
    ctx.deed(target, 'was not found by the god', 2);
    ctx.emit('descent', 'notable', `${name.toUpperCase()} WAS NOT WHERE YOU WENT.`, ['The confrontation ended without a body. They will read that as luck, or as strength.'], [target.id]);
    return 'fled';
  }

  ctx.emit('descent', 'notable', 'YOU CAME BACK UP.', ['The target is gone from the roster.'], []);
  return 'fled';
}

/** The strategic return card: what you did, and what the board did while you were gone. */
export function buildDescentReport(
  ctx: GodContext,
  facts: DescentFacts,
  outcome: DescentReport['outcome'],
  whileGone: Beat[],
  cycles: number
): DescentReport {
  const target = ctx.mgr.byId(facts.nemesisId);
  const name = target ? fullName(target) : 'UNKNOWN';
  const lines: string[] = [];

  switch (outcome) {
    case 'killed':
      lines.push(`${name} is dead by your hand. Their allies know it.`);
      break;
    case 'spared':
      lines.push(`${name} still stands — scarred, and afraid of you.`);
      break;
    case 'fled':
      lines.push(`${name} was never brought to ground. The confrontation ended without a body.`);
      break;
    case 'player_died': {
      const killer = ctx.mgr.byId(facts.killerId);
      lines.push(killer ? `${fullName(killer)} killed you. The world watched.` : 'You died below.');
      break;
    }
    case 'escaped':
      lines.push(`You extracted. ${name} watched you go.`);
      break;
  }

  if (target && target.alive) {
    if (target.power !== facts.snapshot.power) lines.push(`Their power ${facts.snapshot.power} → ${target.power}.`);
    if (target.territory !== facts.snapshot.territory) lines.push(`They moved to ${target.territory.toUpperCase()}.`);
    if (target.stolen.length < facts.snapshot.stolen) lines.push('The steel they carried left their hands.');
  }
  const towerNow = ctx.mgr.data.territories.tower ?? null;
  if (towerNow !== facts.snapshot.holder) {
    const holder = towerNow ? ctx.mgr.byId(towerNow) : null;
    lines.push(holder ? `The Tower answers to ${fullName(holder)} now.` : 'The Tower has no holder.');
  }

  const loud = whileGone
    .filter((b) => (b.priority === 'legendary' || b.priority === 'major') && b.kind !== 'descent' && b.kind !== 'intervention' && b.kind !== 'act')
    .slice(0, 3);
  if (loud.length) {
    lines.push(`While you were below (${cycles} cycles):`);
    for (const b of loud) lines.push(`· ${b.headline}`);
  } else {
    lines.push(`${cycles} cycles turned while you were below. The board held its breath.`);
  }
  const crisis = ctx.god.crisis;
  if (crisis && crisis.resolved === 'none') {
    lines.push(`${crisis.title} grew while you were gone. ${Math.max(0, crisis.deadline - ctx.god.cycle)} cycles left.`);
  }

  return { targetId: facts.nemesisId, targetName: name, outcome, cyclesElapsed: cycles, lines };
}
