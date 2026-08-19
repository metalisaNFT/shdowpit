/**
 * Creates nemeses. Everything derives from an integer seed so the same
 * character is reproduced exactly after a reload, and so the debug tools can
 * conjure a specific enemy on demand.
 */

import { RNG, mixSeed } from '../core/RNG';
import { AREAS } from '../data/areas';
import { PERSONALITIES } from '../data/personalities';
import { traitsOfKind } from '../data/traits';
import { generateUniqueName, chooseTitle } from '../data/names';
import type { AgeModifier } from '../data/ages';
import type { Archetype, Nemesis, PersonalityType, Rank, TraitId, WeaponType } from './Nemesis';
import { rankIndex } from './Nemesis';

const ARCHETYPES: Archetype[] = ['fighter', 'heavy', 'archer'];
const ARCHETYPE_WEIGHTS = [0.52, 0.26, 0.22];

const WEAPON_BY_ARCHETYPE: Record<Archetype, WeaponType[]> = {
  fighter: ['sword', 'spear', 'axe'],
  heavy: ['club', 'axe'],
  archer: ['bow'],
};

/** Traits that read as "armoured", boosted during the Iron Age. */
const ARMOUR_TRAITS: TraitId[] = ['iron_hide', 'thick_plate', 'immovable', 'bulwark'];

export interface GenerateOptions {
  seed: number;
  rank: Rank;
  turn: number;
  age: AgeModifier;
  /** names already taken, so the roster stays legible */
  taken: Set<string>;
  territory?: string;
  archetype?: Archetype;
  personality?: PersonalityType;
  /** level override; otherwise derived from rank + age */
  level?: number;
  persistent?: boolean;
  id: string;
}

export function generateNemesis(opts: GenerateOptions): Nemesis {
  const r = new RNG(opts.seed);

  const { name, seed: nameSeed } = generateUniqueName(mixSeed(opts.seed, 0x1a2b), opts.taken);
  const appearanceSeed = mixSeed(nameSeed, opts.seed);

  const archetype = opts.archetype ?? r.weighted(ARCHETYPES, ARCHETYPE_WEIGHTS);
  const personality = opts.personality ?? r.pick(PERSONALITIES).id;
  const weapon = r.pick(WEAPON_BY_ARCHETYPE[archetype]);

  const ri = rankIndex(opts.rank);
  const baseLevel = 1 + ri * 3 + r.int(0, 2);
  const level = opts.level ?? Math.max(1, Math.round(baseLevel * (1 + (opts.age.health - 1) * 0.6)));

  // Strengths scale with rank; weaknesses always exist so the player has a lever.
  const nStrengths = Math.min(4, 1 + Math.floor(ri * 0.8) + (r.chance(0.3) ? 1 : 0));
  const nWeaknesses = Math.max(1, 2 - Math.floor(ri * 0.4));

  const strengthPool = traitsOfKind('strength');
  const weaknessPool = traitsOfKind('weakness');

  let strengths = r.sample(strengthPool, nStrengths).map((t) => t.id);
  const weaknesses = r.sample(weaknessPool, nWeaknesses).map((t) => t.id);

  // Age flavour: iron ages plate people, plague ages mutate them.
  if (r.chance(opts.age.armour)) {
    const armour = r.pick(ARMOUR_TRAITS);
    if (!strengths.includes(armour)) strengths = [...strengths, armour].slice(0, 5);
  }
  if (r.chance(opts.age.mutation)) {
    const mut = r.pick(traitsOfKind('mutation')).id;
    if (!strengths.includes(mut)) strengths = [...strengths, mut].slice(0, 5);
  }

  const territory = opts.territory ?? pickTerritoryForRank(r, opts.rank);

  const n: Nemesis = {
    id: opts.id,
    name,
    title: '',
    rank: opts.rank,
    level,
    archetype,
    personality,
    appearanceSeed,
    weapon,
    strengths,
    weaknesses,
    scars: [],
    playerRelationship: 0,
    rivalries: [],
    allies: [],
    master: null,
    killsAgainstPlayer: 0,
    defeatsByPlayer: 0,
    escapedPlayer: 0,
    memory: [],
    alive: true,
    diedOnTurn: null,
    revengeChance: 0.1,
    power: 0,
    territory,
    persistent: opts.persistent ?? true,
    adaptations: [],
    stolen: [],
    bornTurn: opts.turn,
    returns: 0,
  };

  n.title = chooseTitle(n);
  recomputePower(n);
  return n;
}

function pickTerritoryForRank(r: RNG, rank: Rank): string {
  const ri = rankIndex(rank);
  // Higher ranks gravitate to the dangerous ground.
  const weights = AREAS.map((a) => {
    const diff = Math.abs(a.danger - (1 + ri));
    return 1 / (1 + diff * 1.3);
  });
  return r.weighted(AREAS, weights).id;
}

/**
 * Power is the single number the simulation compares. It should broadly track
 * how frightening a nemesis actually is in a fight.
 */
export function recomputePower(n: Nemesis): number {
  const ri = rankIndex(n.rank);
  // Level is capped so a long-reigning Overlord cannot snowball out of reach.
  let p = 20 + Math.min(n.level, 30) * 7 + ri * 26;
  p += n.strengths.length * 9;
  p += n.adaptations.length * 6;
  p -= n.weaknesses.length * 5;
  p += n.scars.length * 4;
  p += n.returns * 10;
  p += Math.min(n.killsAgainstPlayer, 6) * 5;
  p -= Math.min(n.defeatsByPlayer, 6) * 2;
  p += n.stolen.length * 7;
  n.power = Math.max(10, Math.round(p));
  return n.power;
}

/**
 * A throwaway enemy. Not saved, no memory, but built by the same pipeline so
 * it looks like it belongs to the same world.
 */
export function generateGrunt(seed: number, level: number, age: AgeModifier, territory: string): Nemesis {
  const r = new RNG(seed);
  const archetype = r.weighted(ARCHETYPES, ARCHETYPE_WEIGHTS);
  const weapon = r.pick(WEAPON_BY_ARCHETYPE[archetype]);
  const strengths: TraitId[] = [];
  if (r.chance(0.3)) strengths.push(r.pick(traitsOfKind('strength')).id);
  if (r.chance(age.armour * 0.7)) strengths.push(r.pick(ARMOUR_TRAITS));
  if (r.chance(age.mutation * 0.5)) strengths.push(r.pick(traitsOfKind('mutation')).id);
  const weaknesses = r.chance(0.55) ? [r.pick(traitsOfKind('weakness')).id] : [];

  const n: Nemesis = {
    id: 'g' + (seed >>> 0).toString(36),
    name: '',
    title: '',
    rank: 'grunt',
    level: Math.max(1, level),
    archetype,
    personality: r.pick(PERSONALITIES).id,
    appearanceSeed: seed,
    weapon,
    strengths,
    weaknesses,
    scars: [],
    playerRelationship: 0,
    rivalries: [],
    allies: [],
    master: null,
    killsAgainstPlayer: 0,
    defeatsByPlayer: 0,
    escapedPlayer: 0,
    memory: [],
    alive: true,
    diedOnTurn: null,
    revengeChance: 0,
    power: 0,
    territory,
    persistent: false,
    adaptations: [],
    stolen: [],
    bornTurn: 0,
    returns: 0,
  };
  recomputePower(n);
  return n;
}
