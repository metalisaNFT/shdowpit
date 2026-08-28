/**
 * One optional personal objective per run, derived from real Nemesis facts.
 * Generation is seeded; patterns that need an unowned power are rejected.
 */

import { RNG, mixSeed } from '../core/RNG';
import type { Nemesis } from './Nemesis';
import { fullName, hasMemory } from './Nemesis';
import type { PowerSet } from '../data/abilities';
import type { TerritoryMod } from '../world/TerritoryRules';
import { computeMods } from '../data/traits';
import type { TraitId } from './Nemesis';
import type { DamageInfo } from '../combat/Types';
import type { PlayerHabits } from '../core/SaveSystem';

export type VendettaPatternId =
  | 'break_posture_twice'
  | 'defeat_recovered_weapon'
  | 'force_flee'
  | 'no_heal'
  | 'interrupt_attacks'
  | 'perfect_parry_signature'
  | 'defeat_in_master_land'
  | 'execute_with_ally'
  | 'exploit_weakness'
  | 'defeat_adapted_habit'
  | 'separate_loyalist'
  | 'max_heat';

export interface VendettaFacts {
  nemesisId: string;
  name: string;
  stolenWeaponId: string | null;
  canFlee: boolean;
  hasMaster: boolean;
  masterTerritory: string | null;
  hasLivingAlly: boolean;
  hasLoyalistFollower: boolean;
  weakness: string | null;
  adaptation: string | null;
  rank: string;
  personality: string;
  territory: string;
  killsAgainstPlayer: number;
  defeatsByPlayer: number;
  escaped: number;
  humiliated: boolean;
  spared: boolean;
}

export interface VendettaRewardPreview {
  kind: string;
  text: string;
}

export interface VendettaInstance {
  pattern: VendettaPatternId;
  targetId: string;
  targetName: string;
  title: string;
  desc: string;
  progress: number;
  goal: number;
  failed: boolean;
  complete: boolean;
  committed: boolean;
  reward: VendettaRewardPreview;
  healed: boolean;
}

export interface VendettaTickCtx {
  postureBreaks: number;
  interrupts: number;
  perfectParries: number;
  targetFled: boolean;
  targetDead: boolean;
  executed: boolean;
  allyPresent: boolean;
  inMasterTerritory: boolean;
  heat: number;
  heatMax: number;
  weaponId: string;
  stolenWeaponId: string | null;
  usedWeakness: boolean;
  usedAdaptedHabit: boolean;
  loyalistSeparated: boolean;
}

/** Which player habit satisfies a nemesis adaptation vendetta. */
const ADAPTATION_HABIT: Partial<Record<TraitId, keyof PlayerHabits>> = {
  dodge_read: 'dodge',
  delayed_strike: 'parry',
  parry_breaker: 'parry',
  combo_breaker: 'light',
  rear_guard: 'backstab',
  fire_hardened: 'fire',
  execution_ward: 'execute',
  shield_arm: 'ranged',
  closer: 'dodge',
};

export function adaptationHabitFor(adaptation: string | null): keyof PlayerHabits | null {
  if (!adaptation) return null;
  return ADAPTATION_HABIT[adaptation as TraitId] ?? null;
}

/** True when the damage type leveraged a known weakness multiplier. */
export function hitExploitsWeakness(weaknesses: readonly TraitId[], info: DamageInfo): boolean {
  if (!weaknesses.length || info.source === 'execute' || info.source === 'environment') return false;
  const mods = computeMods(weaknesses);
  switch (info.source) {
    case 'heavy':
      return mods.vsHeavy > 1.08;
    case 'light':
      return mods.vsLight > 1.08;
    case 'fire':
      return mods.vsFire > 1.08;
    case 'ranged':
      return mods.vsRanged > 1.08;
    default:
      break;
  }
  if (info.fromBehind && mods.vsBack > 1.08) return true;
  return false;
}

const PATTERN_ORDER: VendettaPatternId[] = [
  'break_posture_twice',
  'defeat_recovered_weapon',
  'force_flee',
  'no_heal',
  'interrupt_attacks',
  'perfect_parry_signature',
  'defeat_in_master_land',
  'execute_with_ally',
  'exploit_weakness',
  'defeat_adapted_habit',
  'separate_loyalist',
  'max_heat',
];

