/**
 * The one place colour is decided.
 *
 * SHDOWPIT's look is a near-monochrome industrial world — black, charcoal,
 * smoke, dirty metal — cut with a very small amount of extremely saturated
 * toxic neon. The neon is not decoration. It is the game's information
 * channel, and every hue below has exactly one meaning.
 *
 * Two rules keep it from turning into soup:
 *
 *  1. WORLD COLOURS ARE DESATURATED AND DARK. Anything in `WORLD` is scenery.
 *     If a surface is scenery, it must not compete with a signal colour.
 *  2. SIGNAL COLOURS MEAN ONE THING EACH. Do not reach into `SIGNAL` for a
 *     colour because it looks nice. A cyan flash means "you can parry this"
 *     everywhere in the game or it means nothing anywhere.
 *
 * The player learns these over a few runs. Breaking them costs more than any
 * individual effect gains.
 */

/* ============================================================
   the world — black, charcoal, smoke, dirty metal
   ============================================================ */

export const WORLD = {
  /** fog and sky; everything fades to this */
  void: 0x08090e,
  /** the global ground plane */
  ground: 0x1c1e26,
  /** worn routes between areas */
  path: 0x2c3038,
  /** the base value for brutalist structures */
  structure: 0x32363f,
  /** lighter structural faces — dirty metal */
  metal: 0x42474f,
  /** the darkest recesses, ceilings */
  shadow: 0x0a0b10,
  /** boundary walls */
  boundary: 0x14161c,
  /** rusted / contaminated industrial surfaces */
  rust: 0x3c352c,
  /** bone and ivory — horns, skulls, exposed structure */
  bone: 0xcfc9b8,
} as const;

/* ============================================================
   the toxic neon family
   ============================================================ */

export const NEON = {
  /** the signature colour of the game */
  lime: 0xc4ff2e,
  /** slightly greener, used for contamination */
  acid: 0x76ff35,
  /** yellow-green, hazard markings */
  toxic: 0xe4ff2b,
  /** the coldest member, reserved for defence */
  cyan: 0x2ff2ff,
  /** warm counterpoint — enemy aggression */
  amber: 0xff9a1f,
  /** danger */
  red: 0xff2a3c,
  /** rare, used sparingly */
  magenta: 0xff2f9c,
  /** supernatural / world events */
  violet: 0xa14cff,
} as const;

/* ============================================================
   the colour language
   ============================================================ */

/**
 * Gameplay meanings. Read this table before adding any coloured effect.
 * If your effect does not fit one of these meanings, it should probably be
 * white, bone, or a world colour — not a new hue.
 */
export const SIGNAL = {
  /** the player: energy, surge, their own weapon edge and trails */
  player: NEON.lime,
  /** surge resource specifically */
  surge: NEON.toxic,

  /** a normal enemy attack winding up — "something is coming" */
  enemyAttack: NEON.amber,
  /** this attack can be parried — the cyan promise */
  parryable: NEON.cyan,
  /** this attack cannot be parried — get out of the way */
  unblockable: NEON.red,
  /** the ground area an attack will cover */
  areaWarning: NEON.amber,

  /** poison, contamination, toxic pools */
  poison: NEON.acid,

  /** posture damage and the moment posture breaks */
  posture: NEON.cyan,
  postureBreak: 0xffffff,

  /** an execution is available / happening */
  execute: NEON.magenta,

  /** world simulation events, arrivals, ages */
  worldEvent: NEON.violet,

  /** a critical hit */
  critical: NEON.toxic,

  /** healing and shrines */
  restore: NEON.lime,
} as const;

/* ============================================================
   nemesis accents
   ============================================================ */

/**
 * Per-nemesis identity colours. Weighted toward the toxic family so the world
 * stays coherent, with a few cold and violet outliers so individual Nemeses
 * are still tellable apart at a glance. Deliberately excludes pure amber and
 * pure red — those belong to the attack language and must not be confused
 * with "who is this".
 */
export const NEMESIS_ACCENTS: number[] = [
  0xc4ff2e, // lime
  0x76ff35, // acid
  0xe4ff2b, // toxic yellow
  0x9dff6a, // pale contamination
  0x2ff2ff, // cyan
  0x5affd0, // sea
  0xa14cff, // violet
  0xff2f9c, // magenta
  0x7bffb0, // mint
  0xd6ff7a, // bleached lime
  0x37d5ff, // ice
  0xcaa8ff, // pale violet
];

/**
 * Enemy body colours: charcoal and dirty metal only. Enemies must read as
 * silhouettes, with the neon doing the identifying.
 */
export const ENEMY_BODY: number[] = [
  0x2e333c, 0x363b46, 0x31363f, 0x3a3f4a, 0x2a2f38, 0x404550, 0x333843, 0x272c35,
];

/** Enemy trim — the darker parts that carve the silhouette. */
export const ENEMY_TRIM = { dark: 0x121419, light: 0x3a3f4a } as const;

/* ============================================================
   helpers
   ============================================================ */

/** Multiply a hex colour by a scalar, clamped. Cheap way to make a dim variant. */
export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * k));
  const b = Math.min(255, Math.round((hex & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

/** Blend two hex colours. `t` of 0 returns `a`. */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** CSS string, for the DOM UI. */
export function css(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
