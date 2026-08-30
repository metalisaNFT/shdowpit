/**
 * The region. One compact interconnected map, roughly 500m x 500m, six named
 * areas. Areas are also the territory unit the simulation fights over.
 *
 * Each area is a place, not a palette: a landmark you navigate by, a combat
 * rule you feel, and a reason to come back when ownership changes.
 */

export interface AreaDef {
  id: string;
  name: string;
  cx: number;
  cz: number;
  /** playable radius */
  radius: number;
  /** 1 (safe-ish) .. 5 (overlord ground) */
  danger: number;
  /** how many generic enemies live here at once */
  population: number;
  /** hex colours for the modular geometry */
  ground: number;
  structure: number;
  accent: number;
  /** local fog multiplier */
  fog: number;
  blurb: string;
  /** combat condition — short, readable on entry */
  combat: string;
  /** named landmark the player should learn to steer by */
  landmark: string;
  /** why this ground is worth a second visit */
  returnHook: string;
}

export const AREAS: AreaDef[] = [
  {
    id: 'pit',
    name: 'THE PIT',
    cx: 0,
    cz: 0,
    radius: 58,
    danger: 1,
    population: 6,
    ground: 0x22252e,
    structure: 0x3a3f48,
    accent: 0xc4ff2e,
    fog: 1,
    blurb: 'Where everything that arrives here starts.',
    combat: 'Open bowl. Nowhere to hide. Fights are read from every side.',
    landmark: 'THE DROP',
    returnHook: 'The cages remember who last crawled out.',
  },
  {
    id: 'ruins',
    name: 'THE RUINS',
    cx: -152,
    cz: -128,
    radius: 62,
    danger: 2,
    population: 8,
    ground: 0x232432,
    structure: 0x3c3d4c,
    accent: 0xa14cff,
    fog: 1.1,
    blurb: 'Columns that outlasted whoever raised them.',
    combat: 'Pillars. Break line of sight, then reappear on a flank.',
    landmark: 'THE BROKEN NAVE',
    returnHook: 'Whoever holds it hangs their colour on the fallen gate.',
  },
  {
    id: 'forest',
    name: 'THE FOREST',
    cx: -160,
    cz: 138,
    radius: 66,
    danger: 2,
    population: 9,
    ground: 0x1c2620,
    structure: 0x33463a,
    accent: 0x76ff35,
    fog: 1.35,
    blurb: 'Nothing grows. It only stands there.',
    combat: 'Short sightlines. Ambush range. Do not stand still.',
    landmark: 'THE PALE TREE',
    returnHook: 'Caches rot in the groves the current hunter has not emptied.',
  },
  {
    id: 'caves',
    name: 'THE CAVES',
    cx: 156,
    cz: 142,
    radius: 56,
    danger: 3,
    population: 8,
    ground: 0x1c202a,
    structure: 0x353a48,
    accent: 0x2ff2ff,
    fog: 1.55,
    blurb: 'Low ceilings. Bad sightlines.',
    combat: 'Chokes and chambers. Wide swings punish; needles punish less.',
    landmark: 'THE THROAT',
    returnHook: 'The still pool shows the holder’s mark when the dark allows.',
  },
  {
    id: 'tower',
    name: 'THE TOWER',
    cx: 148,
    cz: -140,
    radius: 60,
    danger: 4,
    population: 7,
    ground: 0x242330,
    structure: 0x424656,
    accent: 0xe4ff2b,
    fog: 0.78,
    blurb: 'Whoever holds it can see you coming.',
    combat: 'Exposed ring around the spire. You are visible. So are they.',
    landmark: 'THE SPIRE',
    returnHook: 'The beacon on the crown names the watcher.',
  },
  {
    id: 'fortress',
    name: 'THE FORTRESS',
    cx: 0,
    cz: -212,
    radius: 64,
    danger: 5,
    population: 7,
    ground: 0x282026,
    structure: 0x463840,
    accent: 0xff2f9c,
    fog: 1.15,
    blurb: 'The seat. Someone always sits in it.',
    combat: 'Gates funnel you. The courtyard is a killing floor.',
    landmark: 'THE SEAT',
    returnHook: 'The throne carries the Overlord’s colour until it does not.',
  },
];

export const AREA_MAP = new Map<string, AreaDef>(AREAS.map((a) => [a.id, a]));

export function getArea(id: string): AreaDef {
  return AREA_MAP.get(id) ?? AREAS[0];
}

/** Corridors between areas, as pairs of ids. Used for path geometry. */
export const CONNECTIONS: Array<[string, string]> = [
  ['pit', 'ruins'],
  ['pit', 'forest'],
  ['pit', 'caves'],
  ['pit', 'tower'],
  ['ruins', 'fortress'],
  ['tower', 'fortress'],
  ['ruins', 'forest'],
  ['caves', 'tower'],
];

/** Which area does a world position belong to? Null when between areas. */
export function areaAt(x: number, z: number): AreaDef | null {
  let best: AreaDef | null = null;
  let bestD = Infinity;
  for (const a of AREAS) {
    const d = Math.hypot(x - a.cx, z - a.cz);
    if (d < a.radius && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Nearest area regardless of radius — used for the minimap and spawn logic. */
export function nearestArea(x: number, z: number): AreaDef {
  let best = AREAS[0];
  let bestD = Infinity;
  for (const a of AREAS) {
    const d = Math.hypot(x - a.cx, z - a.cz);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Angles (atan2 dz, dx) of each road leaving an area. */
export function exitAngles(areaId: string): number[] {
  const a = getArea(areaId);
  const out: number[] = [];
  for (const [x, y] of CONNECTIONS) {
    const other = x === areaId ? y : y === areaId ? x : null;
    if (!other) continue;
    const b = getArea(other);
    out.push(Math.atan2(b.cz - a.cz, b.cx - a.cx));
  }
  return out;
}

export function angleNear(t: number, targets: readonly number[], window: number): boolean {
  for (const e of targets) {
    const d = Math.abs(Math.atan2(Math.sin(t - e), Math.cos(t - e)));
    if (d < window) return true;
  }
  return false;
}

export const WORLD_HALF = 260;