export function factsFromNemesis(
  n: Nemesis,
  lookup: (id: string) => Nemesis | undefined,
  livingAlly: (id: string) => boolean
): VendettaFacts {
  const stolen = n.stolen.find((s) => s.weaponId)?.weaponId ?? null;
  const master = n.master ? lookup(n.master) : undefined;
  const loyalist = (n.allies ?? [])
    .map(lookup)
    .some((a) => a && a.alive && a.personality === 'loyalist');
  return {
    nemesisId: n.id,
    name: fullName(n),
    stolenWeaponId: stolen,
    canFlee: n.personality !== 'madman',
    hasMaster: !!n.master,
    masterTerritory: master?.territory ?? null,
    hasLivingAlly: (n.allies ?? []).some((id) => livingAlly(id)),
    hasLoyalistFollower: loyalist,
    weakness: n.weaknesses[0] ?? null,
    adaptation: n.adaptations[0] ?? null,
    rank: n.rank,
    personality: n.personality,
    territory: n.territory,
    killsAgainstPlayer: n.killsAgainstPlayer,
    defeatsByPlayer: n.defeatsByPlayer,
    escaped: n.escapedPlayer,
    humiliated: hasMemory(n, 'PLAYER_HUMILIATED_ME'),
    spared: hasMemory(n, 'PLAYER_SPARED_ME'),
  };
}

function eligible(id: VendettaPatternId, f: VendettaFacts, powers: PowerSet): boolean {
  switch (id) {
    case 'defeat_recovered_weapon':
      return !!f.stolenWeaponId;
    case 'force_flee':
      return f.canFlee;
    case 'no_heal':
      return !powers.has('leech') && !powers.has('vulture');
    case 'defeat_in_master_land':
      return f.hasMaster && !!f.masterTerritory;
    case 'execute_with_ally':
      return f.hasLivingAlly;
    case 'exploit_weakness':
      return !!f.weakness;
    case 'defeat_adapted_habit':
      return !!f.adaptation;
    case 'separate_loyalist':
      return f.hasLoyalistFollower;
    default:
      return true;
  }
}

function copyFor(id: VendettaPatternId, f: VendettaFacts): { title: string; desc: string; goal: number } {
  const name = f.name.toUpperCase();
  switch (id) {
    case 'break_posture_twice':
      return { title: `BREAK ${name}`, desc: 'Break their posture twice before they fall.', goal: 2 };
    case 'defeat_recovered_weapon':
      return { title: `TAKE IT BACK`, desc: `Defeat them while wielding the weapon they stole.`, goal: 1 };
    case 'force_flee':
      return { title: `RUN THEM OFF`, desc: 'Force them to flee rather than finishing them.', goal: 1 };
    case 'no_heal':
      return { title: `NO RESPITE`, desc: 'Defeat them without healing.', goal: 1 };
    case 'interrupt_attacks':
      return { title: `CUT THEM OFF`, desc: 'Interrupt three of their attacks, then defeat them.', goal: 3 };
    case 'perfect_parry_signature':
      return { title: `READ THEM`, desc: 'Perfect-parry two of their blows, then defeat them.', goal: 2 };
    case 'defeat_in_master_land':
      return { title: `ON STOLEN GROUND`, desc: "Defeat them in their master's territory.", goal: 1 };
    case 'execute_with_ally':
      return { title: `MAKE THEM WATCH`, desc: 'Execute them while an ally is present.', goal: 1 };
    case 'exploit_weakness':
      return { title: `PRESS THE WOUND`, desc: `Exploit their known weakness (${f.weakness}).`, goal: 1 };
    case 'defeat_adapted_habit':
      return { title: `OLD HABITS`, desc: `Defeat them using the behaviour they adapted against (${f.adaptation}).`, goal: 1 };
    case 'separate_loyalist':
      return { title: `CUT THE GUARD`, desc: 'Separate them from a loyalist before the fight is decided.', goal: 1 };
    case 'max_heat':
      return { title: `IN THE OPEN`, desc: 'Defeat them while carrying maximum pursuit Heat.', goal: 1 };
  }
}

function rewardFor(id: VendettaPatternId, _f: VendettaFacts): VendettaRewardPreview {
  switch (id) {
    case 'break_posture_twice':
      return { kind: 'essence', text: '+45 Essence and a posture technique chance' };
    case 'defeat_recovered_weapon':
      return { kind: 'technique', text: 'Unlock a technique on the recovered weapon' };
    case 'force_flee':
      return { kind: 'territory', text: 'Destabilise their territory' };
    case 'no_heal':
      return { kind: 'power', text: 'Themed recovery power offer' };
    case 'interrupt_attacks':
      return { kind: 'power', text: 'Posture-family power offer' };
    case 'perfect_parry_signature':
      return { kind: 'power', text: 'Perfect-defence power offer' };
    case 'defeat_in_master_land':
      return { kind: 'permanence', text: 'Their next death is far more likely to stick' };
    case 'execute_with_ally':
      return { kind: 'choice', text: 'Choose a Nemesis-derived reward after victory' };
    case 'exploit_weakness':
      return { kind: 'weaken', text: 'Permanently weaken one of their strengths' };
    case 'defeat_adapted_habit':
      return { kind: 'steal_adapt', text: 'Steal or destroy their adaptation' };
    case 'separate_loyalist':
      return { kind: 'informant', text: 'The loyalist may turn informant' };
    case 'max_heat':
      return { kind: 'essence', text: '+70 Essence; Heat does not lock extraction' };
  }
}

