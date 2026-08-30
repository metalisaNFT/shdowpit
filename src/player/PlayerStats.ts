/**
 * Everything about the player that is a number. Kept apart from the entity so
 * the run/meta layers can read and write it without touching the scene graph.
 */

import { PowerSet, type PowerId } from '../data/abilities';
import type { PlayerHabits } from '../core/SaveSystem';
import { PLAYER, RANGED, HEAL_ECON } from '../data/balance';
import { RUN_STATS, RUN_STAT_MAP, statValue, formatStat, STAT_TIPS, type RunStatId, type RunStatDef } from '../data/stats';
import { hasTriggeredPower } from '../data/equipment';
import type { RunState } from '../run/RunState';

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
    let v = statValue(def, this.statBoons.get(id) ?? 0) + (this.gearAdd.get(id) ?? 0);
    if (def.max !== undefined) {
      if (def.step >= 0) v = Math.min(def.max, v);
      else v = Math.max(0.35, v);
    }
    return v;
  }

  private gearAdd = new Map<RunStatId, number>();

  addGearStat(id: RunStatId, add: number): void {
    this.gearAdd.set(id, (this.gearAdd.get(id) ?? 0) + add);
    if (id === 'maxHp') {
      this.maxHp = this.baseMaxHp + this.stat('maxHp');
    }
  }

  clearGear(): void {
    this.gearAdd.clear();
    this.armorIncomingMul = 1;
    this.brokenMask = false;
    this.ashenEye = false;
    this.varkMask = false;
    this.heavySetBonus = false;
    this.lightSetBonus = false;
    this.toxicSetBonus = false;
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
  statList(): Array<{ def: RunStatDef; value: number; count: number; text: string; tip: string }> {
    return RUN_STATS.map((def) => {
      const count = this.statBoons.get(def.id) ?? 0;
      const value = this.stat(def.id);
      return { def, value, count, text: formatStat(def, value), tip: STAT_TIPS[def.id] ?? def.desc };
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
  techniques: string[] = [];

  /** temporary buffs */
  speedBuff = 0;
  speedBuffTime = 0;

  /** currently equipped weapon id */
  weaponId = 'sword';

  heavySetBonus = false;
  lightSetBonus = false;
  toxicSetBonus = false;

  /** compiled from skill tree + gear (incoming damage mul) */
  armorIncomingMul = 1;
  brokenMask = false;
  ashenEye = false;
  varkMask = false;

  /** run scoring */
  runKills = 0;
  runNamedKills = 0;
  essence = 0;
  run: RunState | null = null;

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
    this.techniques = [];
    this.speedBuff = 0;
    this.speedBuffTime = 0;
    this.weaponId = weaponId;
    this.gearAdd.clear();
    this.armorIncomingMul = 1;
    this.brokenMask = false;
    this.ashenEye = false;
    this.varkMask = false;
    this.heavySetBonus = false;
    this.lightSetBonus = false;
    this.toxicSetBonus = false;
    this.runKills = 0;
    this.runNamedKills = 0;
    this.essence = 0;
    this.habits = { light: 0, heavy: 0, parry: 0, dodge: 0, fire: 0, execute: 0, backstab: 0, ranged: 0, flee: 0 };
  }

  /** Outgoing damage multiplier from powers and momentum. */
  damageMultiplier(): number {
    let m = 1;
    if (this.powers.has('glass')) m *= 1.55;
    if (hasTriggeredPower(this.powers.ids(), 'momentum')) m *= 1 + this.momentum * 0.05;
    for (const t of this.stolenTraits) {
      if (t === 'brutal') m *= 1.12;
      if (t === 'blood_fury' && this.maxHp > 0 && this.hp / this.maxHp <= 0.45) m *= 1.08;
      if (t === 'relentless') m *= 1.06;
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
    let m = 1 * this.armorIncomingMul;
    if (this.powers.has('glass')) m *= 1.3;
    if (this.powers.has('last_stand') && this.maxHp > 0 && this.hp / this.maxHp <= 0.3) m *= 0.55;
    for (const t of this.stolenTraits) {
      if (t === 'iron_hide') m *= 0.92;
      if (t === 'thick_plate') m *= 0.95;
      if (t === 'blade_ward') m *= 0.94;
      if (t === 'arrow_ward') m *= 0.92;
      if (t === 'bulwark') m *= 0.96;
    }
    return m;
  }

  /** Stolen fire resistance from PARASITE. */
  fireResistMul(): number {
    return this.stolenTraits.includes('fire_resist') ? 0.35 : 1;
  }

  /** Extra max HP from stolen VIGOROUS. */
  stolenVigourBonus(): number {
    return this.stolenTraits.includes('vigorous') ? 18 : 0;
  }

  moveSpeedMultiplier(): number {
    let m = this.stat('moveSpeed');
    if (this.speedBuffTime > 0) m *= 1 + this.speedBuff;
    for (const t of this.stolenTraits) {
      if (t === 'quick') m *= 1.08;
      if (t === 'swift_step') m *= 1.05;
    }
    return m;
  }

  addPower(id: PowerId): void {
    this.powers.add(id);
    if (id === 'second_wind') this.secondWindUsed = false;
  }

  heal(amount: number, source = 'generic'): number {
    if (amount <= 0 || this.run?.healLocked) return 0;
    if (this.run) {
      const already = this.run.healedBySource[source] ?? 0;
      amount = amount / (1 + already / HEAL_ECON.dimPerSource);
      if (source === 'regen' && this.run.severeDamage > 0) amount *= HEAL_ECON.regenVsSevere;
      this.run.healedBySource[source] = already + amount;
    }
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const gained = this.hp - before;
    if (gained > 0.5 && this.run?.vendetta) this.run.vendetta.healed = true;
    return gained;
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
      this.heal(regen * dt, 'regen');
    }
  }

  /** LIFESTEAL run stat: heal a fraction of damage dealt. */
  lifestealFrom(damage: number): number {
    const frac = this.stat('lifesteal');
    if (frac <= 0 || damage <= 0) return 0;
    return this.heal(damage * frac, 'lifesteal');
  }
}
