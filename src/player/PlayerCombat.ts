/**
 * The player's action state machine.
 *
 * This file owns *timing* only — it decides what the player is doing and when
 * a hit window opens. Actually resolving that window against the world is the
 * CombatSystem's job, which keeps this readable and easy to tune.
 */

import type { WeaponDef } from '../data/weapons';
import type { PlayerStats } from './PlayerStats';
import { hasTriggeredPower } from '../data/equipment';
import { PLAYER, RANGED, DODGE_RULES } from '../data/balance';

/** total seconds of the Void Needle throw overlay animation */
export const RANGED_THROW_TIME = 0.32;
/** the needle leaves the hand this long into the throw */
const RANGED_RELEASE = 0.1;
/** attacking within this window after a dodge triggers DASH STRIKE */
const DASH_STRIKE_WINDOW = 0.28;

export type PlayerAction = 'idle' | 'attack' | 'dodge' | 'parry' | 'stagger' | 'execute' | 'dead' | 'skill' | 'ultimate';
export type AttackKind = 'light' | 'heavy';
export type Phase = 'windup' | 'active' | 'recover';

export interface PendingHit {
  kind: AttackKind;
  damage: number;
  stagger: number;
  reach: number;
  halfArc: number;
  combo: number;
  /** heavy finishers and shockwaves push harder */
  knockback: number;
  ignite: boolean;
}

/* All timing lives in data/balance.ts — see the note at the top of that file. */
const DODGE_TIME = PLAYER.dodgeDuration;
const DODGE_IFRAME_START = PLAYER.dodgeIFrameStart;
const DODGE_IFRAME_END = PLAYER.dodgeIFrameEnd;
const DODGE_COOLDOWN = PLAYER.dodgeCooldown;

const PARRY_TIME = PLAYER.parryDuration;
const PARRY_ACTIVE = PLAYER.parryActive;
const PARRY_PERFECT = PLAYER.parryPerfect;
const PARRY_COOLDOWN = PLAYER.parryCooldown;

const COMBO_WINDOW = PLAYER.comboWindow;
const EXECUTE_TIME = PLAYER.executeDuration;
const STAGGER_TIME = PLAYER.staggerDuration;

export class PlayerCombat {
  action: PlayerAction = 'idle';
  phase: Phase = 'windup';
  /** seconds spent in the current phase */
  t = 0;

  attackKind: AttackKind = 'light';
  comboIndex = 0;
  private comboTimer = 0;

  dodgeCooldown = 0;
  parryCooldown = 0;

  /** set for exactly one frame when a swing's active window opens */
  pendingHit: PendingHit | null = null;
  /** true while the swing's hitbox is live (used to allow one hit per target) */
  swingId = 0;

  invulnerable = false;
  /** direction of the current dodge, unit vector on XZ */
  dodgeX = 0;
  dodgeZ = 0;

  /** the enemy uid currently being executed */
  executeTarget: number | null = null;
  /** set for one frame when the execution's damage lands */
  executeStrike = false;

  /** set for one frame when a parry succeeds */
  parriedThisFrame = false;
  /** set for one frame when that parry was a perfect one */
  perfectParryThisFrame = false;
  /** set for one frame when a perfect dodge is detected */
  perfectDodgeThisFrame = false;
  /** temporary attack-speed bonus from a perfect dodge */
  hasteTime = 0;
  /** the next attack lands as a counter */
  counterArmed = false;
  /** brief window after a successful parry where a riposte is free */
  riposteWindow = 0;

  /** locked out of acting (staggered) */
  private staggerTimer = 0;

  /* ---- run-stat plumbing, written by Player.update each frame ---- */
  attackSpeedMul = 1;
  parryWindowMul = 1;
  dodgeCooldownMul = 1;

  /* ---- VOID NEEDLE ----
     The throw is an OVERLAY, not an action: it plays on the off hand so you
     can fire while moving, mid-recovery, even mid-swing. The body never locks. */
  rangedCooldown = 0;
  /** counts down from RANGED_THROW_TIME while the throw plays */
  rangedTimer = 0;
  /** one frame, when the needle should actually spawn */
  pendingRanged = false;
  private rangedReleased = true;

