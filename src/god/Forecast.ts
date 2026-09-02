/**
 * The reading.
 *
 * A strategy game needs the player to be able to form an expectation before
 * they spend, and to be wrong about it sometimes. This file asks the same
 * scorer the simulation uses what each character would do RIGHT NOW — minus
 * the mood, which is the part nobody is allowed to know — and phrases the
 * answer as LIKELY / MIGHT / UNLIKELY. Never a percentage.
 *
 * `forecastIntervention` goes one step further: it lays the conditions an
 * intervention would write onto a scratch index and asks again. "Who would
 * answer this price?" is then a real question with a real answer, and the
 * answer can still be wrong, because the world is noisy and people change
 * their minds between now and the moment they act.
 *
 * Nothing in here writes anything. Every call is a pure read of the world.
 */

import { getPersonality } from '../data/personalities';
import { fullName, type Nemesis } from '../nemesis/Nemesis';
import { enumerateOptions, toBreakdown } from './Autonomy';
import { ConditionIndex, type ConditionSpec } from './Conditions';
import type { GodContext } from './Context';
import { FIGHT_ACTIONS } from './Actions';
import type { InterventionDef } from './Interventions';
import { simOf, type GodState, type ScoreBreakdown } from './GodTypes';
import type { TermCtx } from './Utility';

export type Likelihood = 'LIKELY' | 'MIGHT' | 'UNLIKELY';

export interface ActorForecast {
  actorId: string;
  actorName: string;
  top: ScoreBreakdown;
  second: ScoreBreakdown | null;
  /** how far ahead the top option is; the reading's confidence */
  margin: number;
}

export interface Responder {
  id: string;
  name: string;
  label: Likelihood;
  /** what they would do about it */
  action: string;
  /** who they would do it to */
  targetName: string;
}

export interface Reading {
  /** one to four short lines for the card */
  lines: string[];
  responders: Responder[];
  /** how much the reading can be trusted at this chaos */
  clarity: 'clear' | 'hazy' | 'blind';
}

/** How far ahead an option has to be before the reading commits to it. */
const LIKELY_MARGIN = 2.5;
const MIGHT_MARGIN = -2.5;

export function likelihood(margin: number): Likelihood {
  if (margin >= LIKELY_MARGIN) return 'LIKELY';
  if (margin >= MIGHT_MARGIN) return 'MIGHT';
  return 'UNLIKELY';
}

export function clarityFor(chaos: number): Reading['clarity'] {
  if (chaos >= 85) return 'blind';
  if (chaos >= 55) return 'hazy';
  return 'clear';
}

function previewTerm(ctx: GodContext, cond: ConditionIndex): TermCtx {
  return {
    god: ctx.god,
    cond,
    turn: ctx.mgr.turn,
    now: ctx.now,
    pressure: ctx.act.pressure,
    rng: ctx.rng,
    preview: true,
  };
}

/** What everyone would do now, with the conditions as they stand. */
export function forecastWorld(ctx: GodContext, cond: ConditionIndex = ctx.cond): Map<string, ActorForecast> {
  const term = previewTerm(ctx, cond);
  const out = new Map<string, ActorForecast>();
  for (const actor of ctx.living()) {
    const f = forecastActor(ctx, actor, term);
    if (f) out.set(actor.id, f);
  }
  return out;
}

export function forecastActor(ctx: GodContext, actor: Nemesis, term?: TermCtx): ActorForecast | null {
  const t = term ?? previewTerm(ctx, ctx.cond);
  const options = enumerateOptions(ctx, actor, t);
  if (!options.length) return null;
  const top = toBreakdown(options[0].def, options[0].option, options[0].total);
  const second = options[1] ? toBreakdown(options[1].def, options[1].option, options[1].total) : null;
  return {
    actorId: actor.id,
    actorName: fullName(actor),
    top,
    second,
    margin: second ? top.total - second.total : top.total,
  };
}

/**
 * The option this actor holds against a particular target, and how far it is
 * from being what they do. Positive = it is the top choice by that much.
 */
