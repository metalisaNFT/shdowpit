/**
 * The region. One compact interconnected map, roughly 500m x 500m, six named
 * areas. Areas are also the territory unit the simulation fights over.
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
    ground: 0x17191f,
    structure: 0x2c3038,
    accent: 0xc4ff2e,
    fog: 1,
    blurb: 'Where everything that arrives here starts.',
  },
  {
    id: 'ruins',
    name: 'THE RUINS',
    cx: -152,
    cz: -128,
    radius: 62,
    danger: 2,
    population: 8,
    ground: 0x191a26,
    structure: 0x2f3040,
    accent: 0xa14cff,
    fog: 1.1,
    blurb: 'Columns that outlasted whoever raised them.',
  },
  {
    id: 'forest',
    name: 'THE FOREST',
    cx: -160,
    cz: 138,
    radius: 66,
    danger: 2,
    population: 9,
    ground: 0x151d18,
    structure: 0x27362c,
    accent: 0x76ff35,
    fog: 1.55,
    blurb: 'Nothing grows. It only stands there.',
  },
  {
    id: 'caves',
    name: 'THE CAVES',
    cx: 156,
    cz: 142,
    radius: 56,
    danger: 3,
    population: 8,
    ground: 0x14171f,
    structure: 0x282c38,
    accent: 0x2ff2ff,
    fog: 2.1,
    blurb: 'Low ceilings. Bad sightlines.',
  },
  {
    id: 'tower',
    name: 'THE TOWER',
    cx: 148,
    cz: -140,
    radius: 60,
    danger: 4,
    population: 7,
    ground: 0x1b1a23,
    structure: 0x353846,
    accent: 0xe4ff2b,
    fog: 0.8,
    blurb: 'Whoever holds it can see you coming.',
  },
  {
    id: 'fortress',
    name: 'THE FORTRESS',
    cx: 0,
    cz: -212,
    radius: 64,
    danger: 5,
    population: 7,
    ground: 0x1e181c,
    structure: 0x382e35,
    accent: 0xff2f9c,
    fog: 1.2,
    blurb: 'The seat. Someone always sits in it.',
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

export const WORLD_HALF = 260;
