/**
 * Memory is deliberately discrete. No neural anything — just a list of things
 * that happened, and a scoring function that turns that list into behaviour.
 */

import type { MemoryEvent, MemoryType, Nemesis, Scar, ScarId } from './Nemesis';
import { countMemory, hasScar } from './Nemesis';

const MAX_MEMORY = 40;

/** How much each memory shifts how personal this is for them. */
const RELATIONSHIP_WEIGHT: Partial<Record<MemoryType, number>> = {
  PLAYER_KILLED_ME: 22,
  PLAYER_EXECUTED_ME: 30,
  PLAYER_HUMILIATED_ME: 18,
  PLAYER_BURNED_ME: 14,
  PLAYER_SPARED_ME: 12,
  PLAYER_KILLED_MY_ALLY: 20,
  PLAYER_STOLE_MY_WEAPON: 16,
  PLAYER_PARRIED_ME: 3,
  PLAYER_RAN_FROM_ME: -6,
  I_KILLED_PLAYER: 9,
  I_ESCAPED_PLAYER: 6,
  I_STOLE_PLAYER_WEAPON: 11,
  I_RETURNED_FROM_DEATH: 15,
  PLAYER_USED_FIRE: 4,
  // The god layer. `playerRelationship` is how they feel about YOU, and in the
  // long game you are not a swordsman — you are the thing that keeps
  // interfering. Gifts buy loyalty; curses buy hatred; being raised from the
  // dead buys something more complicated than either.
  GOD_BLESSED_ME: -14,
  GOD_GIFTED_ME: -18,
  GOD_SAVED_ME: -26,
  GOD_RAISED_ME: -30,
  GOD_CURSED_ME: 24,
  GOD_MARKED_ME: 20,
  GOD_EXPOSED_ME: 16,
  GOD_TURNED_MINE_AGAINST_ME: 22,
};

/**
 * Memories between two NPCs must not move how they feel about the player.
 * `remember` is still the only writer of the list; this is the same call with
 * the relationship term suppressed.
 */
const NPC_ONLY = new Set<MemoryType>([
  'I_KILLED_NEMESIS',
  'I_SPARED_NEMESIS',
  'I_WAS_SPARED_BY',
  'I_HUMILIATED_NEMESIS',
  'I_WAS_HUMILIATED_BY',
  'I_FLED_FROM',
  'I_BEAT_A_STRONGER_FOE',
  'I_LOST_TO_A_WEAKER_FOE',
  'I_TOOK_TERRITORY_FROM',
  'I_LOST_TERRITORY_TO',
  'I_ROBBED_THEM',
  'I_WAS_ROBBED_BY',
  'I_SAVED_AN_ALLY',
  'I_ABANDONED_AN_ALLY',
  'MY_MASTER_FELL',
]);

export function isNpcMemory(type: MemoryType): boolean {
  return NPC_ONLY.has(type);
}

export function remember(n: Nemesis, type: MemoryType, turn: number, subject?: string): MemoryEvent {
  const ev: MemoryEvent = { type, turn };
  if (subject) ev.subject = subject;
  n.memory.push(ev);
  if (n.memory.length > MAX_MEMORY) n.memory.splice(0, n.memory.length - MAX_MEMORY);

  const w = NPC_ONLY.has(type) ? 0 : RELATIONSHIP_WEIGHT[type];
  if (w) n.playerRelationship = clamp(n.playerRelationship + w, -100, 200);

  recomputeRevenge(n);
  return ev;
}

/**
 * revengeChance drives: hunting the player during a run, and surviving death.
 * It should feel earned, not random.
 */
export function recomputeRevenge(n: Nemesis): number {
  let c = 0.06;
  c += Math.max(0, n.playerRelationship) * 0.0035;
  c += n.defeatsByPlayer * 0.05;
  c += n.escapedPlayer * 0.04;
  c += countMemory(n, 'PLAYER_HUMILIATED_ME') * 0.07;
  c += countMemory(n, 'PLAYER_EXECUTED_ME') * 0.05;
  if (n.personality === 'obsessed') c += 0.22;
  if (n.personality === 'survivor') c += 0.16;
  if (n.personality === 'avenger') c += 0.12;
  if (n.personality === 'coward') c -= 0.05;
  n.revengeChance = clamp(c, 0, 0.92);
  return n.revengeChance;
}

export function addScar(n: Nemesis, id: ScarId, turn: number, cause?: string): Scar | null {
  if (hasScar(n, id)) return null;
  const s: Scar = { id, turn };
  if (cause) s.cause = cause;
  n.scars.push(s);
  return s;
}

