/**
 * The SIMULATE phase.
 *
 * Everyone alive considers everything they could do, scores it, and does the
 * thing that scored highest. Nothing in here knows what *should* happen; there
 * is no story director, no pacing rule that promotes a specific character, no
 * table of dramatic events. The only lever the run structure pulls is how much
 * pressure everyone is under, and the only lever the player pulls is what
 * conditions exist to be scored against.
 */

import type { RNG } from '../core/RNG';
import { getPersonality } from '../data/personalities';
import { traitsOfKind } from '../data/traits';
import { AREA_NAMES } from '../data/names';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar } from '../nemesis/NemesisMemory';
import { ACTIONS, type ActionDef, type ActionOption } from './Actions';
import { addCondition, expireConditions } from './Conditions';
import type { GodContext } from './Context';
import { declareWar, livingFactions, reconcileFactions, reformHouses, settleFactions } from './Factions';
import { simOf, type Decision, type ScoreBreakdown } from './GodTypes';
import { simulateSkirmishes } from './Skirmish';
import { sumParts, type TermCtx } from './Utility';

/** Actions that consume the cycle's appetite for violence. */
const FIGHT_ACTIONS = new Set(['attack', 'challenge', 'revenge', 'hunt', 'betray', 'seize', 'pursue_item', 'steal']);

const MAX_CONSIDERED = 7;

export interface CycleResult {
  cycle: number;
  deaths: string[];
  decisions: Decision[];
  fights: number;
  skirmishes: number;
  /** the god's own investments that lost a fight this cycle */
  blessedLosers: string[];
}

export function simulateCycle(ctx: GodContext): CycleResult {
  const god = ctx.god;
  const rng = ctx.rng;

  /* ---- 1. the world forgets ---- */
  const expired = expireConditions(god);
  for (const c of expired) {
    if (c.source !== 'god') continue;
    const who = ctx.mgr.byId(c.targetId);
    if (!who) continue;
    ctx.emit('condition', 'background', `${CONDITION_FADE[c.kind] ?? 'SOMETHING'} FADED FROM ${fullName(who)}.`, [c.note], [who.id]);
  }
  ctx.refreshConditions();

  const term: TermCtx = {
    god,
    cond: ctx.cond,
    turn: ctx.mgr.turn,
    pressure: ctx.act.pressure,
    rng,
  };

  /* ---- 2. everyone decides ---- */
  const actors = orderOfPlay(ctx, rng);
  const decisions: Decision[] = [];
  let fightBudget = Math.max(4, Math.round(actors.length * 0.62 * ctx.act.tempo));
  let fights = 0;
  let skirmishes = 0;

  for (const actor of actors) {
    if (!actor.alive) continue;
    const s = simOf(actor);
    const options: Array<{ def: ActionDef; option: ActionOption; total: number }> = [];

    for (const def of ACTIONS) {
      let list: ActionOption[];
      try {
        list = def.enumerate(ctx, actor, term);
      } catch (err) {
        console.error('[god] enumerate failed for ' + def.id, err);
        continue;
      }
      for (const option of list) {
        if (option.veto) continue;
        options.push({ def, option, total: sumParts(option.parts) });
      }
    }

    if (!options.length) continue;
    options.sort((a, b) => b.total - a.total);

    // Fights are rationed so a cycle stays readable. When the ration is spent
    // the actor does not stand still — they do the next thing they wanted.
    let picked = options[0];
    let rationed: Decision['rationed'];
    if (FIGHT_ACTIONS.has(picked.def.id) && fights >= fightBudget) {
      const fallback = options.find((o) => !FIGHT_ACTIONS.has(o.def.id));
      if (fallback) {
        rationed = {
          actionName: picked.def.name,
          targetName: picked.option.target.name,
          total: Math.round(picked.total * 100) / 100,
        };
        picked = fallback;
      }
    }
    if (FIGHT_ACTIONS.has(picked.def.id)) fights++;

    const chosen = toBreakdown(picked.def, picked.option, picked.total);
    // The god's own marks on the target, captured for the taken option only.
    // This is what lets the feed say "you had put a price on his head" instead
    // of "opportunity +4.5".
    if (picked.option.target.id) {
      const marks = ctx.cond
        .on(picked.option.target.id)
        .filter((c) => c.source === 'god' && c.targetId === picked.option.target.id)
        .map((c) => c.kind);
      if (marks.length) chosen.marks = Array.from(new Set(marks));
    }
    const decision: Decision = {
      cycle: god.cycle,
      actorId: actor.id,
      actorName: fullName(actor),
      chosen,
      considered: options.slice(0, MAX_CONSIDERED).map((o) => toBreakdown(o.def, o.option, o.total)),
    };
    if (rationed) decision.rationed = rationed;
    decisions.push(decision);

    // Goals are what a character keeps wanting, so they persist across cycles
    // and get louder — that is what makes a long grudge behave like a story.
    const before = s.goal;
    s.lastActionId = picked.def.id;
    s.lastCycle = god.cycle;
    if (picked.option.target.nemesis && FIGHT_ACTIONS.has(picked.def.id)) {
      const tid = picked.option.target.id;
      if (s.goal === 'revenge' || picked.def.id === 'attack' || picked.def.id === 'hunt' || picked.def.id === 'challenge' || picked.def.id === 'betray') {
        if (s.goalTargetId === tid) s.goalAge++;
        else {
          s.goalTargetId = tid;
          s.goalAge = 0;
        }
      }
    }
    if (s.goal === before) s.goalAge++;

    ctx.attributing = decision;
    try {
      picked.def.perform(ctx, actor, picked.option.target);
    } catch (err) {
      console.error('[god] perform failed for ' + picked.def.id, err);
    }
    ctx.attributing = null;
    ctx.refreshConditions();
    term.cond = ctx.cond;
  }

  /* ---- 2b. the war on the ground ---- */
  skirmishes = simulateSkirmishes(ctx);

  /* ---- 3. the dead get their chance ---- */
  rollReturns(ctx);

  /* ---- 4. drift ---- */
  for (const n of ctx.living()) driftState(ctx, n);

  /* ---- 5. the houses settle up ---- */
  for (const note of reconcileFactions(god, ctx.mgr)) {
    ctx.emit('faction', 'major', note.toUpperCase(), ['A house changing hands changes what everyone under it wants.'], [], 'bad');
    ctx.chronicle('succession', note, [], true, 'bad');
  }
  settleFactions(god, ctx.mgr);
  const reformed = reformHouses(god, ctx.mgr, rng, god.cycle);
  if (reformed) {
    ctx.emit('faction', 'major', reformed.toUpperCase(), ['Power organises. It always has.'], [], 'gold');
    ctx.chronicle('alliance', reformed, [], true, 'gold');
  }
  rollFactionWar(ctx);
  seedUnrest(ctx);

  /* ---- 6. the hierarchy makes itself consistent ---- */
  for (const ev of ctx.mgr.fillRanks()) {
    if (ev.type === 'promotion') {
      ctx.emit('promotion', 'notable', ev.text, ['The order closed up around a gap.'], ev.actors, 'gold');
    }
  }
  ctx.mgr.assignTerritories();
  for (const n of ctx.mgr.roster) recomputePower(n);

  god.rngState = rng.state;
  return { cycle: god.cycle, deaths: ctx.deaths.slice(), decisions, fights, skirmishes, blessedLosers: ctx.blessedLosers.slice() };
}