  /* ---- DASH STRIKE ---- */
  /** seconds since the last dodge ended */
  private sinceDodgeEnd = 99;
  /** set while the current attack is a dash strike */
  dashStrike = false;

  /** SPECTRAL GUARD: absorb one hit while the window is live */
  guardCharges = 0;
  guardTimer = 0;
  brandUid = -1;
  brandTimer = 0;
  livingWeaponT = 0;
  defianceArmorT = 0;
  dodgeCharges = 1;
  lastAttackKind: AttackKind | null = null;

  /* ---- ACTIVE SKILLS ---- */
  skillId: string | null = null;
  pendingSkillHit = false;
  /** brief stagger armor (not i-frames vs red melee) */
  skillArmor = 0;
  skillMoveX = 0;
  skillMoveZ = 0;
  skillPassThrough = false;
  /** uid -> remaining mark time from Shadow Step */
  stepMarks = new Map<number, number>();
  skillWindup = 0.1;
  skillActive = 0.2;
  skillRecover = 0.2;

  reset(): void {
    this.action = 'idle';
    this.phase = 'windup';
    this.t = 0;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.dodgeCooldown = 0;
    this.parryCooldown = 0;
    this.pendingHit = null;
    this.invulnerable = false;
    this.executeTarget = null;
    this.executeStrike = false;
    this.parriedThisFrame = false;
    this.perfectParryThisFrame = false;
    this.perfectDodgeThisFrame = false;
    this.riposteWindow = 0;
    this.hasteTime = 0;
    this.counterArmed = false;
    this.staggerTimer = 0;
    this.rangedCooldown = 0;
    this.rangedTimer = 0;
    this.pendingRanged = false;
    this.rangedReleased = true;
    this.sinceDodgeEnd = 99;
    this.dashStrike = false;
    this.dodgeCharges = 1;
    this.lastAttackKind = null;
    this.skillId = null;
    this.pendingSkillHit = false;
    this.skillArmor = 0;
    this.skillMoveX = 0;
    this.skillMoveZ = 0;
    this.skillPassThrough = false;
    this.stepMarks.clear();
    this.guardCharges = 0;
    this.guardTimer = 0;
    this.brandUid = -1;
    this.brandTimer = 0;
    this.livingWeaponT = 0;
    this.defianceArmorT = 0;
  }

  get busy(): boolean {
    return this.action !== 'idle';
  }

  get canAct(): boolean {
    return this.action === 'idle' || (this.action === 'attack' && this.phase === 'recover');
  }

  get parryActive(): boolean {
    return this.action === 'parry' && this.t <= PARRY_ACTIVE * this.parryWindowMul;
  }

  /**
   * The front of the parry window. A perfect parry catches attacks a normal
   * one cannot, and pays out far more — it is the highest-skill defensive
   * action in the game and should feel like it.
   */
  get parryPerfect(): boolean {
    return this.action === 'parry' && this.t <= PARRY_PERFECT * this.parryWindowMul;
  }

  /**
   * A dodge that began just before the blow arrived. Rewarding lateness is
   * what separates reading an attack from mashing the button.
   */
  get dodgePerfect(): boolean {
    return this.action === 'dodge' && this.t <= PLAYER.perfectDodgeWindow;
  }

  /** True while an attack can be cancelled into a counter after a parry. */
  get canRiposte(): boolean {
    return this.riposteWindow > 0;
  }

  /* ============================================================
     inputs
     ============================================================ */

