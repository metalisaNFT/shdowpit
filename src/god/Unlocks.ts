/**
 * Roguelite progression that adds possibilities rather than percentages.
 *
 * Nothing in this table makes a number bigger. Every unlock either hands the
 * player a new verb, changes what the world starts as, or opens a way of
 * playing that was not available before — because the interesting question at
 * the end of a run is "what can I try now", not "how much stronger am I".
 */

import type { RunOutcome } from './GodTypes';

export type UnlockKind = 'intervention' | 'world' | 'start' | 'insight';

export interface UnlockDef {
  id: string;
  name: string;
  kind: UnlockKind;
  desc: string;
  /** what it takes, in plain words, shown before it is earned */
  requirement: string;
  /** does this outcome earn it? */
  earned(o: RunOutcome, history: UnlockHistory): boolean;
}

export interface UnlockHistory {
  runs: number;
  triumphs: number;
  collapses: number;
  legendsMade: number;
  bestChaos: number;
  crisisKinds: string[];
}

export const UNLOCKS: UnlockDef[] = [
  {
    id: 'int_crown',
    name: 'CROWN',
    kind: 'intervention',
    desc: 'A new intervention: point someone at the top of the world and watch what ambition does to them.',
    requirement: 'Finish a run in which a crisis was named.',
    earned: (o) => !!o.crisisKind,
  },
  {
    id: 'int_still',
    name: 'BE STILL',
    kind: 'intervention',
    desc: 'A new intervention: take your hands off the world and let chaos fall.',
    requirement: 'Reach 70 chaos in a single run.',
    earned: (o) => o.chaosPeak >= 70,
  },
  {
    id: 'world_broken',
    name: 'THE BROKEN ORDER',
    kind: 'world',
    desc: 'A world modifier: start with no Overlord and four houses instead of two. Everything is contested from cycle one.',
    requirement: 'Survive a run to its deadline without the crisis being answered.',
    earned: (o) => o.ending === 'collapse',
  },
  {
    id: 'start_patron',
    name: 'PATRON',
    kind: 'start',
    desc: 'A starting condition: one character begins the run already blessed, already ambitious, and already yours.',
    requirement: 'End a run in triumph.',
    earned: (o) => o.ending === 'triumph',
  },
  {
    id: 'insight_scores',
    name: 'THE READING',
    kind: 'insight',
    desc: 'The board shows what each named character is currently weighing, and roughly how much.',
    requirement: 'Make five legends.',
    earned: (_o, h) => h.legendsMade >= 5,
  },
  {
    id: 'start_deep',
    name: 'THE LONGER GAME',
    kind: 'start',
    desc: 'A starting condition: begin with a higher influence ceiling, so a single cycle can hold a real plan.',
    requirement: 'Finish three runs.',
    earned: (_o, h) => h.runs >= 3,
  },
  {
    id: 'world_hungry',
    name: 'THE HUNGRY AGE',
    kind: 'world',
    desc: 'A world modifier: characters climb far harder and fall far faster. Short reigns, constant upheaval.',
    requirement: 'Win a run in which the crisis was a heretic or a beast.',
    earned: (o) => o.ending === 'triumph' && (o.crisisKind === 'heresy' || o.crisisKind === 'beast'),
  },
  {
    id: 'insight_lines',
    name: 'THE THREADS',
    kind: 'insight',
    desc: 'The board draws who is hunting whom, so a revenge chain can be seen forming instead of found afterwards.',
    requirement: 'End a run with three separate revenge chains still running.',
    earned: (o) => o.revengeChains >= 3,
  },
];

export const UNLOCK_MAP = new Map(UNLOCKS.map((u) => [u.id, u]));

export function evaluateUnlocks(
  outcome: RunOutcome,
  history: UnlockHistory,
  already: readonly string[]
): UnlockDef[] {
  const out: UnlockDef[] = [];
  for (const u of UNLOCKS) {
    if (already.includes(u.id)) continue;
    try {
      if (u.earned(outcome, history)) out.push(u);
    } catch {
      /* an unlock predicate must never be able to break the end of a run */
    }
  }
  return out;
}

export function unlockName(id: string): string {
  return UNLOCK_MAP.get(id)?.name ?? id.toUpperCase();
}

/** Modifiers the next run starts with, derived from what has been unlocked. */
export interface StartingConditions {
  /** extra houses at world seed */
  extraFactions: number;
  /** no overlord to begin with */
  brokenOrder: boolean;
  /** influence ceiling bonus */
  influenceBonus: number;
  /** one character starts blessed and ambitious */
  patron: boolean;
  /** climbing is easier and falling is harder */
  hungry: boolean;
  /** the board may show utility readings */
  showScores: boolean;
  /** the board may draw hunt lines */
  showThreads: boolean;
}

export function startingConditions(unlocked: readonly string[]): StartingConditions {
  return {
    extraFactions: unlocked.includes('world_broken') ? 2 : 0,
    brokenOrder: unlocked.includes('world_broken'),
    influenceBonus: unlocked.includes('start_deep') ? 5 : 0,
    patron: unlocked.includes('start_patron'),
    hungry: unlocked.includes('world_hungry'),
    showScores: unlocked.includes('insight_scores'),
    showThreads: unlocked.includes('insight_lines'),
  };
}
