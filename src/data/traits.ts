/**
 * Trait table.
 *
 * Traits are the mechanical vocabulary of the nemesis system: strengths make
 * an enemy annoying in a specific way, weaknesses give the player a lever, and
 * adaptations are earned by watching the player repeat themselves.
 *
 * Design rule from the brief: adaptations must NOT be hard counters. Every
 * adaptation costs the player convenience, never the ability to fight.
 */

import type { TraitId } from '../nemesis/Nemesis';

export type TraitKind = 'strength' | 'weakness' | 'adaptation' | 'mutation';

export interface TraitMods {
  /** multiplied into max health */
  healthMul: number;
  /** multiplied into outgoing damage */
  damageMul: number;
  /** multiplied into move speed */
  speedMul: number;
  /** multiplied into attack wind-up (lower = faster) */
  windupMul: number;
  /** 0..1, fraction of incoming stagger ignored */
  staggerResist: number;
  /** incoming damage multipliers by source */
  vsLight: number;
  vsHeavy: number;
  vsFire: number;
  vsRanged: number;
  vsBack: number;
  /** flat incoming damage multiplier */
  armour: number;
  /** hp fraction at or below which an execution becomes available */
  executeThreshold: number;
  /** 0..1 chance to shrug an attack entirely */
  blockChance: number;
  /** 0..1 chance to sidestep */
  dodgeChance: number;
  /** 0..1 chance to swing back immediately after being hit */
  counterChance: number;
  /** health fraction below which they flee (personality can override) */
  fleeThreshold: number;
  /** damage bonus multiplier applied when below 30% hp */
  desperationMul: number;
  /** randomised extra wind-up, in seconds — beats rhythmic parrying */
  windupJitter: number;
  /** how sharply they track the player mid-attack, 0..1 */
  trackStrength: number;
  /** survive one execution attempt */
  executionWard: boolean;
  /** cannot be hit from behind for bonus damage */
  rearGuard: boolean;
  /** panics when set on fire */
  fearsFire: boolean;
  /** panics near explosions/shockwaves */
  fearsBlast: boolean;
  /** interrupts the player's third light hit */
  comboBreaker: boolean;
  /** occasional unparryable attack, always telegraphed differently */
  unblockable: boolean;
}

export function neutralMods(): TraitMods {
  return {
    healthMul: 1,
    damageMul: 1,
    speedMul: 1,
    windupMul: 1,
    staggerResist: 0,
    vsLight: 1,
    vsHeavy: 1,
    vsFire: 1,
    vsRanged: 1,
    vsBack: 1,
    armour: 1,
    executeThreshold: 0.2,
    blockChance: 0,
    dodgeChance: 0,
    counterChance: 0,
    fleeThreshold: 0,
    desperationMul: 1,
    windupJitter: 0,
    trackStrength: 0.35,
    executionWard: false,
    rearGuard: false,
    fearsFire: false,
    fearsBlast: false,
    comboBreaker: false,
    unblockable: false,
  };
}

export interface TraitDef {
  id: TraitId;
  name: string;
  kind: TraitKind;
  /** one short line shown on the intro card and hierarchy screen */
  desc: string;
  apply: (m: TraitMods) => void;
  /** rarity weight when rolling traits */
  weight?: number;
}

function def(
  id: string,
  name: string,
  kind: TraitKind,
  desc: string,
  apply: (m: TraitMods) => void,
  weight = 1
): TraitDef {
  return { id, name, kind, desc, apply, weight };
}

