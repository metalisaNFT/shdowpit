/**
 * Encounter kinds are presentation categories. They are derived from stored
 * Nemesis history and the live spawn context — never invented.
 */

import type { Nemesis } from './Nemesis';

export type EncounterKind =
  | 'FIRST_MEETING'
  | 'RETURNING_RIVAL'
  | 'REVENGE_ENCOUNTER'
  | 'AMBUSH'
  | 'INTERRUPTION'
  | 'PROMOTION_REVEAL'
  | 'OVERLORD_ENCOUNTER'
  | 'ESCAPE'
  | 'PLAYER_DEFEATED'
  | 'NEMESIS_DEFEATED'
  | 'FAKE_DEATH'
  | 'RESURRECTION_RETURN';

/** Live outcomes are classified separately from spawn intros. */
export type EncounterOutcome = 'escape' | 'player_dead' | 'nemesis_dead' | 'fake_death';

export interface ClassifyContext {
  hunting?: boolean;
  interrupting?: boolean;
  resurrected?: boolean;
  outcome?: EncounterOutcome;
}

const INTRO_KINDS: ReadonlySet<EncounterKind> = new Set([
  'FIRST_MEETING',
  'RETURNING_RIVAL',
  'REVENGE_ENCOUNTER',
  'AMBUSH',
  'INTERRUPTION',
  'PROMOTION_REVEAL',
  'OVERLORD_ENCOUNTER',
  'RESURRECTION_RETURN',
]);

export function isIntroKind(kind: EncounterKind): boolean {
  return INTRO_KINDS.has(kind);
}

export function classifyEncounter(n: Nemesis, ctx: ClassifyContext = {}): EncounterKind {
  if (ctx.outcome === 'escape') return 'ESCAPE';
  if (ctx.outcome === 'player_dead') return 'PLAYER_DEFEATED';
  if (ctx.outcome === 'fake_death') return 'FAKE_DEATH';
  if (ctx.outcome === 'nemesis_dead') return 'NEMESIS_DEFEATED';

  const last = n.memory.length ? n.memory[n.memory.length - 1] : null;

  if (ctx.resurrected || last?.type === 'I_RETURNED_FROM_DEATH') return 'RESURRECTION_RETURN';

  if (n.rank === 'overlord') return 'OVERLORD_ENCOUNTER';

  if (ctx.interrupting) return 'INTERRUPTION';

  if (last?.type === 'I_WAS_PROMOTED') return 'PROMOTION_REVEAL';

  if (n.killsAgainstPlayer > 0 && ctx.hunting) return 'REVENGE_ENCOUNTER';

  if (ctx.hunting && n.personality === 'hunter') return 'AMBUSH';

  const met =
    n.memory.length > 0 ||
    n.killsAgainstPlayer > 0 ||
    n.defeatsByPlayer > 0 ||
    n.escapedPlayer > 0 ||
    n.returns > 0;
  if (!met) return 'FIRST_MEETING';

  return 'RETURNING_RIVAL';
}
