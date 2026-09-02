/**
 * The SIMULATE phase.
 *
 * Everyone alive considers everything they could do, scores it, and does the
 * thing that scored highest. Nothing in here knows what *should* happen; there
 * is no story director, no pacing rule that promotes a specific character, no
 * table of dramatic events. The only lever the run structure pulls is how much
 * pressure everyone is under, and the only lever the player pulls is what
 * conditions exist to be scored against.
 *
 * RECONSTRUCTION: the cycle is deliberately quieter than it was. Two to four
 * fights among a dozen people, returns from death measured in runs rather
 * than cycles, wars declared over a grievance and ended when the grievance is
 * gone. A world in which everything happens every cycle is a world in which
 * nothing does.
 */

import type { RNG } from '../core/RNG';
import { getPersonality } from '../data/personalities';
import { traitsOfKind } from '../data/traits';
import { AREA_NAMES } from '../data/names';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar } from '../nemesis/NemesisMemory';
import { ACTIONS, FIGHT_ACTIONS, type ActionDef, type ActionOption, type ActionTarget } from './Actions';
import { addCondition, expireConditions } from './Conditions';
import type { GodContext } from './Context';
import { declareWar, factionOf, livingFactions, makePeace, reconcileFactions, reformHouses, settleFactions } from './Factions';
import { simOf, type Decision, type ScoreBreakdown } from './GodTypes';
import { simulateSkirmishes } from './Skirmish';
import { sumParts, type TermCtx } from './Utility';

/** Actions that can retarget a held grudge when scored against a nemesis. */
const GRUDGE_TARGET_ACTIONS = new Set(['revenge', 'attack', 'hunt', 'challenge', 'betray']);

const OVERLORD_RETURN_IMMUNITY_TURNS = 3;
/** Cycles that must pass after any return before the ground opens again. */
const RETURN_COOLDOWN = 7;
/** Cycles somebody has to stay dead before anyone starts wondering. */
const RETURN_MIN_DEAD = 3;

const MAX_CONSIDERED = 7;

function isNemesisTarget(target: ActionTarget): boolean {
  return !!target.nemesis && !!target.id && !target.areaId;
}

/** Persist or advance grudge goals after an action is chosen (G-3). */
export function applyGoalAfterAction(
  s: ReturnType<typeof simOf>,
  defId: string,
  target: ActionTarget,
  goalBefore: ReturnType<typeof simOf>['goal']
): void {
  // Seize and other non-nemesis picks must not touch grudge state.
  if (!isNemesisTarget(target)) {
    if (s.goal === goalBefore) s.goalAge++;
    return;
  }

  if (!FIGHT_ACTIONS.has(defId)) {
    if (s.goal === goalBefore) s.goalAge++;
    return;
  }

  const tid = target.id!;
  let goalAgeTicked = false;

  if (s.goal === 'revenge' && s.goalTargetId) {
    if (s.goalTargetId === tid) {
      s.goalAge++;
      goalAgeTicked = true;
    } else if (defId === 'revenge') {
      s.goalTargetId = tid;
      s.goalAge = 0;
      goalAgeTicked = true;
    }
  } else if (GRUDGE_TARGET_ACTIONS.has(defId)) {
    if (s.goalTargetId === tid) {
      s.goalAge++;
      goalAgeTicked = true;
    } else {
      s.goalTargetId = tid;
      s.goalAge = 0;
      goalAgeTicked = true;
    }
  }

  if (s.goal === goalBefore && !goalAgeTicked) s.goalAge++;
}

export interface CycleResult {
  cycle: number;
  deaths: string[];
  decisions: Decision[];
  fights: number;
  skirmishes: number;
  /** the god's own investments that lost a fight this cycle */
  blessedLosers: string[];
}

/** Everything one character could do right now, scored. Shared with the forecast. */
export function enumerateOptions(
  ctx: GodContext,
  actor: Nemesis,
  term: TermCtx
): Array<{ def: ActionDef; option: ActionOption; total: number }> {
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
  options.sort((a, b) => b.total - a.total);
  return options;
}