  tryAttack(kind: AttackKind, weapon: WeaponDef, stats: PlayerStats): boolean {
    if (this.action === 'dead' || this.action === 'execute' || this.action === 'stagger') return false;
    if (this.action === 'skill' || this.action === 'ultimate') {
      if (!(this.action === 'skill' && this.skillId === 'shadow_step' && this.phase === 'recover')) return false;
    }
    if (this.action === 'dodge' && this.t < DODGE_TIME * 0.62) return false;
    if (this.action === 'parry' && this.t < PARRY_ACTIVE) return false;
    if (this.action === 'attack' && this.phase !== 'recover') return false;

    // Chaining light attacks continues the combo; anything else restarts it.
    if (kind === 'light' && this.comboTimer > 0) {
      this.comboIndex = (this.comboIndex + 1) % 3;
    } else {
      this.comboIndex = 0;
    }

    // DASH STRIKE: a light attack straight out of a dodge becomes a lunge.
    this.dashStrike =
      kind === 'light' &&
      hasTriggeredPower(stats.powers.ids(), 'dash_strike') &&
      (this.action === 'dodge' || this.sinceDodgeEnd < DASH_STRIKE_WINDOW);

    if (stats.powers.has('relentless') && this.lastAttackKind && this.lastAttackKind !== kind) {
      this.hasteTime = Math.max(this.hasteTime, 1.8);
    }
    this.lastAttackKind = kind;

    this.action = 'attack';
    this.attackKind = kind;
    this.phase = 'windup';
    this.t = 0;
    this.swingId++;
    this.comboTimer = 0;
    this.invulnerable = false;
    void weapon;
    return true;
  }

  /**
   * Fire the Void Needle. The charge check lives with the caller (stats own
   * the resource); this only guards the rhythm.
   */
  tryRanged(): boolean {
    if (this.action === 'dead' || this.action === 'execute' || this.action === 'stagger') return false;
    if (this.rangedCooldown > 0 || this.rangedTimer > 0) return false;
    this.rangedTimer = RANGED_THROW_TIME;
    this.rangedReleased = false;
    this.rangedCooldown = RANGED.cooldown;
    return true;
  }

  tryDodge(dirX: number, dirZ: number, stats?: PlayerStats): boolean {
    if (this.action === 'dead' || this.action === 'execute' || this.action === 'stagger') return false;
    if (this.action === 'skill' || this.action === 'ultimate') return false;
    const max = stats && hasTriggeredPower(stats.powers.ids(), 'double_dodge') ? 2 : 1;
    if (this.dodgeCharges <= 0 && this.dodgeCooldown > 0) return false;
    if (this.dodgeCharges <= 0) return false;
    if (this.action === 'attack' && this.phase === 'windup') return false;
    if (this.action === 'dodge') return false;
    this.action = 'dodge';
    this.phase = 'active';
    this.t = 0;
    this.dodgeX = dirX;
    this.dodgeZ = dirZ;
    this.dodgeCharges = Math.max(0, this.dodgeCharges - 1);
    this.dodgeCooldown =
      this.dodgeCharges > 0
        ? 0.12
        : Math.max(DODGE_RULES.cooldownFloor, DODGE_TIME + DODGE_COOLDOWN * this.dodgeCooldownMul);
    this.comboTimer = 0;
    void max;
    return true;
  }

  tryParry(): boolean {
    if (this.action === 'dead' || this.action === 'execute' || this.action === 'stagger') return false;
    if (this.action === 'skill' || this.action === 'ultimate') return false;
    if (this.parryCooldown > 0) return false;
    if (this.action === 'attack' && this.phase === 'windup') return false;
    if (this.action === 'dodge') return false;
    this.action = 'parry';
    this.phase = 'active';
    this.t = 0;
    this.parryCooldown = PARRY_TIME + PARRY_COOLDOWN;
    this.comboTimer = 0;
    return true;
  }

  /**
   * Begin a skill or ultimate. Timings are written by the caller after this
   * returns true (`setSkillTimings`).
   */
  trySkill(kind: 'skill' | 'ultimate', id: string): boolean {
    if (this.action === 'dead' || this.action === 'execute' || this.action === 'stagger') return false;
    if (this.action === 'skill' || this.action === 'ultimate') return false;
    if (kind !== 'skill' && this.action === 'attack' && this.phase === 'windup') return false;
    this.action = kind;
    this.phase = 'windup';
    this.t = 0;
    this.skillId = id;
    this.pendingSkillHit = false;
    this.invulnerable = false;
    this.comboTimer = 0;
    this.dashStrike = false;
    return true;
  }

