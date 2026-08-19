/**
 * Enemy attack definitions.
 *
 * Before this file every enemy had exactly one attack — `weapon.windup`,
 * `weapon.recover`, forever — which is the mechanical reason combat felt
 * repetitive no matter how good the nemesis layer was.
 *
 * Each archetype now has a small set of attacks with genuinely different
 * purposes, and every one of them declares its INTENT, which is what the
 * player actually reads:
 *
 *   normal       amber   — a plain swing; dodge it or trade
 *   parryable    cyan    — the game is offering you a parry
 *   unblockable  red     — parry will not work; move
 *   area         amber   — the ground shows you where it lands
 *
 * The three-phase structure is fixed: ANTICIPATION -> ACTIVE -> RECOVERY.
 * Anticipation is never shorter than TELEGRAPH.minAnticipation, because below
 * that a human cannot see, decide and act. Difficulty comes from combinations,
 * delays and feints — not from taking the reaction time away.
 */

import type { Archetype } from '../nemesis/Nemesis';

export type AttackIntent = 'normal' | 'parryable' | 'unblockable' | 'area';

/**
 * Projectile behaviours. One boring straight arrow became four questions:
 *   bolt     straight, readable, parryable — the baseline
 *   charged  big, slow, unblockable — respect it, move
 *   spread   a cone of three — find the gap or dodge through
 *   ground   a lobbed shot whose toxic ZONE is the real danger
 */
export type ProjectileKind = 'bolt' | 'charged' | 'spread' | 'ground';

export interface EnemyAttackDef {
  id: string;
  name: string;
  archetypes: Archetype[];
  intent: AttackIntent;

  /** seconds — the readable warning */
  anticipation: number;
  /** seconds the hit window is live */
  active: number;
  /** seconds of vulnerability afterwards */
  recovery: number;

  /** multipliers applied to the wielder's weapon */
  reachMul: number;
  arcMul: number;
  damageMul: number;
  postureMul: number;
  /** scales the knockback the blow applies to the player */
  knockbackMul: number;

  /** forward movement during the active phase, m/s */
  lunge: number;

  /**
   * Interruptible attacks can be cancelled by a heavy hit or a posture break
   * during early anticipation. Non-interruptible ones flash their armour
   * instead, so the player learns not to trade into them.
   */
  interruptible: boolean;

  /** extra hold between anticipation and the strike — the "delayed" attacks */
  delay: number;

  /** engagement band, as a fraction of the wielder's reach */
  minRange: number;
  maxRange: number;

  /** selection weight */
  weight: number;
  /** rank index required to use it (0 = grunt) */
  minRank: number;

  /** ground danger circle radius in metres; 0 means it is an arc attack */
  areaRadius: number;
  /** how many separate hits the attack lands */
  hits: number;
  /** projectile count for ranged attacks */
  projectiles: number;
  ranged: boolean;
  /** which projectile behaviour a ranged attack fires */
  projectileKind: ProjectileKind;
}

function atk(p: Partial<EnemyAttackDef> & Pick<EnemyAttackDef, 'id' | 'name' | 'archetypes'>): EnemyAttackDef {
  return {
    intent: 'normal',
    anticipation: 0.6,
    active: 0.1,
    recovery: 0.5,
    reachMul: 1,
    arcMul: 1,
    damageMul: 1,
    postureMul: 1,
    knockbackMul: 1,
    lunge: 0,
    interruptible: true,
    delay: 0,
    minRange: 0,
    maxRange: 1.05,
    weight: 1,
    minRank: 0,
    areaRadius: 0,
    hits: 1,
    projectiles: 0,
    ranged: false,
    projectileKind: 'bolt',
    ...p,
  };
}

/* ============================================================
   the table
   ============================================================ */

