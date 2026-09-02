/**
 * The scoring engine.
 *
 * Every living character considers everything it could plausibly do and scores
 * each option out of the same eight components. No `if` tree decides who
 * betrays whom; a traitor betrays because betrayal scores highest for a
 * traitor with a weak master, an old grudge and an open door, and a loyalist
 * does not because the same sum comes out differently for them.
 *
 *   score = base
 *         + personality   how much this KIND of person wants this kind of thing
 *         + relationship  what they are to the target
 *         + memory        what has already happened between them
 *         + need          injury, fear, confidence, what they lack
 *         - danger        what it would cost to be wrong
 *         + opportunity   conditions in the world, including the god's
 *         + ambition      how hard the act of the run is pushing everyone
 *         + noise         so the same board does not play out identically
 *
 * The full breakdown is kept, not just the total, because a system nobody can
 * inspect is a system nobody can tune.
 */

import type { RNG } from '../core/RNG';
import { getPersonality } from '../data/personalities';
import { countMemory, type MemoryType, type Nemesis } from '../nemesis/Nemesis';
import { rankIndex } from '../nemesis/Nemesis';
import type { ConditionIndex } from './Conditions';
import { atWar, factionFor } from './Factions';
import { simOf, type GodState, type ScoreParts } from './GodTypes';

export function emptyParts(): ScoreParts {
  return {
    base: 0,
    personality: 0,
    relationship: 0,
    memory: 0,
    need: 0,
    danger: 0,
    opportunity: 0,
    ambition: 0,
    noise: 0,
  };
}

export function sumParts(p: ScoreParts): number {
  return (
    p.base + p.personality + p.relationship + p.memory + p.need - p.danger + p.opportunity + p.ambition + p.noise
  );
}

/* ============================================================
   memory
   ============================================================ */

/** How loud a memory of `type` about `subject` still is, decayed by age. */
export function memoryHeat(n: Nemesis, types: MemoryType[], subjectId: string | null, nowTurn: number): number {
  let heat = 0;
  for (let i = n.memory.length - 1; i >= 0; i--) {
    const m = n.memory[i];
    if (!types.includes(m.type)) continue;
    if (subjectId && m.subject !== subjectId) continue;
    const age = Math.max(0, nowTurn - m.turn);
    heat += 1 / (1 + age * 0.22);
  }
  return heat;
}

export function totalMemory(n: Nemesis, type: MemoryType): number {
  return countMemory(n, type);
}

/* ============================================================
   shared terms
   ============================================================ */

export interface TermCtx {
  god: GodState;
  cond: ConditionIndex;
  turn: number;
  /** act pressure, roughly 0.8..1.8 */
  pressure: number;
  rng: RNG;
  /** the clock that advances on this path — see GodContext.now */
  now: number;
  /**
   * Forecast mode: no noise, no RNG consumption. The forecast engine scores
   * the same options the simulation will, minus the mood — which is exactly
   * the part the player is not allowed to know.
   */
  preview?: boolean;
}

/** What A is to B, as a number that can go either way. */
export function relationTerm(ctx: TermCtx, a: Nemesis, b: Nemesis): number {
  let r = 0;
  if (a.rivalries.includes(b.id)) r += 5;
  if (a.allies.includes(b.id)) r -= 7;
  if (a.master === b.id) r -= 9;
  if (b.master === a.id) r -= 5;
  const fa = factionFor(ctx.god, a);
  const fb = factionFor(ctx.god, b);
  if (fa && fb) {
    if (fa.id === fb.id) r -= 6;
    else if (atWar(ctx.god, a, b)) r += 7;
    else r += 1;
  }
  return r;
}

/**
 * What it would cost to be wrong. Danger is subtracted, so a coward with a
 * high danger reading simply never picks the fight — no special case needed.
 */
export function dangerTerm(ctx: TermCtx, a: Nemesis, b: Nemesis): number {
  const sa = simOf(a);
  const ratio = b.power / Math.max(20, a.power);
  let d = (ratio - 1) * 9;
  // Injured actors read every fight as more dangerous, because it is.
  d += (sa.injury / 100) * 5;
  d += (sa.fear / 100) * 5;
  d -= (sa.confidence / 100) * 4;
  // Their friends are part of the price.
  d += Math.min(4, b.allies.length * 0.9);
  d += ctx.cond.weight(b.id, 'ward') * 3.5;
  d += ctx.cond.weight(b.id, 'blessing') * 2.4;
  d -= ctx.cond.weight(b.id, 'curse') * 2.6;
  d -= ctx.cond.weight(b.id, 'exposure') * 2.2;
  // Someone already bleeding is a cheaper problem.
  d -= (simOf(b).injury / 100) * 6;
  const pa = getPersonality(a.personality);
  d *= 1.5 - Math.min(1.2, pa.aggression);
  return Math.max(-8, d);
}

