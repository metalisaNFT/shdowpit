/**
 * The two resources, and the tension between them.
 *
 * Influence is what you spend. Chaos is what spending it costs — not to you
 * directly, but to your ability to predict anything afterwards. A quiet world
 * does roughly what its characters' personalities suggest. A burning one is
 * louder, faster, more lethal, harder to read, and eventually notices that
 * something has been arranging it.
 */

import type { GodState } from './GodTypes';

export const INFLUENCE = {
  start: 7,
  max: 12,
  /** floor of what comes back each cycle */
  regenBase: 3,
  /** added per act index, so the late game can afford larger gestures */
  regenPerAct: 0.5,
  /** a cycle that produced something legendary pays you back for it */
  perLegendaryBeat: 1,
  perMajorBeat: 0.25,
  /** a death in the world is an opening */
  perDeath: 0.5,
} as const;

export const CHAOS = {
  max: 120,
  /** chaos bleeds off slowly, so a spike is survivable and a habit is not */
  decayPerCycle: 1.1,
  /** the point at which characters can start working out that they are handled */
  heresyFrom: 45,
} as const;

export interface ChaosTier {
  at: number;
  name: string;
  blurb: string;
  effects: string[];
}

export const CHAOS_TIERS: ChaosTier[] = [
  {
    at: 0,
    name: 'QUIET',
    blurb: 'The world is behaving roughly as it would have without you.',
    effects: ['Characters act close to their nature'],
  },
  {
    at: 20,
    name: 'RESTLESS',
    blurb: 'Decisions are getting less predictable.',
    effects: ['Wider swings in what people choose', 'Slightly more of the dead come back'],
  },
  {
    at: 40,
    name: 'FRAYING',
    blurb: 'The world has started producing things nobody made.',
    effects: ['Mutations become common', 'Newcomers arrive stronger', 'Some begin to suspect a hand'],
  },
  {
    at: 60,
    name: 'BURNING',
    blurb: 'Everything moves faster and finishes harder.',
    effects: ['Higher tempo and lethality', 'Houses fracture', 'Heretics act against you'],
  },
  {
    at: 85,
    name: 'UNRAVELLING',
    blurb: 'You are no longer the largest thing moving in here.',
    effects: ['The crisis grows on its own', 'The dead return often', 'Anything can happen and does'],
  },
];

export function chaosTier(chaos: number): ChaosTier {
  let out = CHAOS_TIERS[0];
  for (const t of CHAOS_TIERS) if (chaos >= t.at) out = t;
  return out;
}

export interface ChaosMods {
  /** extra spread on every utility roll */
  noise: number;
  /** chance a `consolidate` produces a mutation instead of a level */
  mutation: number;
  /** newcomers arrive this much stronger */
  recruitPower: number;
  /** characters may turn against the god */
  heresy: boolean;
  /** how fast the crisis grows unattended */
  crisisGrowth: number;
  /** multiplier on returns from death */
  resurrection: number;
}

export function chaosMods(chaos: number): ChaosMods {
  const c = Math.max(0, chaos);
  return {
    noise: Math.min(9, c * 0.09),
    mutation: Math.min(0.6, c * 0.005),
    recruitPower: 1 + Math.min(0.7, c * 0.006),
    heresy: c >= CHAOS.heresyFrom,
    crisisGrowth: 1 + Math.min(1.4, c * 0.014),
    resurrection: 1 + Math.min(1.2, c * 0.012),
  };
}

export interface RegenInput {
  actIndex: number;
  legendaryBeats: number;
  majorBeats: number;
  deaths: number;
}

/** What comes back at the top of a cycle, and why. */
export function regenInfluence(god: GodState, input: RegenInput): { gained: number; reasons: string[] } {
  const reasons: string[] = [];
  let gained = INFLUENCE.regenBase;
  reasons.push(`+${INFLUENCE.regenBase} the world turns`);

  const actBonus = input.actIndex * INFLUENCE.regenPerAct;
  if (actBonus > 0) {
    gained += actBonus;
    reasons.push(`+${trim(actBonus)} the stakes are higher`);
  }
  const legend = input.legendaryBeats * INFLUENCE.perLegendaryBeat;
  if (legend > 0) {
    gained += legend;
    reasons.push(`+${trim(legend)} something worth telling happened`);
  }
  const major = input.majorBeats * INFLUENCE.perMajorBeat;
  if (major > 0) {
    gained += major;
    reasons.push(`+${trim(major)} the world moved`);
  }
  const deaths = input.deaths * INFLUENCE.perDeath;
  if (deaths > 0) {
    gained += deaths;
    reasons.push(`+${trim(deaths)} the dead leave room`);
  }

  const before = god.influence;
  god.influence = Math.min(god.influenceMax, god.influence + gained);
  return { gained: Math.round((god.influence - before) * 10) / 10, reasons };
}

export function decayChaos(god: GodState): void {
  god.chaos = Math.max(0, god.chaos - CHAOS.decayPerCycle);
}

export function addChaos(god: GodState, amount: number): void {
  god.chaos = Math.max(0, Math.min(CHAOS.max, god.chaos + amount));
  god.chaosPeak = Math.max(god.chaosPeak, god.chaos);
}

function trim(v: number): string {
  return String(Math.round(v * 10) / 10);
}
