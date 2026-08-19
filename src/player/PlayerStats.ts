/**
 * Everything about the player that is a number. Kept apart from the entity so
 * the run/meta layers can read and write it without touching the scene graph.
 */

import { PowerSet, type PowerId } from '../data/abilities';
import type { PlayerHabits } from '../core/SaveSystem';
import { PLAYER, RANGED } from '../data/balance';
import { RUN_STATS, RUN_STAT_MAP, statValue, formatStat, type RunStatId, type RunStatDef } from '../data/stats';

export const BASE_MAX_HP = 100;

export class PlayerStats {
  maxHp = BASE_MAX_HP;
  hp = BASE_MAX_HP;

  /** limited healing per run */
  healCharges = 2;
  maxHealCharges = 2;
  healAmount = 40;

  powers = new PowerSet();

  /**
   * SURGE — the aggression resource. It does not regenerate. You earn it by
   * hitting things, parrying, dodging well and executing, and you spend it on
   * abilities. That asymmetry is the point: power comes from fighting well,
   * not from waiting.
   */
  surge = 0;
  readonly surgeMax = PLAYER.surgeMax;

  /** MOMENTUM stacks */
  momentum = 0;
  readonly momentumMax = 8;

  /* ============================================================
     run stats — the MegaBonk layer (see data/stats.ts)
     ============================================================ */

  /** boons taken per stat this run */
  private statBoons = new Map<RunStatId, number>();

  /** Current value of a run stat, caps applied. */
  stat(id: RunStatId): number {
    const def = RUN_STAT_MAP.get(id);
    if (!def) return 1;
    return statValue(def, this.statBoons.get(id) ?? 0);
  }

  statCount(id: RunStatId): number {
    return this.statBoons.get(id) ?? 0;
  }

  /** Can another boon of this stat still do anything? */
  statAtCap(id: RunStatId): boolean {
    const def = RUN_STAT_MAP.get(id);
    if (!def) return true;
    const n = this.statBoons.get(id) ?? 0;
    return statValue(def, n + 1) === statValue(def, n);
  }

  addStatBoon(id: RunStatId): void {
    this.statBoons.set(id, (this.statBoons.get(id) ?? 0) + 1);
    if (id === 'maxHp') {
      // The boon heals what it grants — taking MAX HEALTH always feels good.
      const def = RUN_STAT_MAP.get('maxHp');
      this.maxHp = this.baseMaxHp + this.stat('maxHp');
      this.hp = Math.min(this.maxHp, this.hp + (def?.step ?? 20));
    }
    if (id === 'projCount' || id === 'pierce' || id === 'chain') {
      // Ranged boons top a charge back up so the build change is felt now.
      this.rangedCharges = Math.min(this.maxRangedCharges, this.rangedCharges + 1);
    }
  }

  /** Everything the stats page shows. */
  statList(): Array<{ def: RunStatDef; value: number; count: number; text: string }> {
    return RUN_STATS.map((def) => {
      const count = this.statBoons.get(def.id) ?? 0;
      const value = statValue(def, count);
      return { def, value, count, text: formatStat(def, value) };
    });
  }

  private baseMaxHp = BASE_MAX_HP;

  /* ---- VOID NEEDLE charges ---- */
  rangedCharges: number = RANGED.charges;
  get maxRangedCharges(): number {
    return RANGED.charges as number;
  }

  /** Crits: rolled by the attacker, applied by CombatSystem. */
  rollCrit(): boolean {
    return Math.random() < this.stat('critChance');
  }
  get critMultiplier(): number {
    return this.stat('critDamage');
  }

  addSurge(amount: number): number {
    const before = this.surge;
    this.surge = Math.min(this.surgeMax, this.surge + amount * this.stat('surgeGain'));
    return this.surge - before;
  }

  spendSurge(amount: number): boolean {
    if (this.surge < amount) return false;
    this.surge -= amount;
    return true;
  }

