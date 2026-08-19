/**
 * Presentation copy derived from stored Nemesis facts.
 * AI may overlay a line; it may not invent events the simulation never wrote.
 */

import { pickLine, type LineContext } from '../data/dialogue';
import { rankName } from './NemesisManager';
import type { MemoryEvent, MemoryType, Nemesis, PersonalityType } from './Nemesis';
import { hasMemory, hasScar } from './Nemesis';
import type { EncounterKind } from './EncounterKind';

export interface IntroPose {
  clip: string;
  rate: number;
  proudWalk: boolean;
}

export function relationshipLabel(n: Nemesis): string {
  if (n.killsAgainstPlayer >= 2) return `HAS KILLED YOU ${n.killsAgainstPlayer} TIMES`;
  if (n.personality === 'obsessed' && n.playerRelationship > 20) return 'OBSESSED';
  if (n.playerRelationship > 40) return 'HATES YOU';
  if (n.personality === 'coward' || n.playerRelationship < -8) return 'FEARS YOU';
  if (n.killsAgainstPlayer === 1) return 'HAS KILLED YOU ONCE';
  if (n.defeatsByPlayer > 0) return 'REMEMBERS THE DEFEAT';
  return '';
}

export function lastEventChip(n: Nemesis): string {
  const bits: string[] = [];
  if (n.killsAgainstPlayer > 0) bits.push(`KILLED YOU ${n.killsAgainstPlayer}`);
  if (n.escapedPlayer > 0) bits.push(`ESCAPED YOU ${n.escapedPlayer}`);
  if (n.returns > 0) bits.push(`RETURNED ${n.returns}`);
  if (n.stolen.length) bits.push(`HAS ${n.stolen[0].name}`);
  if (n.defeatsByPlayer > 0 && !bits.length) bits.push(`YOU KILLED THEM ${n.defeatsByPlayer}`);
  return bits[0] ?? lastMemoryChip(n);
}

function lastMemoryChip(n: Nemesis): string {
  const last = n.memory.length ? n.memory[n.memory.length - 1] : null;
  if (!last) return '';
  switch (last.type) {
    case 'I_ESCAPED_PLAYER':
      return 'ESCAPED THE PIT';
    case 'I_KILLED_PLAYER':
      return 'KILLED YOU';
    case 'PLAYER_KILLED_ME':
    case 'PLAYER_EXECUTED_ME':
      return 'YOU KILLED THEM';
    case 'I_STOLE_PLAYER_WEAPON':
      return n.stolen[0] ? `STOLE ${n.stolen[0].name}` : 'STOLE FROM YOU';
    case 'I_RETURNED_FROM_DEATH':
      return 'RETURNED FROM DEATH';
    case 'I_WAS_PROMOTED':
      return `NOW ${rankName(n.rank)}`;
    case 'PLAYER_RAN_FROM_ME':
      return 'YOU RAN';
    case 'PLAYER_BURNED_ME':
      return 'REMEMBERS THE FIRE';
    default:
      return '';
  }
}

export function encounterHeadline(kind: EncounterKind, n: Nemesis): string {
  const who = n.name.toUpperCase();
  switch (kind) {
    case 'FIRST_MEETING':
      return who;
    case 'RETURNING_RIVAL':
      return `${who} RETURNS`;
    case 'REVENGE_ENCOUNTER':
      return `${who} HAS FOUND YOU`;
    case 'AMBUSH':
      return `${who} HUNTS YOU`;
    case 'INTERRUPTION':
      return `${who} HAS FOUND YOU`;
    case 'PROMOTION_REVEAL':
      return `${who} ${rankName(n.rank)}`;
    case 'OVERLORD_ENCOUNTER':
      return `${who} THE CROWN`;
    case 'RESURRECTION_RETURN':
      return `${who} RETURNS FROM DEATH`;
    case 'ESCAPE':
      return `${who} IS ESCAPING`;
    case 'PLAYER_DEFEATED':
      return `YOU WERE KILLED BY ${who}`;
    case 'NEMESIS_DEFEATED':
      return `${who} DEFEATED`;
    case 'FAKE_DEATH':
      return `${who} IS NOT DEAD`;
  }
}

export function encounterLineContext(kind: EncounterKind, n: Nemesis): LineContext {
  switch (kind) {
    case 'RESURRECTION_RETURN':
      return 'return';
    case 'ESCAPE':
    case 'FAKE_DEATH':
      return 'flee';
    case 'PLAYER_DEFEATED':
      return 'kill';
    case 'NEMESIS_DEFEATED':
      return 'execute';
    case 'INTERRUPTION':
      return 'interrupt';
    case 'PROMOTION_REVEAL':
      return 'promotion';
    case 'RETURNING_RIVAL':
      if (n.stolen.length) return 'steal';
      if (n.escapedPlayer > 0) return 'escaped';
      return 'arrival';
    case 'REVENGE_ENCOUNTER':
      return 'arrival';
    default:
      return 'arrival';
  }
}

export function encounterLine(n: Nemesis, kind: EncounterKind, salt: number, overlay?: string): string {
  const raw = overlay?.trim() || pickLine(n, encounterLineContext(kind, n), salt);
  return clampLine(raw);
}

export function lastWords(n: Nemesis, salt: number): string {
  // Not every named kill is melodramatic.
  if ((n.appearanceSeed ^ salt) % 5 === 0) return '';
  return clampLine(pickLine(n, 'last_words', salt));
}

