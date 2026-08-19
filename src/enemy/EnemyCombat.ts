/**
 * Enemy attack timing and posture.
 *
 * Every attack runs the same three phases — ANTICIPATION, ACTIVE, RECOVERY —
 * with an optional HOLD between the first two for delayed strikes. The phase
 * an enemy is in is the single most important thing the player reads, so it is
 * exposed plainly and the visual layer keys off it directly.
 *
 * Posture replaces the old `poise` pool. The difference matters: poise was an
 * invisible number that decayed almost immediately, so there was nothing to
 * play toward. Posture is large, visible, regenerates only after a delay, and
 * breaking it opens the enemy up for an execution. It gives combat a second
 * objective besides health.
 */

import type { WeaponDef } from '../data/weapons';
import type { TraitMods } from '../data/traits';
import type { EnemyAttackDef, AttackIntent, ProjectileKind } from '../data/attacks';
import { POSTURE, ENEMY } from '../data/balance';

export type EnemyActionState =
  | 'ready'
  | 'windup'
  /** anticipation is done, the strike is deliberately held back */
  | 'hold'
  | 'active'
  | 'recover'
  | 'stagger'
  | 'block'
  | 'dead'
  | 'knockdown'
  /** posture broken: wide open, executable */
  | 'broken';

export interface EnemyHit {
  damage: number;
  stagger: number;
  reach: number;
  halfArc: number;
  unblockable: boolean;
  ranged: boolean;
  intent: AttackIntent;
  areaRadius: number;
  projectiles: number;
  /** which strike of a multi-hit attack this is, 0-based */
  index: number;
  /** scales the knockback applied to the player (SHOVE pushes, most don't) */
  knockbackMul: number;
  /** which projectile behaviour a ranged attack fires */
  projectileKind: ProjectileKind;
}

export class EnemyCombat {
  state: EnemyActionState = 'ready';
  t = 0;

  /** seconds until willing to attack again */
  cooldown = 0;

  /** the attack currently being performed */
  current: EnemyAttackDef | null = null;

  /* ---- posture ---- */
  posture = 0;
  postureMax: number = POSTURE.base;
  private postureQuiet = 0;
  private brokenTimer = 0;

  /** one-frame hit event, consumed by CombatSystem */
  pendingHit: EnemyHit | null = null;

  /** this swing cannot be parried */
  currentUnblockable = false;

  private anticipation = 0.6;
  private holdTime = 0;
  private activeTime = 0.1;
  private recoverTime = 0.5;
  private hitsTotal = 1;
  private hitsDone = 0;

  /** true for one frame when knocked into stagger */
  staggeredThisFrame = false;
  /** true for one frame when posture breaks */
  brokeThisFrame = false;
  /** true for one frame when an attack enters recovery — the AI's cue to back off */
  justRecovered = false;

  reset(postureMax: number): void {
    this.state = 'ready';
    this.t = 0;
    this.cooldown = 0;
    this.posture = 0;
    this.postureMax = postureMax;
    this.pendingHit = null;
    this.current = null;
    this.brokenTimer = 0;
    this.postureQuiet = 0;
  }

  get busy(): boolean {
    return this.state !== 'ready' && this.state !== 'block';
  }

  get attacking(): boolean {
    return this.state === 'windup' || this.state === 'hold' || this.state === 'active' || this.state === 'recover';
  }

  /** Committed = past the point where repositioning still looks intentional. */
  get committed(): boolean {
    return this.state === 'hold' || this.state === 'active';
  }

  get broken(): boolean {
    return this.state === 'broken';
  }

  get postureFrac(): number {
    return this.postureMax > 0 ? Math.min(1, this.posture / this.postureMax) : 0;
  }

  get intent(): AttackIntent {
    return this.current?.intent ?? 'normal';
  }