  setSkillTimings(windup: number, active: number, recover: number, armor = 0, passThrough = false, dirX = 0, dirZ = 0): void {
    this.skillWindup = Math.max(0.02, windup);
    this.skillActive = Math.max(0.04, active);
    this.skillRecover = Math.max(0.04, recover);
    this.skillArmor = armor;
    this.skillPassThrough = passThrough;
    this.skillMoveX = dirX;
    this.skillMoveZ = dirZ;
  }

  consumeStepMark(uid: number): boolean {
    const left = this.stepMarks.get(uid) ?? 0;
    if (left <= 0) return false;
    this.stepMarks.delete(uid);
    return true;
  }

  startExecute(targetUid: number): boolean {
    if (!this.canAct && this.action !== 'idle') return false;
    this.action = 'execute';
    this.phase = 'active';
    this.t = 0;
    this.executeTarget = targetUid;
    this.executeStrike = false;
    this.invulnerable = true;
    return true;
  }

  stagger(): void {
    if (this.action === 'dead' || this.action === 'execute') return;
    if (this.skillArmor > 0 && (this.action === 'skill' || this.action === 'ultimate')) return;
    this.action = 'stagger';
    this.staggerTimer = STAGGER_TIME;
    this.t = 0;
    this.invulnerable = false;
    this.comboTimer = 0;
    this.skillPassThrough = false;
    this.pendingSkillHit = false;
  }

  die(): void {
    this.action = 'dead';
    this.invulnerable = false;
    this.pendingHit = null;
  }

  onParrySuccess(perfect: boolean): void {
    this.parriedThisFrame = true;
    this.perfectParryThisFrame = perfect;
    this.riposteWindow = PLAYER.riposteWindow;
    this.counterArmed = perfect;
    // A good parry immediately frees you up.
    this.t = Math.min(this.t, PARRY_ACTIVE);
    this.parryCooldown = Math.min(this.parryCooldown, perfect ? 0.12 : 0.22);
  }

  onPerfectDodge(): void {
    this.perfectDodgeThisFrame = true;
    this.hasteTime = PLAYER.perfectDodgeHasteTime;
  }

  /* ============================================================
     tick
     ============================================================ */

  update(dt: number, weapon: WeaponDef, stats: PlayerStats): void {
    this.pendingHit = null;
    this.parriedThisFrame = false;
    this.perfectParryThisFrame = false;
    this.perfectDodgeThisFrame = false;
    this.executeStrike = false;
    this.pendingRanged = false;
    this.pendingSkillHit = false;
    if (this.hasteTime > 0) this.hasteTime -= dt;
    if (this.skillArmor > 0) this.skillArmor -= dt;
    if (this.guardTimer > 0) this.guardTimer -= dt;
    else this.guardCharges = 0;
    if (this.brandTimer > 0) this.brandTimer -= dt;
    else this.brandUid = -1;
    if (this.livingWeaponT > 0) this.livingWeaponT -= dt;
    if (this.defianceArmorT > 0) {
      this.defianceArmorT -= dt;
      if (this.defianceArmorT <= 0) this.invulnerable = this.invulnerable && this.action === 'dodge';
    }
    if (this.riposteWindow <= 0) this.counterArmed = false;

    for (const [uid, t] of this.stepMarks) {
      const n = t - dt;
      if (n <= 0) this.stepMarks.delete(uid);
      else this.stepMarks.set(uid, n);
    }

    if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
    else {
      const max = hasTriggeredPower(stats.powers.ids(), 'double_dodge') ? 2 : 1;
      if (this.dodgeCharges < max) this.dodgeCharges = max;
    }
    if (this.parryCooldown > 0) this.parryCooldown -= dt;
    if (this.riposteWindow > 0) this.riposteWindow -= dt;
    if (this.comboTimer > 0) this.comboTimer -= dt;
    if (this.rangedCooldown > 0) this.rangedCooldown -= dt;
    this.sinceDodgeEnd += dt;

    /* the needle throw runs alongside whatever else the body is doing */
    if (this.rangedTimer > 0) {
      this.rangedTimer -= dt;
      if (!this.rangedReleased && this.rangedTimer <= RANGED_THROW_TIME - RANGED_RELEASE) {
        this.rangedReleased = true;
        this.pendingRanged = true;
      }
    }

    this.t += dt;

    switch (this.action) {
      case 'attack':
        this.updateAttack(weapon, stats);
        break;
      case 'dodge':
        this.invulnerable =
          this.t >= DODGE_IFRAME_START &&
          this.t <= DODGE_IFRAME_END + (hasTriggeredPower(stats.powers.ids(), 'blink') ? DODGE_RULES.blinkIFrameEndBonus : 0);
        if (this.t >= DODGE_TIME) {
          this.action = 'idle';
          this.invulnerable = false;
          this.sinceDodgeEnd = 0;
        }
        break;
      case 'parry':
        if (this.t >= PARRY_TIME) this.action = 'idle';
        break;
      case 'stagger':
        this.staggerTimer -= dt;
        if (this.staggerTimer <= 0) this.action = 'idle';
        break;
      case 'execute':
        if (!this.executeStrike && this.t >= EXECUTE_TIME * 0.45) {
          this.executeStrike = true;
        }
        if (this.t >= EXECUTE_TIME) {
          this.action = 'idle';
          this.invulnerable = false;
          this.executeTarget = null;
        }
        break;
      case 'skill':
      case 'ultimate':
        this.updateSkill();
        break;
      default:
        break;
    }
  }

