/**
 * Permanent skill tree. Nodes change verbs, not +2% rows.
 * BLADE / RANGE / DEFENSE are the MVP branches.
 */

import type { PowerId } from './abilities';
import type { SynergyTag } from '../progress/Types';

export type TreeBranch = 'BLADE' | 'RANGE' | 'DEFENSE';

export interface SkillNodeDef {
  id: string;
  branch: TreeBranch;
  name: string;
  desc: string;
  cost: number;
  /** earlier nodes in the same branch that must be owned */
  requires: string[];
  /** existing combat powers granted for the run */
  powers: PowerId[];
  tags: SynergyTag[];
  x: number;
  y: number;
}

export const SKILL_NODES: SkillNodeDef[] = [
  /* ---- BLADE ---- */
  {
    id: 'dash_strike',
    branch: 'BLADE',
    name: 'DASH STRIKE',
    desc: 'Attack after a dodge becomes a lunging strike.',
    cost: 1,
    requires: [],
    powers: ['dash_strike'],
    tags: ['DODGE', 'MELEE', 'SWORD'],
    x: 0,
    y: 0,
  },
  {
    id: 'heavy_breaker',
    branch: 'BLADE',
    name: 'HEAVY BREAKER',
    desc: 'Charged heavies deal far more posture damage.',
    cost: 1,
    requires: ['dash_strike'],
    powers: ['heavy_breaker'],
    tags: ['POSTURE', 'MELEE', 'HAMMER'],
    x: 1,
    y: 0,
  },
  {
    id: 'combo_finisher',
    branch: 'BLADE',
    name: 'COMBO FINISHER',
    desc: 'The third light attack deals bonus posture damage.',
    cost: 2,
    requires: ['dash_strike'],
    powers: ['combo_finisher'],
    tags: ['MELEE', 'SWORD'],
    x: 1,
    y: 1,
  },
  {
    id: 'execution_flow',
    branch: 'BLADE',
    name: 'EXECUTION FLOW',
    desc: 'An execution instantly refreshes your dodge.',
    cost: 2,
    requires: ['combo_finisher'],
    powers: ['execution_flow'],
    tags: ['EXECUTION', 'DODGE'],
    x: 2,
    y: 1,
  },
  {
    id: 'riposte',
    branch: 'BLADE',
    name: 'RIPOSTE',
    desc: 'A successful parry immediately answers with a free strike.',
    cost: 2,
    requires: ['heavy_breaker'],
    powers: ['riposte'],
    tags: ['PARRY', 'MELEE', 'SWORD'],
    x: 2,
    y: 0,
  },
  {
    id: 'shock_edge',
    branch: 'BLADE',
    name: 'SHOCK EDGE',
    desc: 'Heavy attacks create a short-range shockwave.',
    cost: 3,
    requires: ['riposte'],
    powers: ['shockwave'],
    tags: ['POSTURE', 'HAMMER', 'MELEE'],
    x: 3,
    y: 0,
  },
  {
    id: 'relentless',
    branch: 'BLADE',
    name: 'RELENTLESS',
    desc: 'Alternating light and heavy attacks builds brief attack speed.',
    cost: 3,
    requires: ['execution_flow', 'riposte'],
    powers: ['relentless'],
    tags: ['MELEE', 'SWORD'],
    x: 3,
    y: 1,
  },

  /* ---- RANGE ---- */
  {
    id: 'crippling_bolt',
    branch: 'RANGE',
    name: 'CRIPPLING BOLT',
    desc: 'Void Needles heavily slow running enemies.',
    cost: 1,
    requires: [],
    powers: ['crippling_bolt'],
    tags: ['PROJECTILE'],
    x: 0,
    y: 0,
  },
  {
    id: 'piercing_shot',
    branch: 'RANGE',
    name: 'PIERCING SHOT',
    desc: 'Needles pass through one additional target.',
    cost: 1,
    requires: ['crippling_bolt'],
    powers: ['piercing_shard'],
    tags: ['PROJECTILE'],
    x: 1,
    y: 0,
  },
  {
    id: 'multishot',
    branch: 'RANGE',
    name: 'MULTISHOT',
    desc: 'Fire an additional projectile.',
    cost: 2,
    requires: ['crippling_bolt'],
    powers: ['multishot'],
    tags: ['PROJECTILE'],
    x: 1,
    y: 1,
  },
  {
    id: 'interruptor',
    branch: 'RANGE',
    name: 'INTERRUPTOR',
    desc: 'A Needle during an enemy telegraph deals huge posture and can cancel it.',
    cost: 2,
    requires: ['piercing_shot'],
    powers: ['interruptor'],
    tags: ['PROJECTILE', 'POSTURE'],
    x: 2,
    y: 0,
  },
  {
    id: 'return_fire',
    branch: 'RANGE',
    name: 'RETURN FIRE',
    desc: 'Parrying a projectile sends it back.',
    cost: 2,
    requires: ['multishot'],
    powers: ['return_fire'],
    tags: ['PARRY', 'PROJECTILE'],
    x: 2,
    y: 1,
  },
  {
    id: 'chain_shard',
    branch: 'RANGE',
    name: 'CHAIN SHARD',
    desc: 'Needles jump to one nearby enemy after hitting.',
    cost: 3,
    requires: ['interruptor'],
    powers: ['chain_shard'],
    tags: ['PROJECTILE'],
    x: 3,
    y: 0,
  },
  {
    id: 'execution_shot',
    branch: 'RANGE',
    name: 'EXECUTION SHOT',
    desc: 'Needles deal bonus damage to posture-broken enemies.',
    cost: 3,
    requires: ['return_fire'],
    powers: ['execution_shot'],
    tags: ['PROJECTILE', 'EXECUTION', 'POSTURE'],
    x: 3,
    y: 1,
  },

  /* ---- DEFENSE ---- */
  {
    id: 'perfect_dodge',
    branch: 'DEFENSE',
    name: 'PERFECT DODGE',
    desc: 'A near-miss slows time longer and pays more Surge.',
    cost: 1,
    requires: [],
    powers: ['perfect_dodge'],
    tags: ['DODGE', 'SURGE'],
    x: 0,
    y: 0,
  },
  {
    id: 'double_dodge',
    branch: 'DEFENSE',
    name: 'DOUBLE DODGE',
    desc: 'Gain a second dodge charge.',
    cost: 2,
    requires: ['perfect_dodge'],
    powers: ['double_dodge'],
    tags: ['DODGE'],
    x: 1,
    y: 0,
  },
  {
    id: 'wide_parry',
    branch: 'DEFENSE',
    name: 'WIDE PARRY',
    desc: 'Slightly longer parry timing window.',
    cost: 1,
    requires: ['perfect_dodge'],
    powers: ['wide_parry'],
    tags: ['PARRY'],
    x: 1,
    y: 1,
  },
  {
    id: 'counter_force',
    branch: 'DEFENSE',
    name: 'COUNTER FORCE',
    desc: 'A perfect parry deals extra posture damage.',
    cost: 2,
    requires: ['wide_parry'],
    powers: ['counter_force'],
    tags: ['PARRY', 'POSTURE'],
    x: 2,
    y: 1,
  },
  {
    id: 'last_stand',
    branch: 'DEFENSE',
    name: 'LAST STAND',
    desc: 'Below 30% health, incoming damage is sharply reduced.',
    cost: 2,
    requires: ['double_dodge'],
    powers: ['last_stand'],
    tags: ['DODGE'],
    x: 2,
    y: 0,
  },
  {
    id: 'second_wind',
    branch: 'DEFENSE',
    name: 'SECOND WIND',
    desc: 'Once per run, a fatal blow leaves you at 1 HP.',
    cost: 3,
    requires: ['last_stand'],
    powers: ['second_wind'],
    tags: ['EXECUTION'],
    x: 3,
    y: 0,
  },
  {
    id: 'phase_step',
    branch: 'DEFENSE',
    name: 'PHASE STEP',
    desc: 'Dodge briefly phases through walls and bodies.',
    cost: 3,
    requires: ['counter_force'],
    powers: ['phase_step'],
    tags: ['DODGE'],
    x: 3,
    y: 1,
  },
];

export const SKILL_NODE_MAP = new Map(SKILL_NODES.map((n) => [n.id, n]));

export function nodesInBranch(b: TreeBranch): SkillNodeDef[] {
  return SKILL_NODES.filter((n) => n.branch === b);
}

export function canUnlock(id: string, owned: string[]): boolean {
  const n = SKILL_NODE_MAP.get(id);
  if (!n || owned.includes(id)) return false;
  return n.requires.every((r) => owned.includes(r));
}

export function respecRefund(owned: string[]): number {
  let sum = 0;
  for (const id of owned) sum += SKILL_NODE_MAP.get(id)?.cost ?? 0;
  return sum;
}