export function rollVendetta(
  facts: VendettaFacts,
  history: string[],
  worldSeed: number,
  turn: number,
  powers: PowerSet
): VendettaInstance | null {
  const rng = new RNG(mixSeed(worldSeed, mixSeed(hashId(facts.nemesisId), turn * 2654435761)));
  const pool = PATTERN_ORDER.filter((id) => eligible(id, facts, powers) && !history.slice(-4).includes(id));
  const fallback = PATTERN_ORDER.filter((id) => eligible(id, facts, powers));
  const use = pool.length ? pool : fallback;
  if (!use.length) return null;
  const pattern = rng.pick(use);
  const c = copyFor(pattern, facts);
  return {
    pattern,
    targetId: facts.nemesisId,
    targetName: facts.name,
    title: c.title,
    desc: c.desc,
    progress: 0,
    goal: c.goal,
    failed: false,
    complete: false,
    committed: false,
    reward: rewardFor(pattern, facts),
    healed: false,
  };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function applyVendettaProgress(v: VendettaInstance, ctx: VendettaTickCtx): VendettaInstance {
  if (v.complete || v.failed) return v;
  const next = { ...v };
  switch (v.pattern) {
    case 'break_posture_twice':
      next.progress = Math.min(v.goal, ctx.postureBreaks);
      break;
    case 'interrupt_attacks':
      next.progress = Math.min(v.goal, ctx.interrupts);
      break;
    case 'perfect_parry_signature':
      next.progress = Math.min(v.goal, ctx.perfectParries);
      break;
    case 'no_heal':
      if (ctx.targetDead && !v.healed) {
        next.complete = true;
        next.progress = 1;
      } else if (v.healed) {
        next.failed = true;
      }
      return next;
    case 'force_flee':
      if (ctx.targetFled) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
    case 'defeat_recovered_weapon':
      if (ctx.targetDead && ctx.stolenWeaponId && ctx.weaponId === ctx.stolenWeaponId) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
    case 'defeat_in_master_land':
      if (ctx.targetDead && ctx.inMasterTerritory) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
    case 'execute_with_ally':
      if (ctx.executed && ctx.allyPresent) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
    case 'exploit_weakness':
      if (ctx.targetDead && ctx.usedWeakness) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
    case 'defeat_adapted_habit':
      if (ctx.targetDead && ctx.usedAdaptedHabit) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
    case 'separate_loyalist':
      if (ctx.loyalistSeparated && ctx.targetDead) {
        next.complete = true;
        next.progress = 1;
      }
      break;
    case 'max_heat':
      if (ctx.targetDead && ctx.heat >= ctx.heatMax) {
        next.complete = true;
        next.progress = 1;
      } else if (ctx.targetDead) next.failed = true;
      return next;
  }
  if (next.progress >= next.goal && ctx.targetDead && v.pattern === 'break_posture_twice') {
    next.complete = true;
  }
  if (next.progress >= next.goal && ctx.targetDead && (v.pattern === 'interrupt_attacks' || v.pattern === 'perfect_parry_signature')) {
    next.complete = true;
  }
  if (ctx.targetDead && !next.complete && (v.pattern === 'break_posture_twice' || v.pattern === 'interrupt_attacks' || v.pattern === 'perfect_parry_signature' || v.pattern === 'separate_loyalist')) {
    if (next.progress < next.goal) next.failed = true;
  }
  return next;
}

export function vendettaHud(v: VendettaInstance | null): string {
  if (!v || !v.committed) return '';
  if (v.complete) return `VENDETTA COMPLETE — ${v.reward.text}`;
  if (v.failed) return `VENDETTA FAILED — ${v.title}`;
  return `${v.title}  ${v.progress}/${v.goal}`;
}

export function applyVendettaRewardKind(
  kind: string,
  mods: Record<string, TerritoryMod>,
  areaId: string,
  turn: number
): Record<string, TerritoryMod> {
  if (kind !== 'territory') return mods;
  return { ...mods, [areaId]: { kind: 'destabilised', untilTurn: turn + 2 } };
}

export function isPatternPossible(id: VendettaPatternId, f: VendettaFacts, powers: PowerSet): boolean {
  return eligible(id, f, powers);
}
