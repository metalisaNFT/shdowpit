/**
 * Resolves every blow in the game.
 *
 * The player and the enemies only decide *when* a hit window opens; this file
 * decides what that window touches, applies powers and traits, and fires all
 * the feedback (hit stop, shake, particles, sound) that makes it land.
 */

import * as THREE from 'three';
import type { GameLoop } from '../core/GameLoop';
import type { AudioManager } from '../audio/AudioManager';
import type { Particles } from '../fx/Particles';
import type { VFX } from '../fx/VFX';
import type { DamageFloatKind, DamageNumbers } from '../fx/DamageNumbers';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import type { Arena } from '../world/Arena';
import type { PlayerHabits } from '../core/SaveSystem';
import { Player } from '../player/Player';
import { Enemy } from '../enemy/Enemy';
import { arcHits, isBehind, radiusHits } from './Hitbox';
import type { Combatant, DamageInfo, DamageResult } from './Types';
import { chooseAttack, type AttackIntent, type ProjectileKind } from '../data/attacks';
import { PLAYER, POSTURE, RANGED, PROJ, POISON, STAGGER, HEAL_ECON, EXECUTION_RULES, SKILLS, ULTIMATE } from '../data/balance';
import { SIGNAL } from '../data/palette';
import type { Telemetry } from '../core/Telemetry';
import { canProc, withChannel } from './ProcRules';
import type { RunState } from '../run/RunState';
import { hasReaction } from '../abilities/Reactions';
import type { AbilityRuntime } from '../abilities/AbilityRuntime';
import { getSkill, profileFor, type SkillId } from '../data/skills';
import {
  enemiesAlongSegment,
  enemiesInCone,
  enemiesInDisk,
  pickTetherTarget,
  scaledDistance,
  scaledRadius,
} from '../abilities/SkillTargeting';
import { rankIndex } from '../nemesis/Nemesis';

export interface CombatCallbacks {
  onEnemyKilled(e: Enemy, executed: boolean): void;
  onPlayerKilled(killer: Enemy | null): void;
  onPlayerDamaged(from: Enemy | null, amount: number): void;
  onParrySuccess(e: Enemy): void;
  onEnemyStaggered(e: Enemy): void;
  onHabit(key: keyof PlayerHabits, amount?: number): void;
  onExecutionStarted(e: Enemy): void;
  /** a blow was slipped at the last moment */
  onPerfectDodge?(e: Enemy): void;
  /** an enemy's posture broke — they are open and executable */
  onPostureBroken?(e: Enemy): void;
  onInterrupt?(e: Enemy): void;
  onProcNote?(text: string): void;
}

/**
 * One projectile kind is one question. See data/attacks.ts:
 *   bolt/spread/charged/ground come from enemies; 'needle' is the player's.
 */
interface Projectile {
  mesh: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  ownerUid: number;
  targetsPlayer: boolean;
  kind: ProjectileKind | 'needle';
  /** the parry contract this projectile honours */
  intent: AttackIntent;
  gravity: number;
  radius: number;
  /* player-needle payload */
  pierceLeft: number;
  chainLeft: number;
  slowFactor: number;
  slowDuration: number;
  poison: number;
  postureMul: number;
  critical: boolean;
  /** enemies already struck (pierce/chain must not double-hit) */
  hitUids: number[];
  /** a charged shot keeps flying after striking the player */
  struckPlayer: boolean;
}

/** A lingering toxic zone on the floor. The zone is the danger. */
interface Hazard {
  x: number;
  z: number;
  r: number;
  life: number;
  maxLife: number;
  dps: number;
  owner: 'enemy' | 'player';
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  tick: number;
}