export function marginToward(ctx: GodContext, actor: Nemesis, targetId: string, term?: TermCtx, actions?: Set<string>): { margin: number; action: string } | null {
  const t = term ?? previewTerm(ctx, ctx.cond);
  const options = enumerateOptions(ctx, actor, t);
  if (!options.length) return null;
  const best = options.find((o) => o.option.target.id === targetId && (!actions || actions.has(o.def.id)));
  if (!best) return null;
  const rival = options.find((o) => o !== best);
  return { margin: rival ? best.total - rival.total : best.total, action: best.def.name };
}

/** Scratch index with extra conditions laid on top of the real ones. */
export function hypotheticalIndex(god: GodState, specs: ConditionSpec[]): ConditionIndex {
  const extra = specs.map((spec, i) => ({
    id: 'hypo' + i,
    kind: spec.kind,
    targetKind: spec.targetKind,
    targetId: spec.targetId,
    otherId: spec.otherId,
    magnitude: spec.magnitude,
    createdCycle: god.cycle,
    expiresCycle: god.cycle + spec.duration,
    source: spec.source ?? ('god' as const),
    note: spec.note,
  }));
  return new ConditionIndex({ ...god, conditions: [...god.conditions, ...extra] });
}

/* ============================================================
   the reading for an intervention
   ============================================================ */

export function forecastIntervention(
  ctx: GodContext,
  def: InterventionDef,
  a: Nemesis | null,
  b: Nemesis | null,
  areaId: string | null
): Reading {
  const clarity = clarityFor(ctx.god.chaos);
  if (clarity === 'blind') {
    return { lines: ['The world is too loud to read. You are spending blind.'], responders: [], clarity };
  }
  const specs = def.preview ? def.preview(ctx, a, b, areaId) : [];
  const before = forecastWorld(ctx);
  const after = specs.length ? forecastWorld(ctx, hypotheticalIndex(ctx.god, specs)) : before;
  const lines: string[] = [];
  let responders: Responder[] = [];

  const nameOf = (id: string | null | undefined) => (id ? ctx.name(id) : '');

  switch (def.id) {
    case 'bounty':
    case 'reveal':
    case 'curse':
    case 'gift': {
      if (!a) break;
      responders = whoComesFor(ctx, a, before, after, def.id === 'gift' ? new Set(['steal', 'hunt', 'attack', 'revenge']) : undefined);
      if (def.id === 'gift') {
        const own = after.get(a.id);
        if (own) lines.push(`${fullName(a)} would use it to ${own.top.actionName}${own.top.targetName ? ' ' + own.top.targetName : ''}.`);
      }
      if (!responders.length) {
        lines.push(
          def.id === 'bounty'
            ? 'Nobody in this world looks likely to take the price. It may sit unclaimed.'
            : def.id === 'gift'
              ? 'Nobody looks likely to come for it yet. That can change when they see it.'
              : `Nobody looks likely to move on ${fullName(a)} because of it.`
        );
      } else {
        lines.push(`${responders.slice(0, 3).map((r) => `${r.name} (${r.label})`).join(', ')} would come for ${fullName(a)}.`);
      }
      const own = after.get(a.id);
      if (own && own.top.actionId === 'hide' && def.id !== 'gift') lines.push(`${fullName(a)} would probably go to ground.`);
      break;
    }
    case 'bless':
    case 'mend':
    case 'crown': {
      if (!a) break;
      const own = after.get(a.id);
      if (own) {
        const p = getPersonality(a.personality).name;
        lines.push(
          `${fullName(a)} — ${p} — would ${likelihood(own.margin) === 'LIKELY' ? 'most likely' : 'probably'} ${own.top.actionName}${own.top.targetName ? ' ' + own.top.targetName : ''}.`
        );
        if (own.second && likelihood(own.margin) !== 'LIKELY') lines.push(`Or ${own.second.actionName}${own.second.targetName ? ' ' + own.second.targetName : ''}. It is close.`);
        responders = [
          { id: a.id, name: fullName(a), label: likelihood(own.margin), action: own.top.actionName, targetName: own.top.targetName },
        ];
      }
      const hunters = whoComesFor(ctx, a, before, before);
      if (hunters.length) lines.push(`${hunters[0].name} is already looking at them. This will make them think twice.`);
      break;
    }
    case 'whisper': {
      if (!a || !b) break;
      const p = getPersonality(a.personality);
      const s = simOf(a);
      const bonded = a.master === b.id || a.allies.includes(b.id);
      const m = marginToward(ctx, a, b.id, previewTerm(ctx, hypotheticalIndex(ctx.god, specs)));
      if (p.betray < 0.5 && bonded) {
        lines.push(`${fullName(a)} is a ${p.name}. A story about ${fullName(b)} will sit there and rot.`);
        responders = [{ id: a.id, name: fullName(a), label: 'UNLIKELY', action: 'BETRAY', targetName: fullName(b) }];
      } else if (m) {
        const l = likelihood(m.margin);
        lines.push(`${fullName(a)} (${p.name}, loyalty ${Math.round(s.loyalty)}) — ${l} to ${m.action} ${fullName(b)}.`);
        responders = [{ id: a.id, name: fullName(a), label: l, action: m.action, targetName: fullName(b) }];
      } else {
        lines.push(`${fullName(a)} has no way at ${fullName(b)} right now. The story will wait for one.`);
      }
      break;
    }
    case 'provoke': {
      if (!a || !b) break;
      const hyp = previewTerm(ctx, hypotheticalIndex(ctx.god, specs));
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as Array<[Nemesis, Nemesis]>) {
        const m = marginToward(ctx, x, y.id, hyp, FIGHT_ACTIONS);
        if (!m) continue;
        const l = likelihood(m.margin);
        responders.push({ id: x.id, name: fullName(x), label: l, action: m.action, targetName: fullName(y) });
      }
      if (!responders.length) lines.push('Neither of them looks ready to take it. People do walk away.');
      else lines.push(responders.map((r) => `${r.name} ${r.label} to ${r.action} ${r.targetName}`).join(' · ') + '.');
      break;
    }
    case 'raise': {
      if (!a) break;
      const killer = ctx.mgr.byId(simOf(a).killedById);
      lines.push(killer && killer.alive ? `They would come back wanting ${fullName(killer)}.` : 'They would come back with nobody in particular to blame.');
      lines.push('Everyone will know something did this. Ten chaos.');
      break;
    }
    case 'calamity':
      lines.push('It will take ground and it will not be yours. Whoever holds ' + nameOf(null) + (areaId ? areaId.toUpperCase() : 'that ground') + ' is about to have a very bad cycle.');
      break;
    case 'descend': {
      if (!a) break;
      const allies = a.allies.map((id) => ctx.mgr.byId(id)).filter((n): n is Nemesis => !!n && n.alive);
      lines.push(allies.length ? `${allies.map((n) => fullName(n)).join(', ')} stand with them.` : 'They stand alone.');
      lines.push('Two cycles pass while you are down there.');
      break;
    }
    case 'still':
      lines.push('Nothing moves. That is the point.');
      break;
  }

  if (clarity === 'hazy') {
    responders = responders.slice(0, 1).map((r) => ({ ...r, label: r.label === 'LIKELY' ? 'MIGHT' : r.label }));
    lines.push('The world is loud. You can only half read it.');
  }
  if (!lines.length) lines.push(def.promise);
  return { lines, responders, clarity };
}