export function fightBudgetFor(actorCount: number, tempo: number, chaos: number): number {
  let budget = Math.max(2, Math.round(actorCount * 0.3 * tempo));
  if (chaos > 40) budget += 1;
  return budget;
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
    now: ctx.now,
    pressure: ctx.act.pressure,
    rng,
  };

  /* ---- 2. everyone decides ---- */
  const actors = orderOfPlay(ctx, rng);
  const decisions: Decision[] = [];
  const fightBudget = fightBudgetFor(actors.length, ctx.act.tempo, god.chaos);
  let fights = 0;

  for (const actor of actors) {
    if (!actor.alive) continue;
    const s = simOf(actor);
    const options = enumerateOptions(ctx, actor, term);
    if (!options.length) continue;

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

    const before = s.goal;
    s.lastActionId = picked.def.id;
    s.lastCycle = god.cycle;
    applyGoalAfterAction(s, picked.def.id, picked.option.target, before);

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
  const skirmishes = simulateSkirmishes(ctx);

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
  rollPeace(ctx);
  seedUnrest(ctx);

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

export function toBreakdown(def: ActionDef, option: ActionOption, total: number): ScoreBreakdown {
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
function driftState(ctx: GodContext, n: Nemesis): void {
  const s = simOf(n);
  const p = getPersonality(n.personality);
  const hungry = (ctx.mgr.data.godUnlocks ?? []).includes('world_hungry');
  s.fear = Math.max(0, s.fear - 3);
  s.injury = Math.max(0, s.injury - 4);
  s.confidence = clamp01to100(s.confidence + (s.wins - s.losses) * 0.3 * (hungry ? 1.25 : 1) - (hungry ? 0.8 : 0.5));
  s.ambition = clamp01to100(
    s.ambition + (p.ambition - 1) * 2.2 * (hungry ? 1.35 : 1) + (rankIndex(n.rank) >= 3 ? -1 : 0.6) * (hungry ? 1.4 : 1)
  );
  // A treacherous nature erodes its own bonds. This is the slow fuse under
  // every alliance in the world, and it is why "swear to each other" is not a
  // permanent state.
  s.loyalty = clamp01to100(s.loyalty + (p.betray > 1.2 ? -2.2 : 0.8) - (s.reputation < 0 ? 1 : 0));
  s.reputation = Math.max(-100, s.reputation - (hungry ? 0.8 : 0.5));
  if (s.goalAge > (hungry ? 10 : 14) && s.goal !== 'revenge') {
    s.goal = 'survive';
    s.goalAge = 0;
  }
}

function clamp01to100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** The turn somebody last came back, anywhere in the roster. */
function lastReturnTurn(ctx: GodContext): number {
  let last = -Infinity;
  for (const n of ctx.mgr.roster) {
    for (const m of n.memory) if (m.type === 'I_RETURNED_FROM_DEATH' && m.turn > last) last = m.turn;
  }
  return last;
}

/**
 * Returns are rare and always cost something. A death that reverses every
 * couple of cycles is not a death; the design wants one or two a run, each of
 * them an event the whole world reacts to. Chaos buys more of them, which is
 * one of the ways an over-managed world becomes an unmanageable one.
 */
function rollReturns(ctx: GodContext): void {
  const rng = ctx.rng;
  if (ctx.mgr.turn - lastReturnTurn(ctx) < RETURN_COOLDOWN) return;
  const chaosMul = 1 + ctx.god.chaos * 0.02;
  const base = 0.025 * ctx.mgr.mods.resurrection * chaosMul;
  for (const n of ctx.mgr.dead()) {
    if (n.persistent === false) continue;
    if (n.rank === 'overlord' && n.diedOnTurn != null) {
      if (ctx.mgr.turn - n.diedOnTurn < OVERLORD_RETURN_IMMUNITY_TURNS) continue;
      if (ctx.mgr.suppressOverlordReturnsUntilTurn > ctx.mgr.turn) continue;
    }
    const since = n.diedOnTurn == null ? RETURN_MIN_DEAD : ctx.mgr.turn - n.diedOnTurn;
    if (since < RETURN_MIN_DEAD) continue;
    const s = simOf(n);
    const p = getPersonality(n.personality);
    const killer = ctx.mgr.byId(s.killedById);
    // What brings somebody back is a reason: a nature that does not stay down,
    // and someone alive to come back for.
    let chance = base;
    chance += (p.survival - 1) * 0.04;
    if (killer && killer.alive) chance += 0.03;
    if (n.revengeChance > 0.3) chance += 0.02;
    if (n.returns >= 1) chance *= 0.35;
    if (!rng.chance(Math.max(0, Math.min(0.16, chance)))) continue;

    const label = ctx.scar(n, 'death');
    const pool = traitsOfKind(rng.chance(0.35) ? 'mutation' : 'strength').filter((t) => !n.strengths.includes(t.id));
    if (pool.length && n.strengths.length < 5) n.strengths.push(rng.pick(pool).id);
    ctx.mgr.resurrect(n, label);
    s.fear = Math.max(0, s.fear - 20);
    s.confidence = Math.min(100, s.confidence + 15);
    s.injury = 30;
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

/**
 * Wars start over something. A leader who wants the other leader dead, a
 * member killed by the other house, ground taken. Two houses that merely
 * exist next to each other do not go to war because a die came up.
 */
export function grievanceBetween(ctx: GodContext, a: { leaderId: string | null; memberIds: string[] }, b: { leaderId: string | null; memberIds: string[] }): number {
  const la = ctx.mgr.byId(a.leaderId);
  const lb = ctx.mgr.byId(b.leaderId);
  if (!la || !lb) return 0;
  let g = 0;
  const sa = simOf(la);
  if (sa.revengeTargets.includes(lb.id)) g += 1;
  if (la.rivalries.includes(lb.id)) g += 0.35;
  const bMembers = new Set(b.memberIds);
  for (const id of a.memberIds) {
    const m = ctx.mgr.byId(id);
    if (!m || !m.alive) continue;
    const ms = simOf(m);
    if (ms.revengeTargets.some((t) => bMembers.has(t))) g += 0.3;
    for (const mem of m.memory) {
      if (mem.subject && bMembers.has(mem.subject) && (mem.type === 'I_LOST_TERRITORY_TO' || mem.type === 'MY_MASTER_FELL' || mem.type === 'I_WAS_BETRAYED')) {
        g += Math.max(0, 0.4 - (ctx.mgr.turn - mem.turn) * 0.05);
      }
    }
  }
  return g;
}

function rollFactionWar(ctx: GodContext): void {
  // On the offscreen path the houses are rebuilt every beat, so a war would
  // be declared and forgotten inside the same turn. Wars belong to god runs.
  if (ctx.ephemeralGod) return;
  const live = livingFactions(ctx.god);
  if (live.length < 2) return;
  for (const a of live) {
    for (const b of live) {
      if (a.id >= b.id || a.warWith.includes(b.id)) continue;
      const la = ctx.mgr.byId(a.leaderId);
      const lb = ctx.mgr.byId(b.leaderId);
      if (!la || !lb) continue;
      const grievance = grievanceBetween(ctx, a, b) + grievanceBetween(ctx, b, a);
      if (grievance <= 0) continue;
      let p = 0.01 + grievance * 0.18;
      p += ((a.aggression + b.aggression) / 200) * 0.06;
      p *= ctx.act.pressure;
      if (!ctx.rng.chance(Math.min(0.6, p))) continue;
      if (!declareWar(a, b)) continue;
      ctx.emit(
        'faction',
        'legendary',
        `${a.name} AND ${b.name} ARE AT WAR.`,
        [
          `${fullName(la)} and ${fullName(lb)} have stopped being careful with each other.`,
          'Everyone sworn to either of them just got a reason to swing, and the ground between them will bleed.',
        ],
        [la.id, lb.id],
        'bad'
      );
      ctx.chronicle('territory', `${a.name} and ${b.name} went to war.`, [la.id, lb.id], true, 'bad');
      return;
    }
  }
}

/** Wars end when nobody left alive has a reason to keep fighting them. */
function rollPeace(ctx: GodContext): void {
  if (ctx.ephemeralGod) return;
  for (const a of livingFactions(ctx.god)) {
    for (const bid of a.warWith.slice()) {
      const b = factionOf(ctx.god, bid);
      if (!b || a.id >= b.id) continue;
      // The war that is the crisis does not end at a table.
      const crisis = ctx.god.crisis;
      if (crisis && crisis.resolved === 'none' && crisis.kind === 'civil_war' && (crisis.factionId === a.id || crisis.factionId === b.id)) continue;
      const grievance = grievanceBetween(ctx, a, b) + grievanceBetween(ctx, b, a);
      if (grievance > 0.3) continue;
      const exhausted = Math.min(a.stability, b.stability) < 45;
      const p = exhausted ? 0.35 : 0.18;
      if (!ctx.rng.chance(p)) continue;
      makePeace(a, b);
      const la = ctx.mgr.byId(a.leaderId);
      const lb = ctx.mgr.byId(b.leaderId);
      ctx.emit(
        'faction',
        'major',
        `${a.name} AND ${b.name} STOPPED FIGHTING.`,
        ['Nobody left alive on either side had a reason to keep it going.', exhausted ? 'Both houses are worn thin.' : 'It will hold until somebody gives them a new reason.'],
        [la?.id, lb?.id].filter((x): x is string => !!x),
        'good'
      );
      ctx.chronicle('alliance', `${a.name} and ${b.name} made peace.`, [], true, 'good');
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