  private updateSkill(): void {
    if (this.phase === 'windup' && this.t >= this.skillWindup) {
      this.phase = 'active';
      this.t -= this.skillWindup;
      this.pendingSkillHit = true;
    } else if (this.phase === 'active' && this.t >= this.skillActive) {
      this.phase = 'recover';
      this.t -= this.skillActive;
      this.skillPassThrough = false;
    } else if (this.phase === 'recover' && this.t >= this.skillRecover) {
      this.action = 'idle';
      this.phase = 'windup';
      this.t = 0;
      this.skillId = null;
      this.skillPassThrough = false;
    }
  }

  skillProgress(): number {
    const total = this.skillWindup + this.skillActive + this.skillRecover;
    let done = this.t;
    if (this.phase === 'active') done += this.skillWindup;
    else if (this.phase === 'recover') done += this.skillWindup + this.skillActive;
    return Math.max(0, Math.min(1, done / Math.max(0.01, total)));
  }

  private updateAttack(weapon: WeaponDef, stats: PlayerStats): void {
    const t = this.timings(weapon);
    if (this.phase === 'windup' && this.t >= t.windup) {
      this.phase = 'active';
      this.t -= t.windup;
      this.pendingHit = this.buildHit(weapon, stats);
    } else if (this.phase === 'active' && this.t >= t.active) {
      this.phase = 'recover';
      this.t -= t.active;
      this.comboTimer = COMBO_WINDOW;
    } else if (this.phase === 'recover' && this.t >= t.recover) {
      this.action = 'idle';
      this.phase = 'windup';
      this.t = 0;
      this.dashStrike = false;
    }
  }

  timings(weapon: WeaponDef): { windup: number; active: number; recover: number } {
    // A perfect dodge buys a short burst of speed. It is applied to windup and
    // recovery rather than to damage, because tempo is what a defensive read
    // should be worth. The ATTACK SPEED run stat multiplies on top.
    const haste = (this.hasteTime > 0 ? 1 - PLAYER.perfectDodgeHaste : 1) / Math.max(0.5, this.attackSpeedMul);
    if (this.attackKind === 'heavy') {
      return {
        windup: (weapon.windup * 1.9 + 0.05) * haste,
        active: 0.1,
        recover: weapon.recover * 1.55 * haste,
      };
    }
    // Three genuinely different swings, not two identical ones and a finisher.
    //   0  fast horizontal opener
    //   1  opposite diagonal — quicker still, so the pair reads as a flurry
    //   2  committed forward finisher: slower, longer, and it moves you
    const c = (weapon.lightCombo ?? LIGHT_COMBO)[this.comboIndex] ?? LIGHT_COMBO[0];
    return {
      windup: weapon.windup * c.windup * haste,
      active: 0.07,
      recover: weapon.recover * c.recover * haste,
    };
  }

