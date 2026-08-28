/**
 * What a character can decide to do with a cycle.
 *
 * Each action enumerates its own plausible targets and scores each one out of
 * the shared components in Utility.ts. Nothing here reaches for a special
 * case: "the coward hides" is not a rule, it is what happens when `hide`
 * multiplies survival by 4 and `attack` subtracts a danger term that a coward
 * reads as larger than anyone else does.
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
  enumerate(ctx: GodContext, actor: Nemesis, term: TermCtx): ActionOption[];
  perform(ctx: GodContext, actor: Nemesis, target: ActionTarget): void;
}

const NONE: ActionTarget = { id: null, name: '' };

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

function opt(target: ActionTarget, parts: ScoreParts, veto?: string): ActionOption {
  return veto ? { target, parts, veto } : { target, parts };
}

function tgt(n: Nemesis): ActionTarget {
  return { id: n.id, name: fullName(n), nemesis: n };
}

/** Promotion when the win was convincing enough to move the hierarchy. */
function climbAfterWin(ctx: GodContext, winner: Nemesis, loser: Nemesis, margin: number): void {
  if (rankIndex(loser.rank) > rankIndex(winner.rank) && margin > 0.14) {
    const taken = loser.rank;
    ctx.mgr.demote(loser, `${fullName(winner)} took their place`);
    ctx.mgr.promote(winner, taken);
    ctx.emit(
      'promotion',
      'major',
      `${fullName(winner)} TOOK ${fullName(loser)}'S PLACE.`,
      [`${fullName(loser)} is now ${RANK_ORDER[Math.max(0, rankIndex(taken) - 1)].toUpperCase()}.`],
      [winner.id, loser.id],
      'gold'
    );
  } else if (ctx.rng.chance(0.18 + margin * 0.3)) {
    ctx.mgr.promote(winner);
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
    blurb: 'Take a swing at someone above them.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (rankIndex(n.rank) <= rankIndex(actor.rank)) continue;
        if (rankIndex(n.rank) > rankIndex(actor.rank) + 1) continue;
        const parts = emptyParts();
        parts.base = 6 - travelPenalty(actor, n, term);
        parts.personality = p.challenge * 3.4 + p.ambition * 2.6;
        parts.relationship = relationTerm(term, actor, n) * 0.8;
        parts.memory =
          memoryHeat(actor, ['I_WAS_DEMOTED', 'I_WAS_HUMILIATED_BY'], null, term.turn) * 2.6 +
          memoryHeat(actor, ['RIVAL_DEFEATED_ME'], n.id, term.turn) * 3;
        parts.need = -(s.injury / 100) * 6 + (s.confidence / 100) * 4;
        parts.danger = dangerTerm(term, actor, n);
        parts.opportunity = opportunityTerm(term, actor, n) + crisisGlory(term, actor, n);
        parts.ambition = ambitionTerm(term, actor);
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const res = ctx.fight(actor, n, 'challenge');
      ctx.emit('duel', res.aftermath === 'killed' ? 'major' : 'notable', res.headline, res.detail, [actor.id, n.id], res.aftermath === 'killed' ? 'bad' : 'neutral');
      ctx.chronicle('duel', res.headline, [res.winner.id, res.loser.id], rankIndex(res.winner.rank) >= 2);
      if (res.winner.alive && res.loser !== res.winner) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- ATTACK */
  {
    id: 'attack',
    name: 'ATTACK',
    blurb: 'Settle something with whoever is standing in front of them.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (sameFaction(actor, n) && !actor.rivalries.includes(n.id)) continue;
        const parts = emptyParts();
        parts.base = 4 - travelPenalty(actor, n, term);
        parts.personality = p.aggression * 3 + p.challenge * 1.6;
        parts.relationship = relationTerm(term, actor, n);
        parts.memory = memoryHeat(actor, ['RIVAL_DEFEATED_ME', 'I_WAS_ROBBED_BY', 'I_LOST_TERRITORY_TO'], n.id, term.turn) * 2.4;
        parts.need = -(s.injury / 100) * 7;
        parts.danger = dangerTerm(term, actor, n);
        parts.opportunity = opportunityTerm(term, actor, n) + crisisGlory(term, actor, n);
        parts.ambition = ambitionTerm(term, actor) * 0.4;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const res = ctx.fight(actor, n, 'duel');
      ctx.emit('duel', res.aftermath === 'killed' ? 'major' : 'notable', res.headline, res.detail, [actor.id, n.id], res.aftermath === 'killed' ? 'bad' : 'neutral');
      ctx.chronicle('duel', res.headline, [res.winner.id, res.loser.id], rankIndex(res.winner.rank) >= 2);
      if (res.winner.alive) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- REVENGE */
  {
    id: 'revenge',
    name: 'REVENGE',
    blurb: 'Go and answer for something.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      for (const id of new Set([...s.revengeTargets, ...s.escapedFrom])) {
        const n = ctx.mgr.byId(id);
        if (!n || !n.alive || n.id === actor.id) continue;
        const parts = emptyParts();
        // Revenge crosses the map. That is what makes it revenge.
        parts.base = 9 - travelPenalty(actor, n, term) * 0.35;
        parts.personality = p.revenge * 5 + p.hunt * 1.6;
        parts.relationship = relationTerm(term, actor, n) * 0.5;
        parts.memory =
          memoryHeat(actor, ['I_WAS_HUMILIATED_BY', 'I_FLED_FROM', 'MY_MASTER_FELL', 'I_WAS_BETRAYED', 'I_WAS_ROBBED_BY'], n.id, term.turn) * 4.5 +
          memoryHeat(actor, ['RIVAL_DEFEATED_ME'], n.id, term.turn) * 2;
        // Old grudges get louder, not quieter, when they are the standing goal.
        parts.need = s.goal === 'revenge' && s.goalTargetId === n.id ? 3 + Math.min(6, s.goalAge * 1.1) : 0;
        parts.danger = dangerTerm(term, actor, n) * 0.7;
        parts.opportunity = opportunityTerm(term, actor, n) + crisisGlory(term, actor, n) * 0.7;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const s = simOf(actor);
      const returning = s.escapedFrom.includes(n.id);
      const res = ctx.fight(actor, n, 'hunt');
      const extra = returning ? [`${fullName(actor)} ran from ${fullName(n)} once. Not this time.`] : [];
      ctx.emit(
        'revenge',
        res.aftermath === 'killed' ? 'legendary' : 'major',
        res.headline,
        [...extra, ...res.detail],
        [actor.id, n.id],
        res.winner.id === actor.id ? 'good' : 'bad'
      );
      ctx.chronicle('revenge', res.headline, [res.winner.id, res.loser.id], true, 'bad');
      if (res.winner.id === actor.id) {
        s.escapedFrom = s.escapedFrom.filter((x) => x !== n.id);
        s.revengeTargets = s.revengeTargets.filter((x) => x !== n.id);
        ctx.deed(actor, `answered ${fullName(n)}`, 3);
        if (returning) ctx.deed(actor, `came back for ${fullName(n)} after running from them`, 4);
      }
      if (res.winner.alive) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- HUNT */
  {
    id: 'hunt',
    name: 'HUNT',
    blurb: 'Go looking for someone the world has put a price on.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        const bounty = term.cond.weight(n.id, 'bounty');
        const mark = term.cond.weight(n.id, 'mark');
        const exposed = term.cond.weight(n.id, 'exposure');
        if (bounty <= 0 && mark <= 0 && exposed <= 0) continue;
        if (sameFaction(actor, n) && bounty <= 0) continue;
        const parts = emptyParts();
        parts.base = 3;
        parts.personality = p.hunt * 3.2 + p.steal * 1.4 + p.ambition * 1.2;
        parts.relationship = relationTerm(term, actor, n) * 0.6;
        parts.memory = memoryHeat(actor, ['RIVAL_DEFEATED_ME'], n.id, term.turn) * 1.5;
        parts.need = 0;
        parts.danger = dangerTerm(term, actor, n);
        parts.opportunity = opportunityTerm(term, actor, n) * 1.3 + crisisGlory(term, actor, n);
        parts.ambition = ambitionTerm(term, actor) * 0.5;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const bounty = ctx.cond.weight(n.id, 'bounty');
      const res = ctx.fight(actor, n, 'hunt');
      const detail = [...res.detail];
      if (bounty > 0) detail.unshift(`There was a price on ${fullName(n)}, and ${fullName(actor)} wanted it.`);
      ctx.emit('hunt', res.aftermath === 'killed' ? 'major' : 'notable', res.headline, detail, [actor.id, n.id], 'bad');
      ctx.chronicle('duel', res.headline, [res.winner.id, res.loser.id], true);
      if (res.winner.id === actor.id && bounty > 0 && res.aftermath === 'killed') {
        actor.level = Math.min(30, actor.level + 1);
        recomputePower(actor);
        ctx.deed(actor, `collected the price on ${fullName(n)}`, 3);
      }
      if (res.winner.alive) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
    },
  },

  /* ---------------------------------------------------------- BETRAY */
  {
    id: 'betray',
    name: 'BETRAY',
    blurb: 'Decide the arrangement has run its course.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const s = simOf(actor);
      const out: ActionOption[] = [];
      const bonds = new Set<string>([...(actor.master ? [actor.master] : []), ...actor.allies]);
      for (const id of bonds) {
        const n = ctx.mgr.byId(id);
        if (!n || !n.alive) continue;
        const parts = emptyParts();
        parts.base = 2.6;
        parts.personality = p.betray * 6.4 + p.ambition * 1.6;
        // Being close is what makes betrayal possible, so proximity is a plus
        // here where it is a minus everywhere else.
        parts.relationship = (actor.master === n.id ? 4 : 2.5) - (s.loyalty / 100) * 9;
        parts.memory =
          memoryHeat(actor, ['I_WAS_HUMILIATED_BY', 'I_WAS_ROBBED_BY'], n.id, term.turn) * 3 +
          memoryHeat(actor, ['I_WAS_DEMOTED'], null, term.turn) * 1.6;
        parts.need = -(s.injury / 100) * 4;
        parts.danger = dangerTerm(term, actor, n) * 0.8;
        // A rumour is exactly the excuse a traitor was waiting for.
        parts.opportunity = opportunityTerm(term, actor, n) + term.cond.between(actor.id, n.id, 'rumour') * 5;
        parts.ambition = ambitionTerm(term, actor) * 1.2;
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
      shakeFaction(ctx.god, simOf(actor).factionId, -14);
      ctx.deed(actor, `turned on ${fullName(n)}`, 3);

      const res = ctx.fight(actor, n, 'betrayal');
      ctx.emit(
        'betrayal',
        res.aftermath === 'killed' ? 'legendary' : 'major',
        `${fullName(actor)} TURNED ON ${fullName(n)}.`.toUpperCase(),
        [res.headline, ...res.detail],
        [actor.id, n.id],
        'bad'
      );
      ctx.chronicle('betrayal', `${fullName(actor)} turned on ${fullName(n)}.`, [actor.id, n.id], true, 'bad');
      if (res.winner.alive) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
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
      for (const n of others(ctx, actor)) {
        if (actor.allies.includes(n.id) || actor.rivalries.includes(n.id)) continue;
        if (!sameGround(actor, n) && !sameFaction(actor, n)) continue;
        const parts = emptyParts();
        parts.base = 3.4;
        parts.personality = p.ally * 3.6 + p.protect * 1.2;
        parts.relationship = -relationTerm(term, actor, n) * 0.5;
        parts.memory = memoryHeat(actor, ['I_WAS_SPARED_BY', 'I_SAVED_AN_ALLY'], n.id, term.turn) * 3;
        // Frightened, friendless people go looking for company.
        parts.need = (s.fear / 100) * 5 + (actor.allies.length === 0 ? 3 : -actor.allies.length * 1.4);
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
      ctx.emit('alliance', 'background', `${fullName(actor)} SWORE TO ${fullName(n)}.`, [`Two fewer people in this world are alone.`], [actor.id, n.id]);
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
        const threat = term.cond.weight(n.id, 'bounty') + term.cond.weight(n.id, 'mark') + ns.injury / 60;
        // Standing over somebody who is in no danger is not an action, it is a
        // pose. Without a threat this simply is not on the table.
        if (threat < 0.35) continue;
        // Somebody is already standing there. Two people in the same doorway is
        // not twice the protection, it is the same beat printed twice.
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
        duration: 2,
        note: `${fullName(actor)} is standing over them`,
        source: 'world',
      });
      const s = simOf(actor);
      s.loyalty = Math.min(100, s.loyalty + 6);
      remember(actor, 'I_SAVED_AN_ALLY', ctx.mgr.turn, n.id);
      ctx.emit('guard', 'background', `${fullName(actor)} PUT THEMSELVES BETWEEN ${fullName(n)} AND THE WORLD.`, [`Anyone coming for ${fullName(n)} has to go through them first.`], [actor.id, n.id], 'good');
    },
  },

  /* ---------------------------------------------------------- RECRUIT */
  {
    id: 'recruit',
    name: 'RECRUIT',
    blurb: 'Pull someone up out of the rabble.',
    enumerate(ctx, actor, term) {
      if (rankIndex(actor.rank) < 2) return [];
      if (ctx.living().length >= 20) return [];
      const p = getPersonality(actor.personality);
      const parts = emptyParts();
      parts.base = 2.6;
      parts.personality = p.ambition * 2.4 + p.protect * 1;
      parts.relationship = 0;
      parts.memory = 0;
      parts.need = actor.allies.length < 2 ? 3 : -1;
      parts.danger = 0;
      parts.opportunity = 0;
      parts.ambition = ambitionTerm(term, actor) * 0.6;
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
      ctx.emit('recruit', 'background', `${fullName(n)} CAME UP BEHIND ${fullName(actor)}.`, [`${fullName(actor)} has one more sword than they did.`], [actor.id, n.id]);
      ctx.chronicle('recruitment', `${fullName(n)} came up behind ${fullName(actor)}.`, [n.id, actor.id]);
    },
  },

  /* ---------------------------------------------------------- STEAL */
  {
    id: 'steal',
    name: 'STEAL',
    blurb: 'Take something that is not theirs.',
    enumerate(ctx, actor, term) {
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (!n.stolen.length) continue;
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
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      // Taking it is one thing. Being caught is another.
      const caught = ctx.rng.chance(0.45 + (n.power / Math.max(20, actor.power) - 1) * 0.2);
      if (caught) {
        const res = ctx.fight(actor, n, 'duel');
        ctx.emit('theft', 'notable', `${fullName(actor)} WAS CAUGHT GOING THROUGH ${fullName(n)}'S THINGS.`, [res.headline, ...res.detail], [actor.id, n.id], 'bad');
        makeRivals(actor, n);
        if (res.winner.alive) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
        return;
      }
      const item = n.stolen.pop();
      if (!item) return;
      actor.stolen.push(item);
      recomputePower(actor);
      recomputePower(n);
      makeRivals(actor, n);
      remember(actor, 'I_ROBBED_THEM', ctx.mgr.turn, n.id);
      remember(n, 'I_WAS_ROBBED_BY', ctx.mgr.turn, actor.id);
      ctx.wantRevenge(n, actor);
      ctx.deed(actor, `lifted ${item.name} from ${fullName(n)}`, 2);
      ctx.emit('theft', 'notable', `${fullName(actor)} TOOK ${item.name.toUpperCase()} FROM ${fullName(n)}.`, [`${fullName(n)} knows exactly who has it.`], [actor.id, n.id], 'gold');
      ctx.chronicle('weapon_theft', `${fullName(actor)} took ${item.name} from ${fullName(n)}.`, [actor.id, n.id], true, 'gold');
    },
  },

  /* ---------------------------------------------------------- SEIZE GROUND */
  {
    id: 'seize',
    name: 'SEIZE',
    blurb: 'Take ground off whoever is standing on it.',
    enumerate(ctx, actor, term) {
      if (rankIndex(actor.rank) < 1) return [];
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const area of AREAS) {
        const holder = ctx.mgr.territoryHolder(area.id);
        if (holder && holder.id === actor.id) continue;
        if (area.id === 'fortress' && rankIndex(actor.rank) < 3) continue;
        const parts = emptyParts();
        parts.base = 3 - (area.id === actor.territory ? 0 : 1.2);
        parts.personality = p.ambition * 3 + p.challenge * 1.2;
        parts.relationship = holder ? relationTerm(term, actor, holder) * 0.7 : 2;
        parts.memory = holder ? memoryHeat(actor, ['I_LOST_TERRITORY_TO'], holder.id, term.turn) * 3.5 : 0;
        parts.need = 0;
        parts.danger = holder ? dangerTerm(term, actor, holder) : 0;
        parts.opportunity =
          (holder ? opportunityTerm(term, actor, holder) : 3) + term.cond.weight(area.id, 'unrest') * 4;
        parts.ambition = ambitionTerm(term, actor);
        parts.noise = noiseTerm(term);
        out.push(opt({ id: area.id, name: AREA_NAMES[area.id] ?? area.name, areaId: area.id }, parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const areaId = target.areaId!;
      const holder = ctx.mgr.territoryHolder(areaId);
      const label = AREA_NAMES[areaId] ?? getArea(areaId).name;
      if (holder && holder.alive && holder.id !== actor.id) {
        const res = ctx.fight(actor, holder, 'war');
        if (res.winner.id !== actor.id) {
          ctx.emit('territory', 'notable', `${fullName(holder)} HELD ${label} AGAINST ${fullName(actor)}.`, res.detail, [holder.id, actor.id]);
          ctx.chronicle('territory', `${fullName(holder)} held ${label} against ${fullName(actor)}.`, [holder.id, actor.id]);
          return;
        }
        remember(actor, 'I_TOOK_TERRITORY_FROM', ctx.mgr.turn, holder.id);
        remember(holder, 'I_LOST_TERRITORY_TO', ctx.mgr.turn, actor.id);
        const hs = simOf(holder);
        ctx.wantRevenge(holder, actor);
        shakeFaction(ctx.god, hs.factionId, -10);
      }
      ctx.mgr.data.territories[areaId] = actor.id;
      actor.territory = areaId;
      actor.level = Math.min(30, actor.level + 1);
      recomputePower(actor);
      ctx.deed(actor, `took ${label}`, 2);
      ctx.emit('territory', 'major', `${fullName(actor)} TOOK ${label}.`, [`${label} answers to ${fullName(actor)} now.`], [actor.id], 'gold');
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
      const p = getPersonality(actor.personality);
      const out: ActionOption[] = [];
      for (const areaId of holds) {
        const parts = emptyParts();
        parts.base = 2;
        parts.personality = p.protect * 2.6 - p.challenge * 1;
        parts.relationship = 0;
        parts.memory = memoryHeat(actor, ['I_LOST_TERRITORY_TO'], null, term.turn) * 2.5;
        parts.need = (simOf(actor).fear / 100) * 4;
        parts.danger = 0;
        parts.opportunity = term.cond.weight(areaId, 'unrest') * 3.5;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt({ id: areaId, name: AREA_NAMES[areaId] ?? areaId, areaId }, parts));
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
      shakeFaction(ctx.god, simOf(actor).factionId, 5);
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
      for (const area of AREAS) {
        if (area.id === actor.territory) continue;
        const parts = emptyParts();
        parts.base = 1.2;
        parts.personality = getPersonality(actor.personality).hunt * 0.8;
        parts.relationship = 0;
        parts.memory = 0;
        // Fear moves people off dangerous ground.
        parts.need = (s.fear / 100) * (5 - area.danger) * 0.9;
        parts.danger = area.danger * 0.6;
        parts.opportunity = goalTarget && goalTarget.territory === area.id ? 6 : 0;
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt({ id: area.id, name: AREA_NAMES[area.id] ?? area.name, areaId: area.id }, parts));
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
      const hunted =
        term.cond.weight(actor.id, 'bounty') + term.cond.weight(actor.id, 'mark') + term.cond.weight(actor.id, 'exposure');
      const parts = emptyParts();
      parts.base = 0.8;
      parts.personality = p.survival * 3.4 - p.challenge * 1.2;
      parts.relationship = 0;
      parts.memory = memoryHeat(actor, ['I_FLED_FROM', 'I_WAS_HUMILIATED_BY'], null, term.turn) * 1.6;
      parts.need = (s.fear / 100) * 8 + (s.injury / 100) * 6;
      parts.danger = 0;
      parts.opportunity = hunted * 4.5;
      parts.ambition = -ambitionTerm(term, actor) * 0.4;
      parts.noise = noiseTerm(term);
      return [opt(NONE, parts)];
    },
    perform(ctx, actor) {
      const s = simOf(actor);
      s.hiddenUntil = ctx.god.cycle + 2;
      s.fear = Math.max(0, s.fear - 10);
      s.goal = 'hide';
      ctx.emit('hide', 'background', `${fullName(actor)} STOPPED BEING SOMEWHERE.`, ['Nobody will find them for a cycle or two.'], [actor.id]);
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
      ctx.emit('recover', 'background', `${fullName(actor)} SPENT THE CYCLE PUTTING THEMSELVES BACK TOGETHER.`, [`Wounds ${before} → ${s.injury}.`], [actor.id]);
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
    enumerate(ctx, actor, term) {
      const lost = actor.stolenFromThem ?? [];
      if (!lost.length) return [];
      const out: ActionOption[] = [];
      for (const n of others(ctx, actor)) {
        if (!n.stolen.some((it) => lost.some((l) => l.name === it.name))) continue;
        const parts = emptyParts();
        parts.base = 6;
        parts.personality = getPersonality(actor.personality).steal * 2 + getPersonality(actor.personality).revenge * 2;
        parts.relationship = relationTerm(term, actor, n) * 0.6;
        parts.memory = memoryHeat(actor, ['I_WAS_ROBBED_BY'], n.id, term.turn) * 4;
        parts.need = 0;
        parts.danger = dangerTerm(term, actor, n) * 0.8;
        parts.opportunity = opportunityTerm(term, actor, n);
        parts.ambition = 0;
        parts.noise = noiseTerm(term);
        out.push(opt(tgt(n), parts));
      }
      return out;
    },
    perform(ctx, actor, target) {
      const n = target.nemesis!;
      const res = ctx.fight(actor, n, 'hunt');
      let recovered = '';
      if (res.winner.id === actor.id) {
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
      ctx.emit(
        'reclaim',
        'major',
        recovered ? `${fullName(actor)} TOOK ${recovered.toUpperCase()} BACK.` : res.headline,
        [res.headline, ...res.detail],
        [actor.id, n.id],
        recovered ? 'gold' : 'neutral'
      );
      if (res.winner.alive) climbAfterWin(ctx, res.winner, res.loser, res.duel.margin);
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
      parts.base = 1.4;
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
      if (who && who.alive && !s.revengeTargets.includes(who.id)) {
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
      const blessed = ctx.god.conditions.filter((c) => c.kind === 'blessing' || c.kind === 'ward');
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
        ],
        [actor.id],
        'bad'
      );
      ctx.chronicle('revenge', `${fullName(actor)} turned against the hand that has been moving things.`, [actor.id], true, 'bad');
    },
  },
];

export const ACTION_MAP = new Map(ACTIONS.map((a) => [a.id, a]));
