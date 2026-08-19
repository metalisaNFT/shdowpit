/**
 * Every tuning number in the game, in one file.
 *
 * The rule: if a value changes how the game *feels* or how hard it is, it
 * belongs here, not inline. Scattered magic numbers are how a combat system
 * becomes impossible to balance — you end up unable to answer "why did that
 * kill me" because the answer is spread across six files.
 *
 * Design philosophy encoded here:
 *  - normal enemies die fast when you play well; they are not damage sponges
 *  - difficulty comes from attack variety, timing and combinations
 *  - telegraphs are long enough to read and get shorter only as a late-game
 *    pressure, never so short that a hit is unavoidable
 *  - the player always has an answer: dodge, parry, interrupt, or reposition
 */

export const PLAYER = {
  baseHp: 100,

  /* movement */
  walkSpeed: 7.2,
  sprintMultiplier: 1.42,
  acceleration: 46,
  deceleration: 34,

  /* dodge */
  dodgeDuration: 0.36,
  /** i-frames start slightly after the press so a panic dodge is not free */
  dodgeIFrameStart: 0.03,
  dodgeIFrameEnd: 0.28,
  dodgeCooldown: 0.3,
  dodgeDistance: 7.4,
  /**
   * A dodge that begins within this many seconds of an incoming hit landing
   * counts as a PERFECT DODGE. Generous enough to reward intent, tight enough
   * that spamming dodge never triggers it.
   */
  perfectDodgeWindow: 0.16,
  perfectDodgeSlowMo: 0.22,
  perfectDodgeSurge: 12,
  /** attack-speed bonus and how long it lasts */
  perfectDodgeHaste: 0.3,
  perfectDodgeHasteTime: 3.5,

  /* parry */
  parryDuration: 0.46,
  /** the whole active window — a late parry still blocks */
  parryActive: 0.2,
  /** the front of the active window that counts as PERFECT */
  parryPerfect: 0.11,
  parryCooldown: 0.44,
  parrySurge: 18,
  /** seconds after a perfect parry in which attack becomes a counter */
  riposteWindow: 0.6,

  /* attacks */
  comboWindow: 0.45,
  executeDuration: 0.95,
  staggerDuration: 0.42,

  /* surge — earned by fighting well, spent on abilities */
  surgeMax: 100,
  surgeOnHit: 3,
  surgeOnHeavyHit: 6,
  surgeOnKill: 10,
  surgeOnExecute: 20,
  /** Surge does NOT regenerate. You earn it or you do without. */
  surgeDecayPerSecond: 0,
} as const;

/* ============================================================
   posture
   ============================================================ */

export const POSTURE = {
  /** base pool before rank and archetype scaling */
  base: 100,
  rankMultiplier: [0.7, 0.9, 1.15, 1.4, 1.75],
  archetypeMultiplier: { fighter: 1, heavy: 1.6, archer: 0.65 } as Record<string, number>,

  /** how fast posture recovers while the enemy is not being hit */
  regenPerSecond: 9,
  /** seconds after taking posture damage before regen resumes */
  regenDelay: 1.6,

  /* what fills it */
  lightHit: 8,
  heavyHit: 26,
  chargedHeavyHit: 42,
  parry: 34,
  perfectParry: 55,
  counterHit: 30,
  abilityHit: 20,
  /** hitting an enemy during its own windup punishes it harder */
  interruptBonus: 1.75,

  /** seconds an enemy stays broken and executable */
  brokenDuration: 3.2,
} as const;

/* ============================================================
   enemies
   ============================================================ */

export const ENEMY = {
  /** multiplies weapon damage; keep low, difficulty is not damage */
  damageMultiplier: 1,
  rankDamage: [0.85, 1, 1.15, 1.3, 1.5],
  rankHp: [0.85, 1, 1.18, 1.34, 1.55],
  archetypeHp: { fighter: 1, heavy: 1.85, archer: 0.72 } as Record<string, number>,
  archetypeSpeed: { fighter: 4.9, heavy: 3.9, archer: 5.3 } as Record<string, number>,

  /** seconds between an enemy finishing a swing and being willing to start another */
  recoveryMin: 0.6,
  recoveryMax: 1.7,
  /** aggressive personalities shorten the above */
  aggressionRecoveryScale: 0.55,

  /** how far a melee enemy will start a swing from, as a fraction of reach */
  swingRangeFraction: 0.92,

  /* ---- engagement bands (see enemy/EnemyAI.ts) ----
     Enemies used to sprint straight at the player until they were inside
     reach, forever. Now: run in the APPROACH band, walk in the PRESSURE band,
     and only close the last metres when they intend to swing. Everyone else
     circles, hesitates, backs off. The fight breathes. */
  /** width of the pressure band beyond swing range, metres */
  pressureBand: 4.6,
  /** speed multipliers by intent */
  approachSpeed: 1,
  pressureSpeed: 0.62,
  circleSpeed: 0.5,
  backoffSpeed: 0.55,
  /** seconds an enemy backs off after finishing an attack */
  backoffTime: [0.5, 1.2],
  /** chance per decision to simply stand and watch for a beat */
  hesitateChance: 0.24,
  hesitateTime: [0.35, 0.9],
  /** captains+ may cancel a windup into a feint */
  feintChance: 0.14,
} as const;

/* ============================================================
   telegraphs
   ============================================================ */

/**
 * Attack phase floors. Any attack may be slower than these; nothing may be
 * faster, because below roughly a third of a second a human cannot see it,
 * decide, and act. Late-game pressure comes from *combinations* and delays,
 * not from cutting anticipation below this.
 */