/* ============================================================
   order of play
   ============================================================ */

/**
 * Initiative, not rank order. A frightened overlord can be beaten to the punch
 * by a confident elite, which is how the small ones get their openings.
 */
function orderOfPlay(ctx: GodContext, rng: RNG): Nemesis[] {
  return ctx
    .living()
    .map((n) => {
      const s = simOf(n);
      const p = getPersonality(n.personality);
      const init =
        n.power * 0.05 + s.confidence * 0.35 + s.ambition * 0.25 + p.aggression * 20 - s.injury * 0.25 + rng.range(0, 26);
      return { n, init };
    })
    .sort((a, b) => b.init - a.init)
    .map((x) => x.n);
}

function toBreakdown(def: ActionDef, option: ActionOption, total: number): ScoreBreakdown {
  const out: ScoreBreakdown = {
    actionId: def.id,
    actionName: def.name,
    targetId: option.target.id,
    targetName: option.target.name,
    targetKind: option.target.areaId ? 'place' : option.target.id ? 'nemesis' : 'none',
    total: Math.round(total * 100) / 100,
    parts: option.parts,
  };
  if (option.veto) out.veto = option.veto;
  return out;
}

/* ============================================================
   between cycles
   ============================================================ */

/** Feelings move. Nothing here is an event; it is the weather. */
function driftState(_ctx: GodContext, n: Nemesis): void {
  const s = simOf(n);
  const p = getPersonality(n.personality);
  s.fear = Math.max(0, s.fear - 3);
  s.injury = Math.max(0, s.injury - 4);
  s.confidence = clamp01to100(s.confidence + (s.wins - s.losses) * 0.4 - 0.5);
  s.ambition = clamp01to100(s.ambition + (p.ambition - 1) * 2.2 + (rankIndex(n.rank) >= 3 ? -1 : 0.6));
  // A treacherous nature erodes its own bonds. This is the slow fuse under
  // every alliance in the world, and it is why "swear to each other" is not a
  // permanent state.
  s.loyalty = clamp01to100(s.loyalty + (p.betray > 1.2 ? -3.4 : 0.8) - (s.reputation < 0 ? 1 : 0));
  s.reputation = Math.max(-100, s.reputation - 0.5);
  if (s.goalAge > 14 && s.goal !== 'revenge') {
    s.goal = 'survive';
    s.goalAge = 0;
  }
}

function clamp01to100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/**
 * Returns are rare and always cost something. Chaos buys more of them, which
 * is one of the ways an over-managed world becomes an unmanageable one.
 */
