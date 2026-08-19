/**
 * The persistent enemy record. This is the heart of the game: everything in
 * here survives page reloads, and almost every interesting moment in SHDOWPIT
 * is a consequence of one of these fields changing.
 */

import type { NemesisAIContent } from '../ai/AITypes';

export type Rank = 'grunt' | 'elite' | 'captain' | 'warlord' | 'overlord';

export const RANK_ORDER: Rank[] = ['grunt', 'elite', 'captain', 'warlord', 'overlord'];

export function rankIndex(r: Rank): number {
  return RANK_ORDER.indexOf(r);
}

export type Archetype = 'fighter' | 'heavy' | 'archer';

export type PersonalityType =
  | 'coward'
  | 'hunter'
  | 'showoff'
  | 'madman'
  | 'collector'
  | 'avenger'
  | 'opportunist'
  | 'loyalist'
  | 'traitor'
  | 'survivor'
  | 'obsessed'
  | 'ambitious';

export type WeaponType = 'sword' | 'axe' | 'club' | 'spear' | 'bow';

/** Trait identifiers; the definitions live in data/traits.ts. */
export type TraitId = string;

export type ScarId =
  | 'burn'
  | 'missing_eye'
  | 'broken_mask'
  | 'metal_jaw'
  | 'damaged_arm'
  | 'cracked_armor'
  | 'corruption'
  | 'shattered_horn';

export interface Scar {
  id: ScarId;
  /** world turn on which it was acquired */
  turn: number;
  /** free-form cause, used to colour dialogue and titles */
  cause?: string;
}

export type MemoryType =
  | 'PLAYER_KILLED_ME'
  | 'PLAYER_SPARED_ME'
  | 'PLAYER_HUMILIATED_ME'
  | 'PLAYER_RAN_FROM_ME'
  | 'I_KILLED_PLAYER'
  | 'PLAYER_KILLED_MY_ALLY'
  | 'PLAYER_USED_FIRE'
  | 'PLAYER_BURNED_ME'
  | 'PLAYER_PARRIED_ME'
  | 'PLAYER_STOLE_MY_WEAPON'
  | 'I_STOLE_PLAYER_WEAPON'
  | 'I_ESCAPED_PLAYER'
  | 'I_DEFEATED_RIVAL'
  | 'RIVAL_DEFEATED_ME'
  | 'I_WAS_PROMOTED'
  | 'I_WAS_DEMOTED'
  | 'I_BETRAYED_ALLY'
  | 'I_WAS_BETRAYED'
  | 'I_RETURNED_FROM_DEATH'
  | 'PLAYER_EXECUTED_ME';

export interface MemoryEvent {
  type: MemoryType;
  turn: number;
  /** other nemesis id involved, when relevant */
  subject?: string;
}

export type RelationKind = 'friend' | 'ally' | 'neutral' | 'rival' | 'enemy' | 'master' | 'follower';

/** What the player was carrying that this nemesis walked off with. */
export interface StolenItem {
  name: string;
  kind: 'weapon' | 'relic';
  /** weapon id if kind === 'weapon' */
  weaponId?: string;
}

export interface Nemesis {
  id: string;
  name: string;
  /** e.g. "THE ASHEN" — may be empty until they earn one */
  title: string;

  rank: Rank;
  level: number;

  archetype: Archetype;
  personality: PersonalityType;

  appearanceSeed: number;
  weapon: WeaponType;

  strengths: TraitId[];
  weaknesses: TraitId[];

  scars: Scar[];

  /**
   * How personal this is. Rises when the player hurts, humiliates, or is
   * beaten by them. Drives revenge chance, dialogue and hunting behaviour.
   */
  playerRelationship: number;

  rivalries: string[];
  allies: string[];
  /** id of superior they follow, if any */
  master: string | null;

  killsAgainstPlayer: number;
  defeatsByPlayer: number;
  escapedPlayer: number;

  memory: MemoryEvent[];

  alive: boolean;
  /** turn on which they died, for "returns from death" pacing */
  diedOnTurn: number | null;
  revengeChance: number;

  power: number;

  /** home area id — where they are likely to be encountered */
  territory: string;

  /** true for the 10–15 tracked characters; false for throwaway grunts */
  persistent: boolean;

  /** learned counters to the player's habits */
  adaptations: TraitId[];

  /** loot taken from the player's corpse */
  stolen: StolenItem[];

  /** turn they were created — used for "the new blood" flavour */
  bornTurn: number;

  /** how many times they have come back from apparent death */
  returns: number;

  /**
   * Presentation-only content: AI-authored title, taunts, chronicle summary and
   * portrait references. NOTHING in here is read by combat, progression or the
   * world simulation — that separation is what stops generated text from
   * becoming a mechanical fact. See src/ai/AITypes.ts.
   */
  ai?: NemesisAIContent;
}

export function hasMemory(n: Nemesis, type: MemoryType): boolean {
  for (let i = n.memory.length - 1; i >= 0; i--) if (n.memory[i].type === type) return true;
  return false;
}

export function countMemory(n: Nemesis, type: MemoryType): number {
  let c = 0;
  for (const m of n.memory) if (m.type === type) c++;
  return c;
}

export function lastMemory(n: Nemesis, type: MemoryType): MemoryEvent | null {
  for (let i = n.memory.length - 1; i >= 0; i--) if (n.memory[i].type === type) return n.memory[i];
  return null;
}

export function fullName(n: Nemesis): string {
  return n.title ? `${n.name} ${n.title}` : n.name;
}

export function hasScar(n: Nemesis, id: ScarId): boolean {
  return n.scars.some((s) => s.id === id);
}
