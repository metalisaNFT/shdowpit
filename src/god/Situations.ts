/**
 * The OBSERVE board.
 *
 * A simulation this size produces far more state than anyone can read, and
 * dumping it is the fastest way to make an emergent game feel like a
 * spreadsheet. This file does the opposite job: it looks at the whole world
 * and returns only the handful of things that are *about to matter*.
 *
 * RECONSTRUCTION: a situation is a TENSION, not a threshold. "X is badly
 * hurt" is a number; "X is bleeding and Y is the one who would finish it" is
 * a situation. Every card below is built from the forecast — what the scorer
 * says people would do right now — so the board answers WHAT IS HAPPENING,
 * WHY IT MATTERS and WHAT MIGHT HAPPEN NEXT, and the `suggest` list is the
 * fourth question: WHAT CAN I DO ABOUT IT.
 *
 * Nothing here promises. A LIKELY is the scorer's best guess without the mood.
 */

import { AREA_NAMES } from '../data/names';
import { AREAS } from '../data/areas';
import { getPersonality } from '../data/personalities';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import type { GodContext } from './Context';
import { factionOf, heirOf, livingFactions } from './Factions';
import { bestHope, crisisLabel } from './Crisis';
import { CONDITION_LABEL } from './Conditions';
import { forecastWorld, likelihood, type ActorForecast, type Likelihood } from './Forecast';
import { FIGHT_ACTIONS } from './Actions';
import { simOf, type Situation } from './GodTypes';
import { TOWER_SITUATION_ID } from './Opening';

const MAX_SITUATIONS = 9;
const EARLY_MAX = 4;

function label(l: Likelihood): string {
  return l === 'LIKELY' ? 'LIKELY TO MOVE' : l === 'MIGHT' ? 'MIGHT MOVE' : 'HOLDING';
}

