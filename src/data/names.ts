/**
 * Procedural naming. Deterministic from a seed so a nemesis is always called
 * the same thing after a reload, and so the same seed always produces the same
 * character.
 */

import { RNG } from '../core/RNG';
import type { Nemesis, Rank } from '../nemesis/Nemesis';
import { countMemory, hasMemory, hasScar } from '../nemesis/Nemesis';

const HEADS = [
  'var', 'kra', 'gor', 'dra', 'mor', 'vex', 'thul', 'zag', 'brak', 'nul',
  'skar', 'oz', 'grim', 'hak', 'ruk', 'tor', 'vosk', 'yrm', 'del', 'kor',
  'maz', 'ghul', 'sarn', 'ulk', 'brem', 'kaz', 'dro', 'vin', 'harg', 'olm',
  'sev', 'urk', 'gnaw', 'pell', 'tarn', 'wrek', 'ash', 'obb', 'lug', 'creth',
];

const MIDS = ['a', 'o', 'u', 'e', 'ae', 'ou', 'ei', 'y'];

const TAILS = [
  'k', 'ak', 'en', 'ath', 'ug', 'ok', 'ir', 'un', 'esh', 'ar',
  'oth', 'iz', 'um', 'ash', 'ek', 'ur', 'im', 'org', 'ax', 'ul',
  'ard', 'ith', 'ock', 'ez', 'ai', 'og', 'ven', 'ras', 'ux', 'ib',
];

