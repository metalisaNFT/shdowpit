/**
 * Build reactions. Behaviour changes, not damage multipliers. Recursion is
 * blocked by channel + per-target cooldown + a depth flag on DamageInfo.
 */

import type { PowerId, PowerSet } from '../data/abilities';
import { getPower } from '../data/abilities';
import { REACTION } from '../data/balance';
import type { RunState } from '../run/RunState';

export type PowerFamily =
  | 'Poison'
  | 'Posture'
  | 'Execution'
  | 'PerfectDefense'
  | 'Movement'
  | 'Projectile'
  | 'Fire'
  | 'Momentum'
  | 'Revenge'
  | 'Utility';

export interface ReactionDef {
  id: string;
  name: string;
  requires: PowerId[];
  desc: string;
  behavior: string;
}

export const REACTIONS: ReactionDef[] = [
  {
    id: 'poison_shockwave',
    name: 'PLAGUE WAVE',
    requires: ['shockwave', 'toxic_edge'],
    desc: 'Shockwave spreads accumulated poison to everyone it hits.',
    behavior: 'spreadPoison',
  },
  {
    id: 'blink_dash',
    name: 'PHANTOM LANE',
    requires: ['blink', 'dash_strike'],
    desc: 'Blink-dash marks enemies you pass through.',
    behavior: 'markPath',
  },
  {
    id: 'reversal_ember',
    name: 'CINDER PARRY',
    requires: ['reversal', 'ember'],
    desc: 'Reflected melee ignites the attacker.',
    behavior: 'igniteReflect',
  },
  {
    id: 'terror_predator',
    name: 'THE CHASE',
    requires: ['terror', 'predator'],
    desc: 'Fleeing enemies become pursuit targets instead of leaving.',
    behavior: 'huntFleeing',
  },
  {
    id: 'parasite_debt',
    name: 'BLOOD TITHE',
    requires: ['parasite', 'blood_debt'],
    desc: 'Stolen revenge traits hit harder against those who killed you.',
    behavior: 'revengeTraits',
  },
  {
    id: 'chain_momentum',
    name: 'KILL RHYTHM',
    requires: ['chain', 'momentum'],
    desc: 'A kill-reset dodge keeps Momentum instead of spending it.',
    behavior: 'keepMomentum',
  },
  {
    id: 'posture_echo',
    name: 'SECOND BREAK',
    requires: ['posture_hunter', 'echo'],
    desc: "Echo's delayed strike deals extra posture.",
    behavior: 'echoPosture',
  },
  {
    id: 'return_chain',
    name: 'RICOCHET',
    requires: ['return_fire', 'chain_shard'],
    desc: 'Reflected shots jump to one extra target.',
    behavior: 'reflectJump',
  },
];

export function ownedReactions(powers: PowerSet): ReactionDef[] {
  return REACTIONS.filter((r) => r.requires.every((id) => powers.has(id)));
}

export function activeReactions(powers: PowerSet): ReactionDef[] {
  return ownedReactions(powers).slice(0, REACTION.maxActive);
}

export function potentialReactions(powers: PowerSet): ReactionDef[] {
  return REACTIONS.filter((r) => {
    const have = r.requires.filter((id) => powers.has(id)).length;
    return have > 0 && have < r.requires.length;
  });
}

export function hasReaction(powers: PowerSet, id: string): boolean {
  return activeReactions(powers).some((r) => r.id === id);
}

export function reactionReady(run: RunState, key: string, now: number): boolean {
  const until = run.reactionCooldowns[key] ?? 0;
  return now >= until;
}

export function markReaction(run: RunState, key: string, now: number): void {
  run.reactionCooldowns[key] = now + REACTION.perTargetCooldown;
}

export function familyOf(id: PowerId): PowerFamily {
  return getPower(id).family;
}
