/**
 * World Ages. Every time the player kills the Overlord the world advances an
 * Age, difficulty shifts sideways rather than merely upwards, and after the
 * fifth named Age the modifiers combine procedurally forever.
 */

import { RNG } from '../core/RNG';

export interface AgeModifier {
  id: string;
  name: string;
  desc: string;
  /** enemy attack frequency multiplier */
  aggression: number;
  /** enemy outgoing damage multiplier */
  damage: number;
  /** enemy health multiplier — used sparingly, no bullet sponges */
  health: number;
  /** chance a simulated survivor gains a mutation trait */
  mutation: number;
  /** chance a promoted/generated enemy gets armour-flavoured traits */
  armour: number;
  /** chance a dead nemesis returns during simulation */
  resurrection: number;
  /** how many extra named enemies exist beyond the base roster */
  extraCaptains: number;
  /** chance per run that a named enemy hunts the player */
  huntRate: number;
  /** ambient light tint applied to the arena */
  tint: number;
  /** fog density multiplier */
  fog: number;
}

function mod(id: string, name: string, desc: string, o: Partial<AgeModifier>): AgeModifier {
  return {
    id,
    name,
    desc,
    aggression: 1,
    damage: 1,
    health: 1,
    mutation: 0,
    armour: 0.12,
    resurrection: 0.12,
    extraCaptains: 0,
    huntRate: 0.3,
    tint: 0x1a1e24,
    fog: 1,
    ...o,
  };
}

export const NAMED_AGES: AgeModifier[] = [
  mod('wastes', 'THE WASTES', 'Cold, quiet, and indifferent.', {}),
  mod('blood_moon', 'BLOOD MOON', 'They do not wait for you to be ready.', {
    aggression: 1.35,
    damage: 1.12,
    huntRate: 0.45,
    tint: 0x241a1c,
    fog: 1.15,
  }),
  mod('plague', 'THE PLAGUE', 'Something is changing them.', {
    mutation: 0.4,
    health: 1.08,
    resurrection: 0.2,
    tint: 0x1b2420,
    fog: 1.4,
  }),
  mod('iron', 'THE IRON AGE', 'They have learned to make armour.', {
    armour: 0.55,
    damage: 1.08,
    health: 1.12,
    aggression: 0.92,
    tint: 0x1d2026,
    fog: 0.85,
  }),
  mod('void', 'THE VOID', 'Death has stopped being an ending.', {
    resurrection: 0.55,
    aggression: 1.15,
    extraCaptains: 2,
    huntRate: 0.55,
    tint: 0x1a1824,
    fog: 1.6,
  }),
];

/** Extra modifiers that only appear in procedurally combined Ages. */
export const LATE_MODIFIERS: AgeModifier[] = [
  mod('famine', 'THE FAMINE', 'Nothing heals easily now.', { damage: 1.18, huntRate: 0.5, tint: 0x22211a }),
  mod('long_night', 'THE LONG NIGHT', 'The dark has thickened.', { fog: 2.1, aggression: 1.1, tint: 0x0d0f16 }),
  mod('spire', 'THE SPIRE', 'They gather under one banner.', { extraCaptains: 3, armour: 0.4, tint: 0x1c1a26 }),
  mod('hollow', 'THE HOLLOW', 'They come back wrong.', { resurrection: 0.65, mutation: 0.5, tint: 0x151f20 }),
  mod('feast', 'THE FEAST', 'They fight each other as much as you.', { aggression: 1.25, extraCaptains: 2, tint: 0x231a1e }),
  mod('ember', 'THE EMBER', 'Everything smoulders.', { damage: 1.15, mutation: 0.25, tint: 0x2a1f16, fog: 1.3 }),
];

const NAMES_A = ['SECOND', 'THIRD', 'BROKEN', 'DROWNED', 'BURNING', 'SILENT', 'HUNGRY', 'ENDLESS', 'BLIND', 'RUSTED'];
const NAMES_B = ['AGE', 'DARK', 'SEASON', 'WINTER', 'REIGN', 'YEAR', 'HOUR'];

export interface AgeState {
  age: number;
  name: string;
  modifiers: string[];
  combined: AgeModifier;
}

const ALL = new Map<string, AgeModifier>(
  [...NAMED_AGES, ...LATE_MODIFIERS].map((m) => [m.id, m])
);

export function getModifier(id: string): AgeModifier | undefined {
  return ALL.get(id);
}

/** Multiply/accumulate a set of modifier ids into one effective block. */
export function combineModifiers(ids: readonly string[]): AgeModifier {
  const out = mod('combined', 'COMBINED', '', {});
  let tintR = 0;
  let tintG = 0;
  let tintB = 0;
  let count = 0;
  for (const id of ids) {
    const m = ALL.get(id);
    if (!m) continue;
    out.aggression *= m.aggression;
    out.damage *= m.damage;
    out.health *= m.health;
    out.mutation = Math.max(out.mutation, m.mutation);
    out.armour = Math.max(out.armour, m.armour);
    out.resurrection = Math.max(out.resurrection, m.resurrection);
    out.extraCaptains += m.extraCaptains;
    out.huntRate = Math.max(out.huntRate, m.huntRate);
    out.fog *= m.fog;
    tintR += (m.tint >> 16) & 0xff;
    tintG += (m.tint >> 8) & 0xff;
    tintB += m.tint & 0xff;
    count++;
  }
  if (count > 0) {
    out.tint = ((Math.round(tintR / count) << 16) | (Math.round(tintG / count) << 8) | Math.round(tintB / count)) >>> 0;
  }
  // Keep it from running away into nonsense at Age 40.
  out.aggression = Math.min(out.aggression, 2.1);
  out.damage = Math.min(out.damage, 2.0);
  out.health = Math.min(out.health, 1.7);
  out.extraCaptains = Math.min(out.extraCaptains, 6);
  out.fog = Math.min(Math.max(out.fog, 0.6), 2.6);
  return out;
}

/** Roll the Age the world enters at `age` (1-indexed). */
export function rollAge(age: number, seed: number): AgeState {
  if (age <= NAMED_AGES.length) {
    const m = NAMED_AGES[age - 1];
    return { age, name: m.name, modifiers: [m.id], combined: combineModifiers([m.id]) };
  }
  const r = new RNG(seed ^ (age * 0x9e3779b9));
  const pool = [...NAMED_AGES.slice(1), ...LATE_MODIFIERS];
  const n = Math.min(2 + Math.floor((age - NAMED_AGES.length) / 3), 4);
  const chosen = r.sample(pool, n).map((m) => m.id);
  const name = `THE ${r.pick(NAMES_A)} ${r.pick(NAMES_B)}`;
  return { age, name, modifiers: chosen, combined: combineModifiers(chosen) };
}

export function describeAge(state: AgeState): string {
  const parts = state.modifiers.map((id) => ALL.get(id)?.desc ?? '').filter(Boolean);
  return parts.join(' ');
}