function rollReturns(ctx: GodContext): void {
  const rng = ctx.rng;
  const base = ctx.mgr.mods.resurrection * (1 + ctx.god.chaos * 0.012);
  for (const n of ctx.mgr.dead()) {
    const since = ctx.god.cycle - (simOf(n).lastCycle || 0);
    if (since < 2) continue;
    const s = simOf(n);
    const p = getPersonality(n.personality);
    let chance = base * 0.13 + n.revengeChance * 0.16 + (s.revengeTargets.length ? 0.05 : 0);
    chance *= p.survival;
    if (n.returns >= 1) chance *= 0.4;
    if (!rng.chance(Math.min(0.24, chance))) continue;

    const label = ctx.scar(n, 'death');
    const pool = traitsOfKind(rng.chance(0.35) ? 'mutation' : 'strength').filter((t) => !n.strengths.includes(t.id));
    if (pool.length && n.strengths.length < 5) n.strengths.push(rng.pick(pool).id);
    ctx.mgr.resurrect(n, label);
    s.fear = Math.max(0, s.fear - 20);
    s.confidence = Math.min(100, s.confidence + 15);
    const killer = ctx.mgr.byId(s.killedById);
    if (killer && killer.alive && !s.revengeTargets.includes(killer.id)) {
      s.revengeTargets.push(killer.id);
      s.goal = 'revenge';
      s.goalTargetId = killer.id;
      s.goalAge = 0;
    }
    ctx.deed(n, 'came back from the dead', 4);
    ctx.emit(
      'return',
      'legendary',
      `${fullName(n)} WAS NOT AS DEAD AS EVERYONE THOUGHT.`,
      [
        label ? `They came back with ${label.toLowerCase()}.` : 'They came back changed.',
        killer && killer.alive ? `${fullName(killer)} put them in the ground. That is now ${fullName(killer)}'s problem.` : 'Nobody has worked out how yet.',
      ],
      [n.id, ...(killer ? [killer.id] : [])],
      'bad'
    );
    break; // at most one per cycle, or a return stops being an event
  }
}

/** Two houses that keep bumping into each other eventually stop pretending. */
function rollFactionWar(ctx: GodContext): void {
  const live = livingFactions(ctx.god);
  if (live.length < 2) return;
  for (const a of live) {
    for (const b of live) {
      if (a.id >= b.id || a.warWith.includes(b.id)) continue;
      const la = ctx.mgr.byId(a.leaderId);
      const lb = ctx.mgr.byId(b.leaderId);
      if (!la || !lb) continue;
      let p = 0.03;
      if (la.rivalries.includes(lb.id)) p += 0.3;
      p += ((a.aggression + b.aggression) / 200) * 0.16;
      p += Math.max(0, 60 - Math.min(a.stability, b.stability)) * 0.002;
      p *= ctx.act.pressure;
      if (!ctx.rng.chance(p)) continue;
      if (!declareWar(a, b)) continue;
      ctx.emit(
        'faction',
        'major',
        `${a.name} AND ${b.name} ARE AT WAR.`,
        [
          `${fullName(la)} and ${fullName(lb)} have stopped being careful with each other.`,
          'Everyone sworn to either of them just got a reason to swing.',
        ],
        [la.id, lb.id],
        'bad'
      );
      ctx.chronicle('betrayal', `${a.name} and ${b.name} went to war.`, [la.id, lb.id], true, 'bad');
      return;
    }
  }
}

/** Ground held by a fracturing house is ground people start eyeing. */
function seedUnrest(ctx: GodContext): void {
  for (const f of livingFactions(ctx.god)) {
    if (f.stability >= 38) continue;
    for (const areaId of f.territories) {
      addCondition(ctx.god, {
        kind: 'unrest',
        targetKind: 'area',
        targetId: areaId,
        magnitude: (38 - f.stability) / 60,
        duration: 2,
        note: `${f.name} is not holding ${AREA_NAMES[areaId] ?? areaId}`,
        source: 'world',
      });
    }
  }
  ctx.refreshConditions();
}

const CONDITION_FADE: Record<string, string> = {
  blessing: 'YOUR BLESSING',
  curse: 'YOUR CURSE',
  bounty: 'THE PRICE',
  rumour: 'THE RUMOUR',
  mark: 'THE MARK',
  ward: 'THE WARD',
  opportunity: 'THE OPENING',
  exposure: 'THE EXPOSURE',
  omen: 'THE OMEN',
  unrest: 'THE UNREST',
};

/** Used by the debug panel when someone needs to be visibly hurt. */
export function woundFor(ctx: GodContext, n: Nemesis, amount: number, cause: string): void {
  const s = simOf(n);
  s.injury = Math.min(100, s.injury + amount);
  if (s.injury > 70 && ctx.rng.chance(0.4)) applyScar(n, 'damaged_arm', ctx.mgr.turn, cause);
  recomputePower(n);
}

export { FIGHT_ACTIONS };