  private buildHit(weapon: WeaponDef, stats: PlayerStats): PendingHit {
    const mult = stats.meleeDamageMultiplier();
    if (this.attackKind === 'heavy') {
      return {
        kind: 'heavy',
        damage: weapon.damage * 1.95 * mult,
        stagger: weapon.stagger * 2.4,
        reach: weapon.reach * 1.12,
        halfArc: weapon.arc * 1.25,
        combo: 0,
        knockback: 7,
        ignite: stats.techniques.includes('sun_ignite'),
      };
    }
    const c = (weapon.lightCombo ?? LIGHT_COMBO)[this.comboIndex] ?? LIGHT_COMBO[0];
    const dash = this.dashStrike;
    const techs = stats.techniques;
    let reachMul = dash ? 1.35 : 1;
    if (dash && techs.includes('spear_chase')) {
      reachMul *= 1.15;
    }
    let arc = weapon.arc * c.arc;
    if (this.comboIndex === 2 && techs.includes('gs_spin')) arc *= 1.35;
    let reach = weapon.reach * c.reach * reachMul;
    if (this.comboIndex === 2 && techs.includes('tooth_pierce')) reach *= 1.12;
    return {
      kind: 'light',
      damage: weapon.damage * c.damage * mult * (dash ? 1.25 : 1) * (this.counterArmed && techs.includes('sword_riposte_drive') ? 1.35 : 1),
      stagger: weapon.stagger * c.posture * (dash ? 1.4 : 1),
      reach,
      halfArc: arc,
      combo: this.comboIndex,
      knockback: c.knockback,
      ignite: hasTriggeredPower(stats.powers.ids(), 'ember'),
    };
  }

  /** Forward step the finisher adds, in metres per second. */
  get comboLunge(): number {
    if (this.action !== 'attack' || this.attackKind !== 'light') return 0;
    if (this.phase !== 'active') return 0;
    return (LIGHT_COMBO[this.comboIndex]?.lunge ?? 0) + (this.dashStrike ? 13 : 0);
  }

  /** 0..1 progress through the current attack, for animation. */
  attackProgress(weapon: WeaponDef): number {
    const t = this.timings(weapon);
    const total = t.windup + t.active + t.recover;
    let done = this.t;
    if (this.phase === 'active') done += t.windup;
    else if (this.phase === 'recover') done += t.windup + t.active;
    return Math.max(0, Math.min(1, done / total));
  }

  dodgeProgress(): number {
    return Math.max(0, Math.min(1, this.t / DODGE_TIME));
  }

  executeProgress(): number {
    return Math.max(0, Math.min(1, this.t / EXECUTE_TIME));
  }

  parryProgress(): number {
    return Math.max(0, Math.min(1, this.t / PARRY_TIME));
  }
}

/**
 * The light combo. Each step has a distinct job — the QA pass found steps 1 and
 * 2 were mechanically identical, which is why the "three hit combo" read as
 * two of the same swing plus a finisher.
 */
const LIGHT_COMBO = [
  // 0 — opener: neutral, safe, cancels into anything
  { windup: 1, recover: 1, damage: 1, posture: 1, reach: 1, arc: 1, knockback: 1.6, lunge: 0 },
  // 1 — the return swing: faster and wider, rewards staying in
  { windup: 0.82, recover: 0.9, damage: 1.05, posture: 1.15, reach: 1, arc: 1.25, knockback: 2, lunge: 0 },
  // 2 — finisher: slow, committed, long, and it carries you forward
  { windup: 1.45, recover: 1.5, damage: 1.55, posture: 2.2, reach: 1.18, arc: 1.15, knockback: 4.5, lunge: 5.5 },
] as const;

export const DODGE_DURATION = DODGE_TIME;
export const EXECUTE_DURATION = EXECUTE_TIME;