export function buildSituations(ctx: GodContext): Situation[] {
  const out: Situation[] = [];
  const living = ctx.living();
  const forecast = forecastWorld(ctx);
  const seen = new Set<string>();

  /** everyone whose top choice is a fight aimed at `id` */
  const huntersOf = (id: string): Array<{ n: Nemesis; f: ActorForecast }> =>
    living
      .filter((n) => n.id !== id)
      .map((n) => ({ n, f: forecast.get(n.id)! }))
      .filter((x) => x.f && x.f.top.targetId === id && FIGHT_ACTIONS.has(x.f.top.actionId));

  /* ---- campaign: Tower Commander ---- */
  if (ctx.god.scenarioFlags?.towerCommander) {
    const commander = living.find((n) => n.archetype === 'commander' && n.territory === 'tower' && n.alive);
    if (commander) {
      const spear = commander.stolen.some((s) => s.weaponId === 'spear');
      const loyal = living.find((n) => n.master === commander.id && n.alive);
      out.push({
        id: TOWER_SITUATION_ID,
        kind: 'territory',
        headline: `${fullName(commander)} COMMANDS THE TOWER`,
        detail: spear
          ? `${fullName(commander)} holds the Tower and stolen steel.${loyal ? ` ${fullName(loyal)} stands with them.` : ''} Bless, curse, or price their head — then descend into the configuration you made.`
          : `${fullName(commander)} holds the Tower.${loyal ? ` ${fullName(loyal)} stands with them.` : ''} Change their conditions, then enter the Tower yourself if you want a physical answer.`,
        actors: loyal ? [commander.id, loyal.id] : [commander.id],
        urgency: 0.96,
        suggest: ['bless', 'bounty', 'curse', 'descend'],
      });
    }
  }

  /* ---- the crisis owns the top of the board ---- */
  const crisis = ctx.god.crisis;
  if (crisis && crisis.resolved === 'none') {
    const body = ctx.mgr.byId(crisis.bodyId);
    const hope = bestHope(ctx);
    const hunters = body ? huntersOf(body.id) : [];
    const left = Math.max(0, crisis.deadline - ctx.god.cycle);
    out.push({
      id: 'crisis',
      kind: 'crisis',
      headline: `${crisis.title} — ${crisisLabel(ctx, crisis)}`,
      detail:
        crisis.description +
        ` ${left} cycles before it is too late.` +
        (hunters.length
          ? ` ${hunters.map((h) => fullName(h.n)).slice(0, 2).join(' and ')} ${hunters.length > 1 ? 'are' : 'is'} ${label(likelihood(hunters[0].f.margin)).toLowerCase()} against it.`
          : hope
            ? ` Nobody is moving on it. The closest thing to an answer is ${fullName(hope)}.`
            : ' Nobody left could try.'),
      // The hope goes in slot A: BLESS / GIFT / CROWN are for them. The body
      // sits in B, where PRICE and WHISPER reach it.
      actors: hope && body ? [hope.id, body.id] : body ? [body.id] : [],
      urgency: 1,
      suggest: hope ? ['bless', 'gift', 'crown', 'whisper'] : ['raise', 'calamity'],
    });
  }

  /* ---- heresy ---- */
  for (const n of living) {
    if (!simOf(n).heretic) continue;
    out.push({
      id: 'her:' + n.id,
      kind: 'heresy',
      headline: `${fullName(n)} KNOWS SOMETHING IS ARRANGING THIS`,
      detail: 'They will spend their cycles tearing up whatever you put down. Chaos is what let them see it. You cannot touch them; find someone who can.',
      actors: [n.id],
      urgency: 0.85,
      suggest: ['bounty', 'whisper', 'reveal'],
    });
  }

  /* ---- grudges, with a reading ---- */
  for (const n of living) {
    const s = simOf(n);
    const f = forecast.get(n.id);
    const targets = new Set(s.revengeTargets);
    if (s.goal === 'revenge' && s.goalTargetId) targets.add(s.goalTargetId);
    for (const id of targets) {
      const t = ctx.mgr.byId(id);
      if (!t || !t.alive) continue;
      const key = 'rev:' + n.id + ':' + id;
      if (seen.has(key)) continue;
      seen.add(key);
      const held = s.goalTargetId === id ? s.goalAge : 0;
      const aims = f && f.top.targetId === id && FIGHT_ACTIONS.has(f.top.actionId);
      const near = !aims && f?.second && f.second.targetId === id && FIGHT_ACTIONS.has(f.second.actionId);
      const l: Likelihood = aims ? likelihood(f!.margin) : near ? 'MIGHT' : 'UNLIKELY';
      const hidden = simOf(t).hiddenUntil > ctx.now;
      const why = s.escapedFrom.includes(id)
        ? `${fullName(n)} ran from them once.`
        : (n.humiliations ?? 0) > 0
          ? `${fullName(n)} was made small in front of people.`
          : t.memory.some((m) => m.type === 'I_KILLED_NEMESIS' && n.allies.includes(m.subject ?? '') === false && m.subject && !ctx.mgr.byId(m.subject)?.alive)
            ? `${fullName(t)} killed someone ${fullName(n)} cared about.`
            : 'It goes back a way.';
      const power = t.power > n.power * 1.2 ? `${fullName(t)} is the stronger.` : t.power < n.power * 0.8 ? `${fullName(n)} could do it.` : 'They are evenly matched.';
      out.push({
        id: key,
        kind: held >= 6 ? 'grudge' : 'revenge',
        headline: `${fullName(n)} WANTS ${fullName(t)} — ${hidden ? 'CANNOT FIND THEM' : label(l)}`,
        detail: `${why} Held ${held} cycles. ${power}${hidden ? ` ${fullName(t)} has gone to ground.` : ''}`,
        actors: [n.id, t.id],
        urgency: 0.4 + Math.min(0.2, held * 0.03) + (l === 'LIKELY' ? 0.3 : l === 'MIGHT' ? 0.15 : 0) + (rankIndex(t.rank) >= 3 ? 0.05 : 0),
        suggest: hidden ? ['reveal', 'bless', 'gift'] : l === 'LIKELY' ? ['bless', 'curse', 'mend'] : ['reveal', 'provoke', 'gift'],
      });
    }
  }

  /* ---- who is about to turn ---- */
  for (const n of living) {
    if (!n.master) continue;
    const m = ctx.mgr.byId(n.master);
    if (!m || !m.alive) continue;
    const s = simOf(n);
    const p = getPersonality(n.personality);
    const f = forecast.get(n.id);
    const aims = f && f.top.actionId === 'betray' && f.top.targetId === m.id;
    const near = !aims && f?.second?.actionId === 'betray' && f.second.targetId === m.id && f.top.total - f.second.total < 5;
    if (!aims && !near && !(s.loyalty < 40 && p.betray > 0.9)) continue;
    const l: Likelihood = aims ? likelihood(f!.margin) : near ? 'MIGHT' : 'UNLIKELY';
    out.push({
      id: 'bet:' + n.id,
      kind: 'betrayal_risk',
      headline: `${fullName(n)} IS NOT LOYAL TO ${fullName(m)} — ${l === 'UNLIKELY' ? 'WAVERING' : label(l)}`,
      detail: `${p.name}. Loyalty ${Math.round(s.loyalty)}. ${simOf(m).injury > 40 ? `${fullName(m)} is wounded, which makes it easier.` : 'A rumour would be all the excuse they need.'}`,
      actors: [n.id, m.id],
      urgency: 0.45 + (l === 'LIKELY' ? 0.3 : l === 'MIGHT' ? 0.15 : 0) + (60 - Math.min(60, s.loyalty)) / 300,
      suggest: ['whisper', 'provoke', 'bless'],
    });
  }

  /* ---- who is about to climb ---- */
  for (const n of living) {
    const f = forecast.get(n.id);
    if (!f) continue;
    if (f.top.actionId !== 'challenge' || !f.top.targetId) continue;
    const t = ctx.mgr.byId(f.top.targetId);
    if (!t) continue;
    const l = likelihood(f.margin);
    if (l === 'UNLIKELY') continue;
    out.push({
      id: 'asc:' + n.id,
      kind: 'ascendant',
      headline: `${fullName(n)} IS ABOUT TO GO FOR ${fullName(t)}'S PLACE — ${label(l)}`,
      detail: `${getPersonality(n.personality).name}, ${n.rank.toUpperCase()} against ${t.rank.toUpperCase()}. ${t.power > n.power ? `${fullName(t)} is the stronger, which has not stopped anyone yet.` : `${fullName(n)} is the stronger. This is a matter of nerve.`}`,
      actors: [n.id, t.id],
      urgency: 0.5 + (l === 'LIKELY' ? 0.25 : 0.1) + rankIndex(t.rank) * 0.04,
      suggest: ['bless', 'curse', 'gift', 'mend'],
    });
  }

  /* ---- who is bleeding, and who knows it ---- */
  for (const n of living) {
    const s = simOf(n);
    if (s.injury < 45) continue;
    const hunters = huntersOf(n.id);
    const holds = Object.values(ctx.mgr.data.territories).includes(n.id);
    const leads = livingFactions(ctx.god).some((f) => f.leaderId === n.id);
    if (!hunters.length && !holds && !leads) continue;
    const h = hunters[0];
    out.push({
      id: 'wnd:' + n.id,
      kind: 'wounded',
      headline: h ? `${fullName(n)} IS BLEEDING AND ${fullName(h.n)} KNOWS IT` : `${fullName(n)} IS BLEEDING ON GROUND THEY HOLD`,
      detail: `Wounds at ${Math.round(s.injury)}.${h ? ` ${fullName(h.n)} is ${label(likelihood(h.f.margin)).toLowerCase()} to ${h.f.top.actionName.toLowerCase()} them.` : ''}${leads ? ' A house depends on them.' : ''}`,
      actors: h ? [n.id, h.n.id] : [n.id],
      urgency: 0.4 + s.injury / 250 + (h ? 0.2 : 0),
      suggest: h ? ['mend', 'curse', 'bounty'] : ['mend', 'bless'],
    });
  }

  /* ---- succession: who inherits if the leader falls ---- */
  for (const f of livingFactions(ctx.god)) {
    const leader = ctx.mgr.byId(f.leaderId);
    if (!leader || !leader.alive) continue;
    const ls = simOf(leader);
    const hunted = huntersOf(leader.id);
    if (ls.injury < 40 && !hunted.length && ctx.god.crisis?.bodyId !== leader.id) continue;
    const heir = heirOf(ctx.god, ctx.mgr, f);
    if (!heir) continue;
    const hp = getPersonality(heir.personality);
    out.push({
      id: 'suc:' + f.id,
      kind: 'succession',
      headline: `IF ${fullName(leader)} FALLS, ${fullName(heir)} TAKES ${f.name}`,
      detail: `${fullName(heir)} is ${hp.name.toLowerCase()}${hp.betray > 1.2 || hp.ambition > 1.5 ? ', which is not reassuring' : ''}. ${hunted.length ? `${fullName(hunted[0].n)} is ${label(likelihood(hunted[0].f.margin)).toLowerCase()} against ${fullName(leader)}.` : `${fullName(leader)} is wounded.`}`,
      actors: [leader.id, heir.id],
      urgency: 0.45 + (hunted.length ? 0.2 : 0) + (hp.betray > 1.2 ? 0.1 : 0),
      suggest: ['mend', 'bless', 'whisper'],
    });
  }

  /* ---- houses ---- */
  for (const f of livingFactions(ctx.god)) {
    if (f.warWith.length) {
      const other = factionOf(ctx.god, f.warWith[0]);
      if (other && f.id < other.id) {
        const stronger = f.strength >= other.strength ? f : other;
        out.push({
          id: 'war:' + f.id + other.id,
          kind: 'faction_war',
          headline: `${f.name} IS AT WAR WITH ${other.name}`,
          detail: `${stronger.name} is winning it. Strength ${Math.round(f.strength)} against ${Math.round(other.strength)}; stability ${Math.round(f.stability)} and ${Math.round(other.stability)}. It ends when nobody left alive has a reason to keep it going.`,
          actors: [f.leaderId ?? '', other.leaderId ?? ''].filter(Boolean),
          urgency: 0.6,
          suggest: ['bounty', 'whisper', 'bless'],
        });
      }
    }
    if (f.stability < 35) {
      out.push({
        id: 'frac:' + f.id,
        kind: 'power_vacuum',
        headline: `${f.name} IS COMING APART`,
        detail: `Stability ${Math.round(f.stability)}. One more bad cycle and it stops existing, and everyone sworn to it becomes someone else's problem.`,
        actors: [f.leaderId ?? ''].filter(Boolean),
        urgency: 0.55 + (35 - f.stability) / 120,
        suggest: ['mend', 'bless', 'whisper'],
      });
    }
  }

  /* ---- ground ---- */
  for (const area of AREAS) {
    const holder = ctx.mgr.territoryHolder(area.id);
    const unrest = ctx.cond.weight(area.id, 'unrest');
    const name = AREA_NAMES[area.id] ?? area.name;
    if (!holder) {
      const takers = living.filter((n) => forecast.get(n.id)?.top.actionId === 'seize' && forecast.get(n.id)?.top.targetId === area.id);
      out.push({
        id: 'ter:' + area.id,
        kind: 'territory',
        headline: takers.length ? `${fullName(takers[0])} IS ABOUT TO TAKE ${name}` : `${name} HAS NO HOLDER`,
        detail: takers.length ? `Open ground, and ${fullName(takers[0])} has noticed.` : 'Open ground. The first person with the nerve to walk onto it owns it.',
        actors: takers.slice(0, 1).map((n) => n.id),
        urgency: takers.length ? 0.5 : 0.3,
        suggest: ['crown', 'bless', 'reveal'],
      });
    } else if (unrest > 0.4) {
      const takers = living.filter((n) => n.id !== holder.id && forecast.get(n.id)?.top.actionId === 'seize' && forecast.get(n.id)?.top.targetId === area.id);
      out.push({
        id: 'unr:' + area.id,
        kind: 'territory',
        headline: `${name} IS SLIPPING FROM ${fullName(holder)}`,
        detail: takers.length ? `${fullName(takers[0])} is likely to test that.` : 'Whoever holds it is not holding it well. Somebody is going to test that.',
        actors: [holder.id, ...takers.slice(0, 1).map((n) => n.id)],
        urgency: 0.42 + unrest * 0.2 + (takers.length ? 0.1 : 0),
        suggest: ['bounty', 'bless', 'mend'],
      });
    }
  }

  /* ---- your conditions still on the board (two at most) ---- */
  let marks = 0;
  for (const c of ctx.god.conditions) {
    if (c.source !== 'god' || marks >= 2) continue;
    const left = c.expiresCycle - ctx.god.cycle;
    if (left <= 0) continue;
    const n = ctx.mgr.byId(c.targetId);
    if (!n) continue;
    marks++;
    const lbl = CONDITION_LABEL[c.kind] ?? c.kind.toUpperCase();
    const f = forecast.get(n.id);
    out.push({
      id: 'cond:' + c.id,
      kind: 'condition',
      headline: `${fullName(n).toUpperCase()} — ${lbl}`,
      detail: `${c.note} · ${left} cycle${left === 1 ? '' : 's'} left.${f ? ` They would ${f.top.actionName.toLowerCase()}${f.top.targetName ? ' ' + f.top.targetName : ''} next.` : ''}`,
      actors: [n.id],
      urgency: left === 1 ? 0.5 : 0.3,
      suggest: suggestForCondition(c.kind),
    });
  }

  out.sort((a, b) => b.urgency - a.urgency);
  const capped = dedupeActors(out).slice(0, MAX_SITUATIONS);
  if (!ctx.god.boardUnlocked && !ctx.god.openingDone) {
    return capped.slice(0, EARLY_MAX);
  }
  return capped;
}

function suggestForCondition(kind: string): string[] {
  switch (kind) {
    case 'bounty':
      return ['reveal', 'gift', 'bless'];
    case 'blessing':
    case 'ward':
    case 'opportunity':
      return ['gift', 'reveal', 'crown'];
    case 'rumour':
    case 'exposure':
      return ['whisper', 'provoke', 'bounty'];
    case 'curse':
    case 'mark':
      return ['bounty', 'provoke', 'mend'];
    default:
      return ['bless', 'bounty', 'reveal'];
  }
}

/**
 * Two situations about the same person are usually the same story told twice.
 * Keep the more urgent one unless the second brings a different lens.
 */
function dedupeActors(list: Situation[]): Situation[] {
  const count = new Map<string, number>();
  const out: Situation[] = [];
  for (const s of list) {
    const primary = s.actors[0] ?? s.id;
    const c = count.get(primary) ?? 0;
    if (c >= 2) continue;
    count.set(primary, c + 1);
    out.push(s);
  }
  return out;
}
