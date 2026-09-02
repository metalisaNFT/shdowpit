/**
 * A fighter, derived from a persistent record, for the headless duel.
 *
 * Every number here comes from the same tables the onscreen game uses:
 * `BODY` for the body scale, `ENEMY_WEAPONS` for the steel, `computeMods` for
 * the traits, `PERSONALITIES` for the nerve. An offscreen duel and an onscreen
 * one are the same creature — that is the whole point of building it this way
 * rather than comparing two `power` integers.
 */

import { computeMods, type TraitMods } from '../data/traits';
import { enemyWeapon, type WeaponDef } from '../data/weapons';
import { getPersonality, type PersonalityDef } from '../data/personalities';
import { BODY, POSTURE } from '../data/balance';
import type { AgeModifier } from '../data/ages';
import type { Archetype, Nemesis } from '../nemesis/Nemesis';
import { rankIndex } from '../nemesis/Nemesis';
import { simOf } from './GodTypes';

/** Tilts applied by conditions. Never decides a fight — only leans on it. */
export interface CombatTilt {
  /** multiplies outgoing damage */
  damage: number;
  /** multiplies starting and maximum health */
  health: number;
  /** multiplies incoming damage */
  armour: number;
  /** adds to nerve: how long they stay in a losing fight */
  resolve: number;
  /** they know something the other does not — first-strike advantage */
  edge: number;
}

export function neutralTilt(): CombatTilt {
  return { damage: 1, health: 1, armour: 1, resolve: 0, edge: 0 };
}

export interface Fighter {
  id: string;
  name: string;
  archetype: Archetype;
  rankIdx: number;
  level: number;
  personality: PersonalityDef;
  mods: TraitMods;
  weapon: WeaponDef;

  maxHp: number;
  hp: number;
  damage: number;
  speed: number;
  posture: number;
  postureMax: number;

  /** 0..1 — wounds carried in from earlier cycles */
  woundedFrac: number;
  tilt: CombatTilt;
  /**
   * 0..1 — how hard they run somebody down. A hunter or an avenger does not
   * let a broken opponent walk off; a showoff has already turned to the crowd.
   * Fights started to answer somebody (revenge, hunt) raise it further.
   */
  pursuit: number;

  /* live duel state */
  busy: number;
  lastAttackId: string;
  broken: boolean;
  brokenTimer: number;
  fleeing: boolean;
  hits: number;
  landed: number;
  parries: number;
  biggestHit: number;
}

/**
 * Build a fighter. `hpScale` lets the caller start someone at less than full
 * health without pretending their maximum changed — that is how an injury
 * carried between cycles is felt.
 */
export function makeFighter(n: Nemesis, age: AgeModifier, tilt: CombatTilt = neutralTilt()): Fighter {
  const sim = simOf(n);
  const traits = [...n.strengths, ...n.weaknesses, ...n.adaptations];
  const mods = computeMods(traits);
  const ri = rankIndex(n.rank);
  const pers = getPersonality(n.personality);

  const hpBase = BODY.hpBase + n.level * BODY.hpPerLevel;
  const maxHp = Math.max(
    12,
    Math.round(
      hpBase *
        (BODY.archHp[n.archetype] ?? 1) *
        (BODY.rankHp[ri] ?? 1) *
        mods.healthMul *
        age.health *
        tilt.health
    )
  );

  // The crisis is the thing the world could not hold. It does not run, and it
  // hits like something that knows it.
  if (sim.crisisBorn) {
    tilt = { ...tilt, damage: tilt.damage * 1.15, resolve: tilt.resolve + 0.3 };
  }

  let weapon = enemyWeapon(n.weapon);
  let damage =
    weapon.damage * (1 + n.level * BODY.damagePerLevel) * mods.damageMul * age.damage * (0.85 + pers.aggression * 0.3);
  if (n.stolen.length) {
    damage *= BODY.stolenDamage;
    weapon = { ...weapon, reach: weapon.reach + BODY.stolenReach, damage: weapon.damage + BODY.stolenWeaponDamage };
  }
  if (n.stolenFromThem?.length) damage *= BODY.robbedDamage;
  damage *= tilt.damage;

  const postureMax = Math.round(
    POSTURE.base * (POSTURE.rankMultiplier[ri] ?? 1) * (POSTURE.archetypeMultiplier[n.archetype] ?? 1) * (1 + n.level * 0.02)
  );

  const woundedFrac = Math.min(0.75, sim.injury / 140);

  return {
    id: n.id,
    name: n.name,
    archetype: n.archetype,
    rankIdx: ri,
    level: n.level,
    personality: pers,
    mods,
    weapon,
    maxHp,
    hp: Math.max(6, Math.round(maxHp * (1 - woundedFrac))),
    damage,
    speed: (BODY.archSpeed[n.archetype] ?? BODY.archSpeedDefault) * mods.speedMul,
    posture: 0,
    postureMax,
    woundedFrac,
    tilt,
    pursuit: Math.max(0, Math.min(1, (pers.hunt - 1) * 0.35 + (pers.revenge - 1) * 0.25 + tilt.edge * 0.2)),
    busy: 0,
    lastAttackId: '',
    broken: false,
    brokenTimer: 0,
    fleeing: false,
    hits: 0,
    landed: 0,
    parries: 0,
    biggestHit: 0,
  };
}

/** The health fraction at which this fighter starts thinking about leaving. */
export function fleeThreshold(f: Fighter): number {
  if (f.mods.fleeThreshold === -1 || f.personality.fleeAt === -1) return -1;
  // The onscreen thresholds are tuned for running from the player, who is
  // always the more dangerous thing in the room. Between two characters the
  // same numbers made two fights in three end with somebody walking off.
  const base = Math.max(f.mods.fleeThreshold, f.personality.fleeAt * 0.6);
  return Math.max(0, base - f.tilt.resolve);
}