export const SCAR_NAMES: Record<ScarId, string> = {
  burn: 'BURN SCARS',
  missing_eye: 'MISSING EYE',
  broken_mask: 'BROKEN MASK',
  metal_jaw: 'METAL JAW',
  damaged_arm: 'DAMAGED ARM',
  cracked_armor: 'CRACKED ARMOUR',
  corruption: 'GLOWING CORRUPTION',
  shattered_horn: 'SHATTERED HORN',
};

/** Traits a scar tends to bring with it. */
export const SCAR_TRAITS: Record<ScarId, { strength?: string; weakness?: string }> = {
  burn: { strength: 'fire_resist', weakness: 'fears_fire' },
  missing_eye: { weakness: 'open_back' },
  broken_mask: { weakness: 'fragile' },
  metal_jaw: { strength: 'iron_hide' },
  damaged_arm: { weakness: 'sluggish' },
  cracked_armor: { weakness: 'weak_heavy' },
  corruption: { strength: 'blood_fury', weakness: 'flammable' },
  shattered_horn: { weakness: 'poor_footing' },
};

/**
 * Apply a scar and its mechanical consequences. Returns a short human line for
 * the event log, or null if nothing happened.
 */
export function applyScar(n: Nemesis, id: ScarId, turn: number, cause?: string): string | null {
  const s = addScar(n, id, turn, cause);
  if (!s) return null;
  const t = SCAR_TRAITS[id];
  if (t.strength && !n.strengths.includes(t.strength) && n.strengths.length < 5) {
    n.strengths.push(t.strength);
  }
  if (t.weakness && !n.weaknesses.includes(t.weakness) && n.weaknesses.length < 3) {
    n.weaknesses.push(t.weakness);
  }
  return SCAR_NAMES[id];
}

/** Human-readable memory lines for the hierarchy detail panel. */
export const MEMORY_TEXT: Record<MemoryType, string> = {
  PLAYER_KILLED_ME: 'You killed them',
  PLAYER_SPARED_ME: 'You let them live',
  PLAYER_HUMILIATED_ME: 'You humiliated them',
  PLAYER_RAN_FROM_ME: 'You ran from them',
  I_KILLED_PLAYER: 'They killed you',
  PLAYER_KILLED_MY_ALLY: 'You killed their ally',
  PLAYER_USED_FIRE: 'You fought with fire',
  PLAYER_BURNED_ME: 'You burned them',
  PLAYER_PARRIED_ME: 'You turned their blade',
  PLAYER_STOLE_MY_WEAPON: 'You took their weapon',
  I_STOLE_PLAYER_WEAPON: 'They took your weapon',
  I_ESCAPED_PLAYER: 'They escaped you',
  I_DEFEATED_RIVAL: 'They beat a rival',
  RIVAL_DEFEATED_ME: 'A rival beat them',
  I_WAS_PROMOTED: 'They were promoted',
  I_WAS_DEMOTED: 'They were demoted',
  I_BETRAYED_ALLY: 'They betrayed an ally',
  I_WAS_BETRAYED: 'They were betrayed',
  I_RETURNED_FROM_DEATH: 'They came back',
  PLAYER_EXECUTED_ME: 'You executed them',
  I_KILLED_NEMESIS: 'They killed someone',
  I_SPARED_NEMESIS: 'They let someone live',
  I_WAS_SPARED_BY: 'Someone let them live',
  I_HUMILIATED_NEMESIS: 'They humiliated someone',
  I_WAS_HUMILIATED_BY: 'They were humiliated',
  I_FLED_FROM: 'They ran',
  I_BEAT_A_STRONGER_FOE: 'They beat someone stronger',
  I_LOST_TO_A_WEAKER_FOE: 'They lost to someone weaker',
  I_TOOK_TERRITORY_FROM: 'They took ground',
  I_LOST_TERRITORY_TO: 'They lost ground',
  I_ROBBED_THEM: 'They robbed someone',
  I_WAS_ROBBED_BY: 'They were robbed',
  I_SAVED_AN_ALLY: 'They saved an ally',
  I_ABANDONED_AN_ALLY: 'They abandoned an ally',
  MY_MASTER_FELL: 'Their master fell',
  GOD_BLESSED_ME: 'You blessed them',
  GOD_CURSED_ME: 'You cursed them',
  GOD_SAVED_ME: 'You pulled them out of death',
  GOD_GIFTED_ME: 'You put steel in their hands',
  GOD_RAISED_ME: 'You raised them from the dead',
  GOD_MARKED_ME: 'You put a price on them',
  GOD_EXPOSED_ME: 'You showed the world where they were',
  GOD_TURNED_MINE_AGAINST_ME: 'You turned their own against them',
  I_WAS_CAGED_BY: 'They were caged',
  I_SWORE_TO: 'They swore to someone',
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
