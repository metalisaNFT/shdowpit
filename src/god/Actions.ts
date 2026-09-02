/**
 * What a character can decide to do with a cycle.
 *
 * Each action enumerates its own plausible targets and scores each one out of
 * the shared components in Utility.ts. Nothing here reaches for a special
 * case: "the coward hides" is not a rule, it is what happens when `hide`
 * multiplies survival by 4 and `attack` subtracts a danger term that a coward
 * reads as larger than anyone else does.
 *
 * RECONSTRUCTION (2026-09-02): the material/quest/dungeon economy is gone.
 * Nine actions produced nothing a player could plan around — they were
 * simulation without gameplay. What remains is the political catalogue: who
 * fights whom, who swears to whom, who takes what ground, and who goes to
 * ground. Every action here either changes a relationship, a rank, a piece of
 * territory, or a character's readiness to do one of those next cycle.
 *
 * `enumerate` must stay PURE — it is also used by the forecast engine to
 * preview what a character is likely to do before the player spends.
 */

import { AREAS, getArea } from '../data/areas';
import { AREA_NAMES } from '../data/names';
import { getPersonality } from '../data/personalities';
import { traitsOfKind } from '../data/traits';
import { fullName, rankIndex, RANK_ORDER, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { remember } from '../nemesis/NemesisMemory';
import { breakBond, makeAllies, makeRivals, setMaster } from '../nemesis/NemesisRelationships';
import { addCondition } from './Conditions';
import type { GodContext } from './Context';
import { factionFor, sameFaction, shakeFaction } from './Factions';
import { simOf, type ScoreParts } from './GodTypes';
import {
  ambitionTerm,
  crisisGlory,
  dangerTerm,
  emptyParts,
  memoryHeat,
  noiseTerm,
  opportunityTerm,
  reachable,
  relationTerm,
  sameGround,
  type TermCtx,
} from './Utility';

export interface ActionTarget {
  id: string | null;
  name: string;
  nemesis?: Nemesis;
  areaId?: string;
}

export interface ActionOption {
  target: ActionTarget;
  parts: ScoreParts;
  veto?: string;
}

export interface ActionDef {
  id: string;
  name: string;
  /** one line for the feed and the dev panel */
  blurb: string;
  /** this action is a fight, and is rationed as one */
  fight?: boolean;
  enumerate(ctx: GodContext, actor: Nemesis, term: TermCtx): ActionOption[];
  perform(ctx: GodContext, actor: Nemesis, target: ActionTarget): void;
}

const NONE: ActionTarget = { id: null, name: '' };

/** How many named characters the world wants alive before it stops recruiting. */
export const CAST_FLOOR = 8;
export const CAST_CEILING = 14;

/* ============================================================
   helpers
   ============================================================ */

function others(ctx: GodContext, actor: Nemesis): Nemesis[] {
  return ctx.living().filter((n) => n.id !== actor.id);
}

/** Cheap distance penalty: reaching someone on other ground costs appetite. */
function travelPenalty(actor: Nemesis, target: Nemesis, term: TermCtx): number {
  if (sameGround(actor, target)) return 0;
  const exposed = term.cond.weight(target.id, 'exposure');
  return exposed > 0 ? 0.5 : 3.2;
}

function opt(target: ActionTarget, parts: ScoreParts, veto?: string | null): ActionOption {
  return veto ? { target, parts, veto } : { target, parts };
}

function tgt(n: Nemesis): ActionTarget {
  return { id: n.id, name: fullName(n), nemesis: n };
}

function areaTarget(areaId: string): ActionTarget {
  return { id: areaId, name: AREA_NAMES[areaId] ?? getArea(areaId).name, areaId };
}

/**
 * Promotion when the win was convincing enough to move the hierarchy. This is
 * one of exactly three ways rank changes in a god run (the others are
 * succession inside a house, and a nobody rising out of the rabble).
 */
function climbAfterWin(ctx: GodContext, winner: Nemesis, loser: Nemesis, margin: number): void {
  if (!winner.alive) return;
  // A seat is taken by beating whoever sits in it. Lesser ranks want a
  // convincing win; the seat itself changes hands on any win at all, because
  // an Overlord who was seen on the ground is not an Overlord any more.
  if (rankIndex(loser.rank) > rankIndex(winner.rank) && (margin > 0.1 || loser.rank === 'overlord')) {
    const taken = loser.rank;
    ctx.mgr.demote(loser, `${fullName(winner)} took their place`);
    ctx.mgr.promote(winner, taken);
    ctx.emit(
      'promotion',
      taken === 'overlord' ? 'legendary' : 'major',
      `${fullName(winner)} TOOK ${fullName(loser)}'S PLACE.`,
      [`${fullName(loser)} is now ${RANK_ORDER[Math.max(0, rankIndex(taken) - 1)].toUpperCase()}.`],
      [winner.id, loser.id],
      'gold'
    );
    if (taken === 'overlord') ctx.deed(winner, `took the seat from ${fullName(loser)}`, 6);
  }
}

/* ============================================================
   the catalogue
   ============================================================ */

export const ACTIONS: ActionDef[] = [
  /* ---------------------------------------------------------- CHALLENGE */
  {
    id: 'challenge',
    name: 'CHALLENGE',
    blurb: 'Take a swing at someone one step above them.',
    fight: true,
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (rankIndex(n.rank) !== rankIndex(actor.rank) + 1) continue;
        const veto = reachable(term, actor, n);
        const parts = emptyParts();
        parts.base = 4.5 - travelPenalty(actor, n, term);
        parts.personality = p.challenge * 3.2 + p.ambition * 2.4;
        parts.relationship = relationTerm(term, actor, n) * 0.8;
        parts.memory =
          memoryHeat(actor, ['I_WAS_DEMOTED', 'I_WAS_HUMILIATED_BY'], null, term.turn) * 2.6 +
          memoryHeat(actor, ['RIVAL_DEFEATED_ME'], n.id, term.turn) * 3;
        parts.need = -(s.injury / 100) * 7 + (s.confidence / 100) * 4;
        parts.danger = dangerTerm(term, actor, n) * 1.15;
        parts.opportunity = opportunityTerm(term, actor, n) + crisisGlory(term, actor, n);
        parts.ambition = ambitionTerm(term, actor);
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const res = ctx.fight(actor, n, 'challenge');
      ctx.emitFight('duel', res.aftermath === 'killed' ? 'major' : 'notable', res, actor, n, 'challenge', [actor.id, n.id], res.aftermath === 'killed' ? 'bad' : 'neutral');
      ctx.chronicle('duel', res.headline, [res.winner.id, res.loser.id], rankIndex(res.winner.rank) >= 2);
      if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- ATTACK */
  {
    id: 'attack',
    name: 'ATTACK',
    blurb: 'Settle something with whoever is standing in front of them.',
    fight: true,
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (sameFaction(actor, n) && !actor.rivalries.includes(n.id)) continue;
        // Unprovoked violence needs a reason: a rivalry, a war, a grudge, or a
        // mark the god left. Otherwise it is not on the table at all.
        const reason =
          actor.rivalries.includes(n.id) ||
          term.cond.weight(n.id, 'bounty') > 0 ||
          term.cond.weight(n.id, 'mark') > 0 ||
          term.cond.between(actor.id, n.id, 'rumour') > 0 ||
          relationTerm(term, actor, n) >= 7 ||
          crisisGlory(term, actor, n) > 0;
        if (!reason) continue;
        const veto = reachable(term, actor, n);
        const parts = emptyParts();
        parts.base = 2.6 - travelPenalty(actor, n, term);
        parts.personality = p.aggression * 3 + p.challenge * 1.6;
        parts.relationship = relationTerm(term, actor, n);
        parts.memory = memoryHeat(actor, ['RIVAL_DEFEATED_ME', 'I_WAS_ROBBED_BY', 'I_LOST_TERRITORY_TO'], n.id, term.turn) * 2.4;
        parts.need = -(s.injury / 100) * 8;
        parts.danger = dangerTerm(term, actor, n) * 1.1;
        parts.opportunity = opportunityTerm(term, actor, n) + crisisGlory(term, actor, n);
        parts.ambition = ambitionTerm(term, actor) * 0.4;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const res = ctx.fight(actor, n, 'duel');
      ctx.emitFight('duel', res.aftermath === 'killed' ? 'major' : 'notable', res, actor, n, 'duel', [actor.id, n.id], res.aftermath === 'killed' ? 'bad' : 'neutral');
      ctx.chronicle('duel', res.headline, [res.winner.id, res.loser.id], rankIndex(res.winner.rank) >= 2);
      if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- REVENGE */
  {
    id: 'revenge',
    name: 'REVENGE',
    blurb: 'Go and answer for something.',
    fight: true,
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      for (const id of new Set([...s.revengeTargets, ...s.escapedFrom])) {
        const n = ctx.mgr.byId(id);
        if (!n || !n.alive || n.id === actor.id) continue;
        const veto = reachable(term, actor, n);
        const parts = emptyParts();
        // Revenge crosses the map. That is what makes it revenge.
        parts.base = 7 - travelPenalty(actor, n, term) * 0.35;
        parts.personality = p.revenge * 5 + p.hunt * 1.6;
        parts.relationship = relationTerm(term, actor, n) * 0.5;
        parts.memory =
          memoryHeat(actor, ['I_WAS_HUMILIATED_BY', 'I_FLED_FROM', 'MY_MASTER_FELL', 'I_WAS_BETRAYED', 'I_WAS_ROBBED_BY'], n.id, term.turn) * 4.5 +
          memoryHeat(actor, ['RIVAL_DEFEATED_ME'], n.id, term.turn) * 2;
        // Old grudges get louder, not quieter, when they are the standing goal.
        parts.need = s.goal === 'revenge' && s.goalTargetId === n.id ? 3 + Math.min(6, s.goalAge * 1.1) : 0;
        parts.need -= (s.injury / 100) * 5;
        parts.danger = dangerTerm(term, actor, n) * 0.8;
        parts.opportunity = opportunityTerm(term, actor, n) + crisisGlory(term, actor, n) * 0.7;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const s = simOf(actor);
      const returning = s.escapedFrom.includes(n.id);
      const res = ctx.fight(actor, n, 'hunt');
      const extra = returning ? [`${fullName(actor)} ran from ${fullName(n)} once. Not this time.`] : [];
      ctx.emitFight(
        'revenge',
        res.aftermath === 'killed' ? 'legendary' : 'major',
        res,
        actor,
        n,
        'hunt',
        [actor.id, n.id],
        res.winner.id === actor.id ? 'good' : 'bad',
        res.headline,
        extra
      );
      ctx.chronicle('revenge', res.headline, [res.winner.id, res.loser.id], true, 'bad');
      if (res.winner.id === actor.id && res.duel.ending === 'down') {
        s.escapedFrom = s.escapedFrom.filter((x) => x !== n.id);
        s.revengeTargets = s.revengeTargets.filter((x) => x !== n.id);
        if (s.goal === 'revenge' && s.goalTargetId === n.id) {
          s.goal = 'survive';
          s.goalTargetId = null;
          s.goalAge = 0;
        }
        ctx.deed(actor, `answered ${fullName(n)}`, 3);
        if (returning) ctx.deed(actor, `came back for ${fullName(n)} after running from them`, 4);
      }
      if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- HUNT */
  {
    id: 'hunt',
    name: 'HUNT',
    blurb: 'Go looking for someone the world has put a price on.',
    fight: true,
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        const bounty = term.cond.weight(n.id, 'bounty');
        const mark = term.cond.weight(n.id, 'mark');
        const exposed = term.cond.weight(n.id, 'exposure');
        if (bounty <= 0 && mark <= 0 && exposed <= 0) continue;
        if (sameFaction(actor, n) && bounty <= 0) continue;
        const veto = reachable(term, actor, n);
        const parts = emptyParts();
        parts.base = 2.5;
        parts.personality = p.hunt * 3.2 + p.steal * 1.4 + p.ambition * 1.2;
        parts.relationship = relationTerm(term, actor, n) * 0.6;
        parts.memory = memoryHeat(actor, ['RIVAL_DEFEATED_ME'], n.id, term.turn) * 1.5;
        parts.need = -(simOf(actor).injury / 100) * 5;
        parts.danger = dangerTerm(term, actor, n);
        parts.opportunity = opportunityTerm(term, actor, n) * 1.3 + crisisGlory(term, actor, n);
        parts.ambition = ambitionTerm(term, actor) * 0.5;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const bounty = ctx.cond.weight(n.id, 'bounty');
      const res = ctx.fight(actor, n, 'hunt');
      const extra =
        bounty > 0 ? [`There was a price on ${fullName(n)}, and ${fullName(actor)} wanted it.`] : [];
      ctx.emitFight(
        'hunt',
        res.aftermath === 'killed' ? 'major' : 'notable',
        res,
        actor,
        n,
        'hunt',
        [actor.id, n.id],
        'bad',
        res.headline,
        extra
      );
      ctx.chronicle('duel', res.headline, [res.winner.id, res.loser.id], true);
      if (res.winner.id === actor.id && bounty > 0 && res.aftermath === 'killed') {
        actor.level = Math.min(30, actor.level + 1);
        recomputePower(actor);
        ctx.deed(actor, `collected the price on ${fullName(n)}`, 3);
      }
      if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- BETRAY */
  {
    id: 'betray',
    name: 'BETRAY',
    blurb: 'Decide the arrangement has run its course.',
    fight: true,
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      const bonds = new Set<string>([...(actor.master ? [actor.master] : []), ...actor.allies]);
      for (const id of bonds) {
        const n = ctx.mgr.byId(id);
        if (!n || !n.alive) continue;
        const ns = simOf(n);
        const rumour = term.cond.between(actor.id, n.id, 'rumour');
        const whispered = rumour > 0 || term.cond.weight(n.id, 'opportunity') > 0;
        // A betrayal needs a NATURE and a REASON. The nature is cheap to
        // have; the reason is a rumour, a wound on the master, a demotion,
        // a master above them who is worth replacing, or a bond gone cold.
        const master = actor.master === n.id;
        const above = rankIndex(n.rank) > rankIndex(actor.rank);
        const parts = emptyParts();
        parts.base = 0;
        parts.personality = p.betray * 3.6 + p.ambition * 1.2;
        // Being close is what makes betrayal possible, so proximity is a plus
        // here where it is a minus everywhere else — until loyalty argues.
        parts.relationship = (master ? 3 : 1.5) - (s.loyalty / 100) * 9 + (s.loyalty < 25 ? 2.5 : 0);
        parts.memory =
          memoryHeat(actor, ['I_WAS_HUMILIATED_BY', 'I_WAS_ROBBED_BY'], n.id, term.turn) * 3 +
          memoryHeat(actor, ['I_WAS_DEMOTED'], null, term.turn) * 1.6 -
          // Someone who just turned on somebody is not trusted enough to be
          // close to anyone else for a while — and knows it.
          memoryHeat(actor, ['I_BETRAYED_ALLY'], null, term.turn) * 4;
        parts.need = -(s.injury / 100) * 4;
        parts.danger = dangerTerm(term, actor, n) * 0.9;
        // A rumour is exactly the excuse a traitor was waiting for. A wounded
        // master is another. A master worth replacing is a third.
        parts.opportunity =
          opportunityTerm(term, actor, n) +
          rumour * (whispered ? 6.5 : 5) +
          (ns.injury / 100) * 4 +
          memoryHeat(n, ['RIVAL_DEFEATED_ME', 'I_FLED_FROM'], null, term.turn) * 1.5 +
          (master && above ? (s.ambition / 100) * 3 : 0);
        parts.ambition = master && above ? ambitionTerm(term, actor) * 1.1 : ambitionTerm(term, actor) * 0.4;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      breakBond(actor, n);
      makeRivals(actor, n);
      remember(actor, 'I_BETRAYED_ALLY', ctx.mgr.turn, n.id);
      remember(n, 'I_WAS_BETRAYED', ctx.mgr.turn, actor.id);
      const ns = simOf(n);
      ns.loyalty = Math.max(0, ns.loyalty - 25);
      ctx.wantRevenge(n, actor);
      shakeFaction(ctx.god, simOf(actor).factionId, -9);
      ctx.deed(actor, `turned on ${fullName(n)}`, 3);

      const res = ctx.fight(actor, n, 'betrayal');
      ctx.emitFight(
        'betrayal',
        res.aftermath === 'killed' ? 'legendary' : 'major',
        res,
        actor,
        n,
        'betrayal',
        [actor.id, n.id],
        'bad',
        `${fullName(actor)} TURNED ON ${fullName(n)}.`.toUpperCase()
      );
      ctx.chronicle('betrayal', `${fullName(actor)} turned on ${fullName(n)}.`, [actor.id, n.id], true, 'bad');
      if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- ALLY */
  {
    id: 'ally',
    name: 'SWEAR',
    blurb: 'Find someone worth standing next to.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      if (actor.allies.length >= 2) return out;
      // Company is something you look for when you have none, or when you
      // are frightened. Otherwise the arrangement you have is the one you keep.
      if (actor.allies.length > 0 && s.fear < 40) return out;
      for (const n of others(ctx, actor)) {
        if (actor.allies.includes(n.id) || actor.rivalries.includes(n.id)) continue;
        if (!sameGround(actor, n) && !sameFaction(actor, n)) continue;
        if (n.allies.length >= 3) continue;
        // Nobody swears to someone who has just turned on somebody.
        if (memoryHeat(n, ['I_BETRAYED_ALLY'], null, term.turn) > 0.5) continue;
        const parts = emptyParts();
        parts.base = 0.8;
        parts.personality = p.ally * 3 + p.protect * 1.2;
        parts.relationship = -relationTerm(term, actor, n) * 0.5;
        parts.memory = memoryHeat(actor, ['I_WAS_SPARED_BY', 'I_SAVED_AN_ALLY'], n.id, term.turn) * 3;
        // Frightened, friendless people go looking for company.
        parts.need = (s.fear / 100) * 5 + (actor.allies.length === 0 ? 2.5 : -actor.allies.length * 2.5);
        parts.danger = 0;
        parts.opportunity = (n.power / Math.max(20, actor.power) - 1) * 3;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      if (!makeAllies(actor, n)) return;
      const s = simOf(actor);
      if (rankIndex(n.rank) > rankIndex(actor.rank) && (actor.personality === 'loyalist' || s.loyalty > 60)) {
        setMaster(actor, n);
        s.goal = 'serve';
        s.goalTargetId = n.id;
      }
      const nf = factionFor(ctx.god, n);
      if (nf && !s.factionId) {
        s.factionId = nf.id;
        nf.memberIds.push(actor.id);
      }
      ctx.emit('alliance', 'notable', `${fullName(actor)} SWORE TO ${fullName(n)}.`, [`Two fewer people in this world are alone.`], [actor.id, n.id]);
      ctx.chronicle('alliance', `${fullName(actor)} swore to ${fullName(n)}.`, [actor.id, n.id]);
    },
  },

  /* ---------------------------------------------------------- PROTECT */
  {
    id: 'protect',
    name: 'GUARD',
    blurb: 'Stand in front of someone who needs it.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      const bonds = new Set<string>([...(actor.master ? [actor.master] : []), ...actor.allies]);
      for (const id of bonds) {
        const n = ctx.mgr.byId(id);
        if (!n || !n.alive) continue;
        const ns = simOf(n);
        const hunted = ctx.living().some((h) => h.id !== actor.id && h.id !== n.id && simOf(h).revengeTargets.includes(n.id));
        const threat =
          term.cond.weight(n.id, 'bounty') + term.cond.weight(n.id, 'mark') + (hunted ? 0.5 : 0) + (ns.injury > 50 ? 0.3 : 0);
        // Standing over somebody who is in no danger is not an action, it is a
        // pose. Without a threat this simply is not on the table.
        if (threat < 0.4) continue;
        // Somebody is already standing there.
        if (term.cond.weight(n.id, 'ward') > 0) continue;
        const parts = emptyParts();
        parts.base = 0.3;
        parts.personality = p.protect * 2.2 + p.ally * 0.5;
        parts.relationship = actor.master === n.id ? 4 : 2;
        parts.memory = memoryHeat(actor, ['I_WAS_SPARED_BY'], n.id, term.turn) * 2;
        parts.need = (s.loyalty / 100) * 5;
        parts.danger = 0;
        parts.opportunity = threat * 3.2;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      addCondition(ctx.god, {
        kind: 'ward',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 0.6,
        duration: 3,
        note: `${fullName(actor)} is standing over them`,
        source: 'world',
      });
      const s = simOf(actor);
      s.loyalty = Math.min(100, s.loyalty + 6);
      remember(actor, 'I_SAVED_AN_ALLY', ctx.mgr.turn, n.id);
      const marked = ctx.cond.weight(n.id, 'bounty') + ctx.cond.weight(n.id, 'mark') > 0;
      ctx.emit('guard', marked ? 'notable' : 'background', `${fullName(actor)} PUT THEMSELVES BETWEEN ${fullName(n)} AND THE WORLD.`, [`Anyone coming for ${fullName(n)} has to go through them first.`], [actor.id, n.id], 'good');
    },
  },

  /* ---------------------------------------------------------- RECRUIT */
  {
    id: 'recruit',
    name: 'RECRUIT',
    blurb: 'Pull someone up out of the rabble.',
    enumerate(ctx, actor, term) {
      if (rankIndex(actor.rank) < 2) return [];
      if (ctx.mgr.namedLiving().length >= CAST_CEILING) return [];
      const p = getPersonality(actor.personality);
      const thin = ctx.mgr.namedLiving().length < CAST_FLOOR;
      const parts = emptyParts();
      parts.base = thin ? 4.5 : 1.4;
      parts.personality = p.ambition * 2 + p.protect * 1;
      parts.relationship = 0;
      parts.memory = memoryHeat(actor, ['MY_MASTER_FELL', 'I_WAS_BETRAYED'], null, term.turn) * 1.5;
      parts.need = actor.allies.length === 0 ? 3 : -actor.allies.length * 1.2;
      parts.danger = 0;
      parts.opportunity = thin ? 2 : 0;
      parts.ambition = ambitionTerm(term, actor) * 0.5;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const n = ctx.mgr.recruit('elite', false);
      n.territory = actor.territory;
      setMaster(n, actor);
      const s = simOf(n);
      s.factionId = simOf(actor).factionId;
      s.loyalty = 60 + ctx.rng.int(0, 25);
      const f = factionFor(ctx.god, actor);
      if (f) f.memberIds.push(n.id);
      ctx.emit('recruit', 'notable', `${fullName(n)} CAME UP BEHIND ${fullName(actor)}.`, [`${getPersonality(n.personality).name}. ${fullName(actor)} has one more sword than they did.`], [actor.id, n.id]);
      ctx.chronicle('recruitment', `${fullName(n)} came up behind ${fullName(actor)}.`, [n.id, actor.id]);
    },
  },

  /* ---------------------------------------------------------- STEAL */
  {
    id: 'steal',
    name: 'STEAL',
    blurb: 'Take something that is not theirs.',
    fight: true,
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (!n.stolen.length) continue;
        const veto = reachable(term, actor, n);
        const parts = emptyParts();
        parts.base = 2.4 - travelPenalty(actor, n, term) * 0.5;
        parts.personality = p.steal * 5;
        parts.relationship = relationTerm(term, actor, n) * 0.4;
        parts.memory = memoryHeat(actor, ['I_WAS_ROBBED_BY'], n.id, term.turn) * 2;
        parts.need = 0;
        parts.danger = dangerTerm(term, actor, n) * 0.8;
        parts.opportunity = opportunityTerm(term, actor, n) + (simOf(n).injury / 100) * 4;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      // Taking it is one thing. Being caught is another.
      const caught = ctx.rng.chance(0.45 + (n.power / Math.max(20, actor.power) - 1) * 0.2);
      if (caught) {
        const res = ctx.fight(actor, n, 'duel');
        ctx.emitFight('theft', 'notable', res, actor, n, 'duel', [actor.id, n.id], 'bad', `${fullName(actor)} WAS CAUGHT GOING THROUGH ${fullName(n)}'S THINGS.`);
        makeRivals(actor, n);
        if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
        return;
      }
      const item = n.stolen.pop()!;
      actor.stolen.push(item);
      recomputePower(actor);
      recomputePower(n);
      makeRivals(actor, n);
      remember(actor, 'I_ROBBED_THEM', ctx.mgr.turn, n.id);
      remember(n, 'I_WAS_ROBBED_BY', ctx.mgr.turn, actor.id);
      ctx.wantRevenge(n, actor);
      ctx.deed(actor, `lifted ${item.name} from ${fullName(n)}`, 2);
      ctx.emit('theft', 'major', `${fullName(actor)} TOOK ${item.name.toUpperCase()} FROM ${fullName(n)}.`, [`${fullName(n)} knows exactly who has it.`], [actor.id, n.id], 'gold');
      ctx.chronicle('weapon_theft', `${fullName(actor)} took ${item.name} from ${fullName(n)}.`, [actor.id, n.id], true, 'gold');
    },
  },

  /* ---------------------------------------------------------- SEIZE GROUND */
  {
    id: 'seize',
    name: 'SEIZE',
    blurb: 'Take ground off whoever is standing on it.',
    fight: true,
    enumerate(ctx, actor, term) {
      if (rankIndex(actor.rank) < 1) return [];
      const p = getPersonality(actor.personality);
      const held = Object.keys(ctx.mgr.data.territories).filter((a) => ctx.mgr.data.territories[a] === actor.id).length;
      // Ground is heavy. One area for most; a warlord can stretch to two.
      const capacity = rankIndex(actor.rank) >= 3 ? 2 : 1;
      if (held >= capacity) return [];
      const out: ActionOption[] = [];
      for (const area of AREAS) {
        if (area.id === 'fortress' && rankIndex(actor.rank) < 3) continue;
        const holder = ctx.mgr.territoryHolder(area.id);
        if (holder && holder.id === actor.id) continue;
        if (holder && sameFaction(actor, holder) && !actor.rivalries.includes(holder.id)) continue;
        const hs = holder ? simOf(holder) : null;
        const veto = holder ? reachable(term, actor, holder) : null;
        const parts = emptyParts();
        parts.base = (holder ? 2.0 : 3.2) - (area.id === actor.territory ? 0 : 1.4);
        parts.personality = p.ambition * 2.6 + p.challenge * 1;
        parts.relationship = holder ? relationTerm(term, actor, holder) * 0.7 : 0;
        parts.memory = holder ? memoryHeat(actor, ['I_LOST_TERRITORY_TO'], holder.id, term.turn) * 3.5 : 0;
        parts.need = 0;
        parts.danger = holder ? dangerTerm(term, actor, holder) * 1.2 : 0;
        // Weak holders invite it: wounded, at war, or sitting on unrest.
        parts.opportunity =
          (holder ? opportunityTerm(term, actor, holder) + (hs!.injury / 100) * 6 : 0) +
          term.cond.weight(area.id, 'unrest') * 4;
        parts.ambition = ambitionTerm(term, actor) * 0.8;
        parts.noise = noiseTerm(term);
        out.push(opt(areaTarget(area.id), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const areaId = target.areaId!;
      const holder = ctx.mgr.territoryHolder(areaId);
      const label = AREA_NAMES[areaId] ?? getArea(areaId).name;
      if (holder && holder.alive && holder.id !== actor.id) {
        const res = ctx.fight(actor, holder, 'war');
        // The holder keeps it by standing. Running off it is losing it.
        if (res.winner.id !== actor.id || res.duel.ending === 'stalemate') {
          ctx.emitFight('territory', 'notable', res, holder, actor, 'war', [holder.id, actor.id], 'neutral', `${fullName(holder)} HELD ${label} AGAINST ${fullName(actor)}.`);
          ctx.chronicle('territory', `${fullName(holder)} held ${label} against ${fullName(actor)}.`, [holder.id, actor.id]);
          if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
          return;
        }
        remember(actor, 'I_TOOK_TERRITORY_FROM', ctx.mgr.turn, holder.id);
        remember(holder, 'I_LOST_TERRITORY_TO', ctx.mgr.turn, actor.id);
        const hs = simOf(holder);
        if (holder.alive) ctx.wantRevenge(holder, actor);
        shakeFaction(ctx.god, hs.factionId, -6);
        // Whoever lost it is no longer standing on it.
        if (holder.alive && holder.territory === areaId) holder.territory = ctx.fleeGround(holder, areaId);
      }
      ctx.mgr.data.territories[areaId] = actor.id;
      actor.territory = areaId;
      ctx.deed(actor, `took ${label}`, 2);
      const big = areaId === 'fortress' || !!holder;
      ctx.emit('territory', big ? 'major' : 'notable', `${fullName(actor)} TOOK ${label}.`, [holder ? `${fullName(holder)} lost it, and will not forget who to.` : `${label} answers to ${fullName(actor)} now.`], holder ? [actor.id, holder.id] : [actor.id], 'gold');
      ctx.chronicle('territory', `${fullName(actor)} seized ${label}.`, [actor.id], true, 'gold');
    },
  },

  /* ---------------------------------------------------------- DEFEND GROUND */
  {
    id: 'defend',
    name: 'DIG IN',
    blurb: 'Make their ground expensive to walk onto.',
    enumerate(ctx, actor, term) {
      const holds = Object.keys(ctx.mgr.data.territories).filter((a) => ctx.mgr.data.territories[a] === actor.id);
      if (!holds.length) return [];
      if (term.cond.weight(actor.id, 'ward') > 0) return [];
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const areaId of holds) {
        const parts = emptyParts();
        parts.base = 1.6;
        parts.personality = p.protect * 2.6 - p.challenge * 1;
        parts.relationship = 0;
        parts.memory = memoryHeat(actor, ['I_LOST_TERRITORY_TO'], null, term.turn) * 2.5;
        parts.need = (simOf(actor).fear / 100) * 4;
        parts.danger = 0;
        parts.opportunity = term.cond.weight(areaId, 'unrest') * 3.5 + term.cond.weight(actor.id, 'bounty') * 2;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(areaTarget(areaId), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const areaId = target.areaId!;
      addCondition(ctx.god, {
        kind: 'ward',
        targetKind: 'nemesis',
        targetId: actor.id,
        magnitude: 0.5,
        duration: 2,
        note: `dug into ${AREA_NAMES[areaId] ?? areaId}`,
        source: 'world',
      });
      shakeFaction(ctx.god, simOf(actor).factionId, 3);
      ctx.emit('territory', 'background', `${fullName(actor)} DUG INTO ${AREA_NAMES[areaId] ?? areaId}.`, ['Harder to shift than they were last cycle.'], [actor.id]);
    },
  },

  /* ---------------------------------------------------------- TRAVEL */
  {
    id: 'travel',
    name: 'MOVE',
    blurb: 'Be somewhere else.',
    enumerate(ctx, actor, term) {
      const s = simOf(actor);
      const goalTarget = ctx.mgr.byId(s.goalTargetId);
      const out: ActionOption[] = [];
      // Someone holding ground does not wander off it.
      const holds = Object.values(ctx.mgr.data.territories).includes(actor.id);
      if (holds) return [];
      for (const area of AREAS) {
        if (area.id === actor.territory) continue;
        const parts = emptyParts();
        parts.base = 0.6;
        parts.personality = getPersonality(actor.personality).hunt * 0.8;
        parts.relationship = 0;
        parts.memory = 0;
        // Fear moves people off dangerous ground.
        parts.need = (s.fear / 100) * (5 - area.danger) * 0.9;
        parts.danger = area.danger * 0.6;
        parts.opportunity = goalTarget && goalTarget.alive && goalTarget.territory === area.id ? 6 : 0;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(areaTarget(area.id), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      actor.territory = target.areaId!;
      simOf(actor).travelTo = null;
      ctx.emit('move', 'background', `${fullName(actor)} WENT TO ${target.name}.`, [], [actor.id]);
    },
  },

  /* ---------------------------------------------------------- HIDE */
  {
    id: 'hide',
    name: 'GO TO GROUND',
    blurb: 'Stop being findable for a while.',
    enumerate(_ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      if (s.hiddenUntil > term.now) return [];
      const hunted =
        term.cond.weight(actor.id, 'bounty') + term.cond.weight(actor.id, 'mark') + term.cond.weight(actor.id, 'exposure');
      const parts = emptyParts();
      parts.base = 0.4;
      parts.personality = p.survival * 3.2 - p.challenge * 1.2;
      parts.relationship = 0;
      parts.memory = memoryHeat(actor, ['I_FLED_FROM', 'I_WAS_HUMILIATED_BY'], null, term.turn) * 1.4;
      parts.need = (s.fear / 100) * 8 + (s.injury / 100) * 5;
      parts.danger = 0;
      parts.opportunity = hunted * 4;
      parts.ambition = -ambitionTerm(term, actor) * 0.4;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const s = simOf(actor);
      s.hiddenUntil = ctx.now + 3;
      s.fear = Math.max(0, s.fear - 10);
      if (s.goal !== 'revenge') s.goal = 'hide';
      ctx.emit('hide', 'notable', `${fullName(actor)} STOPPED BEING SOMEWHERE.`, ['Nobody will find them for a few cycles, unless somebody shows the world where they are.'], [actor.id]);
    },
  },

  /* ---------------------------------------------------------- RECOVER */
  {
    id: 'recover',
    name: 'RECOVER',
    blurb: 'Sit down and stop bleeding.',
    enumerate(_ctx, actor, term) {
      const s = simOf(actor);
      if (s.injury < 12) return [];
      const parts = emptyParts();
      parts.base = 1;
      parts.personality = getPersonality(actor.personality).survival * 2;
      parts.relationship = 0;
      parts.memory = 0;
      parts.need = (s.injury / 100) * 16;
      parts.danger = 0;
      parts.opportunity = 0;
      parts.ambition = -ambitionTerm(term, actor) * 0.3;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const s = simOf(actor);
      const before = s.injury;
      s.injury = Math.max(0, s.injury - 34);
      s.confidence = Math.min(100, s.confidence + 4);
      ctx.emit('recover', 'background', `${fullName(actor)} SPENT THE CYCLE PUTTING THEMSELVES BACK TOGETHER.`, [`Wounds ${Math.round(before)} → ${Math.round(s.injury)}.`], [actor.id]);
    },
  },

  /* ---------------------------------------------------------- CONSOLIDATE */
  {
    id: 'consolidate',
    name: 'BUILD',
    blurb: 'Get harder to kill.',
    enumerate(_ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const parts = emptyParts();
      parts.base = 2.2;
      parts.personality = p.ambition * 2 + p.protect * 0.8;
      parts.relationship = 0;
      parts.memory = memoryHeat(actor, ['RIVAL_DEFEATED_ME', 'I_WAS_HUMILIATED_BY'], null, term.turn) * 2;
      parts.need = -(simOf(actor).injury / 100) * 4;
      parts.danger = 0;
      parts.opportunity = 0;
      parts.ambition = ambitionTerm(term, actor) * 0.7;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const s = simOf(actor);
      const pool = traitsOfKind(ctx.rng.chance(0.2) ? 'mutation' : 'strength').filter((t) => !actor.strengths.includes(t.id));
      if (pool.length && actor.strengths.length < 5 && ctx.rng.chance(0.4)) {
        const t = ctx.rng.pick(pool);
        actor.strengths.push(t.id);
        recomputePower(actor);
        ctx.emit('build', 'notable', `${fullName(actor)} CAME BACK DIFFERENT. ${t.name}.`, [t.desc], [actor.id], 'bad');
        ctx.deed(actor, `learned ${t.name.toLowerCase()}`, 1);
        return;
      }
      actor.level = Math.min(30, actor.level + 1);
      s.confidence = Math.min(100, s.confidence + 5);
      s.ambition = Math.min(100, s.ambition + 3);
      recomputePower(actor);
      ctx.emit('build', 'background', `${fullName(actor)} SPENT THE CYCLE GETTING STRONGER.`, [`Level ${actor.level}, power ${actor.power}.`], [actor.id]);
    },
  },

  /* ---------------------------------------------------------- PURSUE ITEM */
  {
    id: 'pursue_item',
    name: 'RECLAIM',
    blurb: 'Go and get back what was taken.',
    fight: true,
    enumerate(ctx, actor, term) {
      const lost = actor.stolenFromThem ?? [];
      if (!lost.length) return [];
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (!n.stolen.some((it) => lost.some((l) => l.name === it.name))) continue;
        const veto = reachable(term, actor, n);
        const parts = emptyParts();
        parts.base = 5;
        parts.personality = getPersonality(actor.personality).steal * 2 + getPersonality(actor.personality).revenge * 2;
        parts.relationship = relationTerm(term, actor, n) * 0.6;
        parts.memory = memoryHeat(actor, ['I_WAS_ROBBED_BY'], n.id, term.turn) * 4;
        parts.need = -(simOf(actor).injury / 100) * 5;
        parts.danger = dangerTerm(term, actor, n) * 0.8;
        parts.opportunity = opportunityTerm(term, actor, n);
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts, veto));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const res = ctx.fight(actor, n, 'hunt');
      let recovered = '';
      if (res.winner.id === actor.id && res.duel.ending === 'down') {
        const lost = actor.stolenFromThem ?? [];
        const idx = n.stolen.findIndex((it) => lost.some((l) => l.name === it.name));
        if (idx >= 0) {
          const item = n.stolen.splice(idx, 1)[0];
          actor.stolen.push(item);
          actor.stolenFromThem = lost.filter((l) => l.name !== item.name);
          recomputePower(actor);
          recomputePower(n);
          recovered = item.name;
          ctx.deed(actor, `took ${item.name} back off ${fullName(n)}`, 3);
        }
      }
      ctx.emitFight(
        'reclaim',
        'major',
        res,
        actor,
        n,
        'hunt',
        [actor.id, n.id],
        recovered ? 'gold' : 'neutral',
        recovered ? `${fullName(actor)} TOOK ${recovered.toUpperCase()} BACK.` : res.headline
      );
      if (res.duel.ending === 'down') climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- BROOD */
  {
    id: 'brood',
    name: 'BROOD',
    blurb: 'Sit with it until it becomes a plan.',
    enumerate(_ctx, actor, term) {
      const s = simOf(actor);
      const parts = emptyParts();
      parts.base = 1.2;
      parts.personality = getPersonality(actor.personality).revenge * 1.6;
      parts.relationship = 0;
      parts.memory = memoryHeat(actor, ['I_WAS_HUMILIATED_BY', 'RIVAL_DEFEATED_ME', 'I_WAS_BETRAYED', 'I_WAS_DEMOTED'], null, term.turn) * 2.4;
      parts.need = (s.fear / 100) * 3;
      parts.danger = 0;
      parts.opportunity = 0;
      parts.ambition = 0;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const s = simOf(actor);
      s.ambition = Math.min(100, s.ambition + 6);
      s.fear = Math.max(0, s.fear - 4);
      // Brooding turns a bad memory into a name.
      const wound = [...actor.memory]
        .reverse()
        .find((m) => m.subject && ['I_WAS_HUMILIATED_BY', 'RIVAL_DEFEATED_ME', 'I_WAS_BETRAYED', 'I_WAS_ROBBED_BY'].includes(m.type));
      const who = ctx.mgr.byId(wound?.subject);
      if (who && who.alive && who.persistent !== false && !s.revengeTargets.includes(who.id)) {
        s.revengeTargets.push(who.id);
        s.goal = 'revenge';
        s.goalTargetId = who.id;
        s.goalAge = 0;
        makeRivals(actor, who);
        ctx.emit('grudge', 'notable', `${fullName(actor)} DECIDED ${fullName(who)} WAS THE PROBLEM.`, ['It will not be dropped.'], [actor.id, who.id], 'bad');
        return;
      }
      ctx.emit('grudge', 'background', `${fullName(actor)} SAT WITH IT.`, [], [actor.id]);
    },
  },

  /* ---------------------------------------------------------- DEFY THE GOD */
  {
    id: 'defy',
    name: 'DEFY',
    blurb: 'Decide the interference is the problem.',
    enumerate(ctx, actor, term) {
      // Only reachable once the world is unstable enough to notice it is being
      // handled. Chaos is what buys the player this enemy.
      if (ctx.god.chaos < 45) return [];
      const s = simOf(actor);
      const resentment = Math.max(0, actor.playerRelationship);
      if (resentment < 20 && !s.heretic) return [];
      const parts = emptyParts();
      parts.base = 1 + (ctx.god.chaos - 45) * 0.06;
      parts.personality = getPersonality(actor.personality).revenge * 2 + getPersonality(actor.personality).challenge * 1.4;
      parts.relationship = 0;
      parts.memory =
        memoryHeat(actor, ['GOD_CURSED_ME', 'GOD_MARKED_ME', 'GOD_EXPOSED_ME', 'GOD_TURNED_MINE_AGAINST_ME'], null, term.turn) * 4;
      parts.need = 0;
      parts.danger = 0;
      parts.opportunity = resentment * 0.06;
      parts.ambition = ambitionTerm(term, actor) * 0.5;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const s = simOf(actor);
      const wasHeretic = s.heretic;
      s.heretic = true;
      s.goal = 'destroy_god';
      s.ambition = Math.min(100, s.ambition + 12);

      // Tearing down what the god has built up is the actual action.
      const blessed = ctx.god.conditions.filter((c) => c.source === 'god' && (c.kind === 'blessing' || c.kind === 'ward' || c.kind === 'opportunity'));
      if (blessed.length && ctx.rng.chance(0.6)) {
        const c = ctx.rng.pick(blessed);
        const victim = ctx.mgr.byId(c.targetId);
        ctx.god.conditions = ctx.god.conditions.filter((x) => x.id !== c.id);
        ctx.refreshConditions();
        ctx.deed(actor, 'broke something the god had made', 4);
        ctx.emit(
          'heresy',
          'major',
          `${fullName(actor)} TORE THE MARK OFF ${victim ? fullName(victim) : 'THE GROUND'}.`,
          ['Whatever you put there is gone.', 'They are not afraid of you any more.'],
          [actor.id, ...(victim ? [victim.id] : [])],
          'bad'
        );
        return;
      }

      ctx.emit(
        'heresy',
        wasHeretic ? 'notable' : 'legendary',
        `${fullName(actor)} SAID YOUR NAME OUT LOUD.`,
        [
          'They have worked out that something has been arranging this.',
          'They have decided to do something about it.',
          wasHeretic ? '' : 'You cannot touch them directly. Find someone who can, or stop feeding the fire.',
        ].filter(Boolean),
        [actor.id],
        'bad'
      );
      ctx.chronicle('revenge', `${fullName(actor)} turned against the hand that has been moving things.`, [actor.id], true, 'bad');
    },
  },
];

export const ACTION_MAP = new Map(ACTIONS.map((a) => [a.id, a]));

/** Actions that consume the cycle's appetite for violence. */
export const FIGHT_ACTIONS = new Set(ACTIONS.filter((a) => a.fight).map((a) => a.id));