export const ENEMY_ATTACKS: EnemyAttackDef[] = [
  /* ---------------- FIGHTER ---------------- */
  atk({
    id: 'quick_slash',
    name: 'SLASH',
    archetypes: ['fighter'],
    intent: 'normal',
    anticipation: 0.46,
    active: 0.09,
    recovery: 0.42,
    damageMul: 0.85,
    postureMul: 0.8,
    weight: 3,
  }),
  atk({
    id: 'double_slash',
    name: 'DOUBLE SLASH',
    archetypes: ['fighter'],
    intent: 'normal',
    anticipation: 0.55,
    active: 0.3,
    recovery: 0.55,
    damageMul: 0.7,
    postureMul: 0.7,
    hits: 2,
    weight: 2,
    minRank: 1,
  }),
  atk({
    id: 'thrust',
    name: 'THRUST',
    archetypes: ['fighter'],
    intent: 'unblockable',
    anticipation: 0.72,
    active: 0.12,
    recovery: 0.62,
    reachMul: 1.45,
    arcMul: 0.4,
    damageMul: 1.15,
    lunge: 9,
    interruptible: true,
    minRange: 0.6,
    maxRange: 1.7,
    weight: 1.5,
    minRank: 1,
  }),
  atk({
    id: 'overhead',
    name: 'OVERHEAD',
    archetypes: ['fighter'],
    // The game's standing offer: a big, slow, obvious swing you are meant to
    // catch. Every archetype has at least one.
    intent: 'parryable',
    anticipation: 0.78,
    active: 0.11,
    recovery: 0.68,
    damageMul: 1.35,
    postureMul: 1.4,
    arcMul: 0.85,
    weight: 2,
  }),
  atk({
    id: 'sidestep_cut',
    name: 'SIDESTEP CUT',
    archetypes: ['fighter'],
    // A short darting slash after a hop — quick but honest, and it leaves them
    // close and recovering. The punish window is the point.
    intent: 'parryable',
    anticipation: 0.52,
    active: 0.1,
    recovery: 0.7,
    damageMul: 0.9,
    postureMul: 0.9,
    lunge: 6,
    minRange: 0.5,
    maxRange: 1.4,
    weight: 1.6,
    minRank: 1,
  }),
  atk({
    id: 'delayed_overhead',
    name: 'HELD OVERHEAD',
    archetypes: ['fighter'],
    // The fighter's version of the heavy's held smash: the windup completes,
    // holds a beat, then falls. Captains and above.
    intent: 'normal',
    anticipation: 0.6,
    delay: 0.4,
    active: 0.1,
    recovery: 0.7,
    damageMul: 1.2,
    postureMul: 1.2,
    weight: 1.1,
    minRank: 2,
  }),

  /* ---------------- HEAVY ---------------- */
  atk({
    id: 'wide_sweep',
    name: 'SWEEP',
    archetypes: ['heavy'],
    intent: 'unblockable',
    anticipation: 0.85,
    active: 0.16,
    recovery: 0.7,
    arcMul: 1.8,
    reachMul: 1.15,
    damageMul: 1.1,
    postureMul: 1.3,
    interruptible: false,
    weight: 2.5,
  }),
  atk({
    id: 'ground_slam',
    name: 'SLAM',
    archetypes: ['heavy'],
    intent: 'area',
    anticipation: 1.05,
    active: 0.12,
    recovery: 0.85,
    damageMul: 1.4,
    postureMul: 1.6,
    areaRadius: 5.2,
    interruptible: false,
    weight: 2,
    minRank: 1,
  }),
  atk({
    id: 'shoulder_charge',
    name: 'CHARGE',
    archetypes: ['heavy'],
    intent: 'unblockable',
    anticipation: 0.9,
    active: 0.42,
    recovery: 0.8,
    reachMul: 0.9,
    arcMul: 1.2,
    damageMul: 0.9,
    postureMul: 1.5,
    lunge: 13,
    interruptible: false,
    minRange: 0.9,
    maxRange: 3.2,
    weight: 2,
  }),
  atk({
    id: 'heavy_overhead',
    name: 'OVERHEAD',
    archetypes: ['heavy'],
    intent: 'parryable',
    anticipation: 1.0,
    active: 0.12,
    recovery: 0.8,
    damageMul: 1.5,
    postureMul: 1.8,
    arcMul: 0.8,
    weight: 1.6,
  }),
  atk({
    id: 'shove',
    name: 'SHOVE',
    archetypes: ['heavy'],
    // Not damage — DISTANCE. The heavy makes space with a flat slam of the
    // free hand, then follows with something that hurts. Fast for a heavy,
    // interruptible, and mostly knockback.
    intent: 'normal',
    anticipation: 0.45,
    active: 0.12,
    recovery: 0.55,
    reachMul: 0.7,
    arcMul: 1.1,
    damageMul: 0.35,
    postureMul: 0.4,
    knockbackMul: 4.5,
    maxRange: 0.7,
    weight: 1.8,
  }),
  atk({
    id: 'delayed_smash',
    name: 'HELD SMASH',
    archetypes: ['heavy'],
    // The anticipation completes, and then nothing happens for a beat. The
    // player's trained dodge comes out early and whiffs. Captains and above
    // only — this is unfair against someone still learning the base timings.
    intent: 'unblockable',
    anticipation: 0.8,
    delay: 0.55,
    active: 0.12,
    recovery: 0.9,
    damageMul: 1.35,
    postureMul: 1.6,
    interruptible: false,
    weight: 1.2,
    minRank: 2,
  }),

  /* ---------------- ARCHER ---------------- */
  atk({
    id: 'single_arrow',
    name: 'ARROW',
    archetypes: ['archer'],
    // The baseline STANDARD BOLT: straight, moderate speed, cyan — the game's
    // promise that a shot can be turned aside.
    intent: 'parryable',
    anticipation: 0.55,
    active: 0.06,
    recovery: 0.55,
    damageMul: 1,
    ranged: true,
    projectiles: 1,
    projectileKind: 'bolt',
    minRange: 0.15,
    maxRange: 1,
    weight: 3,
  }),
  atk({
    id: 'triple_burst',
    name: 'SPREAD SHOT',
    archetypes: ['archer'],
    // Three in a cone. The answer is positioning — stand in the gap or dodge
    // through it — not the parry button.
    intent: 'normal',
    anticipation: 0.75,
    active: 0.08,
    recovery: 0.8,
    damageMul: 0.6,
    ranged: true,
    projectiles: 3,
    projectileKind: 'spread',
    minRange: 0.15,
    maxRange: 0.8,
    weight: 1.8,
    minRank: 1,
  }),
  atk({
    id: 'piercing_shot',
    name: 'CHARGED SHOT',
    archetypes: ['archer'],
    // The CHARGED SHOT: long telegraph, a big slow glowing mass, high damage,
    // and no parry. Clear danger, clear answer: move.
    intent: 'unblockable',
    anticipation: 1.1,
    active: 0.06,
    recovery: 0.9,
    damageMul: 1.8,
    postureMul: 1.4,
    ranged: true,
    projectiles: 1,
    projectileKind: 'charged',
    minRange: 0.2,
    maxRange: 1,
    weight: 1.2,
    minRank: 1,
  }),
  atk({
    id: 'toxic_lob',
    name: 'TOXIC LOB',
    archetypes: ['archer'],
    // GROUND SHOT: an arcing lob that leaves a toxic zone where it lands. The
    // projectile is not the danger — the floor is. Area intent, acid colour.
    intent: 'area',
    anticipation: 0.8,
    active: 0.06,
    recovery: 0.85,
    damageMul: 0.5,
    ranged: true,
    projectiles: 1,
    projectileKind: 'ground',
    minRange: 0.15,
    maxRange: 0.9,
    weight: 1.4,
    minRank: 1,
  }),
  atk({
    id: 'backstep_shot',
    name: 'BACKSTEP',
    archetypes: ['archer'],
    intent: 'normal',
    anticipation: 0.42,
    active: 0.06,
    recovery: 0.5,
    damageMul: 0.7,
    lunge: -11,
    ranged: true,
    projectiles: 1,
    projectileKind: 'bolt',
    minRange: 0,
    maxRange: 0.35,
    weight: 2.5,
  }),
];