export const TELEGRAPH = {
  minAnticipation: 0.38,
  /** the ideal readable anticipation for a standard attack */
  standardAnticipation: 0.6,
  /** big, obvious, punishing attacks */
  heavyAnticipation: 0.95,
  /** how much of the anticipation is spent flashing the intent colour */
  colourLeadFraction: 0.55,
  /** unblockables get longer warning because the answer is movement */
  unblockableAnticipationScale: 1.25,

  /** world age shortens anticipation, but never below minAnticipation */
  agePressurePerAge: 0.04,
  agePressureMax: 0.22,
} as const;

/* ============================================================
   stagger — the flinch layer
   ============================================================ */

/**
 * STAGGER is the short flinch; POSTURE break is the long opening. The flinch
 * exists so the player can interrupt momentum — and the immunity window exists
 * so they cannot chain flinches into a free kill. Meaningful interruption,
 * never infinite stunlock.
 */
export const STAGGER = {
  /** flinch seconds by archetype [min, max] — heavies barely notice */
  duration: {
    fighter: [0.4, 0.7],
    heavy: [0.2, 0.4],
    archer: [0.45, 0.75],
  } as Record<string, readonly [number, number]>,
  /** captains and above shrug flinches off; posture is how you open THEM */
  rankScale: [1, 1, 0.72, 0.55, 0.4],
  /** seconds after a flinch ends during which further flinches are ignored */
  immunity: 1.15,
  /** shove impulse applied along the hit direction, m/s */
  shove: 5.5,
  /** a ranged hit on a fleeing/escaping enemy trips them this long */
  fleeingHit: 0.55,
} as const;

/* ============================================================
   the player's ranged tool — VOID NEEDLE
   ============================================================ */

/**
 * Not a gun. The needle exists to answer enemies that run, charge, or hide
 * behind distance: it slows runners, punishes windups, and trips escapees.
 * Damage is deliberately modest — interruption is the payload.
 */
export const RANGED = {
  damage: 9,
  speed: 30,
  /** seconds between shots */
  cooldown: 0.4,
  charges: 3,
  /** seconds to refill one charge */
  rechargeTime: 4.2,
  /** movement multiplier applied to the target and for how long */
  slowFactor: 0.55,
  slowDuration: 1.7,
  /** posture damage; windup hits also get POSTURE.interruptBonus */
  posture: 12,
  /** metres of soft-aim cone assistance, radians */
  aimCone: 0.22,
  aimRange: 34,
  projectileLife: 1.5,
} as const;

/* ============================================================
   enemy projectiles
   ============================================================ */

/**
 * Projectile speeds are reaction-rate limited. The old single arrow flew at
 * 42 m/s — from a 15m band that is 0.36s, which is not a decision, it is a
 * coin flip. Danger now comes from pattern, timing and zones, never from raw
 * speed.
 */
export const PROJ = {
  /** standard bolt — readable, parryable */
  boltSpeed: 17,
  /** charged shot — big, slow, unblockable, hurts */
  chargedSpeed: 11.5,
  chargedRadius: 0.55,
  /** spread shot — three in a cone; move through the gap */
  spreadSpeed: 15,
  spreadCone: 0.3,
  /** ground shot — lobbed; the zone is the danger, not the projectile */
  lobSpeed: 14,
  lobGravity: -14,
  maxLife: 3.4,
  /** toxic zone left by ground shots */
  zoneRadius: 3.2,
  zoneLife: 5.5,
  zoneDps: 10,
  zoneTick: 0.45,
} as const;

/* ============================================================
   poison
   ============================================================ */

export const POISON = {
  /** buildup needed to poison an enemy */
  threshold: 42,
  buildupMelee: 15,
  buildupShot: 24,
  dps: 7,
  duration: 4,
  /** TOXIC DETONATION */
  detonateDamage: 34,
  detonateRadius: 5.2,
} as const;

/* ============================================================
   the combat director
   ============================================================ */

/**
 * How many enemies may be committed to an attack at once. Everyone else
 * circles, repositions, or threatens. This is the single most important knob
 * for crowd readability — without it, four enemies swing simultaneously and
 * the player cannot possibly parse it.
 */
export const DIRECTOR = {
  maxAttackers: 2,
  /** raised when the player is strong or the world is old */
  maxAttackersHigh: 3,
  maxAttackersExtreme: 4,
  /** an enemy holds a claimed attack slot for at most this long */
  slotTimeout: 3.5,
  /** ranged attackers are counted separately so archers never block melee */
  maxRangedAttackers: 1,
  /** minimum seconds between two different enemies starting an attack */
  staggerBetweenAttacks: 0.35,
} as const;

/* ============================================================
   scaling
   ============================================================ */

export const SCALING = {
  /** per world age */
  enemyHpPerAge: 0.06,
  enemyDamagePerAge: 0.05,
  maxAgeScale: 1.6,
  /** per nemesis level */
  nemesisHpPerLevel: 0.03,
  nemesisDamagePerLevel: 0.02,
} as const;

/** Clamp helper used by the scaling functions. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Anticipation for an attack, after age pressure, floored at the minimum. */
export function anticipationFor(base: number, worldAge: number): number {
  const pressure = clamp(
    (worldAge - 1) * TELEGRAPH.agePressurePerAge,
    0,
    TELEGRAPH.agePressureMax
  );
  return Math.max(TELEGRAPH.minAnticipation, base * (1 - pressure));
}
