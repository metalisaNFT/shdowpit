/**
 * The thing that ends the run.
 *
 * The crisis is not written in advance and it is not spawned from a table of
 * bosses. It is a promotion: the simulation is inspected, whatever has already
 * become the most dangerous fact in the world is named, and from then on it
 * grows on its own. Which means the crisis is usually something the player
 * made — the character they kept protecting, the house they armed, the thing
 * they let out of the ground twelve cycles ago.
 *
 * You do not fight it. You have to arrange for someone who can.
 */

import { traitsOfKind } from '../data/traits';
import { addCondition } from './Conditions';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import type { GodContext } from './Context';
import { dominantFaction, factionOf, livingFactions, seniorMembers } from './Factions';
import { chaosMods } from './Influence';
import { simOf, type Crisis, type CrisisKind } from './GodTypes';
import { RUN_DEADLINE } from './Arc';

export interface CrisisCandidate {
  kind: CrisisKind;
  score: number;
  body: Nemesis | null;
  factionId: string | null;
  title: string;
  description: string;
}

/**
 * Read the world and decide what has actually gone wrong with it. Every branch
 * here is a measurement, not a preference.
 */
export function assessCrisis(ctx: GodContext): CrisisCandidate | null {
  const living = ctx.living();
  if (living.length < 3) return null;
  const byPower = living.slice().sort((a, b) => b.power - a.power);
  const top = byPower[0];
  const second = byPower[1];
  const candidates: CrisisCandidate[] = [];

  /* ---- a heretic who has decided the god is the enemy ---- */
  const heretics = living.filter((n) => simOf(n).heretic).sort((a, b) => b.power - a.power);
  if (heretics.length) {
    const h = heretics[0];
    candidates.push({
      kind: 'heresy',
      score: h.power * 0.85 + ctx.god.chaos * 3 + heretics.length * 40,
      body: h,
      factionId: simOf(h).factionId,
      title: 'THE ONE WHO LOOKED UP',
      description: `${fullName(h)} has worked out that something has been arranging this world, and has started dismantling everything you built in it.`,
    });
  }

  /* ---- something that was never born ---- */
  const beasts = living.filter(
    (n) => n.strengths.filter((t) => traitsOfKind('mutation').some((m) => m.id === t)).length >= 2
  );
  if (beasts.length) {
    const b = beasts.sort((x, y) => y.power - x.power)[0];
    candidates.push({
      kind: 'beast',
      score: b.power * 1.25 + ctx.god.chaos * 3 + b.strengths.length * 25,
      body: b,
      factionId: null,
      title: 'THE THING IN THE GROUND',
      description: `${fullName(b)} stopped being a person somewhere along the way. It takes ground and it does not stop.`,
    });
  }

  /* ---- a legend with too much history ---- */
  const legends = living
    .filter((n) => n.returns > 0 || simOf(n).kills.length >= 4)
    .sort((a, b) => simOf(b).reputation + b.power - (simOf(a).reputation + a.power));
  if (legends.length) {
    const l = legends[0];
    const s = simOf(l);
    candidates.push({
      kind: 'legend',
      score: l.power * 0.9 + s.reputation * 1.1 + l.returns * 55 + s.kills.length * 30,
      body: l,
      factionId: s.factionId,
      title: 'THE ONE EVERYONE KNOWS',
      description: `${fullName(l)} has survived everything this world has done to them, and everyone in it now behaves as though that will continue.`,
    });
  }

  /* ---- two houses that cannot both exist ---- */
  const live = livingFactions(ctx.god);
  const warring = live.filter((f) => f.warWith.length > 0);
  if (warring.length >= 2) {
    const a = warring.sort((x, y) => y.strength - x.strength)[0];
    const b = factionOf(ctx.god, a.warWith[0]);
    if (b) {
      candidates.push({
        kind: 'civil_war',
        score: (a.strength + b.strength) * 0.55 + (100 - Math.min(a.stability, b.stability)) * 5,
        body: ctx.mgr.byId(a.leaderId),
        factionId: a.id,
        title: 'THE WAR NOBODY CAN END',
        description: `${a.name} and ${b.name} have gone past the point where either can stop. Everyone else is standing in the middle of it.`,
      });
    }
  }

  /* ---- or simply: someone won ---- */
  const dom = dominantFaction(ctx.god);
  if (top && second) {
    candidates.push({
      kind: 'warlord',
      score: top.power * 1.15 + (top.power - second.power) * 1.6 + (dom ? dom.territories.length * 45 : 0),
      body: top,
      factionId: simOf(top).factionId,
      title: 'THE ONE WHO WON',
      description: `${fullName(top)} is simply stronger than the world that produced them, and nothing left standing can be expected to change that.`,
    });
  }

  if (!candidates.length) return null;
  // A small jitter, so two runs with near-identical worlds do not always name
  // the same kind of catastrophe.
  for (const c of candidates) c.score *= 0.88 + ctx.rng.next() * 0.24;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

export function birthCrisis(ctx: GodContext): Crisis | null {
  const c = assessCrisis(ctx);
  if (!c) return null;
  const body = c.body;
  const crisis: Crisis = {
    kind: c.kind,
    title: c.title,
    bodyId: body ? body.id : null,
    factionId: c.factionId,
    power: body ? body.power : Math.round(c.score * 0.4),
    growth: 12 + Math.round(ctx.god.chaos * 0.15),
    bornCycle: ctx.god.cycle,
    deadline: RUN_DEADLINE,
    resolved: 'none',
    description: c.description,
    slainById: null,
  };
  ctx.god.crisis = crisis;
  if (body) {
    // Everyone knows where it is. That is what makes it answerable at all.
    addCondition(ctx.god, {
      kind: 'exposure',
      targetKind: 'nemesis',
      targetId: body.id,
      magnitude: 1,
      duration: 99,
      note: 'there is no question where it is',
      source: 'world',
    });
    ctx.refreshConditions();
    const s = simOf(body);
    s.crisisBorn = true;
    s.ambition = 100;
    s.fear = Math.max(0, s.fear - 40);
    s.confidence = 100;
    ctx.deed(body, 'became the thing the world could not hold', 6);
  }

  ctx.emit(
    'crisis',
    'legendary',
    `${crisis.title}: ${body ? fullName(body) : (factionOf(ctx.god, c.factionId)?.name ?? 'THE WORLD')}.`,
    [
      crisis.description,
      `It grows by about ${crisis.growth} power every cycle it is left alone.`,
      `If nothing in this world can put it down by cycle ${crisis.deadline}, that is the end of the run.`,
      'You cannot touch it directly. Find someone who can, and make them able.',
    ],
    body ? [body.id] : [],
    'bad'
  );
  ctx.chronicle(
    'age_begins',
    `${crisis.title} — ${body ? fullName(body) : 'the world itself'}.`,
    body ? [body.id] : [],
    true,
    'bad'
  );
  return crisis;
}

/**
 * What to call it. A war has no single body, and the leader a war was named
 * after can be dead by the time the run ends — in both cases naming the house
 * is more truthful than printing a blank.
 */
export function crisisLabel(ctx: GodContext, crisis: Crisis): string {
  const body = ctx.mgr.byId(crisis.bodyId);
  if (body) return fullName(body);
  const f = factionOf(ctx.god, crisis.factionId);
  if (f) return f.name;
  return crisis.title;
}

/** Feed the crisis. This is what "left alone" costs. */
export function crisisTick(ctx: GodContext): void {
  const crisis = ctx.god.crisis;
  if (!crisis || crisis.resolved !== 'none') return;
  const mods = chaosMods(ctx.god.chaos);
  const body = ctx.mgr.byId(crisis.bodyId);
  const isWar = crisis.kind === 'civil_war';

  /* ---- has it been put down? ---- */
  if (isWar) {
    const f = factionOf(ctx.god, crisis.factionId);
    // A war outlives the person it was named after; keep it pointed at
    // whoever is currently running it.
    if (f && f.leaderId && f.leaderId !== crisis.bodyId) crisis.bodyId = f.leaderId;
    if (!f || f.destroyedCycle || f.warWith.length === 0) {
      crisis.resolved = 'defeated';
        crisis.slainById = null;
      ctx.emit('crisis', 'legendary', 'THE WAR ENDED.', ['One side stopped existing, or stopped caring. Either way it is over.'], [], 'good');
      return;
    }
  } else if (body && !body.alive) {
    crisis.resolved = 'defeated';
    crisis.slainById = simOf(body).killedById;
    const slayer = ctx.mgr.byId(crisis.slainById);
    if (slayer) {
      ctx.deed(slayer, `put ${fullName(body)} in the ground when nobody else could`, 8);
      simOf(slayer).reputation = Math.min(200, simOf(slayer).reputation + 60);
    }
    ctx.emit(
      'crisis',
      'legendary',
      slayer ? `${fullName(slayer)} KILLED ${fullName(body)}.` : `${fullName(body)} IS DEAD.`,
      [
        crisis.description,
        slayer
          ? `${fullName(slayer)} was not chosen for this. They were simply the one who was standing there when it mattered.`
          : 'Nobody is quite sure who did it.',
      ],
      slayer ? [slayer.id, body.id] : [body.id],
      'good'
    );
    ctx.chronicle('overlord_slain', slayer ? `${fullName(slayer)} killed ${fullName(body)}.` : `${fullName(body)} fell.`, [body.id], true, 'gold');
    return;
  } else if (!body && !isWar) {
    crisis.resolved = 'defeated';
    return;
  }

  /* ---- otherwise it gets worse ---- */
  const growth = crisis.growth * mods.crisisGrowth;
  crisis.power += growth;
  if (body && body.alive) {
    body.level = Math.min(30, body.level + 1);
    if (ctx.rng.chance(0.4) && body.strengths.length < 5) {
      const pool = traitsOfKind(crisis.kind === 'beast' ? 'mutation' : 'strength').filter((t) => !body.strengths.includes(t.id));
      if (pool.length) body.strengths.push(ctx.rng.pick(pool).id);
    }
    recomputePower(body);
    crisis.power = Math.max(crisis.power, body.power);
    // The crisis pulls people in — that is what makes it a crisis rather than
    // a strong character.
    const f = factionOf(ctx.god, simOf(body).factionId);
    if (f) f.aggression = Math.min(100, f.aggression + 4);
  } else if (isWar) {
    for (const f of livingFactions(ctx.god)) {
      if (f.warWith.length) f.stability = Math.max(0, f.stability - 5);
    }
  }

  if (ctx.god.cycle % 3 === 0) {
    ctx.emit(
      'crisis',
      'major',
      `${crisis.title} IS STILL GROWING.`,
      [
        body ? `${fullName(body)} — power ${body.power}.` : `The war has not stopped.`,
        `${Math.max(0, crisis.deadline - ctx.god.cycle)} cycles left.`,
        bestHopeLine(ctx, crisis.power),
      ],
      body ? [body.id] : [],
      'bad'
    );
  }
}

/** Who, if anyone, could plausibly answer it. Shown so the player has a lever. */
export function bestHope(ctx: GodContext): Nemesis | null {
  const crisis = ctx.god.crisis;
  const bodyId = crisis?.bodyId ?? null;
  const pool = ctx.living().filter((n) => n.id !== bodyId);
  if (!pool.length) return null;
  return pool
    .slice()
    .sort((a, b) => {
      const sa = simOf(a);
      const sb = simOf(b);
      const scoreA =
        a.power +
        sa.confidence * 1.2 -
        sa.injury * 0.8 +
        (bodyId && sa.revengeTargets.includes(bodyId) ? 90 : 0) +
        ctx.cond.on(a.id).filter((c) => c.source === 'god').length * 28 +
        (ctx.cond.on(a.id).some((c) => c.kind === 'bounty') ? 35 : 0);
      const scoreB =
        b.power +
        sb.confidence * 1.2 -
        sb.injury * 0.8 +
        (bodyId && sb.revengeTargets.includes(bodyId) ? 90 : 0) +
        ctx.cond.on(b.id).filter((c) => c.source === 'god').length * 28 +
        (ctx.cond.on(b.id).some((c) => c.kind === 'bounty') ? 35 : 0);
      return scoreB - scoreA;
    })[0];
}

function bestHopeLine(ctx: GodContext, power: number): string {
  const hope = bestHope(ctx);
  if (!hope) return 'There is nobody left who could try.';
  const gap = Math.round(((power - hope.power) / Math.max(1, power)) * 100);
  if (gap <= 0) return `${fullName(hope)} could take it today.`;
  return `${fullName(hope)} is the closest thing to an answer, and is ${gap}% short.`;
}

/** Runway copy for the crisis NOW card — growth, hope gap, deadline tension. */
export interface CrisisRunway {
  growthPerCycle: number;
  hopeLine: string;
  cyclesLeft: number;
  hopeId: string | null;
  bodyId: string | null;
  championId: string | null;
}

export function crisisRunway(ctx: GodContext): CrisisRunway | null {
  const crisis = ctx.god.crisis;
  if (!crisis || crisis.resolved !== 'none') return null;
  const mods = chaosMods(ctx.god.chaos);
  const hope = bestHope(ctx);
  return {
    growthPerCycle: Math.round(crisis.growth * mods.crisisGrowth * 10) / 10,
    hopeLine: bestHopeLine(ctx, crisis.power),
    cyclesLeft: Math.max(0, crisis.deadline - ctx.god.cycle),
    hopeId: hope?.id ?? null,
    bodyId: crisis.bodyId,
    championId: ctx.god.championId,
  };
}

/** Warlords and up who would follow the crisis rather than fight it. */
export function crisisFollowers(ctx: GodContext): Nemesis[] {
  const crisis = ctx.god.crisis;
  if (!crisis) return [];
  const f = factionOf(ctx.god, crisis.factionId);
  if (!f) return [];
  return seniorMembers(ctx.mgr, f, 2).filter((n) => n.id !== crisis.bodyId);
}

export function crisisDefeated(ctx: GodContext): boolean {
  return ctx.god.crisis?.resolved === 'defeated';
}

export function crisisRank(ctx: GodContext): number {
  const b = ctx.mgr.byId(ctx.god.crisis?.bodyId);
  return b ? rankIndex(b.rank) : 4;
}