export function introPoseFor(n: Nemesis): IntroPose {
  const p: PersonalityType = n.personality;
  if (n.archetype === 'heavy') return { clip: 'Atk2H_Slam', rate: 0.85, proudWalk: true };
  if (p === 'showoff' || p === 'ambitious') return { clip: 'Taunt', rate: 1.0, proudWalk: true };
  if (p === 'madman') return { clip: 'Atk2H_Slam', rate: 1.25, proudWalk: false };
  if (p === 'coward' || p === 'survivor') return { clip: 'GetUp', rate: 1.05, proudWalk: false };
  if (p === 'hunter') return { clip: 'Taunt', rate: 0.9, proudWalk: false };
  if (p === 'opportunist' || p === 'traitor') return { clip: 'Shove', rate: 1.15, proudWalk: true };
  if (p === 'collector') return { clip: 'Taunt', rate: 1.05, proudWalk: true };
  return { clip: 'Taunt', rate: 1.1, proudWalk: p === 'loyalist' || p === 'avenger' };
}

export function celebrateClip(n: Nemesis): IntroPose {
  const p = n.personality;
  if (p === 'madman' || n.archetype === 'heavy') return { clip: 'Atk2H_Slam', rate: 1.1, proudWalk: false };
  if (p === 'coward') return { clip: 'GetUp', rate: 1.2, proudWalk: false };
  if (n.stolen.length) return { clip: 'Taunt', rate: 0.95, proudWalk: true };
  return { clip: 'Taunt', rate: 1.15, proudWalk: true };
}

export function stingFor(kind: EncounterKind): string {
  switch (kind) {
    case 'RESURRECTION_RETURN':
      return 'nemesis_return';
    case 'ESCAPE':
    case 'FAKE_DEATH':
      return 'nemesis_escape';
    case 'PLAYER_DEFEATED':
      return 'nemesis_killed_you';
    case 'NEMESIS_DEFEATED':
      return 'nemesis_defeated';
    case 'PROMOTION_REVEAL':
      return 'nemesis_promotion';
    case 'OVERLORD_ENCOUNTER':
      return 'overlord_arrival';
    case 'INTERRUPTION':
      return 'arrival';
    default:
      return kind === 'FIRST_MEETING' ? 'arrival' : 'arrival';
  }
}

export function historyBeat(n: Nemesis, ev: MemoryEvent, subjectName?: string): string {
  const who = n.name;
  switch (ev.type) {
    case 'I_KILLED_PLAYER':
      return `${who} killed you.`;
    case 'PLAYER_KILLED_ME':
      return `You killed ${who}.`;
    case 'PLAYER_EXECUTED_ME':
      return `You executed ${who}.`;
    case 'I_ESCAPED_PLAYER':
      return `${who} escaped.`;
    case 'PLAYER_RAN_FROM_ME':
      return `You fled from ${who}.`;
    case 'I_STOLE_PLAYER_WEAPON':
      return n.stolen[0] ? `${who} stole ${n.stolen[0].name}.` : `${who} stole from you.`;
    case 'PLAYER_STOLE_MY_WEAPON':
      return `You took ${who}'s weapon.`;
    case 'I_RETURNED_FROM_DEATH':
      return `${who} returned.`;
    case 'I_WAS_PROMOTED':
      return `${who} became ${rankName(n.rank)}.`;
    case 'I_WAS_DEMOTED':
      return `${who} was cast down.`;
    case 'PLAYER_BURNED_ME':
      return `You burned ${who}.`;
    case 'PLAYER_KILLED_MY_ALLY':
      return subjectName ? `You killed ${subjectName}.` : `${who} lost an ally.`;
    case 'I_BETRAYED_ALLY':
      return subjectName ? `${who} betrayed ${subjectName}.` : `${who} betrayed an ally.`;
    case 'I_WAS_BETRAYED':
      return `${who} was betrayed.`;
    case 'I_DEFEATED_RIVAL':
      return subjectName ? `${who} defeated ${subjectName}.` : `${who} defeated a rival.`;
    default:
      return MEMORY_SHORT[ev.type] ?? ev.type;
  }
}

const MEMORY_SHORT: Partial<Record<MemoryType, string>> = {
  PLAYER_SPARED_ME: 'You let them live.',
  PLAYER_HUMILIATED_ME: 'You humiliated them.',
  PLAYER_USED_FIRE: 'You fought with fire.',
  PLAYER_PARRIED_ME: 'You turned their blade.',
  RIVAL_DEFEATED_ME: 'A rival beat them.',
};

export function factAllowsLine(n: Nemesis, line: string): boolean {
  const t = line.toLowerCase();
  if (/\bfire|ash|burn/.test(t) && !(hasScar(n, 'burn') || hasMemory(n, 'PLAYER_BURNED_ME'))) return false;
  if (/\bdead|die|buried|grave/.test(t) && n.returns === 0 && !hasMemory(n, 'PLAYER_KILLED_ME') && !hasMemory(n, 'PLAYER_EXECUTED_ME')) {
    return false;
  }
  if (/\bstole|stolen|recognize it|looking for this/.test(t) && n.stolen.length === 0) return false;
  if (/\bran|running|fled/.test(t) && !hasMemory(n, 'PLAYER_RAN_FROM_ME')) return false;
  return true;
}

function clampLine(s: string): string {
  const trimmed = s.replace(/^["']|["']$/g, '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 12) return trimmed;
  return words.slice(0, 12).join(' ');
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}