  /**
   * Interruptible only during the first part of anticipation, and only if the
   * attack allows it at all. Non-interruptible attacks are the ones that flash
   * armour, so the player can tell the difference before committing.
   */
  get interruptible(): boolean {
    if (this.state !== 'windup') return false;
    if (!this.current) return true;
    if (!this.current.interruptible) return false;
    return this.t < this.anticipation * 0.62;
  }

  /** 0..1 through the anticipation — drives the telegraph. */
  windupProgress(): number {
    if (this.state === 'windup') return Math.min(1, this.t / Math.max(0.05, this.anticipation));
    if (this.state === 'hold') return 1;
    return 0;
  }

  /** Seconds until the strike lands while telegraphing; -1 otherwise. */
  get windupRemaining(): number {
    if (this.state === 'windup') return Math.max(0, this.anticipation - this.t) + this.holdTime;
    if (this.state === 'hold') return Math.max(0, this.holdTime - this.t);
    return -1;
  }

  /**
   * Cancel an early windup into a deliberate feint: the telegraph starts, the
   * player's trained answer comes out, and nothing arrives. Captain+ only —
   * the AI decides when; this just performs it.
   */
  feint(): boolean {
    if (this.state !== 'windup' || !this.current) return false;
    this.state = 'recover';
    this.t = 0;
    this.recoverTime = 0.26;
    this.current = null;
    this.cooldown = Math.max(this.cooldown, 0.4);
    return true;
  }

  /**
   * The current attack's phase lengths, seconds — the animation layer scrubs
   * its clips against these exact numbers (see anim/Animator.scrubAttack).
   */
  get phaseDurations(): { windup: number; hold: number; active: number; recover: number } {
    return {
      windup: this.anticipation,
      hold: this.holdTime,
      active: this.activeTime,
      recover: this.recoverTime,
    };
  }

  /** 0..1 across the whole attack, for animation. */
  swingProgress(): number {
    const total = this.anticipation + this.holdTime + this.activeTime + this.recoverTime;
    if (total <= 0) return 0;
    let done = 0;
    if (this.state === 'windup') done = this.t;
    else if (this.state === 'hold') done = this.anticipation + this.t;
    else if (this.state === 'active') done = this.anticipation + this.holdTime + this.t;
    else if (this.state === 'recover') done = this.anticipation + this.holdTime + this.activeTime + this.t;
    else return 0;
    return Math.min(1, done / total);
  }

  /* ============================================================
     starting an attack
     ============================================================ */

  startAttack(def: EnemyAttackDef, weapon: WeaponDef, mods: TraitMods, anticipation: number): void {
    this.state = 'windup';
    this.t = 0;
    this.current = def;
    this.anticipation = Math.max(0.15, anticipation * mods.windupMul);
    this.holdTime = def.delay;
    this.activeTime = def.active;
    this.recoverTime = def.recovery * mods.windupMul;
    this.hitsTotal = Math.max(1, def.hits);
    this.hitsDone = 0;
    this.currentUnblockable = def.intent === 'unblockable';
    void weapon;
  }

  block(duration: number): void {
    this.state = 'block';
    this.t = duration;
  }

  stagger(duration = 0.7): void {
    if (this.state === 'broken') return; // broken outranks stagger
    this.state = 'stagger';
    this.t = duration;
    this.pendingHit = null;
    this.current = null;
    this.staggeredThisFrame = true;
  }

  knockdown(duration = 1.5): void {
    this.state = 'knockdown';
    this.t = duration;
    this.posture = 0;
    this.pendingHit = null;
    this.current = null;
  }

  /** Posture break: wide open, executable, and it lasts. */
  breakPosture(): void {
    this.state = 'broken';
    this.brokenTimer = POSTURE.brokenDuration;
    this.posture = 0;
    this.postureQuiet = 0;
    this.pendingHit = null;
    this.current = null;
    this.brokeThisFrame = true;
  }

  die(): void {
    this.state = 'dead';
    this.pendingHit = null;
    this.current = null;
  }