export const TRAITS: TraitDef[] = [
  /* ---------------- STRENGTHS ---------------- */
  def('fire_resist', 'FIRE RESISTANT', 'strength', 'Barely notices burning.', (m) => (m.vsFire *= 0.35)),
  def('iron_hide', 'IRON HIDE', 'strength', 'Takes reduced damage from everything.', (m) => (m.armour *= 0.78)),
  def('immovable', 'IMMOVABLE', 'strength', 'Very hard to stagger.', (m) => {
    m.staggerResist = Math.max(m.staggerResist, 0.75);
  }),
  def('quick', 'QUICK', 'strength', 'Moves and swings faster.', (m) => {
    m.speedMul *= 1.22;
    m.windupMul *= 0.82;
  }),
  def('brutal', 'BRUTAL', 'strength', 'Hits considerably harder.', (m) => (m.damageMul *= 1.35)),
  def('vigorous', 'VIGOROUS', 'strength', 'Unusually large health pool.', (m) => (m.healthMul *= 1.4)),
  def('blade_ward', 'BLADE WARD', 'strength', 'Shrugs off light attacks.', (m) => (m.vsLight *= 0.55)),
  def('counterstrike', 'COUNTERSTRIKE', 'strength', 'Swings back when struck.', (m) => (m.counterChance = 0.22)),
  def('arrow_ward', 'ARROW WARD', 'strength', 'Resists ranged damage.', (m) => (m.vsRanged *= 0.45)),
  def('relentless', 'RELENTLESS', 'strength', 'Does not flinch. Does not retreat.', (m) => {
    m.staggerResist = Math.max(m.staggerResist, 0.5);
    m.fleeThreshold = -1;
  }),
  def('hard_to_kill', 'HARD TO KILL', 'strength', 'Cannot be executed until nearly dead.', (m) => (m.executeThreshold = 0.08)),
  def('blood_fury', 'BLOOD FURY', 'strength', 'Grows stronger as it dies.', (m) => (m.desperationMul = 1.8)),
  def('bulwark', 'BULWARK', 'strength', 'Frequently blocks incoming blows.', (m) => (m.blockChance = 0.26)),
  def('swift_step', 'SWIFT STEP', 'strength', 'Sidesteps attacks.', (m) => (m.dodgeChance = 0.2)),
  def('thick_plate', 'THICK PLATE', 'strength', 'Heavy armour dulls cutting weapons.', (m) => {
    m.vsLight *= 0.65;
    m.speedMul *= 0.92;
  }),

  /* ---------------- WEAKNESSES ---------------- */
  def('weak_heavy', 'WEAK TO HEAVY', 'weakness', 'Crumples under heavy attacks.', (m) => (m.vsHeavy *= 1.85)),
  def('flammable', 'FLAMMABLE', 'weakness', 'Burns badly.', (m) => (m.vsFire *= 2.2)),
  def('poor_footing', 'POOR FOOTING', 'weakness', 'Staggers from almost anything.', (m) => {
    m.staggerResist = -0.5;
  }),
  def('fragile', 'FRAGILE', 'weakness', 'Can be executed early.', (m) => (m.executeThreshold = 0.4)),
  def('weak_ranged', 'EXPOSED', 'weakness', 'Takes extra ranged damage.', (m) => (m.vsRanged *= 1.9)),
  def('fears_fire', 'FEARS FIRE', 'weakness', 'Panics when burned.', (m) => {
    m.fearsFire = true;
  }),
  def('fears_blast', 'FEARS EXPLOSIONS', 'weakness', 'Panics near blasts.', (m) => {
    m.fearsBlast = true;
  }),
  def('glass_bones', 'GLASS BONES', 'weakness', 'Noticeably less health.', (m) => (m.healthMul *= 0.68)),
  def('sluggish', 'SLUGGISH', 'weakness', 'Slow to move and slow to swing.', (m) => {
    m.speedMul *= 0.8;
    m.windupMul *= 1.25;
  }),
  def('open_back', 'OPEN BACK', 'weakness', 'Devastated by attacks from behind.', (m) => (m.vsBack *= 2.2)),
  def('coward_heart', 'FEARS DEATH', 'weakness', 'Runs while it still can.', (m) => (m.fleeThreshold = Math.max(m.fleeThreshold, 0.45))),
  def('weak_light', 'THIN GUARD', 'weakness', 'Cut apart by fast weapons.', (m) => (m.vsLight *= 1.7)),

  /* ---------------- ADAPTATIONS ----------------
     Earned by watching the player. Deliberately soft. */
  def('delayed_strike', 'DELAYED STRIKE', 'adaptation', 'Holds attacks to break parry rhythm.', (m) => {
    m.windupJitter = 0.34;
  }),
  def('fire_hardened', 'FIRE HARDENED', 'adaptation', 'Learned to survive the flames.', (m) => (m.vsFire *= 0.5)),
  def('rear_guard', 'REAR GUARD', 'adaptation', 'Watches its back now.', (m) => {
    m.rearGuard = true;
    m.vsBack = Math.min(m.vsBack, 1);
  }),
  def('parry_breaker', 'PARRY BREAKER', 'adaptation', 'Some blows cannot be turned aside.', (m) => {
    m.unblockable = true;
  }),
  def('dodge_read', 'DODGE READ', 'adaptation', 'Tracks you through your rolls.', (m) => (m.trackStrength = 0.85)),
  def('execution_ward', 'EXECUTION WARD', 'adaptation', 'Will not die on its knees twice.', (m) => {
    m.executionWard = true;
  }),
  def('combo_breaker', 'COMBO BREAKER', 'adaptation', 'Interrupts your third swing.', (m) => {
    m.comboBreaker = true;
  }),
  def('shield_arm', 'SHIELD ARM', 'adaptation', 'Has learned to cover against arrows.', (m) => (m.vsRanged *= 0.5)),
  def('no_retreat', 'NO RETREAT', 'adaptation', 'Will not run from you again.', (m) => {
    m.fleeThreshold = -1;
  }),
  def('closer', 'CLOSER', 'adaptation', 'Refuses to let you keep your distance.', (m) => (m.speedMul *= 1.18)),

  /* ---------------- MUTATIONS (Age of Plague) ---------------- */
  def('mut_bloated', 'BLOATED', 'mutation', 'Swollen, slow and durable.', (m) => {
    m.healthMul *= 1.6;
    m.speedMul *= 0.85;
  }),
  def('mut_spined', 'SPINED', 'mutation', 'Lashes out reflexively.', (m) => (m.counterChance = Math.max(m.counterChance, 0.3))),
  def('mut_hollow', 'HOLLOW', 'mutation', 'Light, fast, and wrong.', (m) => {
    m.speedMul *= 1.35;
    m.healthMul *= 0.8;
  }),
  def('mut_seething', 'SEETHING', 'mutation', 'Its wounds boil.', (m) => {
    m.desperationMul = 2.1;
    m.vsFire *= 0.6;
  }),
];