/** Generate a name from a seed. Same seed, same name, forever. */
export function generateName(seed: number): string {
  const r = new RNG(seed);
  const head = r.pick(HEADS);
  let name = head;
  if (r.chance(0.28)) name += r.pick(MIDS);
  name += r.pick(TAILS);
  // Trim awkward triple letters.
  name = name.replace(/(.)\1\1+/g, '$1$1');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Generate a name that is not already in `taken` (case-insensitive). */
export function generateUniqueName(seed: number, taken: Set<string>): { name: string; seed: number } {
  let s = seed >>> 0;
  for (let i = 0; i < 64; i++) {
    const n = generateName(s);
    if (!taken.has(n.toLowerCase())) return { name: n, seed: s };
    s = (s + 0x9e3779b9) >>> 0;
  }
  // Extremely unlikely fallback.
  return { name: generateName(s) + 'ek', seed: s };
}

/* ============================================================
   TITLES
   Titles should describe what actually happened. We score every
   candidate against the nemesis's history and take the best one.
   ============================================================ */

interface TitleRule {
  title: string;
  score: (n: Nemesis) => number;
}

const TITLE_RULES: TitleRule[] = [
  { title: 'THE ASHEN', score: (n) => (hasScar(n, 'burn') ? 10 : 0) },
  { title: 'THE BURNED', score: (n) => (hasMemory(n, 'PLAYER_BURNED_ME') ? 6 : 0) },
  { title: 'THE HALF-BLIND', score: (n) => (hasScar(n, 'missing_eye') ? 9 : 0) },
  { title: 'THE FACELESS', score: (n) => (hasScar(n, 'broken_mask') ? 8 : 0) },
  { title: 'THE IRONJAW', score: (n) => (hasScar(n, 'metal_jaw') ? 9 : 0) },
  { title: 'THE CRIPPLED', score: (n) => (hasScar(n, 'damaged_arm') ? 7 : 0) },
  { title: 'THE CRACKED', score: (n) => (hasScar(n, 'cracked_armor') ? 5 : 0) },
  { title: 'THE ROTTING', score: (n) => (hasScar(n, 'corruption') ? 9 : 0) },
  { title: 'THE HORNLESS', score: (n) => (hasScar(n, 'shattered_horn') ? 7 : 0) },

  { title: 'THE RETURNED', score: (n) => (n.returns > 0 ? 12 + n.returns : 0) },
  { title: 'THE UNBURIED', score: (n) => (n.returns > 1 ? 14 : 0) },
  { title: 'THE SURVIVOR', score: (n) => (n.escapedPlayer >= 2 ? 8 + n.escapedPlayer : 0) },
  { title: 'THE COWARD', score: (n) => (n.personality === 'coward' && n.escapedPlayer >= 2 ? 9 : 0) },
  { title: 'THE UNBROKEN', score: (n) => (n.defeatsByPlayer === 0 && n.killsAgainstPlayer >= 1 ? 11 : 0) },
  { title: 'THE SLAYER', score: (n) => (n.killsAgainstPlayer >= 3 ? 13 : n.killsAgainstPlayer >= 2 ? 9 : 0) },
  { title: 'THE HUNTER', score: (n) => (n.personality === 'hunter' && n.playerRelationship > 30 ? 8 : 0) },
  { title: 'THE OBSESSED', score: (n) => (n.personality === 'obsessed' && n.playerRelationship > 40 ? 9 : 0) },
  { title: 'THE TRAITOR', score: (n) => (hasMemory(n, 'I_BETRAYED_ALLY') ? 11 : 0) },
  { title: 'THE BETRAYED', score: (n) => (hasMemory(n, 'I_WAS_BETRAYED') ? 7 : 0) },
  { title: 'THE MAD', score: (n) => (n.personality === 'madman' ? 6 : 0) },
  { title: 'THE BLOODLESS', score: (n) => (countMemory(n, 'I_DEFEATED_RIVAL') >= 3 ? 11 : 0) },
  { title: 'THE EXECUTIONER', score: (n) => (countMemory(n, 'I_DEFEATED_RIVAL') >= 2 ? 7 : 0) },
  { title: 'THE THIEF', score: (n) => (n.stolen.length > 0 ? 12 : 0) },
  { title: 'THE COLLECTOR', score: (n) => (n.personality === 'collector' && n.stolen.length > 0 ? 10 : 0) },
  { title: 'THE MERCIFUL', score: () => 0 },
  { title: 'THE SPARED', score: (n) => (hasMemory(n, 'PLAYER_SPARED_ME') ? 8 : 0) },
  { title: 'THE HUMBLED', score: (n) => (hasMemory(n, 'PLAYER_HUMILIATED_ME') ? 6 : 0) },
  { title: 'THE RISEN', score: (n) => (countMemory(n, 'I_WAS_PROMOTED') >= 3 ? 10 : 0) },
  { title: 'THE FALLEN', score: (n) => (countMemory(n, 'I_WAS_DEMOTED') >= 2 ? 8 : 0) },
  { title: 'THE AMBITIOUS', score: (n) => (n.personality === 'ambitious' && n.level > 8 ? 6 : 0) },
  { title: 'THE LOYAL', score: (n) => (n.personality === 'loyalist' && n.master !== null ? 5 : 0) },
  { title: 'THE VENGEFUL', score: (n) => (n.personality === 'avenger' && n.rivalries.length >= 2 ? 7 : 0) },
  { title: 'THE SCARRED', score: (n) => (n.scars.length >= 3 ? 8 : n.scars.length >= 2 ? 4 : 0) },
  { title: 'THE PATIENT', score: (n) => (n.personality === 'opportunist' && n.level >= 6 ? 5 : 0) },
  { title: 'THE LOUD', score: (n) => (n.personality === 'showoff' ? 4 : 0) },
];

/** Baseline titles when nothing has happened yet, keyed off rank. */
const PLAIN_TITLES: Record<Rank, string[]> = {
  grunt: ['THE NAMELESS', 'THE LEAST', 'THE NEW'],
  elite: ['THE RISING', 'THE KEEN', 'THE HUNGRY', 'THE SHARP'],
  captain: ['THE HARD', 'THE GRIM', 'THE COLD', 'THE HEAVY', 'THE SILENT'],
  warlord: ['THE CRUEL', 'THE VAST', 'THE DREAD', 'THE BLACK'],
  overlord: ['THE FIRST', 'THE CROWN', 'THE ETERNAL', 'THE LAST WORD'],
};

/**
 * Choose the most narratively-earned title. `avoid` lets the caller keep the
 * roster from turning into five copies of THE SCARRED.
 */
export function chooseTitle(n: Nemesis, avoid: Set<string> = new Set()): string {
  let best = '';
  let bestScore = 0;
  for (const rule of TITLE_RULES) {
    let s = rule.score(n);
    if (s <= 0) continue;
    if (avoid.has(rule.title)) s *= 0.35;
    if (rule.title === n.title) s += 1.5; // slight stickiness — identity matters
    if (s > bestScore) {
      bestScore = s;
      best = rule.title;
    }
  }
  if (best) return best;
  if (n.title) return n.title;
  const r = new RNG(n.appearanceSeed ^ 0x51ed270b);
  return r.pick(PLAIN_TITLES[n.rank]);
}

export const AREA_NAMES: Record<string, string> = {
  pit: 'THE PIT',
  ruins: 'THE RUINS',
  tower: 'THE TOWER',
  forest: 'THE FOREST',
  caves: 'THE CAVES',
  fortress: 'THE FORTRESS',
};