export const ATTACK_MAP = new Map(ENEMY_ATTACKS.map((a) => [a.id, a]));

/* ============================================================
   selection
   ============================================================ */

export interface AttackQuery {
  archetype: Archetype;
  rankIndex: number;
  /** distance to the target, in metres */
  distance: number;
  /** the wielder's weapon reach, in metres */
  reach: number;
  /** 0..1 */
  aggression: number;
  /** trait flags that unlock or bias attacks */
  allowUnblockable: boolean;
  allowDelayed: boolean;
  rand: () => number;
}

/**
 * Pick an attack that actually makes sense from here. Returns null when the
 * enemy is out of position for every option it owns, which is what makes them
 * reposition instead of flailing.
 */
export function chooseAttack(q: AttackQuery): EnemyAttackDef | null {
  const candidates: Array<{ def: EnemyAttackDef; w: number }> = [];
  const frac = q.distance / Math.max(0.5, q.reach);

  for (const def of ENEMY_ATTACKS) {
    if (!def.archetypes.includes(q.archetype)) continue;
    if (def.minRank > q.rankIndex) continue;
    if (frac < def.minRange || frac > def.maxRange) continue;
    if (def.intent === 'unblockable' && !q.allowUnblockable && def.id !== 'thrust') continue;
    if (def.delay > 0 && !q.allowDelayed) continue;

    let w = def.weight;
    // Aggressive personalities favour committed, high-damage options.
    if (def.damageMul > 1.2) w *= 0.7 + q.aggression * 0.8;
    // Prefer attacks whose band centres on the current distance.
    const centre = (def.minRange + def.maxRange) / 2;
    w *= 1 / (1 + Math.abs(frac - centre) * 1.4);
    candidates.push({ def, w });
  }

  if (!candidates.length) return null;
  let total = 0;
  for (const c of candidates) total += c.w;
  let roll = q.rand() * total;
  for (const c of candidates) {
    roll -= c.w;
    if (roll <= 0) return c.def;
  }
  return candidates[candidates.length - 1].def;
}

/** The colour a telegraph should use for an intent. Kept next to the table. */
export function intentIsParryable(intent: AttackIntent): boolean {
  return intent === 'parryable';
}