/** Everyone whose best move becomes — or nearly becomes — coming for `target`. */
function whoComesFor(
  ctx: GodContext,
  target: Nemesis,
  before: Map<string, ActorForecast>,
  after: Map<string, ActorForecast>,
  actions: Set<string> = FIGHT_ACTIONS
): Responder[] {
  const out: Responder[] = [];
  for (const actor of ctx.living()) {
    if (actor.id === target.id) continue;
    const f = after.get(actor.id);
    if (!f) continue;
    const aims = f.top.targetId === target.id && actions.has(f.top.actionId);
    const nearly = !aims && f.second && f.second.targetId === target.id && actions.has(f.second.actionId) && f.top.total - f.second.total < 4;
    if (!aims && !nearly) continue;
    const was = before.get(actor.id);
    const alreadyWas = was && was.top.targetId === target.id;
    const label: Likelihood = aims ? likelihood(f.margin) : 'MIGHT';
    out.push({
      id: actor.id,
      name: fullName(actor) + (alreadyWas ? '' : ''),
      label,
      action: aims ? f.top.actionName : f.second!.actionName,
      targetName: fullName(target),
    });
  }
  const rank: Record<Likelihood, number> = { LIKELY: 0, MIGHT: 1, UNLIKELY: 2 };
  out.sort((x, y) => rank[x.label] - rank[y.label]);
  return out;
}