  get surgeFrac(): number {
    return this.surgeMax > 0 ? this.surge / this.surgeMax : 0;
  }

  /** SECOND WIND spent? */
  secondWindUsed = false;

  /** traits stolen with PARASITE, applied as flat multipliers */
  stolenTraits: string[] = [];

  /** temporary buffs */
  speedBuff = 0;
  speedBuffTime = 0;

  /** currently equipped weapon id */
  weaponId = 'sword';

  /** run scoring */
  runKills = 0;
  runNamedKills = 0;
  essence = 0;

  /** the player's own habit counters for this run, folded into the save later */
  habits: PlayerHabits = {
    light: 0,
    heavy: 0,
    parry: 0,
    dodge: 0,
    fire: 0,
    execute: 0,
    backstab: 0,
    ranged: 0,
    flee: 0,
  };

  reset(vigour: number, weaponId: string): void {
    this.baseMaxHp = BASE_MAX_HP + vigour;
    this.maxHp = this.baseMaxHp;
    this.hp = this.maxHp;
    this.healCharges = this.maxHealCharges;
    this.powers.clear();
    this.statBoons.clear();
    this.rangedCharges = RANGED.charges;
    this.momentum = 0;
    this.secondWindUsed = false;
    this.stolenTraits = [];
    this.speedBuff = 0;
    this.speedBuffTime = 0;
    this.weaponId = weaponId;
    this.runKills = 0;
    this.runNamedKills = 0;
    this.essence = 0;
    this.habits = { light: 0, heavy: 0, parry: 0, dodge: 0, fire: 0, execute: 0, backstab: 0, ranged: 0, flee: 0 };
  }

  /** Outgoing damage multiplier from powers and momentum. */
  damageMultiplier(): number {
    let m = 1;
    if (this.powers.has('glass')) m *= 1.55;
    if (this.powers.has('momentum')) m *= 1 + this.momentum * 0.05;
    for (const t of this.stolenTraits) {
      if (t === 'brutal') m *= 1.2;
    }
    return m;
  }

  /** Melee swings: powers times the MELEE DAMAGE run stat. */
  meleeDamageMultiplier(): number {
    return this.damageMultiplier() * this.stat('meleeDamage');
  }

  /** Void Needles: powers times the RANGED DAMAGE run stat. */
  rangedDamageMultiplier(): number {
    return this.damageMultiplier() * this.stat('rangedDamage');
  }

  /** Incoming damage multiplier. */
  defenceMultiplier(): number {
    let m = 1;
    if (this.powers.has('glass')) m *= 1.3;
    for (const t of this.stolenTraits) {
      if (t === 'iron_hide') m *= 0.85;
    }
    return m;
  }

  moveSpeedMultiplier(): number {
    let m = this.stat('moveSpeed');
    if (this.speedBuffTime > 0) m *= 1 + this.speedBuff;
    for (const t of this.stolenTraits) {
      if (t === 'quick') m *= 1.12;
    }
    return m;
  }

  addPower(id: PowerId): void {
    this.powers.add(id);
    if (id === 'second_wind') this.secondWindUsed = false;
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  tick(dt: number): void {
    if (this.speedBuffTime > 0) {
      this.speedBuffTime -= dt;
      if (this.speedBuffTime <= 0) this.speedBuff = 0;
    }
    // VOID NEEDLE charges refill on a timer; they are ammunition, not mana.
    if (this.rangedCharges < this.maxRangedCharges) {
      this.rangedCharges = Math.min(this.maxRangedCharges, this.rangedCharges + dt / RANGED.rechargeTime);
    }
    // HEALTH REGEN run stat.
    const regen = this.stat('hpRegen');
    if (regen > 0 && this.hp > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    }
  }

  /** LIFESTEAL run stat: heal a fraction of damage dealt. */
  lifestealFrom(damage: number): number {
    const frac = this.stat('lifesteal');
    if (frac <= 0 || damage <= 0) return 0;
    return this.heal(damage * frac);
  }
}
