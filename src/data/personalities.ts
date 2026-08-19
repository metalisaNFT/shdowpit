/**
 * Personalities steer both the offscreen simulation and live combat. They are
 * the reason two enemies with identical stats produce different stories.
 */

import type { PersonalityType } from '../nemesis/Nemesis';

export interface PersonalityDef {
  id: PersonalityType;
  name: string;
  desc: string;

  /* --- simulation biases, all roughly 0..2 with 1 = average --- */
  challenge: number; // starts duels
  betray: number; // turns on allies and masters
  ally: number; // forms bonds
  revenge: number; // pursues grudges
  ambition: number; // seeks promotion
  survival: number; // survives apparent death, escapes
  hunt: number; // invades the player's area during a run
  protect: number; // defends a superior
  steal: number; // loots corpses, including the player's

  /* --- live combat --- */
  /** health fraction at which they consider running */
  fleeAt: number;
  /** 0..1, how often they press an attack */
  aggression: number;
  /** damage multiplier once below 30% health */
  desperation: number;
  /** willingness to keep distance (archers use this most) */
  spacing: number;
}

function p(
  id: PersonalityType,
  name: string,
  desc: string,
  o: Partial<Omit<PersonalityDef, 'id' | 'name' | 'desc'>>
): PersonalityDef {
  return {
    id,
    name,
    desc,
    challenge: 1,
    betray: 0.3,
    ally: 1,
    revenge: 1,
    ambition: 1,
    survival: 1,
    hunt: 1,
    protect: 0.6,
    steal: 0.5,
    fleeAt: 0.18,
    aggression: 0.6,
    desperation: 1,
    spacing: 0.5,
    ...o,
  };
}

export const PERSONALITIES: PersonalityDef[] = [
  p('coward', 'COWARD', 'Runs when badly hurt. Comes back when you are not looking.', {
    challenge: 0.4,
    betray: 0.9,
    ambition: 0.6,
    survival: 1.6,
    hunt: 0.3,
    fleeAt: 0.5,
    aggression: 0.4,
    spacing: 0.75,
  }),
  p('hunter', 'HUNTER', 'Seeks you out. Will interrupt fights that are not his.', {
    hunt: 2.4,
    revenge: 1.4,
    challenge: 1.1,
    aggression: 0.75,
    fleeAt: 0.1,
  }),
  p('showoff', 'SHOWOFF', 'Picks fights constantly. Loves an audience.', {
    challenge: 2.2,
    ambition: 1.4,
    protect: 0.2,
    aggression: 0.8,
    fleeAt: 0.12,
  }),
  p('madman', 'MADMAN', 'Grows stronger the closer he gets to death.', {
    challenge: 1.6,
    survival: 1.2,
    fleeAt: -1,
    aggression: 0.9,
    desperation: 2.0,
    spacing: 0.15,
  }),
  p('collector', 'COLLECTOR', 'Takes what the dead leave behind.', {
    steal: 2.6,
    challenge: 1.2,
    ambition: 0.9,
    fleeAt: 0.25,
    aggression: 0.6,
  }),
  p('avenger', 'AVENGER', 'Comes for whoever hurt his own.', {
    revenge: 2.5,
    ally: 1.6,
    protect: 1.5,
    hunt: 1.5,
    aggression: 0.7,
    fleeAt: 0.08,
  }),
  p('opportunist', 'OPPORTUNIST', 'Arrives once someone else is already bleeding.', {
    challenge: 0.8,
    betray: 1.2,
    ambition: 1.5,
    hunt: 1.3,
    steal: 1.4,
    aggression: 0.5,
    fleeAt: 0.3,
    spacing: 0.65,
  }),
  p('loyalist', 'LOYALIST', 'Dies in front of his master rather than behind him.', {
    protect: 2.6,
    betray: 0.02,
    ally: 1.8,
    ambition: 0.5,
    aggression: 0.65,
    fleeAt: 0.05,
  }),
  p('traitor', 'TRAITOR', 'Every alliance is temporary.', {
    betray: 2.8,
    ally: 1.2,
    ambition: 1.7,
    protect: 0.05,
    aggression: 0.6,
    fleeAt: 0.28,
  }),
  p('survivor', 'SURVIVOR', 'Very hard to be rid of permanently.', {
    survival: 2.8,
    challenge: 0.7,
    aggression: 0.55,
    fleeAt: 0.4,
    spacing: 0.6,
  }),
  p('obsessed', 'OBSESSED', 'Has decided this is between the two of you.', {
    hunt: 2.8,
    revenge: 2.2,
    survival: 1.5,
    ambition: 0.7,
    aggression: 0.85,
    fleeAt: -1,
    spacing: 0.1,
  }),
  p('ambitious', 'AMBITIOUS', 'Climbing, always, over anyone.', {
    ambition: 2.6,
    challenge: 1.8,
    betray: 1.1,
    protect: 0.2,
    aggression: 0.7,
    fleeAt: 0.2,
  }),
];

const MAP = new Map<PersonalityType, PersonalityDef>(PERSONALITIES.map((x) => [x.id, x]));

export function getPersonality(id: PersonalityType): PersonalityDef {
  return MAP.get(id) ?? PERSONALITIES[0];
}
