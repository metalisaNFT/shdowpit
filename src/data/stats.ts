/**
 * Run stats — the MegaBonk layer.
 *
 * A run stat is a number the player can watch grow: visible on the stats page,
 * granted by boons, and combined into builds. Rules:
 *
 *  - every stat here DOES something. No dead rows on the stats page.
 *  - stats are multiplicative seasoning on top of the mechanical powers in
 *    data/abilities.ts — powers change verbs, stats change numbers.
 *  - stat strength must never invalidate reading telegraphs. Damage scales;
 *    enemy anticipation and the parry contract do not.
 */

export type RunStatId =
  | 'maxHp'
  | 'hpRegen'
  | 'moveSpeed'
  | 'attackSpeed'
  | 'meleeDamage'
  | 'rangedDamage'
  | 'projSpeed'
  | 'projCount'
  | 'pierce'
  | 'chain'
  | 'critChance'
  | 'critDamage'
  | 'postureDamage'
  | 'knockback'
  | 'dodgeCooldown'
  | 'parryWindow'
  | 'surgeGain'
  | 'poisonDamage'
  | 'executionPower'
  | 'lifesteal';

export interface RunStatDef {
  id: RunStatId;
  name: string;
  /** starting value */
  base: number;
  /** how much one boon adds */
  step: number;
  /** hard cap; undefined = uncapped */
  max?: number;
  /** how the stats page prints it */
  fmt: 'pct' | 'flat' | 'seconds';
  /** boon card text */
  desc: string;
  /** weight when rolling boon offers */
  weight: number;
}

export const RUN_STATS: RunStatDef[] = [
  { id: 'maxHp', name: 'MAX HEALTH', base: 0, step: 20, fmt: 'flat', desc: '+20 maximum health, healed on pickup.', weight: 1 },
  { id: 'hpRegen', name: 'HEALTH REGEN', base: 0, step: 0.5, max: 3, fmt: 'flat', desc: '+0.5 health per second, always.', weight: 0.7 },
  { id: 'moveSpeed', name: 'MOVEMENT SPEED', base: 1, step: 0.08, max: 1.6, fmt: 'pct', desc: '+8% movement speed.', weight: 1 },
  { id: 'attackSpeed', name: 'ATTACK SPEED', base: 1, step: 0.1, max: 2, fmt: 'pct', desc: '+10% attack speed.', weight: 1 },
  { id: 'meleeDamage', name: 'MELEE DAMAGE', base: 1, step: 0.12, fmt: 'pct', desc: '+12% melee damage.', weight: 1.2 },
  { id: 'rangedDamage', name: 'RANGED DAMAGE', base: 1, step: 0.15, fmt: 'pct', desc: '+15% Void Needle damage.', weight: 1 },
  { id: 'projSpeed', name: 'PROJECTILE SPEED', base: 1, step: 0.15, max: 2.2, fmt: 'pct', desc: '+15% projectile speed.', weight: 0.8 },
  { id: 'projCount', name: 'PROJECTILES', base: 1, step: 1, max: 5, fmt: 'flat', desc: '+1 Void Needle per throw, fanned.', weight: 0.55 },
  { id: 'pierce', name: 'PIERCE', base: 0, step: 1, max: 6, fmt: 'flat', desc: 'Needles pass through +1 enemy.', weight: 0.7 },
  { id: 'chain', name: 'CHAIN', base: 0, step: 1, max: 4, fmt: 'flat', desc: 'Needles jump to +1 nearby enemy.', weight: 0.6 },
  { id: 'critChance', name: 'CRIT CHANCE', base: 0.05, step: 0.06, max: 0.65, fmt: 'pct', desc: '+6% critical strike chance.', weight: 1 },
  { id: 'critDamage', name: 'CRIT DAMAGE', base: 1.5, step: 0.25, fmt: 'pct', desc: '+25% critical strike damage.', weight: 0.9 },
  { id: 'postureDamage', name: 'POSTURE DAMAGE', base: 1, step: 0.15, fmt: 'pct', desc: '+15% posture damage. Break them faster.', weight: 1 },
  { id: 'knockback', name: 'KNOCKBACK', base: 1, step: 0.25, max: 3, fmt: 'pct', desc: '+25% knockback.', weight: 0.6 },
  { id: 'dodgeCooldown', name: 'DODGE COOLDOWN', base: 1, step: -0.12, max: 1, fmt: 'pct', desc: '-12% dodge cooldown.', weight: 0.8 },
  { id: 'parryWindow', name: 'PARRY WINDOW', base: 1, step: 0.12, max: 1.6, fmt: 'pct', desc: '+12% parry window.', weight: 0.8 },
  { id: 'surgeGain', name: 'SURGE GAIN', base: 1, step: 0.15, fmt: 'pct', desc: '+15% Surge earned.', weight: 0.8 },
  { id: 'poisonDamage', name: 'POISON DAMAGE', base: 1, step: 0.2, fmt: 'pct', desc: '+20% poison damage and buildup.', weight: 0.7 },
  { id: 'executionPower', name: 'EXECUTION POWER', base: 1, step: 0.2, fmt: 'pct', desc: '+20% damage against posture-broken enemies; executions reach further.', weight: 0.7 },
  { id: 'lifesteal', name: 'LIFESTEAL', base: 0, step: 0.03, max: 0.18, fmt: 'pct', desc: 'Heal 3% of damage you deal.', weight: 0.6 },
];

export const RUN_STAT_MAP = new Map<RunStatId, RunStatDef>(RUN_STATS.map((s) => [s.id, s]));

/** Value after `count` boons, respecting caps. */
export function statValue(def: RunStatDef, count: number): number {
  let v = def.base + def.step * count;
  if (def.max !== undefined) {
    if (def.step >= 0) v = Math.min(def.max, v);
    else v = Math.max(0.35, v); // dodgeCooldown floor
  }
  return v;
}

export function formatStat(def: RunStatDef, v: number): string {
  if (def.fmt === 'pct') return `${Math.round(v * 100)}%`;
  if (def.fmt === 'seconds') return `${v.toFixed(2)}s`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