export class CombatSystem {
  private projectiles: Projectile[] = [];
  private hazards: Hazard[] = [];
  private arrowGeo = new THREE.BoxGeometry(0.09, 0.09, 1.1);
  private orbGeo = new THREE.IcosahedronGeometry(1, 1);
  private needleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.8);
  private zoneRingGeo = new THREE.RingGeometry(0.9, 1, 40);
  private zoneFillGeo = new THREE.CircleGeometry(1, 32);
  private arrowMat = new THREE.MeshBasicMaterial({ color: SIGNAL.parryable, toneMapped: false, fog: false });
  private spreadMat = new THREE.MeshBasicMaterial({ color: SIGNAL.enemyAttack, toneMapped: false, fog: false });
  private pierceMat = new THREE.MeshBasicMaterial({ color: SIGNAL.unblockable, toneMapped: false, fog: false });
  private lobMat = new THREE.MeshBasicMaterial({ color: SIGNAL.poison, toneMapped: false, fog: false });
  private needleMat = new THREE.MeshBasicMaterial({ color: SIGNAL.player, toneMapped: false, fog: false });
  private tmp = new THREE.Vector3();
  /**
   * Set by Game. Records every blow that lands on the player with enough
   * context to judge whether it was fair — see core/Telemetry.ts.
   */
  telemetry: Telemetry | null = null;
  run: RunState | null = null;
  lastKillChannel: DamageInfo['channel'] = 'primary';
  lastKillPlayerCredit = true;
  combatClock = 0;
  abilities: AbilityRuntime | null = null;
  lockUid: number | null = null;
  private lastStepX = 0;
  private lastStepZ = 0;
  private skillArmed = false;

  /** enemies that have been executed this frame, for the caller */
  constructor(
    private player: Player,
    private enemies: Enemy[],
    private arena: Arena,
    private particles: Particles,
    private vfx: VFX,
    private floats: DamageNumbers,
    private audio: AudioManager,
    private loop: GameLoop,
    private camera: ThirdPersonCamera,
    private scene: THREE.Object3D,
    private cb: CombatCallbacks
  ) {}

  setEnemies(list: Enemy[]): void {
    this.enemies = list;
  }

  /* ============================================================
     frame
     ============================================================ */

  update(dt: number): void {
    this.combatClock += dt;
    this.resolvePlayerSwing();
    this.resolvePlayerRanged();
    this.resolvePlayerSkills();
    this.resolvePlayerExecution();
    this.resolveEnemySwings(dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateBurning(dt);
    this.updateTrails();
    this.reapDotKills();
  }

  private reapDotKills(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.hp > 0.011) continue;
      if (e.poisonTimer > 0 || e.burning > 0) {
        e.hp = 0;
        this.killEnemy(
          e,
          false,
          undefined,
          withChannel(
            {
              amount: 1,
              source: 'fire',
              stagger: 0,
              attacker: this.player,
              fromX: e.position.x,
              fromZ: e.position.z,
            },
            'dot',
            true
          )
        );
      }
    }
  }

  /* ============================================================
     player offence
     ============================================================ */

  private resolvePlayerSwing(): void {
    const hit = this.player.combat.pendingHit;
    if (!hit) return;
    const p = this.player;
    const stats = p.stats;

    this.cb.onHabit(hit.kind === 'heavy' ? 'heavy' : 'light');
    this.audio.play('swing', { volume: 0.5, pitch: hit.kind === 'heavy' ? 0.7 : 1.15 });
    this.vfx.slash(
      p.position.x,
      1.1,
      p.position.z,
      p.facing,
      hit.reach * 0.9,
      hit.halfArc,
      hit.kind === 'heavy' ? 0xffb020 : 0x9fe8ff
    );

    let anyHit = false;
    const q = { x: p.position.x, z: p.position.z, facing: p.facing, reach: hit.reach, halfArc: hit.halfArc };

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!arcHits(q, e.position.x, e.position.z, e.radius)) continue;

      const behind = isBehind(e.facing, p.position.x, p.position.z, e.position.x, e.position.z);
      if (behind) this.cb.onHabit('backstab');

      let damage = hit.damage;
      let stagger = hit.stagger;
      if (stats.techniques.includes('gs_breaker') && hit.kind === 'heavy' && e.combat.attacking) {
        stagger *= 1.2;
      }
      if (p.combat.consumeStepMark(e.uid)) {
        stagger += SKILLS.markPosture;
        this.vfx.impact('posture_break', e.position.x, 1.15, e.position.z);
        this.audio.play('stagger', { volume: 0.45, pitch: 1.4, minGap: 0.08 });
      }
      // BLOOD DEBT — the ones who have killed you before bleed harder.
      if (stats.powers.has('blood_debt') && e.nemesis.killsAgainstPlayer > 0) damage *= 1.75;
      if (stats.powers.has('hunters_mark') && e.named) damage *= 1.2;
      // EXECUTION POWER — broken enemies take extra from everything.
      if (e.combat.broken) damage *= stats.stat('executionPower');
      // Crits are rolled per target so multi-hit sweeps sparkle.
      const crit = stats.rollCrit();
      if (crit) damage *= stats.critMultiplier;

      // POSTURE HUNTER — a flinched enemy's guard is already open.
      const hunter = stats.powers.has('posture_hunter') && e.combat.state === 'stagger' ? 1.6 : 1;

      const info: DamageInfo = {
        amount: damage,
        source: hit.kind === 'heavy' ? 'heavy' : 'light',
        stagger,
        attacker: p,
        fromX: p.position.x,
        fromZ: p.position.z,
        knockback: hit.knockback * stats.stat('knockback'),
        fromBehind: behind,
        ignite: hit.ignite,
        critical: crit,
        postureMul: stats.stat('postureDamage') * hunter,
        poison: stats.powers.has('toxic_edge') ? POISON.buildupMelee * stats.stat('poisonDamage') : 0,
        channel: 'primary',
        grantsPlayerKill: true,
        slowFactor: this.player.stats.techniques.includes('spear_chase') && this.player.combat.dashStrike ? 0.7 : undefined,
        slowDuration: 1.1,
      };
      if (e.combat.state === 'windup' || e.combat.state === 'hold') this.cb.onInterrupt?.(e);
      const res = this.strike(e, info);

      if (res.dodged) {
        this.particles.dust(e.position.x, 0.4, e.position.z, 6);
        this.audio.play('dodge', { volume: 0.4 });
        continue;
      }
      if (res.blocked) {
        this.audio.play('block', { volume: 0.7, pitch: 1 });
        // ARMOR HIT: grey sparks + flat white flash — reads "that bounced"
        this.vfx.impact('armor', e.position.x, 1.2, e.position.z);
        this.camera.shake(0.06);
        anyHit = true;
        continue;
      }

      anyHit = true;
      if (this.telemetry) {
        this.telemetry.pushHit({
          attacker: 'player',
          target: `e${e.uid}`,
          amount: res.applied,
          source: hit.kind,
          dist: Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z),
          reach: hit.reach,
          parried: false,
          dodged: res.dodged,
          blocked: res.blocked,
          victimAction: e.combat.state,
          unblockable: false,
        });
      }
      this.onDamageFeedback(e, res.applied, hit.kind, res.critical, hit.ignite);
      this.afterPlayerHit(e, res, hit.kind === 'heavy', info);

      if (stats.powers.has('leech') && canProc(info, 'leech')) {
        const healed = stats.heal(Math.min(HEAL_ECON.leechCapPerHit, 1 + stats.powers.count('leech')), 'leech');
        if (healed > 0) this.audio.play('heal', { volume: 0.15, minGap: 0.4 });
      }
      if (stats.powers.has('momentum') && canProc(info, 'momentum')) {
        stats.momentum = Math.min(stats.momentumMax, stats.momentum + 1);
      }
      this.grantSurge(hit.kind === 'heavy' ? PLAYER.surgeOnHeavyHit : PLAYER.surgeOnHit, hit.kind === 'heavy' ? 'heavy' : 'light');
      if (res.killed) {
        this.killEnemy(e, false, undefined, info);
      }
    }

    // VOID TOOTH — light finisher pierces to a second target in line.
    if (hit.kind === 'light' && p.combat.comboIndex === 2 && stats.techniques.includes('tooth_pierce')) {
      const extraReach = hit.reach * 1.35;
      const q2 = { x: p.position.x, z: p.position.z, facing: p.facing, reach: extraReach, halfArc: 0.28 };
      let pierced = 0;
      for (const e of this.enemies) {
        if (!e.alive || pierced >= 1) continue;
        if (!arcHits(q2, e.position.x, e.position.z, e.radius)) continue;
        if (arcHits(q, e.position.x, e.position.z, e.radius)) continue;
        pierced++;
        const info: DamageInfo = {
          amount: hit.damage * 0.7,
          source: 'light',
          stagger: hit.stagger * 0.6,
          attacker: p,
          fromX: p.position.x,
          fromZ: p.position.z,
          knockback: 2,
          channel: 'secondary',
          grantsPlayerKill: true,
        };
        const res = this.strike(e, info);
        if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'light', false, false);
        if (res.killed) this.killEnemy(e, false, undefined, info);
      }
    }

    if (anyHit) {
      this.loop.hitStop(hit.kind === 'heavy' ? 0.085 : 0.045);
      this.camera.shake(hit.kind === 'heavy' ? 0.34 : 0.16);
    }

    // SHOCKWAVE — heavies blast outward.
    if (hit.kind === 'heavy' && stats.powers.has('shockwave')) {
      this.shockwave(p.position.x, p.position.z, 7.2, hit.damage * 0.55, 34);
    }
    // ECHO — a second, delayed strike.
    if (hit.kind === 'heavy' && stats.powers.has('echo')) {
      const fx = p.position.x;
      const fz = p.position.z;
      const facing = p.facing;
      window.setTimeout(() => {
        if (!this.player.alive) return;
        this.delayedArc(fx, fz, facing, hit.reach, hit.halfArc, hit.damage * 0.6);
      }, 190);
    }
  }

  private delayedArc(x: number, z: number, facing: number, reach: number, halfArc: number, damage: number): void {
    this.vfx.slash(x, 1.2, z, facing, reach * 0.9, halfArc, 0xffe08a);
    const q = { x, z, facing, reach, halfArc };
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!arcHits(q, e.position.x, e.position.z, e.radius)) continue;
      const res = this.strike(e, {
        amount: damage,
        source: 'heavy',
        stagger: hasReaction(this.player.stats.powers, 'posture_echo') ? 22 : 8,
        attacker: this.player,
        fromX: x,
        fromZ: z,
        knockback: 2,
        channel: 'secondary',
        grantsPlayerKill: true,
        postureMul: hasReaction(this.player.stats.powers, 'posture_echo') ? 1.8 : 1,
      });
      if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'heavy', false, false);
      this.afterPlayerHit(e, res, true);
      if (res.killed) this.killEnemy(e, false, undefined, {
        amount: damage, source: 'heavy', stagger: 8, attacker: this.player, fromX: x, fromZ: z, channel: 'secondary', grantsPlayerKill: true,
      });
    }
  }

  /** Radial blast used by SHOCKWAVE and other effects. */
  shockwave(x: number, z: number, radius: number, damage: number, stagger: number): void {
    this.vfx.ring(x, 0.05, z, 0xffb020, 0.6, radius, 0.45);
    this.particles.burst(x, 0.6, z, 22, 0xffc46a, 9, { size: 0.14, life: 0.5 });
    this.audio.play('shockwave', { volume: 0.8 });
    this.camera.shake(0.5);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!radiusHits(x, z, radius, e.position.x, e.position.z, e.radius)) continue;
      const info: DamageInfo = {
        amount: damage,
        source: 'blast',
        stagger,
        attacker: this.player,
        fromX: x,
        fromZ: z,
        knockback: 9,
        channel: 'secondary',
        grantsPlayerKill: true,
      };
      if (hasReaction(this.player.stats.powers, 'poison_shockwave')) {
        info.poison = 18 * this.player.stats.stat('poisonDamage');
        if (e.poisoned) info.poison += 24;
        this.cb.onProcNote?.('PLAGUE WAVE');
      }
      const res = this.strike(e, info);
      if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'heavy', false, false);
      this.afterPlayerHit(e, res, true);
      if (res.killed) this.killEnemy(e, false, undefined, info);
    }
  }

  /**
   * The needle exists to interact with enemies the sword cannot reach: it
   * slows runners, punishes windups, trips escapees. Modest damage on
   * purpose — interruption is the payload (see RANGED in data/balance.ts).
   */
  private resolvePlayerRanged(): void {
    const p = this.player;
    if (!p.combat.pendingRanged) return;

    const stats = p.stats;
    const count = Math.max(1, Math.round(stats.stat('projCount')));
    const speed = RANGED.speed * stats.stat('projSpeed');

    // Soft aim: the nearest live enemy inside a narrow cone of the facing,
    // else straight ahead. The needle is a tool, not a sniper rifle.
    const fx = -Math.sin(p.facing);
    const fz = -Math.cos(p.facing);
    let aimX = fx;
    let aimZ = fz;
    let best = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.position.x - p.position.x;
      const dz = e.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5 || d > RANGED.aimRange) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < Math.cos(RANGED.aimCone)) continue;
      const score = dot * 3 - d * 0.05;
      if (score > best) {
        best = score;
        aimX = dx / d;
        aimZ = dz / d;
      }
    }

    this.cb.onHabit('ranged');
    this.audio.play('bow', { volume: 0.5, pitch: 1.5, minGap: 0.05 });

    const crippling = stats.powers.has('crippling_bolt');
    const pierce = Math.round(stats.stat('pierce')) + stats.powers.count('piercing_shard');
    const chain = Math.round(stats.stat('chain')) + stats.powers.count('chain_shard');
    const baseYaw = Math.atan2(-aimX, -aimZ);

    for (let i = 0; i < count; i++) {
      // Extra needles fan out around the aim line.
      const off = count > 1 ? (i - (count - 1) / 2) * 0.09 : 0;
      const yaw = baseYaw + off;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const crit = stats.rollCrit();

      const mesh = new THREE.Mesh(this.needleGeo, this.needleMat);
      mesh.position.set(p.position.x + dirX * 0.6, 1.35, p.position.z + dirZ * 0.6);
      mesh.lookAt(p.position.x + dirX * 10, 1.35, p.position.z + dirZ * 10);
      this.scene.add(mesh);

      this.projectiles.push({
        mesh,
        x: mesh.position.x,
        y: 1.35,
        z: mesh.position.z,
        vx: dirX * speed,
        vy: 0,
        vz: dirZ * speed,
        life: RANGED.projectileLife,
        damage: RANGED.damage * stats.rangedDamageMultiplier() * (crit ? stats.critMultiplier : 1),
        ownerUid: p.uid,
        targetsPlayer: false,
        kind: 'needle',
        intent: 'normal',
        gravity: 0,
        radius: 0.35,
        pierceLeft: pierce,
        chainLeft: chain,
        slowFactor: crippling ? 0.42 : RANGED.slowFactor,
        slowDuration: crippling ? 2.8 : RANGED.slowDuration,
        poison: stats.powers.has('toxic_shot') ? POISON.buildupShot * stats.stat('poisonDamage') : 0,
        postureMul: stats.stat('postureDamage') * (stats.powers.has('interruptor') ? 2.4 : 1),
        critical: crit,
        hitUids: [],
        struckPlayer: false,
      });
    }
  }

  /** One needle strikes one enemy. Returns true if the needle should stop. */
  private needleHit(a: Projectile, e: Enemy): boolean {
    const stats = this.player.stats;
    a.hitUids.push(e.uid);

    let damage = a.damage;
    if (e.combat.broken) damage *= stats.stat('executionPower');

    const res = this.strike(e, {
      amount: damage,
      source: 'ranged',
      stagger: RANGED.posture,
      attacker: this.player,
      fromX: a.x,
      fromZ: a.z,
      knockback: 1.5 * stats.stat('knockback'),
      critical: a.critical,
      slowFactor: a.slowFactor,
      slowDuration: a.slowDuration,
      poison: a.poison,
      postureMul: a.postureMul,
    });

    if (res.applied > 0) {
      this.vfx.impact('projectile', a.x, a.y, a.z);
      this.audio.play('arrow_hit', { volume: 0.5, pitch: 1.4, minGap: 0.05 });
      this.grantSurge(2, 'needle');
      this.afterPlayerHit(e, res, false);
      if (stats.techniques.includes('sword_needle_bind') && this.player.combat.parryActive) {
        stats.rangedCharges = Math.min(stats.maxRangedCharges, stats.rangedCharges + 1);
        this.cb.onProcNote?.('NEEDLE BIND');
      }
    }
    if (this.telemetry) {
      this.telemetry.pushHit({
        attacker: 'player',
        target: `e${e.uid}`,
        amount: res.applied,
        source: 'needle',
        dist: Math.hypot(this.player.position.x - e.position.x, this.player.position.z - e.position.z),
        reach: -1,
        parried: false,
        dodged: res.dodged,
        blocked: res.blocked,
        victimAction: e.combat.state,
        unblockable: false,
      });
    }
    if (res.killed) this.killEnemy(e, false);

    /* CHAIN — jump to the nearest fresh enemy */
    if (a.chainLeft > 0) {
      let target: Enemy | null = null;
      let bestD = 10;
      for (const other of this.enemies) {
        if (!other.alive || other.uid === e.uid || a.hitUids.includes(other.uid)) continue;
        const d = Math.hypot(other.position.x - a.x, other.position.z - a.z);
        if (d < bestD) {
          bestD = d;
          target = other;
        }
      }
      if (target) {
        a.chainLeft--;
        const dx = target.position.x - a.x;
        const dz = target.position.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        const s = Math.hypot(a.vx, a.vz);
        a.vx = (dx / l) * s;
        a.vz = (dz / l) * s;
        a.vy = 0;
        a.life = Math.max(a.life, 0.6);
        this.vfx.flash(a.x, a.y, a.z, SIGNAL.player, 0.4, 0.08);
        return false;
      }
    }
    /* PIERCE — keep flying */
    if (a.pierceLeft > 0) {
      a.pierceLeft--;
      return false;
    }
    return true;
  }

  /* ============================================================
     executions
     ============================================================ */

  /* ============================================================
     active skills
     ============================================================ */

  private resolvePlayerSkills(): void {
    const p = this.player;
    const c = p.combat;
    if (c.action !== 'skill' && c.action !== 'ultimate') {
      this.skillArmed = false;
      return;
    }
    const id = (c.skillId ?? 'shadow_step') as SkillId;
    const def = getSkill(id);
    const prof = profileFor(def, p.stats.weaponId);
    const mom = p.stats.powers.has('momentum') ? 1 + p.stats.momentum * 0.02 : 1;
    const empower = this.abilities?.nextEmpowered && id !== 'pit_eruption';

    if (c.phase === 'windup' && !this.skillArmed) {
      this.skillArmed = true;
      this.lastStepX = p.position.x;
      this.lastStepZ = p.position.z;
      if (id === 'ground_rupture' || id === 'pit_eruption') {
        const r = scaledRadius(def, prof, mom);
        this.vfx.crackDecal(p.position.x, p.position.z, r * 0.55, id === 'pit_eruption' ? 0xe4ff2b : 0xa14cff, 0.9);
        this.vfx.ring(p.position.x, 0.06, p.position.z, 0xa14cff, 0.4, r, c.skillWindup + 0.05, 0.7);
        this.audio.play('skill_cast', { volume: 0.55, pitch: id === 'pit_eruption' ? 0.7 : 0.9 });
      } else if (id === 'shadow_step') {
        this.vfx.ring(p.position.x, 0.05, p.position.z, 0xa14cff, 0.2, 1.6, 0.22, 0.55);
        this.audio.play('skill_cast', { volume: 0.4, pitch: 1.3 });
      } else {
        this.audio.play('skill_cast', { volume: 0.45, pitch: 1.05 });
      }
    }

    if (id === 'shadow_step' && c.phase === 'active') {
      const crossed = enemiesAlongSegment(
        this.enemies,
        this.lastStepX,
        this.lastStepZ,
        p.position.x,
        p.position.z,
        scaledRadius(def, prof, mom)
      );
      this.lastStepX = p.position.x;
      this.lastStepZ = p.position.z;
      const markT = SKILLS.markDuration * (empower ? 1.4 : 1);
      for (const e of crossed) {
        c.stepMarks.set(e.uid, markT);
        this.vfx.flash(e.position.x, 1.1, e.position.z, 0xa14cff, 0.45, 0.1);
        if (p.stats.powers.has('ember')) e.burning = Math.max(e.burning, 2.2);
      }
      this.vfx.flash(p.position.x, 1.0, p.position.z, 0x6a3cff, 0.35, 0.08);
    }

    if (!c.pendingSkillHit) return;
    this.abilities?.nextEmpowered && id !== 'pit_eruption' && (this.abilities.nextEmpowered = false);

    if (id === 'ground_rupture') this.fireRupture(def, prof, mom, !!empower);
    else if (id === 'void_grasp') this.fireGrasp(def, prof, mom, !!empower);
    else if (id === 'pit_eruption') this.fireEruption(def, prof, mom);
  }

  private fireRupture(def: ReturnType<typeof getSkill>, prof: ReturnType<typeof profileFor>, mom: number, empower: boolean): void {
    const p = this.player;
    const r = scaledRadius(def, prof, mom);
    const reach = Math.max(r, scaledDistance(def, prof, mom) || r);
    this.vfx.shockwave(p.position.x, p.position.z, prof.fissure ? reach * 0.7 : r, 0xa14cff);
    this.audio.play('shockwave', { volume: 0.7, pitch: 0.85 });
    this.loop.hitStop(0.06);
    this.camera.shake(0.42);
    const targets = prof.fissure
      ? enemiesInCone(this.enemies, p.position.x, p.position.z, p.facing, reach * 1.6, 0.42)
      : enemiesInDisk(this.enemies, p.position.x, p.position.z, r, 10);
    let i = 0;
    const posture = def.posture * prof.postureMul * (empower ? SKILLS.perfectEmpowerPosture : 1);
    for (const e of targets) {
      const armored = e.combat.current && !e.combat.current.interruptible && (e.combat.state === 'windup' || e.combat.state === 'hold' || e.combat.state === 'active');
      const info: DamageInfo = {
        amount: p.weapon.damage * def.damageMul * prof.damageMul * p.stats.meleeDamageMultiplier(),
        source: 'skill',
        stagger: armored ? posture * 0.35 : posture,
        attacker: p,
        fromX: p.position.x,
        fromZ: p.position.z,
        knockback: def.knockback * e.combat.displaceScale(),
        channel: i === 0 ? 'primary' : 'area',
        grantsPlayerKill: true,
        poison: p.stats.powers.has('toxic_edge') ? POISON.buildupMelee * 0.6 : 0,
        ignite: p.stats.powers.has('ember'),
      };
      i++;
      const res = this.strike(e, info);
      if (res.applied > 0) {
        this.onDamageFeedback(e, res.applied, 'heavy', false, !!info.ignite);
        this.afterPlayerHit(e, res, true, info);
        this.abilities?.logHit('ground_rupture', `d${Math.round(res.applied)}`);
        this.telemetry?.noteSkillHit('ground_rupture', res.applied, posture);
        if (canProc(info, 'surge')) this.grantSurge(2, 'skill_hit');
      }
      if (res.killed) this.killEnemy(e, false, undefined, info);
    }
    if (p.stats.powers.has('toxic_edge')) {
      this.spawnHazard(p.position.x, p.position.z, r * 0.55, POISON.dps * 0.7, 2.4, 'player');
    }
  }

  private fireGrasp(def: ReturnType<typeof getSkill>, prof: ReturnType<typeof profileFor>, mom: number, empower: boolean): void {
    const p = this.player;
    const range = scaledDistance(def, prof, mom);
    const target = pickTetherTarget(
      this.enemies,
      { x: p.position.x, z: p.position.z, facing: p.facing, lockUid: this.lockUid },
      this.arena,
      range,
      def.halfArc
    );
    if (!target) {
      this.audio.play('skill_fail', { volume: 0.4, pitch: 0.7 });
      this.vfx.flash(p.position.x, 1.2, p.position.z, 0x5544aa, 0.4, 0.1);
      this.cb.onProcNote?.('NO TARGET');
      return;
    }
    const ri = rankIndex(target.nemesis.rank);
    const heavy = target.nemesis.archetype === 'heavy' || ri >= 3;
    const protectedBoss = ri >= 4 || (target.combat.current && !target.combat.current.interruptible && target.combat.state !== 'ready');
    this.vfx.slash(p.position.x, 1.2, p.position.z, p.facing, range * 0.5, 0.2, 0xa14cff, 0.2);
    this.vfx.flash(target.position.x, 1.3, target.position.z, 0xa14cff, 0.7, 0.14);
    this.audio.play('skill_hit', { volume: 0.65, pitch: 0.9 });

    if (protectedBoss) {
      this.floats.spawnOn(target, 'RESIST', 'block');
      target.applySlow(0.7, 0.8);
      return;
    }

    if (heavy) {
      const dx = target.position.x - p.position.x;
      const dz = target.position.z - p.position.z;
      const len = Math.hypot(dx, dz) || 1;
      p.controller.knockback(dx / len, dz / len, 14);
      p.combat.skillMoveX = (dx / len) * 18;
      p.combat.skillMoveZ = (dz / len) * 18;
    } else {
      target.pullToward(p.position.x, p.position.z, 22);
      if (p.stats.powers.has('posture_hunter') && target.combat.interruptible) {
        target.combat.stagger(0.4);
        this.cb.onInterrupt?.(target);
      }
    }

    const info: DamageInfo = {
      amount: p.weapon.damage * def.damageMul * p.stats.meleeDamageMultiplier(),
      source: 'skill',
      stagger: def.posture * prof.postureMul * (empower ? SKILLS.perfectEmpowerPosture : 1),
      attacker: p,
      fromX: p.position.x,
      fromZ: p.position.z,
      slowFactor: 0.55,
      slowDuration: 1.1,
      channel: 'primary',
      grantsPlayerKill: true,
    };
    const res = this.strike(target, info);
    if (res.applied > 0) {
      this.onDamageFeedback(target, res.applied, 'light', false, false);
      this.afterPlayerHit(target, res, false, info);
      this.telemetry?.noteSkillHit('void_grasp', res.applied, info.stagger);
      if (canProc(info, 'surge')) this.grantSurge(2, 'skill_hit');
    }
    if (res.killed) this.killEnemy(target, false, undefined, info);
  }

  private fireEruption(def: ReturnType<typeof getSkill>, prof: ReturnType<typeof profileFor>, mom: number): void {
    const p = this.player;
    const r = scaledRadius(def, prof, mom);
    this.loop.slowMo(ULTIMATE.slowMo, ULTIMATE.slowMoScale);
    this.camera.shake(0.7);
    this.vfx.shockwave(p.position.x, p.position.z, r, 0xe4ff2b);
    this.vfx.ring(p.position.x, 0.08, p.position.z, 0xffffff, 0.6, r * 1.05, 0.45, 0.8);
    this.audio.play('ultimate', { volume: 1, pitch: 0.85 });
    this.loop.hitStop(0.1);
    const heavyDmg = p.weapon.damage * 1.95 * p.stats.meleeDamageMultiplier();
    const cap = heavyDmg * ULTIMATE.namedDamageCapMul;
    const targets = enemiesInDisk(this.enemies, p.position.x, p.position.z, r, ULTIMATE.maxTargets);
    let i = 0;
    for (const e of targets) {
      const named = e.named;
      let amount = p.weapon.damage * def.damageMul * prof.damageMul * p.stats.meleeDamageMultiplier();
      if (named) amount = Math.min(amount, cap);
      const held = e.combat.current && !e.combat.current.interruptible && (e.combat.state === 'hold' || e.combat.state === 'active');
      const info: DamageInfo = {
        amount,
        source: 'skill',
        stagger: named ? ULTIMATE.namedPosture : def.posture * prof.postureMul,
        attacker: p,
        fromX: p.position.x,
        fromZ: p.position.z,
        knockback: named ? 3 : def.knockback,
        channel: i === 0 ? 'primary' : 'area',
        grantsPlayerKill: true,
      };
      i++;
      const res = this.strike(e, info);
      if (!held && !named) e.combat.stagger(0.55 * e.combat.displaceScale());
      else if (named && !held) e.combat.stagger(ULTIMATE.namedStagger);
      if (res.applied > 0) {
        this.onDamageFeedback(e, res.applied, 'heavy', false, false);
        this.afterPlayerHit(e, res, true, info);
        this.telemetry?.noteSkillHit('pit_eruption', res.applied, info.stagger);
      }
      if (res.killed) this.killEnemy(e, false, undefined, info);
    }
    this.abilities?.logHit('pit_eruption', `${targets.length} targets`);
  }

  private grantSurge(amount: number, source: string, notable = false): void {
    if (amount <= 0) return;
    const gained = this.player.stats.addSurge(amount);
    this.telemetry?.noteSurge(source, gained);
    if (notable && gained >= 10) this.cb.onProcNote?.(`${source.replace(/_/g, ' ').toUpperCase()} +${Math.round(gained)} SURGE`);
    if (this.player.stats.surge >= this.player.stats.surgeMax - 0.01 && gained > 0) {
      this.audio.play('surge_full', { volume: 0.45, pitch: 1, minGap: 2.5 });
    }
  }

  /** Nearest enemy the player could execute right now. */
  findExecutable(): Enemy | null {
    const p = this.player;
    let best: Enemy | null = null;
    // EXECUTION POWER stretches the reach of the kill.
    let bestD = 3.4 + (p.stats.stat('executionPower') - 1) * 2;
    for (const e of this.enemies) {
      if (!e.alive || !e.executable) continue;
      const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private resolvePlayerExecution(): void {
    const c = this.player.combat;
    if (!c.executeStrike || c.executeTarget === null) return;
    const target = this.enemies.find((e) => e.uid === c.executeTarget);
    if (!target || !target.alive) return;

    // EXECUTION WARD — they break out. Once.
    if (target.executionWardAvailable) {
      target.executionWardAvailable = false;
      target.hp = Math.max(target.hp, Math.round(target.maxHp * 0.28));
      target.combat.stagger(0.2);
      this.player.combat.stagger();
      this.audio.play('block', { volume: 1 });
      this.camera.shake(0.5);
      this.particles.burst(target.position.x, 1.2, target.position.z, 24, 0xffffff, 11, { size: 0.16 });
      return;
    }

    this.cb.onHabit('execute');
    this.cb.onExecutionStarted(target);
    this.loop.hitStop(target.named ? 0.22 : 0.16);
    this.loop.slowMo(0.5, 0.35);
    this.camera.shake(0.95);
    this.audio.play('execute', { volume: 1 });
    this.vfx.impact('execute', target.position.x, 1.2, target.position.z);

    if (target.burning > 0 && this.player.stats.techniques.includes('ash_execute')) {
      this.vfx.flash(target.position.x, 1.2, target.position.z, SIGNAL.unblockable, 1.1, 0.16);
      this.shockwave(target.position.x, target.position.z, 4.2, 22, 16);
    }

    // TOXIC DETONATION — a poisoned kill contaminates the ground and the crowd.
    const wasPoisoned = target.poisoned;
    target.hp = 0;
    this.killEnemy(target, true, undefined, {
      amount: 999,
      source: 'execute',
      stagger: 0,
      attacker: this.player,
      fromX: this.player.position.x,
      fromZ: this.player.position.z,
      channel: 'primary',
      grantsPlayerKill: true,
    });

    const stats = this.player.stats;
    const named = target.named;
    const allow = (id: string) => this.executionAllowed(id, named);

    if (wasPoisoned && stats.powers.has('toxic_detonation') && allow('toxic_detonation')) {
      const px = target.position.x;
      const pz = target.position.z;
      const dmg = POISON.detonateDamage * stats.stat('poisonDamage');
      this.particles.burst(px, 1.1, pz, 30, SIGNAL.poison, 12, { size: 0.16, life: 0.7 });
      this.vfx.flash(px, 1.2, pz, SIGNAL.poison, 1.2, 0.18);
      for (const e of this.enemies) {
        if (!e.alive || e === target) continue;
        if (!radiusHits(px, pz, POISON.detonateRadius, e.position.x, e.position.z, e.radius)) continue;
        const res = this.strike(e, {
          amount: dmg,
          source: 'blast',
          stagger: 18,
          attacker: this.player,
          fromX: px,
          fromZ: pz,
          knockback: 5,
          poison: 30,
        });
        if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'heavy', false, false);
        this.afterPlayerHit(e, res, true);
        if (res.killed) this.killEnemy(e, false);
      }
      this.spawnHazard(px, pz, POISON.detonateRadius * 0.7, POISON.dps * stats.stat('poisonDamage'), 3.2, 'player');
    }

    if (stats.powers.has('execution_surge') && allow('execution_surge')) {
      this.grantSurge(30, 'execution_surge', true);
    }
    this.grantSurge(PLAYER.surgeOnExecute, 'execute', true);
    if (named) this.abilities?.namedExecuteRefund();

    if (stats.powers.has('vulture') && allow('vulture')) {
      const amt = named ? HEAL_ECON.vultureBase : HEAL_ECON.vultureBase * HEAL_ECON.vultureFalloff;
      const healed = stats.heal(amt, 'vulture');
      if (healed) this.audio.play('heal', { volume: 0.6 });
    }
    if (stats.powers.has('predator') && allow('predator')) {
      stats.speedBuff = 0.55;
      stats.speedBuffTime = 6;
    }
    if (stats.powers.has('terror') && allow('terror')) {
      for (const e of this.enemies) {
        if (!e.alive || e === target) continue;
        if (radiusHits(target.position.x, target.position.z, 14, e.position.x, e.position.z, e.radius)) {
          if (e.fleeThreshold !== -1) {
            if (hasReaction(stats.powers, 'terror_predator')) {
              e.escaping = false;
              e.huntedByPlayer = true;
              this.run && (this.run.pursuitTargetId = e.named ? e.nemesis.id : this.run.pursuitTargetId);
              this.cb.onProcNote?.('THE CHASE');
            } else e.escaping = true;
          }
        }
      }
      this.vfx.ring(target.position.x, 0.05, target.position.z, 0x9d7bff, 0.5, 14, 0.7, 0.5);
    }
    if (stats.powers.has('parasite') && allow('parasite') && target.named && target.nemesis.strengths.length) {
      const stolen = target.nemesis.strengths[0];
      if (!stats.stolenTraits.includes(stolen)) stats.stolenTraits.push(stolen);
      if (hasReaction(stats.powers, 'parasite_debt') && target.nemesis.killsAgainstPlayer > 0) {
        stats.stolenTraits.push('brutal');
        this.cb.onProcNote?.('BLOOD TITHE');
      }
    }
  }

  private executionAllowed(id: string, named: boolean): boolean {
    if (named) return true;
    const pri = this.run?.executionPayload;
    if (pri) return pri === id;
    for (const cand of EXECUTION_RULES.gruntPayloadPriority) {
      if (this.player.stats.powers.has(cand as 'vulture')) {
        if (!this.run) return cand === id;
        this.run.executionPayload = cand;
        return cand === id;
      }
    }
    return true;
  }

  /* ============================================================
     enemy offence
     ============================================================ */

  private resolveEnemySwings(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;

      // COMBO BREAKER — interrupt the third light swing, but only in range.
      if (
        e.mods.comboBreaker &&
        p.combat.action === 'attack' &&
        p.combat.attackKind === 'light' &&
        p.combat.comboIndex === 2 &&
        p.combat.phase === 'windup' &&
        e.combat.state === 'ready' &&
        e.combat.cooldown <= 0 &&
        Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z) < e.weapon.reach + 0.8
      ) {
        // COUNTERMASTER punishes a predictable third light swing. It uses a
        // real attack from the table so it still telegraphs honestly.
        const punish = chooseAttack({
          archetype: e.nemesis.archetype,
          rankIndex: 4,
          distance: Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z),
          reach: e.weapon.reach,
          aggression: 1,
          allowUnblockable: false,
          allowDelayed: false,
          rand: Math.random,
        });
        if (punish) e.combat.startAttack(punish, e.weapon, e.mods, punish.anticipation * 0.7);
      }

      const hit = e.combat.pendingHit;
      if (!hit) continue;

      if (hit.ranged) {
        const n = Math.max(1, hit.projectiles);
        for (let i = 0; i < n; i++) {
          // A spread fans in a cone with a walkable gap; other kinds fire one.
          const spread = n > 1 ? (i - (n - 1) / 2) * PROJ.spreadCone : 0;
          this.fireEnemyProjectile(e, hit.damage, hit.projectileKind, hit.intent, spread);
        }
        continue;
      }

      this.audio.play('swing', { volume: 0.28, pitch: 0.85, minGap: 0.08 });

      const isArea = hit.areaRadius > 0;
      const q = { x: e.position.x, z: e.position.z, facing: e.facing, reach: hit.reach, halfArc: hit.halfArc };
      if (isArea) {
        // The SLAM lands: BAM. Expanding shockwave, glowing ground cracks,
        // debris, dust, a camera impulse and a sliver of hit-stop — the payoff
        // the contracting floor ring promised, exactly where it promised it.
        this.vfx.shockwave(e.position.x, e.position.z, hit.areaRadius, SIGNAL.areaWarning);
        this.camera.shake(0.55);
        this.loop.hitStop(0.05);
        this.audio.play('shockwave', { volume: 0.75 });
      }

      // Enemy-vs-enemy: rivals genuinely hurt each other.
      if (e.rivalTarget && e.rivalTarget.alive) {
        const r = e.rivalTarget;
        if (arcHits(q, r.position.x, r.position.z, r.radius)) {
          const res = this.strike(r, {
            amount: hit.damage * 0.55,
            source: 'light',
            stagger: hit.stagger * 0.5,
            attacker: e,
            fromX: e.position.x,
            fromZ: e.position.z,
            knockback: 2,
            channel: 'eve',
            grantsPlayerKill: false,
          });
          if (res.applied > 0) {
            this.particles.burst(r.position.x, 1.2, r.position.z, 8, 0xff6a4a, 6, { size: 0.11, life: 0.35 });
            this.audio.play('light_hit', { volume: 0.3, minGap: 0.06 });
          }
          if (res.killed) this.killEnemy(r, false, e);
        }
      }

      if (!p.alive) continue;
      const connects = isArea
        ? radiusHits(e.position.x, e.position.z, hit.areaRadius, p.position.x, p.position.z, p.radius)
        : arcHits(q, p.position.x, p.position.z, p.radius);
      if (!connects) continue;

      /* ---- parry ----
         The colour contract, enforced here:
           cyan  (parryable)   the full parry window works
           amber (normal)      only a PERFECT parry catches it
           red   (unblockable) nothing catches it; move
         That is what makes cyan worth learning to recognise, and what stops
         parry from being a button you can simply hold down. */
      if (!hit.unblockable && p.combat.parryActive) {
        const offered = hit.intent === 'parryable';
        const perfect = p.combat.parryPerfect;
        if (offered || perfect) {
          this.onParry(e, perfect, offered);
          continue;
        }
      }

      /* ---- i-frames ---- */
      if (p.combat.invulnerable && !hit.unblockable) {
        // A dodge that began at the last moment is a PERFECT DODGE.
        if (p.combat.dodgePerfect) this.onPerfectDodge(e);
        else this.particles.dust(p.position.x, 0.5, p.position.z, 5);
        continue;
      }

      const behind = isBehind(p.facing, e.position.x, e.position.z, p.position.x, p.position.z);
      const hpBefore = p.stats.hp;
      const res = this.strike(p, {
        amount: hit.damage,
        source: 'light',
        stagger: hit.stagger,
        attacker: e,
        fromX: e.position.x,
        fromZ: e.position.z,
        knockback: (4 + hit.stagger * 0.1) * hit.knockbackMul,
        unblockable: hit.unblockable,
        fromBehind: behind,
      });

      if (this.telemetry) {
        const dist = Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z);
        this.telemetry.pushHit({
          attacker: `e${e.uid}`,
          target: 'player',
          amount: res.applied,
          source: 'melee',
          dist,
          reach: hit.reach,
          parried: res.parried,
          dodged: res.dodged,
          blocked: res.blocked,
          victimAction: p.combat.action,
          unblockable: !!hit.unblockable,
        });
      }

      if (res.applied > 0) {
        this.audio.play('player_hurt', { volume: 0.9 });
        this.camera.shake(0.42);
        this.loop.hitStop(0.05);
        this.particles.burst(p.position.x, 1.2, p.position.z, 14, 0xff3b21, 8, { size: 0.13, life: 0.45 });
        this.cb.onPlayerDamaged(e, res.applied);

        // THORNS answers back.
        if (p.stats.powers.has('thorns')) {
          const tr = this.strike(e, {
            amount: 12,
            source: 'thorns',
            stagger: 6,
            attacker: p,
            fromX: p.position.x,
            fromZ: p.position.z,
            channel: 'secondary',
            grantsPlayerKill: true,
          });
          if (tr.applied > 0) this.onDamageFeedback(e, tr.applied, 'light', false, false);
          if (tr.killed) this.killEnemy(e, false);
        }
      }

      if (res.killed) {
        this.telemetry?.pushDeath({
          killerName: e.displayName || 'a grunt',
          killerUid: e.uid,
          attackSource: 'melee',
          damage: res.applied,
          hpBefore,
          unblockable: !!hit.unblockable,
          parryable: !hit.unblockable,
          ranged: false,
          playerAction: p.combat.action,
          playerWasDodging: p.combat.action === 'dodge',
          playerWasParrying: p.combat.action === 'parry',
          playerWasStaggered: p.combat.action === 'stagger',
          distance: Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z),
        });
        this.cb.onPlayerKilled(e);
      }
    }
    void dt;
  }

  /**
   * A parry connects.
   *
   * A normal parry stops the blow and opens them briefly. A PERFECT parry —
   * caught in the first fraction of the window — is the best thing that can
   * happen to you in a fight: it does most of a posture bar's worth of damage,
   * pays Surge, arms a counter, and stops time for a moment so you feel it.
   */
  private onParry(e: Enemy, perfect: boolean, offered: boolean): void {
    const p = this.player;
    p.combat.onParrySuccess(perfect);
    this.cb.onHabit('parry');

    const mid = { x: (p.position.x + e.position.x) / 2, z: (p.position.z + e.position.z) / 2 };
    const colour = perfect ? SIGNAL.parryable : 0xcfefff;

    this.audio.play('parry', { volume: perfect ? 1 : 0.75, pitch: perfect ? 1.15 : 0.95 });
    this.loop.hitStop(perfect ? 0.17 : 0.09);
    this.camera.shake(perfect ? 0.5 : 0.28);
    void colour;
    this.vfx.impact(perfect ? 'perfect_parry' : 'parry', mid.x, 1.3, mid.z);
    this.floats.spawn(mid.x, 1.45, mid.z, perfect ? 'PERFECT' : 'PARRY', 'parry');
    if (perfect) {
      this.grantSurge(PLAYER.parrySurge, 'perfect_parry', true);
      this.abilities && (this.abilities.nextEmpowered = true);
      if (p.stats.techniques.includes('spear_pin') && e.combat.current?.id === 'shoulder_charge') {
        e.applySlow(0.15, 1.4);
        this.cb.onProcNote?.('PIN');
      }
    } else {
      this.grantSurge(Math.round(PLAYER.parrySurge * 0.45), 'parry');
    }

    // Posture is the real payload. A perfect parry is worth more than a heavy.
    const posture = (perfect ? POSTURE.perfectParry : POSTURE.parry) * p.stats.stat('postureDamage');
    const broke = e.combat.addPosture(posture * (offered ? 1 : 0.8), e.mods.staggerResist);
    if (broke) {
      this.onPostureBreak(e);
    } else {
      // A parry stagger is earned — it bypasses the flinch immunity window,
      // but re-arms it so the follow-up cannot chain forever.
      e.combat.stagger((perfect ? 0.95 : 0.6) * (e.named ? 1.4 : 1));
      e.staggerImmune = Math.max(e.staggerImmune, STAGGER.immunity);
    }

    // REVERSAL sends the blow back — perfect parries only, as the card says.
    if (p.stats.powers.has('reversal') && perfect) {
      const res = this.strike(e, {
        amount: e.currentDamage() * 1.6,
        source: 'counter',
        stagger: 20,
        attacker: p,
        fromX: p.position.x,
        fromZ: p.position.z,
        knockback: 5,
        channel: 'reflect',
        grantsPlayerKill: true,
        ignite: hasReaction(p.stats.powers, 'reversal_ember'),
      });
      if (hasReaction(p.stats.powers, 'reversal_ember')) this.cb.onProcNote?.('CINDER PARRY');
      if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'heavy', true, false);
      if (res.killed) this.killEnemy(e, false);
    }
    // RIPOSTE answers immediately.
    if (p.stats.powers.has('riposte')) {
      const res = this.strike(e, {
        amount: p.weapon.damage * 1.8 * p.stats.damageMultiplier(),
        source: 'light',
        stagger: 18,
        attacker: p,
        fromX: p.position.x,
        fromZ: p.position.z,
        knockback: 3,
      });
      if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'light', true, false);
      if (res.killed) this.killEnemy(e, false);
    }

    this.cb.onParrySuccess(e);
  }

  /**
   * A blow passes through i-frames because the player moved late and well.
   * Slows time briefly, pays Surge, and grants a short attack-speed bonus —
   * defensive skill converted into offensive tempo.
   */
  private onPerfectDodge(e: Enemy): void {
    const p = this.player;
    p.combat.onPerfectDodge();
    this.grantSurge(PLAYER.perfectDodgeSurge, 'perfect_dodge', true);
    this.loop.slowMo(PLAYER.perfectDodgeSlowMo, 0.42);
    this.camera.shake(0.12);
    this.audio.play('dodge', { volume: 0.85, pitch: 1.3 });
    this.vfx.ring(p.position.x, 0.05, p.position.z, SIGNAL.player, 0.35, 3.2, 0.32, 0.75);
    this.particles.burst(p.position.x, 1.1, p.position.z, 14, SIGNAL.player, 9, { size: 0.1, life: 0.3 });
    this.cb.onPerfectDodge?.(e);
  }

  /** Slipping a projectile at the last moment — a smaller cousin of the above. */
  private onPerfectDodgeProjectile(): void {
    const p = this.player;
    p.combat.onPerfectDodge();
    this.grantSurge(Math.round(PLAYER.perfectDodgeSurge * 0.5), 'perfect_dodge_shot');
    this.loop.slowMo(PLAYER.perfectDodgeSlowMo * 0.6, 0.45);
    this.audio.play('dodge', { volume: 0.7, pitch: 1.4 });
    this.vfx.ring(p.position.x, 0.05, p.position.z, SIGNAL.player, 0.3, 2.6, 0.3, 0.7);
  }

  /**
   * Posture broken. This is the second win condition in every fight and it has
   * to land like one.
   */
  private onPostureBreak(e: Enemy): void {
    this.loop.hitStop(0.14);
    // A breath of slow motion so the opening reads before you use it.
    this.loop.slowMo(0.3, 0.35);
    this.camera.shake(0.55);
    this.audio.play('stagger', { volume: 1, pitch: 0.8 });
    this.vfx.impact('posture_break', e.position.x, 1.2, e.position.z);
    this.cb.onEnemyStaggered(e);
    this.cb.onPostureBroken?.(e);
  }

  /* ============================================================
     projectiles
     ============================================================ */

  /**
   * Fire one enemy projectile of the attack's declared kind. Speeds live in
   * PROJ (data/balance.ts) and are deliberately reaction-rate limited — the
   * pattern is the danger, never the velocity.
   */
  private fireEnemyProjectile(e: Enemy, damage: number, kind: ProjectileKind, intent: AttackIntent, spread = 0): void {
    const target = e.rivalTarget && e.rivalTarget.alive ? e.rivalTarget.position : this.player.position;
    const sx = e.position.x;
    const sy = 1.3;
    const sz = e.position.z;
    // Lead the target a little so archers are a real threat while moving.
    const lead = this.player.controller.velocity;
    const leadK = kind === 'charged' ? 0.3 : 0.18;
    const tx = target.x + (e.rivalTarget ? 0 : lead.x * leadK);
    const tz = target.z + (e.rivalTarget ? 0 : lead.z * leadK);
    let dx = tx - sx;
    let dz = tz - sz;
    if (spread !== 0) {
      const c = Math.cos(spread);
      const sn = Math.sin(spread);
      const rx = dx * c - dz * sn;
      const rz = dx * sn + dz * c;
      dx = rx;
      dz = rz;
    }
    const flat = Math.hypot(dx, dz) || 1;

    let mesh: THREE.Mesh;
    let speed: number;
    let gravity = 0;
    let vy = 0;
    let radius = 0.4;
    let life: number = PROJ.maxLife;

    switch (kind) {
      case 'charged': {
        // Big, slow, glowing, unmistakable.
        mesh = new THREE.Mesh(this.orbGeo, this.pierceMat);
        mesh.scale.setScalar(PROJ.chargedRadius);
        speed = PROJ.chargedSpeed;
        radius = PROJ.chargedRadius + 0.25;
        break;
      }
      case 'spread': {
        mesh = new THREE.Mesh(this.arrowGeo, this.spreadMat);
        speed = PROJ.spreadSpeed;
        break;
      }
      case 'ground': {
        // Lobbed on an arc; where it lands becomes a toxic zone.
        mesh = new THREE.Mesh(this.orbGeo, this.lobMat);
        mesh.scale.setScalar(0.3);
        speed = PROJ.lobSpeed;
        gravity = PROJ.lobGravity;
        const t = Math.max(0.5, flat / speed);
        vy = (0.05 - sy - 0.5 * gravity * t * t) / t;
        life = t + 0.5;
        radius = 0.35;
        break;
      }
      default: {
        mesh = new THREE.Mesh(this.arrowGeo, intent === 'parryable' ? this.arrowMat : this.spreadMat);
        speed = PROJ.boltSpeed;
        vy = (1.1 - sy) / (flat / speed);
        break;
      }
    }

    mesh.position.set(sx, sy, sz);
    mesh.lookAt(tx, 1.1, tz);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      x: sx,
      y: sy,
      z: sz,
      vx: (dx / flat) * speed,
      vy,
      vz: (dz / flat) * speed,
      life,
      damage,
      ownerUid: e.uid,
      targetsPlayer: !e.rivalTarget,
      kind,
      intent,
      gravity,
      radius,
      pierceLeft: 0,
      chainLeft: 0,
      slowFactor: 1,
      slowDuration: 0,
      poison: 0,
      postureMul: 1,
      critical: false,
      hitUids: [],
      struckPlayer: false,
    });
    this.audio.play('bow', { volume: kind === 'charged' ? 0.7 : 0.45, pitch: kind === 'charged' ? 0.7 : 1, minGap: 0.05 });
  }

  /** Drop a lingering toxic zone. The floor is the attack. */
  spawnHazard(x: number, z: number, radius: number, dps: number, life: number, owner: 'enemy' | 'player'): void {
    const mat = (op: number) =>
      new THREE.MeshBasicMaterial({
        color: SIGNAL.poison,
        transparent: true,
        opacity: op,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
        fog: true,
      });
    const ring = new THREE.Mesh(this.zoneRingGeo, mat(0.75));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    ring.scale.setScalar(radius);
    ring.renderOrder = 2;
    const fill = new THREE.Mesh(this.zoneFillGeo, mat(0.14));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(x, 0.05, z);
    fill.scale.setScalar(radius);
    fill.renderOrder = 1;
    this.scene.add(ring, fill);
    this.hazards.push({ x, z, r: radius, life, maxLife: life, dps, owner, ring, fill, tick: 0 });
    this.particles.burst(x, 0.3, z, 18, SIGNAL.poison, 5, { size: 0.13, life: 0.6, gravity: -3 });
    this.vfx.ring(x, 0.05, z, SIGNAL.poison, 0.4, radius, 0.5, 0.8);
    this.audio.play('fire', { volume: 0.4, pitch: 0.8, minGap: 0.1 });
  }

  private updateHazards(dt: number): void {
    const p = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      h.tick -= dt;
      const fade = Math.min(1, h.life / 0.8);
      (h.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * fade;
      (h.fill.material as THREE.MeshBasicMaterial).opacity = (0.12 + Math.sin(h.life * 6) * 0.04) * fade;

      if (h.tick <= 0) {
        h.tick = PROJ.zoneTick;
        // slow acid bubbles so the zone reads as alive
        this.particles.burst(
          h.x + (Math.random() - 0.5) * h.r * 1.4,
          0.15,
          h.z + (Math.random() - 0.5) * h.r * 1.4,
          2,
          SIGNAL.poison,
          1.6,
          { size: 0.09, life: 0.7, gravity: 2, up: 1 }
        );

        if (h.owner === 'enemy' && p.alive && !p.combat.invulnerable && !p.godMode) {
          if (radiusHits(h.x, h.z, h.r, p.position.x, p.position.z, p.radius)) {
            const res = this.strike(p, {
              amount: h.dps * PROJ.zoneTick,
              source: 'environment',
              stagger: 0,
              attacker: null,
              fromX: h.x,
              fromZ: h.z,
              knockback: 0,
            });
            if (res.applied > 0) {
              this.audio.play('fire', { volume: 0.3, pitch: 1.2, minGap: 0.3 });
              this.cb.onPlayerDamaged(null, res.applied);
              if (res.killed) this.cb.onPlayerKilled(null);
            }
          }
        } else if (h.owner === 'player') {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            if (!radiusHits(h.x, h.z, h.r, e.position.x, e.position.z, e.radius)) continue;
            const res = this.strike(e, {
              amount: h.dps * PROJ.zoneTick,
              source: 'fire',
              stagger: 0,
              attacker: this.player,
              fromX: h.x,
              fromZ: h.z,
              poison: 10,
            });
            if (res.killed) this.killEnemy(e, false);
          }
        }
      }

      if (h.life <= 0) {
        this.scene.remove(h.ring, h.fill);
        (h.ring.material as THREE.Material).dispose();
        (h.fill.material as THREE.Material).dispose();
        this.hazards.splice(i, 1);
      }
    }
  }

  /**
   * Segment-vs-circle on XZ: does the travel this frame pass within `r` of
   * (cx, cz)? Point tests tunnel — a fast needle can cross a whole body in a
   * single low-framerate step — so every projectile collision is swept.
   */
  private static sweptHit(x0: number, z0: number, x1: number, z1: number, cx: number, cz: number, r: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    let t = 0;
    if (len2 > 1e-9) {
      t = ((cx - x0) * dx + (cz - z0) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    return (px - cx) ** 2 + (pz - cz) ** 2 <= r * r;
  }

  private updateProjectiles(dt: number): void {
    const p = this.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const a = this.projectiles[i];
      a.life -= dt;
      a.vy += a.gravity * dt;
      const px0 = a.x;
      const pz0 = a.z;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.z += a.vz * dt;
      a.mesh.position.set(a.x, a.y, a.z);
      if (a.kind === 'charged') {
        a.mesh.rotation.x += dt * 3;
        a.mesh.rotation.y += dt * 5;
        // a slow menacing trail
        this.particles.embers(a.x, a.y, a.z, 0);
      }

      let done = a.life <= 0 || a.y < 0.08;

      // GROUND SHOT: landing is the event — it makes the zone.
      if (a.kind === 'ground' && (a.y < 0.15 || a.life <= 0)) {
        this.spawnHazard(a.x, a.z, PROJ.zoneRadius, PROJ.zoneDps, PROJ.zoneLife, a.targetsPlayer ? 'enemy' : 'player');
        this.scene.remove(a.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      // A lobbed GROUND shot sails over bodies — the zone it leaves is the
      // attack. It never collides in flight, it only lands.
      if (!done && a.kind !== 'ground' && a.targetsPlayer && p.alive && !a.struckPlayer) {
        if (CombatSystem.sweptHit(px0, pz0, a.x, a.z, p.position.x, p.position.z, p.radius + a.radius) && a.y < 2.2) {
          done = true;
          /* ---- the parry contract, held at range ----
             cyan (parryable): the whole window works
             amber (normal/area): only a PERFECT parry catches it
             red (unblockable): nothing does — move */
          const perfect = p.combat.parryPerfect;
          const parried =
            p.combat.parryActive &&
            a.intent !== 'unblockable' &&
            (a.intent === 'parryable' || perfect);
          if (parried) {
            this.audio.play('parry', { volume: perfect ? 1 : 0.8, pitch: perfect ? 1.2 : 1 });
            this.particles.burst(a.x, a.y, a.z, perfect ? 22 : 12, SIGNAL.parryable, 9, { size: 0.11, life: 0.32 });
            if (perfect) this.vfx.flash(a.x, a.y, a.z, SIGNAL.parryable, 0.8, 0.16);
            p.combat.onParrySuccess(perfect);
            this.grantSurge(perfect ? PLAYER.parrySurge : 6, perfect ? 'perfect_parry' : 'parry');
            this.cb.onHabit('parry');

            // RETURN FIRE — the projectile goes home.
            if (p.stats.powers.has('return_fire')) {
              const owner = this.enemies.find((e) => e.uid === a.ownerUid && e.alive);
              const tx = owner ? owner.position.x : a.x - a.vx;
              const tz = owner ? owner.position.z : a.z - a.vz;
              const dx = tx - a.x;
              const dz = tz - a.z;
              const l = Math.hypot(dx, dz) || 1;
              const s = Math.hypot(a.vx, a.vz) * 1.4;
              a.vx = (dx / l) * s;
              a.vz = (dz / l) * s;
              a.vy = owner ? (1.2 - a.y) / (l / s) : 0;
              a.gravity = 0;
              a.targetsPlayer = false;
              a.ownerUid = p.uid;
              a.damage *= 1.4;
              a.life = Math.max(a.life, 1.2);
              if (hasReaction(p.stats.powers, 'return_chain')) {
                a.chainLeft = Math.max(a.chainLeft, 1);
                this.cb.onProcNote?.('RICOCHET');
              }
              this.vfx.flash(a.x, a.y, a.z, SIGNAL.player, 0.6, 0.12);
              done = false;
            }
          } else if (!p.combat.invulnerable) {
            // A well-timed dodge slips any projectile — movement is always an
            // answer, even to red. (Perfect dodges pay out here too.)
            const owner = this.enemies.find((e) => e.uid === a.ownerUid) ?? null;
            const hpBefore = p.stats.hp;
            const res = this.strike(p, {
              amount: a.damage,
              source: 'ranged',
              stagger: 5,
              attacker: owner,
              fromX: a.x,
              fromZ: a.z,
              knockback: a.kind === 'charged' ? 6 : 2,
              unblockable: a.intent === 'unblockable',
            });
            if (res.applied > 0) {
              this.audio.play('arrow_hit', { volume: 0.8, pitch: a.kind === 'charged' ? 0.7 : 1 });
              this.camera.shake(a.kind === 'charged' ? 0.4 : 0.2);
              this.particles.burst(a.x, a.y, a.z, a.kind === 'charged' ? 16 : 8, 0xff3b21, 6, { size: 0.1, life: 0.35 });
              this.cb.onPlayerDamaged(owner, res.applied);
            }
            if (this.telemetry) {
              this.telemetry.pushHit({
                attacker: owner ? `e${owner.uid}` : 'unknown',
                target: 'player',
                amount: res.applied,
                source: a.kind,
                dist: owner ? Math.hypot(p.position.x - owner.position.x, p.position.z - owner.position.z) : -1,
                reach: -1,
                parried: false,
                dodged: res.dodged,
                blocked: res.blocked,
                victimAction: p.combat.action,
                unblockable: a.intent === 'unblockable',
              });
            }
            if (res.killed) {
              this.telemetry?.pushDeath({
                killerName: owner?.displayName || 'an archer',
                killerUid: owner?.uid ?? -1,
                attackSource: a.kind,
                damage: res.applied,
                hpBefore,
                unblockable: a.intent === 'unblockable',
                parryable: a.intent === 'parryable',
                ranged: true,
                playerAction: p.combat.action,
                playerWasDodging: p.combat.action === 'dodge',
                playerWasParrying: p.combat.action === 'parry',
                playerWasStaggered: p.combat.action === 'stagger',
                distance: owner ? Math.hypot(p.position.x - owner.position.x, p.position.z - owner.position.z) : -1,
              });
              this.cb.onPlayerKilled(owner);
            }
            // A charged mass does not stop for one body.
            if (a.kind === 'charged') {
              a.struckPlayer = true;
              done = false;
            }
          } else if (p.combat.dodgePerfect) {
            this.onPerfectDodgeProjectile();
            a.struckPlayer = true; // reward once; it flies on past
            done = false;
          } else {
            done = false; // plain i-frames: it passes through
          }
        }
      }

      if (!done && a.kind !== 'ground') {
        for (const e of this.enemies) {
          if (!e.alive || e.uid === a.ownerUid) continue;
          if (a.kind === 'needle') {
            // The player's needle: hits anything hostile, pierces and chains.
            if (a.hitUids.includes(e.uid)) continue;
            if (CombatSystem.sweptHit(px0, pz0, a.x, a.z, e.position.x, e.position.z, e.radius + a.radius) && a.y < 2.6) {
              done = this.needleHit(a, e);
              if (done) break;
            }
            continue;
          }
          if (a.targetsPlayer && !e.rivalTarget) continue; // no accidental friendly fire in a crowd
          if (CombatSystem.sweptHit(px0, pz0, a.x, a.z, e.position.x, e.position.z, e.radius + a.radius) && a.y < 2.4) {
            done = true;
            const res = this.strike(e, {
              amount: a.damage,
              source: 'ranged',
              stagger: 5,
              attacker: a.ownerUid === p.uid ? p : null,
              fromX: a.x,
              fromZ: a.z,
            });
            if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'light', false, false);
            if (res.killed) this.killEnemy(e, false);
            break;
          }
        }
      }

      if (!done && !this.arena.lineOfSight(a.x - a.vx * dt, a.z - a.vz * dt, a.x, a.z)) {
        done = true;
        this.vfx.impact('environment', a.x, a.y, a.z);
      }

      if (done) {
        this.scene.remove(a.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clearProjectiles(): void {
    for (const a of this.projectiles) this.scene.remove(a.mesh);
    this.projectiles.length = 0;
    for (const h of this.hazards) {
      this.scene.remove(h.ring, h.fill);
      (h.ring.material as THREE.Material).dispose();
      (h.fill.material as THREE.Material).dispose();
    }
    this.hazards.length = 0;
  }

  /** For the F1 trajectory overlay and the QA harness. */
  get liveProjectiles(): ReadonlyArray<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; kind: string; intent: string }> {
    return this.projectiles;
  }

  get liveHazards(): ReadonlyArray<{ x: number; z: number; r: number; owner: string }> {
    return this.hazards;
  }

  /* ============================================================
     weapon trails
     ============================================================ */

  private playerTrail = -1;
  private tmpBase = new THREE.Vector3();

  /**
   * Ribbon trails that follow the ACTUAL weapon path (guard->tip each frame,
   * pooled in fx/VFX.ts). Emitted only during the active window — an idle
   * weapon never draws. Intensity tiers: light = thin lime thread, heavy and
   * executions = wide bright band; named enemies trail in their accent so a
   * Nemesis special reads as THEIRS.
   */
  private updateTrails(): void {
    const p = this.player;
    const c = p.combat;
    const playerActive =
      p.alive &&
      ((c.action === 'attack' && (c.phase === 'active' || (c.phase === 'recover' && c.t < 0.09))) ||
        (c.action === 'execute' && c.executeProgress() > 0.4));
    if (playerActive) {
      if (this.playerTrail < 0) {
        const heavy = c.attackKind === 'heavy' || c.action === 'execute';
        this.playerTrail = this.vfx.trailStart(SIGNAL.player, heavy ? 1 : 0.45);
      }
      p.root.updateWorldMatrix(true, true);
      this.vfx.trailPoint(this.playerTrail, p.weaponBase(this.tmpBase), p.weaponTip(this.tmp));
    } else if (this.playerTrail >= 0) {
      this.vfx.trailEnd(this.playerTrail);
      this.playerTrail = -1;
    }

    for (const e of this.enemies) {
      const on = e.alive && e.combat.state === 'active' && !e.weapon.ranged && e.combat.current !== null;
      if (on) {
        if (e.trailHandle < 0) {
          const strong = e.named || e.nemesis.archetype === 'heavy';
          e.trailHandle = this.vfx.trailStart(e.named ? e.rig.accent : 0x8f96a3, strong ? 0.9 : 0.35);
        }
        e.rig.root.updateWorldMatrix(true, true);
        e.rig.weaponTip.getWorldPosition(this.tmp);
        e.rig.weaponBase.getWorldPosition(this.tmpBase);
        this.vfx.trailPoint(e.trailHandle, this.tmpBase, this.tmp);
      } else if (e.trailHandle >= 0) {
        this.vfx.trailEnd(e.trailHandle);
        e.trailHandle = -1;
      }
    }
  }

  /* ============================================================
     burning
     ============================================================ */

  private updateBurning(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.burning > 0) this.particles.embers(e.position.x, 0.8, e.position.z, 1);
      if (e.poisoned && Math.random() < 0.35) {
        this.particles.burst(e.position.x, 0.9 + Math.random(), e.position.z, 1, SIGNAL.poison, 1.2, {
          size: 0.08,
          life: 0.6,
          gravity: 2,
          up: 1,
        });
      }
      void dt;
    }
    if (this.player.burning > 0) {
      this.particles.embers(this.player.position.x, 0.8, this.player.position.z, 1);
    }
  }

  /* ============================================================
     helpers
     ============================================================ */

  /**
   * Shared bookkeeping after any player-sourced hit connects: posture break
   * escalation, flinch feedback, poison ignition, lifesteal. One place, so a
   * needle and a greatsword pay into the same systems.
   */
  private afterPlayerHit(e: Enemy, res: { applied: number; staggered: boolean; flinched: boolean; poisoned: boolean; critical: boolean }, strong: boolean, info?: DamageInfo): void {
    const stats = this.player.stats;
    if (res.applied > 0 && canProc(info, 'lifesteal')) stats.lifestealFrom(res.applied);
    if (res.applied > 0) this.telemetry?.noteEnemyHurt(e.uid);
    if (res.poisoned) {
      e.poisonDps = POISON.dps * stats.stat('poisonDamage');
      this.audio.play('fire', { volume: 0.35, pitch: 1.5, minGap: 0.2 });
      this.vfx.impact('poison', e.position.x, 1.3, e.position.z);
      this.vfx.ring(e.position.x, 0.05, e.position.z, SIGNAL.poison, 0.3, e.radius + 1.2, 0.4, 0.6);
    }
    if (res.staggered) {
      // Posture BROKE — the big opening.
      this.onPostureBreak(e);
    } else if (res.flinched) {
      // The short flinch: readable recoil, a beat of silence, no slow-mo.
      this.loop.hitStop(strong ? 0.05 : 0.03);
      this.camera.shake(strong ? 0.22 : 0.12);
      this.audio.play('stagger', { volume: 0.55, pitch: 1.25, minGap: 0.1 });
      const dx = e.position.x - this.player.position.x;
      const dz = e.position.z - this.player.position.z;
      const l = Math.hypot(dx, dz) || 1;
      this.particles.burst(e.position.x, 1.2, e.position.z, 10, 0xffffff, 6, {
        size: 0.1,
        life: 0.3,
        dirX: dx / l,
        dirZ: dz / l,
        spread: 0.4,
      });
      this.cb.onEnemyStaggered(e);
    }
    if (res.critical && res.applied > 0) {
      this.vfx.flash(e.position.x, 1.5, e.position.z, SIGNAL.critical, 0.9, 0.12);
      this.audio.play('heavy_hit', { volume: 0.5, pitch: 1.6, minGap: 0.05 });
    }
  }

  private onDamageFeedback(e: Enemy, amount: number, kind: 'light' | 'heavy', critical: boolean, fire: boolean): void {
    // FLESH/BASIC HIT — chips fly along the blow; heavier blows, bigger burst.
    const dx = e.position.x - this.player.position.x;
    const dz = e.position.z - this.player.position.z;
    const l = Math.hypot(dx, dz) || 1;
    this.vfx.impact(
      'flesh',
      e.position.x,
      1.15,
      e.position.z,
      dx / l,
      dz / l,
      Math.min(2, (kind === 'heavy' ? 1.3 : 0.85) + amount * 0.015)
    );
    if (critical) this.vfx.impact('crit', e.position.x, 1.3, e.position.z);
    if (fire) {
      this.particles.burst(e.position.x, 1.15, e.position.z, 8, 0xff7a20, 8, { size: 0.12, life: 0.4 });
      this.audio.play('fire', { volume: 0.3, minGap: 0.4 });
    }
    this.audio.play(kind === 'heavy' ? 'heavy_hit' : 'light_hit', { volume: 0.75, minGap: 0.04 });
  }

  private killEnemy(e: Enemy, executed: boolean, killer?: Enemy, info?: DamageInfo): void {
    if (!e.alive) return;
    e.kill();
    this.audio.play('enemy_death', { volume: 0.8, pitch: e.named ? 0.75 : 1 });
    this.particles.burst(e.position.x, 1.1, e.position.z, executed ? 40 : 20, e.rig.accent, 10, {
      size: 0.15,
      life: 0.7,
    });
    this.vfx.ring(e.position.x, 0.05, e.position.z, e.rig.accent, 0.3, executed ? 5 : 2.6, 0.4);

    const playerCredit = !killer && canProc(info, 'killCredit');
    this.lastKillChannel = info?.channel ?? (killer ? 'eve' : 'primary');
    this.lastKillPlayerCredit = playerCredit;

    if (playerCredit) {
      const stats = this.player.stats;
      stats.runKills++;
      if (e.named) stats.runNamedKills++;
      if (canProc(info, 'surge')) this.grantSurge(PLAYER.surgeOnKill, 'kill');
      if (stats.powers.has('chain') && canProc(info, 'chainDodge')) {
        this.player.combat.dodgeCooldown = 0;
        if (hasReaction(stats.powers, 'chain_momentum')) {
          stats.momentum = Math.min(stats.momentumMax, stats.momentum + 1);
          this.cb.onProcNote?.('KILL RHYTHM');
        }
      }
    }
    this.cb.onEnemyKilled(e, executed);
    this.telemetry?.noteEnemyDown(e.uid, e.nemesis.rank, e.named);
  }

  /** Called by Game when the player dodges, for PHANTOM. */
  onPlayerDodge(): void {
    this.cb.onHabit('dodge');
    this.audio.play('dodge', { volume: 0.5 });
    this.particles.dust(this.player.position.x, 0.35, this.player.position.z, 10);
    if (this.player.stats.powers.has('phantom')) {
      this.player.spawnPhantom(this.scene);
      // The afterimage lashes out where you were.
      const x = this.player.position.x;
      const z = this.player.position.z;
      window.setTimeout(() => {
        if (!this.player.alive) return;
        this.vfx.ring(x, 0.05, z, 0x4fd0ff, 0.4, 3.4, 0.35);
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (!radiusHits(x, z, 3.2, e.position.x, e.position.z, e.radius)) continue;
          const res = this.strike(e, {
            amount: 16,
            source: 'counter',
            stagger: 14,
            attacker: null,
            fromX: x,
            fromZ: z,
            knockback: 3,
            channel: 'afterimage',
            grantsPlayerKill: true,
          });
          if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'light', false, false);
          if (res.killed) this.killEnemy(e, false);
        }
      }, 260);
    }
  }

  /** STAMPEDE — sprinting into someone flattens them. */
  checkStampede(): void {
    if (!this.player.stats.powers.has('stampede')) return;
    if (!this.player.controller.sprinting) return;
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive || e.combat.state === 'knockdown') continue;
      const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      if (d < p.radius + e.radius + 0.35) {
        e.combat.knockdown(1.6);
        const res = this.strike(e, {
          amount: 14,
          source: 'blast',
          stagger: 40,
          attacker: p,
          fromX: p.position.x,
          fromZ: p.position.z,
          knockback: 11,
        });
        if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'heavy', false, false);
        if (res.killed) this.killEnemy(e, false);
        this.camera.shake(0.4);
        this.loop.hitStop(0.06);
      }
    }
  }

  /** Fire hazard used by the EMBER power and by burning enemies spreading. */
  igniteAt(x: number, z: number, radius: number, damage: number): void {
    this.cb.onHabit('fire');
    this.vfx.ring(x, 0.05, z, 0xff5a10, 0.4, radius, 0.5);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!radiusHits(x, z, radius, e.position.x, e.position.z, e.radius)) continue;
      const res = this.strike(e, {
        amount: damage,
        source: 'fire',
        stagger: 4,
        attacker: this.player,
        fromX: x,
        fromZ: z,
        ignite: true,
      });
      if (res.applied > 0) this.onDamageFeedback(e, res.applied, 'light', false, true);
      if (res.killed) this.killEnemy(e, false);
    }
  }

  /**
   * Apply damage and float the result. Every blow in this file goes through
   * here so a number (or BLOCK / MISS) always matches what actually landed.
   */
  private strike(target: Enemy | Player, info: DamageInfo): DamageResult {
    if (!info.channel) info.channel = target.isPlayer ? 'primary' : info.attacker?.isPlayer ? 'primary' : 'primary';
    const res = target.applyDamage(info);
    this.announceHit(target, res, info);
    return res;
  }

  private announceHit(target: Combatant, res: DamageResult, info: DamageInfo): void {
    if (res.dodged) {
      this.floats.spawnOn(target, 'MISS', 'miss');
      return;
    }
    if (res.blocked) {
      this.floats.spawnOn(target, 'BLOCK', 'block');
      return;
    }
    if (res.applied <= 0) return;
    const n = String(Math.max(1, Math.round(res.applied)));
    this.floats.spawnOn(target, n, this.floatKind(target, res, info));
  }

  private floatKind(target: Combatant, res: DamageResult, info: DamageInfo): DamageFloatKind {
    if (target.isPlayer) return 'hurt';
    if (res.critical) return 'crit';
    if (info.source === 'fire') return 'fire';
    if (info.source === 'environment') return 'poison';
    if (info.source === 'execute') return 'crit';
    return 'hit';
  }

  dispose(): void {
    this.clearProjectiles();
    this.arrowGeo.dispose();
    this.arrowMat.dispose();
  }

  get tmpVec(): THREE.Vector3 {
    return this.tmp;
  }
}