  /**
   * Feed posture damage in. Returns true if this broke them.
   * `resist` is the trait-derived reduction; 1 means immune.
   */
  addPosture(amount: number, resist: number): boolean {
    if (this.state === 'broken' || this.state === 'dead') return false;
    const effective = amount * (1 - Math.max(-1, Math.min(0.95, resist)));
    this.posture += effective;
    this.postureQuiet = POSTURE.regenDelay;
    if (this.posture >= this.postureMax) {
      this.breakPosture();
      return true;
    }
    return false;
  }

  /* ============================================================
     tick
     ============================================================ */

  update(dt: number, weapon: WeaponDef, damage: number, mods: TraitMods): void {
    this.pendingHit = null;
    this.staggeredThisFrame = false;
    this.brokeThisFrame = false;
    this.justRecovered = false;
    if (this.state === 'dead') return;

    if (this.cooldown > 0) this.cooldown -= dt;

    // Posture only recovers once they have been left alone for a moment.
    if (this.postureQuiet > 0) this.postureQuiet -= dt;
    else if (this.posture > 0 && this.state !== 'broken') {
      this.posture = Math.max(0, this.posture - dt * POSTURE.regenPerSecond);
    }

    const countdown =
      this.state === 'stagger' || this.state === 'block' || this.state === 'knockdown';
    this.t += countdown ? -dt : dt;

    switch (this.state) {
      case 'windup':
        if (this.t >= this.anticipation) {
          this.t = 0;
          if (this.holdTime > 0) {
            this.state = 'hold';
          } else {
            this.state = 'active';
            this.emitHit(weapon, damage);
          }
        }
        break;

      case 'hold':
        if (this.t >= this.holdTime) {
          this.state = 'active';
          this.t = 0;
          this.emitHit(weapon, damage);
        }
        break;

      case 'active': {
        // Multi-hit attacks land their strikes evenly across the active window.
        if (this.hitsDone < this.hitsTotal) {
          const step = this.activeTime / this.hitsTotal;
          if (this.t >= step * this.hitsDone) this.emitHit(weapon, damage);
        }
        if (this.t >= this.activeTime) {
          this.state = 'recover';
          this.t = 0;
          this.justRecovered = true;
        }
        break;
      }

      case 'recover':
        if (this.t >= this.recoverTime) {
          this.state = 'ready';
          this.t = 0;
          this.current = null;
          const agg = 1 - Math.min(0.8, mods.windupMul > 0 ? 0 : 0);
          this.cooldown = ENEMY.recoveryMin + Math.random() * (ENEMY.recoveryMax - ENEMY.recoveryMin) * agg;
        }
        break;

      case 'broken':
        this.brokenTimer -= dt;
        if (this.brokenTimer <= 0) {
          this.state = 'ready';
          this.t = 0;
          this.posture = 0;
          this.cooldown = Math.max(this.cooldown, 0.5);
        }
        break;

      case 'stagger':
      case 'block':
      case 'knockdown':
        if (this.t <= 0) {
          this.state = 'ready';
          this.t = 0;
          this.cooldown = Math.max(this.cooldown, 0.25);
        }
        break;

      default:
        break;
    }
  }

  private emitHit(weapon: WeaponDef, damage: number): void {
    const def = this.current;
    if (!def) return;
    this.pendingHit = {
      damage: damage * def.damageMul,
      stagger: weapon.stagger * def.postureMul,
      reach: weapon.reach * def.reachMul,
      halfArc: weapon.arc * def.arcMul,
      unblockable: def.intent === 'unblockable',
      ranged: def.ranged,
      intent: def.intent,
      areaRadius: def.areaRadius,
      projectiles: Math.max(1, def.projectiles),
      index: this.hitsDone,
      knockbackMul: def.knockbackMul,
      projectileKind: def.projectileKind,
    };
    this.hitsDone++;
  }
}