/** What this character currently lacks. */
export function needTerm(n: Nemesis): number {
  const s = simOf(n);
  let need = 0;
  need += (s.injury / 100) * 3;
  need += (s.fear / 100) * 2;
  need -= (s.confidence / 100) * 2;
  return need;
}

export function ambitionTerm(ctx: TermCtx, n: Nemesis): number {
  const s = simOf(n);
  const p = getPersonality(n.personality);
  return (s.ambition / 100) * 6 * p.ambition * ctx.pressure - rankIndex(n.rank) * 0.9;
}

/** Chaos makes the world less predictable, which is the whole price of using it. */
export function noiseTerm(ctx: TermCtx): number {
  if (ctx.preview) return 0;
  const spread = 1.8 + Math.min(6, ctx.god.chaos * 0.06);
  return ctx.rng.bell() * spread;
}

/** Opportunity written into the world, by the god or by events. */
export function opportunityTerm(ctx: TermCtx, actor: Nemesis, target: Nemesis | null): number {
  let o = 0;
  o += ctx.cond.weight(actor.id, 'blessing') * 2;
  o -= ctx.cond.weight(actor.id, 'curse') * 2.4;
  if (target) {
    o += ctx.cond.weight(target.id, 'bounty') * 4.5;
    o += ctx.cond.weight(target.id, 'exposure') * 3.4;
    o += ctx.cond.weight(target.id, 'mark') * 2.6;
    o += ctx.cond.between(actor.id, target.id, 'rumour') * 4.4;
    o += ctx.cond.weight(target.id, 'opportunity') * 3;
  }
  return o;
}

/**
 * The crisis is the one thing in the world everybody can see.
 *
 * Killing it is the largest thing anyone in this world could do, and ambitious
 * characters weigh it accordingly. This is not the simulation being told to
 * produce a hero — it is every character being told what the prize is worth,
 * and most of them still deciding it is not worth dying for.
 */
export function crisisGlory(ctx: TermCtx, actor: Nemesis, target: Nemesis): number {
  const crisis = ctx.god.crisis;
  if (!crisis || crisis.resolved !== 'none' || crisis.bodyId !== target.id) return 0;
  if (actor.id === target.id) return 0;
  const s = simOf(actor);
  const p = getPersonality(actor.personality);
  let glory = 2;
  glory += (s.ambition / 100) * 6 * p.ambition;
  glory += (s.confidence / 100) * 4;
  glory += (s.reputation / 100) * 4;
  glory += s.revengeTargets.includes(target.id) ? 6 : 0;
  glory += rankIndex(actor.rank) * 1.2;
  // The longer it is left, the more obvious it becomes that somebody has to.
  glory += Math.min(7, (ctx.god.cycle - crisis.bornCycle) * 0.6);
  // A frightened, broken character is not the answer and knows it.
  glory -= (s.fear / 100) * 7 + (s.injury / 100) * 7;
  // A war's leader is a target for the other side, not for the whole world.
  if (crisis.kind === 'civil_war' && !atWar(ctx.god, actor, target)) glory *= 0.4;
  return Math.max(0, glory);
}

/**
 * A character can only be found if they are not hiding, and only reached if
 * they are somewhere reachable. Returns a veto string when neither holds.
 */
export function reachable(ctx: TermCtx, actor: Nemesis, target: Nemesis): string | null {
  if (!target.alive) return 'dead';
  if (actor.id === target.id) return 'self';
  const ts = simOf(target);
  if (ts.hiddenUntil > ctx.now && ctx.cond.weight(target.id, 'exposure') <= 0) return 'hidden';
  // Different ground is not impossible, just harder — the caller pays for it
  // in `base` through the travel penalty.
  return null;
}

export function sameGround(actor: Nemesis, target: Nemesis): boolean {
  return actor.territory === target.territory;
}