const TRAIT_MAP = new Map<TraitId, TraitDef>(TRAITS.map((t) => [t.id, t]));

export function getTrait(id: TraitId): TraitDef | undefined {
  return TRAIT_MAP.get(id);
}

export function traitName(id: TraitId): string {
  return TRAIT_MAP.get(id)?.name ?? id.toUpperCase();
}

export function traitsOfKind(kind: TraitKind): TraitDef[] {
  return TRAITS.filter((t) => t.kind === kind);
}

/** Fold a set of trait ids into a single modifier block. */
export function computeMods(ids: readonly TraitId[]): TraitMods {
  const m = neutralMods();
  for (const id of ids) {
    const t = TRAIT_MAP.get(id);
    if (t) t.apply(m);
  }
  return m;
}

/**
 * Which adaptation should this enemy learn, given how the player fights?
 * Returns null when the player is varied enough not to deserve one.
 */
export function pickAdaptation(
  habits: Record<string, number>,
  already: readonly TraitId[]
): TraitId | null {
  const total =
    (habits.light ?? 0) +
    (habits.heavy ?? 0) +
    (habits.parry ?? 0) +
    (habits.dodge ?? 0) +
    (habits.fire ?? 0) +
    (habits.execute ?? 0) +
    (habits.backstab ?? 0) +
    (habits.ranged ?? 0);
  if (total < 25) return null;

  const owned = new Set(already);
  const candidates: Array<{ id: TraitId; score: number }> = [
    { id: 'delayed_strike', score: (habits.parry ?? 0) / total },
    { id: 'fire_hardened', score: (habits.fire ?? 0) / total },
    { id: 'rear_guard', score: (habits.backstab ?? 0) / total },
    { id: 'dodge_read', score: (habits.dodge ?? 0) / total },
    { id: 'execution_ward', score: (habits.execute ?? 0) / total },
    { id: 'combo_breaker', score: (habits.light ?? 0) / total },
    { id: 'parry_breaker', score: (habits.parry ?? 0) / total * 0.7 },
    { id: 'shield_arm', score: (habits.ranged ?? 0) / total },
    { id: 'closer', score: (habits.dodge ?? 0) / total * 0.6 },
  ].filter((c) => !owned.has(c.id));

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  // Only adapt if the player is genuinely leaning on something.
  return candidates[0].score >= 0.26 ? candidates[0].id : null;
}
