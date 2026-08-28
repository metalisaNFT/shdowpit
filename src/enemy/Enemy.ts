/**
 * A live enemy in the arena.
 *
 * Every enemy — anonymous grunt or the Overlord — is driven by a Nemesis
 * record, so there is exactly one code path for stats, appearance and
 * behaviour. The only difference is whether that record is persisted.
 *
 * Animation: enemies run the same CharacterAnimator/rig standard as the
 * player. Attack clips are SCRUBBED from the combat phase clock
 * (anticipation/hold/active/recovery), so an enemy's blade is wherever its
 * hitbox is — at any windup multiplier. Personality shapes presentation
 * through additive stances, never through different mechanics.
 */

import * as THREE from 'three';
import type { Combatant, DamageInfo, DamageResult } from '../combat/Types';
import { emptyResult } from '../combat/Types';
import { computeMods, type TraitMods } from '../data/traits';
import { getPersonality } from '../data/personalities';
import { enemyWeapon, type WeaponDef } from '../data/weapons';
import type { AgeModifier } from '../data/ages';
import type { Nemesis } from '../nemesis/Nemesis';
import { fullName, rankIndex } from '../nemesis/Nemesis';
import { buildEnemyRig, type EnemyRig } from '../nemesis/NemesisAppearance';
import { EnemyCombat } from './EnemyCombat';
import { turnToward } from '../combat/Hitbox';
import { POSTURE, TELEGRAPH, STAGGER, POISON, BODY } from '../data/balance';
import { SIGNAL, NEON } from '../data/palette';
import { CLIPS } from '../anim/ClipLibrary';
import type { EnemyAttackDef } from '../data/attacks';
import { neutralTilt, type CombatTilt } from '../god/Combatant';

export type EnemyState =
  | 'idle'
  | 'patrol'
  | 'chase'
  | 'attack'
  | 'block'
  | 'stagger'
  | 'flee'
  | 'dead'
  | 'hunt_player'
  | 'protect_ally'
  | 'attack_rival'
  | 'escape'
  | 'approach_intro';

const RANK_HP = BODY.rankHp;
const ARCH_HP = BODY.archHp;
const ARCH_SPEED = BODY.archSpeed;

let nextUid = 100;

/** Which baked clip performs an attack def. One table, easy to audit. */
export function clipForAttack(def: EnemyAttackDef): string {
  if (def.ranged) return def.projectileKind === 'ground' ? 'Throw' : 'BowShoot';
  switch (def.id) {
    case 'quick_slash':
      return 'Atk1H_A';
    case 'double_slash':
      return 'Atk1H_B';
    case 'thrust':
      return 'AtkThrust';
    case 'overhead':
      return 'Atk1H_C';
    case 'sidestep_cut':
      return 'Atk1H_B';
    case 'delayed_overhead':
      return 'Atk1H_C';
    case 'wide_sweep':
      return 'Atk2H_Sweep';
    case 'ground_slam':
      return 'Atk2H_Slam';
    case 'shoulder_charge':
      return 'Shove';
    case 'heavy_overhead':
      return 'Atk2H_Slam';
    case 'shove':
      return 'Shove';
    case 'delayed_smash':
      return 'Atk2H_Slam';
    case 'dart_slash':
      return 'Atk1H_A';
    case 'riposte_cut':
      return 'Atk1H_C';
    case 'feint_lunge':
      return 'AtkThrust';
    case 'punish_whiff':
      return 'Atk1H_B';
    case 'order_pulse':
      return 'Atk2H_Slam';
    case 'rally_stab':
      return 'AtkThrust';
    case 'banner_sweep':
      return 'Atk2H_Sweep';
    case 'commit_thrust':
      return 'AtkThrust';
    default:
      return 'Atk1H_A';
  }
}

export class Enemy implements Combatant {
  readonly uid: number;
  readonly isPlayer = false;

  nemesis: Nemesis;
  readonly named: boolean;

  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  facing = 0;
  radius: number;
  height: number;

  hp: number;
  maxHp: number;
  alive = true;
  displayName: string;

  mods: TraitMods;
  /** God-layer condition lean — mirrors headless duel tilts when descending. */
  tilt: CombatTilt = neutralTilt();
  weapon: WeaponDef;
  damage: number;
  speed: number;

  combat = new EnemyCombat();
  rig: EnemyRig;

  state: EnemyState = 'idle';
  stateTime = 0;

  rivalTarget: Enemy | null = null;
  protectTarget: Enemy | null = null;
  /** Terror+Predator: fleeing becomes a hunt, not an exit */
  huntedByPlayer = false;
  /** QA / hunt: close from outside normal aggro. */
  engagePlayer = false;

  patrolTarget = new THREE.Vector3();
  attackTimer = 0;
  strafeDir = 1;
  strafeTimer = 0;
  /** seconds spent asking to move while going nowhere — wall unstick */
  stuckTime = 0;
  /** which way to slide around the obstacle; 0 = undecided */
  slideDir: -1 | 0 | 1 = 0;

  /**
   * What the movement layer is trying to do right now — purely descriptive,
   * written by EnemyAI for the debug overlay, QA and telemetry.
   */
  intent: 'none' | 'approach' | 'pressure' | 'circle' | 'backoff' | 'reposition' | 'wait' | 'flee' = 'none';
  hesitateTimer = 0;
  backoffTimer = 0;
  feintPlanned = false;
  summoned = false;
  isolated = false;
  orderBuff = 0;
  orderFired = false;
  summonUsed = false;
  ambient: 'none' | 'patrol' | 'guard' | 'kneel' | 'mourn' | 'loot' = 'none';
  /** MultiEncounter pose; combat with the player clears it. */
  stagePose: 'none' | 'patrol' | 'guard' | 'kneel' | 'mourn' | 'loot' = 'none';

  /** where the head/chest should track (set by EnemyAI: usually the player) */
  aimAt: THREE.Vector3 | null = null;

  /* ---- cripple (Void Needle & skills) ---- */
  slowTimer = 0;
  slowFactor = 1;

  /* ---- stagger anti-stunlock ---- */
  staggerImmune = 0;

  /* ---- poison ---- */
  poison = 0;
  poisonTimer = 0;
  private poisonTick = 0;
  poisonDps: number = POISON.dps;

  burning = 0;
  private burnTick = 0;

  escaping = false;
  escapedAway = false;
  /** pause attacking while a named intro plays — player keeps control */
  introHold = false;
  pendingIntro = false;
  introDelay = 0;
  escapePresented = false;
  aidPresented = false;
  entranceKind: 'walk' | 'behind' | 'resurrection' | 'immediate' = 'immediate';
  escapeAim = { x: 0, z: 0 };
  hasEscapeAim = false;

  get executable(): boolean {
    if (!this.alive) return false;
    return this.combat.broken || this.hp <= this.maxHp * this.mods.executeThreshold;
  }

  executionWardAvailable: boolean;

  hasSpokenArrival = false;
  hasTaunted = false;

  /**
   * Set by AI / world when a named foe commits their signature. Game consumes
   * it for a one-shot toast / flash / audio beat, then clears it.
   */
  signatureCue = false;
  /** True when this cue is the first time the player learns the signature. */
  signatureCueFirst = false;
  /** Cooldown so spammy signatures still read without toast-storming. */
  signatureCueCd = 0;

  /** Queue a player-facing signature beat if the cooldown allows. */
  queueSignatureCue(firstOverride?: boolean): void {
    if (!this.named) return;
    const first = firstOverride ?? !this.nemesis.signatureKnown;
    this.nemesis.signatureKnown = true;
    if (this.signatureCueCd > 0) return;
    this.signatureCue = true;
    this.signatureCueFirst = first;
    this.signatureCueCd = first ? 0.5 : 5;
  }

  private hurtFlash = 0;
  private telegraph: THREE.Mesh;
  private telegraphMat: THREE.MeshBasicMaterial;
  private glowMats: THREE.MeshBasicMaterial[] = [];
  private glowBase: THREE.Color[] = [];
  /**
   * Ground danger indicator for area attacks. Three parts:
   *   areaRing   thin ring at the exact radius — WHERE, does not move
   *   areaFill   disc that grows to fill it — the WHEN countdown
   *   areaPulse  a second ring CONTRACTING onto the boundary with rising
   *              brightness — the countdown you can read in your periphery.
   */
  private areaRing: THREE.Mesh | null = null;
  private areaRingMat: THREE.MeshBasicMaterial | null = null;
  private areaFill: THREE.Mesh | null = null;
  private areaFillMat: THREE.MeshBasicMaterial | null = null;
  private areaPulse: THREE.Mesh | null = null;
  private areaPulseMat: THREE.MeshBasicMaterial | null = null;
  private marker: THREE.Mesh | null = null;
  private markerMat: THREE.MeshBasicMaterial | null = null;
  private pulseClock = Math.random() * 10;
  private baseSkin = new THREE.Color();
  private deathClip: 'DeathA' | 'DeathB' = 'DeathA';
  private deathStarted = false;
  private lastHitDir = new THREE.Vector3(0, 0, 1);
  private staggerRateSet = false;
  /** trail ribbon handle owned by CombatSystem */
  trailHandle = -1;

  constructor(n: Nemesis, age: AgeModifier) {
    this.uid = nextUid++;
    this.nemesis = n;
    this.named = n.persistent;
    this.displayName = n.persistent ? fullName(n) : '';

    const allTraits = [...n.strengths, ...n.weaknesses, ...n.adaptations];
    this.mods = computeMods(allTraits);

    const ri = rankIndex(n.rank);
    const hpBase = BODY.hpBase + n.level * BODY.hpPerLevel;
    this.maxHp = Math.round(
      hpBase * (ARCH_HP[n.archetype] ?? 1) * RANK_HP[ri] * this.mods.healthMul * age.health
    );
    this.hp = this.maxHp;

    this.weapon = enemyWeapon(n.weapon);
    const pers = getPersonality(n.personality);
    this.damage =
      this.weapon.damage *
      (1 + n.level * BODY.damagePerLevel) *
      this.mods.damageMul *
      age.damage *
      (0.85 + pers.aggression * 0.3);
    if (n.stolen.length) {
      this.damage *= 1.14;
      this.weapon = { ...this.weapon, reach: this.weapon.reach + 0.35, damage: this.weapon.damage + 2 };
    }
    if (n.stolenFromThem?.length) this.damage *= 0.86;
    this.speed = (ARCH_SPEED[n.archetype] ?? BODY.archSpeedDefault) * this.mods.speedMul;

    this.rig = buildEnemyRig(n);
    this.radius = this.rig.radius;
    this.height = this.rig.height;
    this.baseSkin.copy(this.rig.skin.color);

    const posture =
      POSTURE.base *
      (POSTURE.rankMultiplier[ri] ?? 1) *
      (POSTURE.archetypeMultiplier[n.archetype] ?? 1) *
      (1 + n.level * 0.02);
    this.combat.reset(Math.round(posture));
    this.executionWardAvailable = this.mods.executionWard;

    /* ---- personality stance: same clips, different body language ---- */
    const anim = this.rig.anim;
    const heavy = n.archetype === 'heavy';
    const archer = n.archetype === 'archer';
    const st = anim.stance;
    if (pers.id === 'coward' || pers.id === 'survivor') {
      st.lean = -0.1; // leans away
      st.armsOut = 0.14;
      st.headDown = 0.04;
    } else if (pers.desperation >= 1.8 || pers.spacing <= 0.15) {
      st.lean = 0.15; // berserker forward
      st.twitch = 0.9;
    } else if (archer || pers.id === 'hunter') {
      st.crouch = 0.035; // low stance
      st.headDown = 0.05;
    } else if (heavy) {
      st.lean = 0.05;
    }
    // arrogant nemeses: slow confident walk, barely reacts until hurt
    const arrogant = ri >= 3 || ((pers.id === 'showoff' || pers.id === 'ambitious') && ri >= 2);
    if (arrogant) {
      anim.proudWalk = true;
      anim.flinchScale = 0.45;
    }
    if (heavy) anim.flinchScale = Math.min(anim.flinchScale, 0.6);

    // Telegraph marker above the head — the readable "it is about to swing".
    this.telegraphMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      fog: false,
      depthWrite: false,
    });
    this.telegraph = new THREE.Mesh(CHROME_GEO.telegraph, this.telegraphMat);
    this.telegraph.rotation.x = Math.PI;
    this.telegraph.position.y = this.height / Math.max(0.01, this.rig.scale) + 0.55;
    this.rig.root.add(this.telegraph);

    const contactMat = new THREE.MeshBasicMaterial({
      color: this.named ? this.rig.accent : 0xd8d4c8,
      transparent: true,
      opacity: this.named ? 0.38 : 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const contact = new THREE.Mesh(CHROME_GEO.contact, contactMat);
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.05;
    contact.scale.setScalar(this.radius * 1.15);
    contact.renderOrder = 1;
    this.rig.root.add(contact);
    this.glowMats.push(contactMat);
    this.glowBase.push(contactMat.color.clone());

    for (const m of this.rig.glows) {
      const mat = (m.material as THREE.MeshBasicMaterial).clone();
      m.material = mat;
      this.glowMats.push(mat);
      this.glowBase.push(mat.color.clone());
    }

    const zoneMat = () =>
      new THREE.MeshBasicMaterial({
        color: SIGNAL.areaWarning,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
        fog: true,
      });
    this.areaRingMat = zoneMat();
    this.areaRing = new THREE.Mesh(CHROME_GEO.areaRing, this.areaRingMat);
    this.areaRing.rotation.x = -Math.PI / 2;
    this.areaRing.visible = false;
    this.areaRing.renderOrder = 2;

    this.areaFillMat = zoneMat();
    this.areaFill = new THREE.Mesh(CHROME_GEO.areaFill, this.areaFillMat);
    this.areaFill.rotation.x = -Math.PI / 2;
    this.areaFill.visible = false;
    this.areaFill.renderOrder = 1;

    this.areaPulseMat = zoneMat();
    this.areaPulse = new THREE.Mesh(CHROME_GEO.areaPulse, this.areaPulseMat);
    this.areaPulse.rotation.x = -Math.PI / 2;
    this.areaPulse.visible = false;
    this.areaPulse.renderOrder = 2;

    if (this.named) {
      this.markerMat = new THREE.MeshBasicMaterial({
        color: this.rig.accent,
        transparent: true,
        opacity: 0.7,
        toneMapped: false,
        fog: false,
        depthWrite: false,
      });
      this.marker = new THREE.Mesh(CHROME_GEO.marker, this.markerMat);
      this.marker.position.y = this.telegraph.position.y + 0.75;
      this.rig.root.add(this.marker);
    }
  }

  get object(): THREE.Object3D {
    return this.rig.root;
  }

  get aggression(): number {
    const p = getPersonality(this.nemesis.personality);
    return p.aggression;
  }

  get effectiveSpeed(): number {
    return this.speed * (this.slowTimer > 0 ? this.slowFactor : 1);
  }

  get poisoned(): boolean {
    return this.poisonTimer > 0;
  }

  applySlow(factor: number, duration: number): void {
    this.slowFactor = this.slowTimer > 0 ? Math.min(this.slowFactor, factor) : factor;
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  private faceTmpA = new THREE.Vector3();
  private faceTmpB = new THREE.Vector3();
  /** Rendered face direction on XZ, unit — QA mirror of Player.faceDirection. */
  faceDirection(out: THREE.Vector3): THREE.Vector3 {
    this.rig.nose.updateWorldMatrix(true, false);
    this.rig.nose.getWorldPosition(this.faceTmpA);
    this.rig.head.updateWorldMatrix(true, false);
    this.rig.head.getWorldPosition(this.faceTmpB);
    out.set(this.faceTmpA.x - this.faceTmpB.x, 0, this.faceTmpA.z - this.faceTmpB.z);
    const l = out.length();
    return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, 0, -1);
  }

  get fleeThreshold(): number {
    const p = getPersonality(this.nemesis.personality);
    if (this.mods.fleeThreshold === -1) return -1;
    return Math.max(this.mods.fleeThreshold, p.fleeAt);
  }

  spawn(x: number, z: number, facing: number): void {
    this.position.set(x, 0, z);
    this.facing = facing;
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = facing;
    this.patrolTarget.set(x, 0, z);
  }

  /* ============================================================
     damage
     ============================================================ */

  tryFlinch(fromX: number, fromZ: number, scale = 1): boolean {
    if (!this.alive) return false;
    const cs = this.combat.state;
    if (cs === 'broken' || cs === 'knockdown' || cs === 'dead') return false;
    if (this.staggerImmune > 0) return false;
    const band = STAGGER.duration[this.nemesis.archetype] ?? STAGGER.duration.fighter;
    const ri = rankIndex(this.nemesis.rank);
    const dur = (band[0] + Math.random() * (band[1] - band[0])) * (STAGGER.rankScale[ri] ?? 1) * scale;
    if (dur < 0.12) return false;
    this.combat.stagger(dur);
    this.staggerImmune = STAGGER.immunity + dur;
    const dx = this.position.x - fromX;
    const dz = this.position.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    const resist = this.nemesis.archetype === 'heavy' ? 0.45 : 1;
    this.velocity.x += (dx / l) * STAGGER.shove * resist;
    this.velocity.z += (dz / l) * STAGGER.shove * resist;
    return true;
  }

  applyDamage(info: DamageInfo): DamageResult {
    const res = emptyResult();
    if (!this.alive) return res;

    if (!info.unblockable && this.combat.state !== 'stagger' && this.combat.state !== 'knockdown') {
      if (this.mods.dodgeChance > 0 && Math.random() < this.mods.dodgeChance && info.source !== 'execute') {
        res.dodged = true;
        return res;
      }
      if (this.mods.blockChance > 0 && Math.random() < this.mods.blockChance && info.source !== 'execute') {
        res.blocked = true;
        this.combat.block(0.3);
        this.combat.addPosture(info.stagger * 0.4, this.mods.staggerResist);
        // the shield/guard visibly takes it
        this.rig.anim.playOneShot('BLOCK', 'BlockHit', 1.6);
        return res;
      }
    }

    let mul = this.mods.armour * this.tilt.armour;
    switch (info.source) {
      case 'light':
        mul *= this.mods.vsLight;
        break;
      case 'heavy':
        mul *= this.mods.vsHeavy;
        break;
      case 'fire':
        mul *= this.mods.vsFire;
        break;
      case 'ranged':
        mul *= this.mods.vsRanged;
        break;
      default:
        break;
    }
    if (info.fromBehind && !this.mods.rearGuard) {
      mul *= this.mods.vsBack;
      res.critical = true;
    }
    if (this.hp / this.maxHp < 0.3) mul *= 1 / Math.max(0.4, this.mods.desperationMul * 0.6 + 0.4);

    const amount = Math.max(1, info.amount * mul);
    this.hp -= amount;
    res.applied = amount;
    this.hurtFlash = 1;
    if (info.critical) res.critical = true;

    // directional flinch — additive, direction-true, never desyncs a hitbox
    {
      const dx = this.position.x - info.fromX;
      const dz = this.position.z - info.fromZ;
      const l = Math.hypot(dx, dz) || 1;
      this.lastHitDir.set(dx / l, 0, dz / l);
      this.rig.anim.notifyHit(dx / l, dz / l, this.facing, info.source === 'heavy' || amount > this.maxHp * 0.14);
    }

    if (info.ignite) {
      this.burning = Math.max(this.burning, 4);
      if (this.mods.fearsFire) this.escaping = true;
    }

    if (info.source === 'blast' && this.mods.fearsBlast) this.escaping = true;

    if (info.slowFactor !== undefined) {
      this.applySlow(info.slowFactor, info.slowDuration ?? 1.5);
    }

    if (info.poison) {
      this.poison += info.poison;
      if (this.poison >= POISON.threshold && this.poisonTimer <= 0) {
        this.poison = 0;
        this.poisonTimer = POISON.duration;
        this.poisonTick = 0;
        res.poisoned = true;
      }
    }

    const kb = info.knockback ?? 0;
    if (kb > 0) {
      const dx = this.position.x - info.fromX;
      const dz = this.position.z - info.fromZ;
      const len = Math.hypot(dx, dz) || 1;
      const resist = this.nemesis.archetype === 'heavy' ? 0.35 : 1;
      const cc = info.source === 'skill' ? this.combat.displaceScale() : 1;
      this.velocity.x += (dx / len) * kb * resist * cc;
      this.velocity.z += (dz / len) * kb * resist * cc;
      if (info.source === 'skill') this.combat.noteDisplace();
    }

    if (info.stagger > 0) {
      const interrupting = this.combat.state === 'windup' || this.combat.state === 'hold';
      const scale = (interrupting ? POSTURE.interruptBonus : 1) * (info.postureMul ?? 1);
      res.staggered = this.combat.addPosture(info.stagger * scale, this.mods.staggerResist);

      if (!res.staggered) {
        const fleeing = this.escaping || this.state === 'flee' || this.state === 'escape';
        if (info.source === 'heavy' || info.source === 'blast' || info.source === 'counter') {
          res.flinched = this.tryFlinch(info.fromX, info.fromZ, 1);
        } else if (info.source === 'ranged' && fleeing) {
          res.flinched = this.tryFlinch(info.fromX, info.fromZ, 0.9);
        }

        if (
          !res.flinched &&
          interrupting &&
          this.combat.interruptible &&
          (info.source === 'heavy' || (info.source === 'ranged' && info.stagger * (info.postureMul ?? 1) >= 18))
        ) {
          this.combat.stagger(0.45);
          res.flinched = true;
        }
      }
    }

    if (this.hp <= 0) {
      this.hp = 0;
      res.killed = true;
    }
    return res;
  }

  pullToward(x: number, z: number, speed: number): void {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const s = speed * this.combat.displaceScale();
    this.velocity.x += (dx / len) * s;
    this.velocity.z += (dz / len) * s;
    this.combat.noteDisplace();
  }

  currentDamage(): number {
    const low = this.hp / this.maxHp < 0.3;
    const p = getPersonality(this.nemesis.personality);
    const desperation = low ? Math.max(this.mods.desperationMul, p.desperation) : 1;
    return this.damage * desperation;
  }

  kill(): void {
    if (this.areaRing) this.areaRing.visible = false;
    if (this.areaFill) this.areaFill.visible = false;
    if (this.areaPulse) this.areaPulse.visible = false;
    this.alive = false;
    this.combat.die();
    this.state = 'dead';
    this.velocity.set(0, 0, 0);
    // fall away from the killing blow: struck from behind -> pitch forward
    const fx = -Math.sin(this.facing);
    const fz = -Math.cos(this.facing);
    const dot = this.lastHitDir.x * fx + this.lastHitDir.z * fz;
    this.deathClip = dot > 0.15 ? 'DeathB' : 'DeathA';
  }

  /* ============================================================
     update
     ============================================================ */

  update(dt: number, rdt: number): void {
    const anim = this.rig.anim;

    if (!this.alive) {
      if (!this.deathStarted) {
        this.deathStarted = true;
        anim.setAction('DEATH', this.deathClip, { mode: 'play', holdEnd: true });
        anim.setAim(0, 0, 0);
        anim.setWobble(0);
      }
      this.telegraphMat.opacity = 0;
      if (this.marker) this.marker.visible = false;
      anim.update(dt, rdt);
      return;
    }

    this.stateTime += dt;
    this.attackTimer -= dt;
    this.strafeTimer -= dt;
    if (this.staggerImmune > 0) this.staggerImmune -= dt;
    if (this.slowTimer > 0) this.slowTimer -= dt;
    if (this.hesitateTimer > 0) this.hesitateTimer -= dt;
    if (this.signatureCueCd > 0) this.signatureCueCd -= dt;
    if (this.backoffTimer > 0) this.backoffTimer -= dt;

    this.combat.update(dt, this.weapon, this.currentDamage(), this.mods);

    if (this.burning > 0) {
      this.burning -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.5;
        this.hp -= 3 * this.mods.vsFire;
        if (this.hp <= 0) this.hp = 0.01;
      }
    }

    if (this.poisonTimer > 0) {
      this.poisonTimer -= dt;
      this.poisonTick -= dt;
      if (this.poisonTick <= 0) {
        this.poisonTick = 0.5;
        this.hp -= this.poisonDps * 0.5;
        if (this.hp <= 0) this.hp = 0.01;
      }
    } else if (this.poison > 0) {
      this.poison = Math.max(0, this.poison - dt * 6);
    }

    const f = Math.max(0, 1 - 9 * dt);
    this.velocity.x *= f;
    this.velocity.z *= f;

    this.animate(dt, rdt);
  }

  faceToward(x: number, z: number, dt: number, rate = 7): void {
    const want = Math.atan2(-(x - this.position.x), -(z - this.position.z));
    this.facing = turnToward(this.facing, want, rate * dt);
  }

  /* ============================================================
     animation state mapping
     ============================================================ */

  private animate(dt: number, rdt: number): void {
    const rig = this.rig;
    const anim = rig.anim;
    rig.root.position.copy(this.position);
    rig.root.rotation.y = this.facing;
    this.pulseClock += rdt * 3;

    /* ---- locomotion feed (velocity into the character frame) ---- */
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const cos = Math.cos(-this.facing);
    const sin = Math.sin(-this.facing);
    const localX = this.velocity.x * cos - this.velocity.z * sin;
    const localZ = this.velocity.x * sin + this.velocity.z * cos;
    anim.setLocomotion(localX, localZ, speed, dt);

    const fleeing = this.state === 'flee' || this.state === 'escape';
    if (speed > 0.4) {
      anim.setLean(
        -Math.max(0, -localZ / Math.max(1, speed)) * Math.min(0.15, speed * 0.022) - (fleeing ? 0.08 : 0),
        (localX / Math.max(1, speed)) * Math.min(0.14, speed * 0.02)
      );
    } else {
      anim.setLean(0, 0);
    }

    /* ---- combat state -> animation state ---- */
    const cs = this.combat.state;
    let wobble = 0;

    if (cs === 'windup' || cs === 'hold' || cs === 'active' || cs === 'recover') {
      const def = this.combat.current;
      const clip = def ? clipForAttack(def) : 'Atk1H_A';
      const heavyAtk = def ? def.postureMul >= 1.3 || def.areaRadius > 0 : false;
      anim.setAction(heavyAtk ? 'HEAVY_ATTACK' : 'ATTACK', clip, { mode: 'scrub' });
      const pd = this.combat.phaseDurations;
      const t = this.combat.t;
      if (cs === 'windup') anim.scrubAttack('windup', t / Math.max(0.05, pd.windup));
      else if (cs === 'hold') anim.scrubAttack('hold', 1, 0.8);
      else if (cs === 'active') anim.scrubAttack('active', t / Math.max(0.02, pd.active));
      else anim.scrubAttack('recover', t / Math.max(0.05, pd.recover));
      this.staggerRateSet = false;
    } else if (cs === 'stagger') {
      // t counts DOWN in stagger — capture the full duration on entry
      if (!this.staggerRateSet) {
        this.staggerRateSet = true;
        const heavyHit = this.combat.t > 0.55;
        const clip = heavyHit ? 'HitHeavy' : 'HitLight';
        anim.setAction('STAGGER', clip, {
          mode: 'play',
          rate: CLIPS[clip].duration / Math.max(0.25, this.combat.t),
          restart: true,
        });
      }
      wobble = 0.35;
    } else if (cs === 'knockdown') {
      anim.setAction('KNOCKDOWN', 'Knockdown', {
        mode: 'play',
        rate: CLIPS.Knockdown.duration / Math.max(0.8, this.combat.t > 0 ? this.combat.t + 0.4 : 1.6),
        holdEnd: true,
      });
      this.staggerRateSet = false;
    } else if (cs === 'broken') {
      // wide open: frozen mid-recoil, swaying — the posture-break pose
      anim.setAction('BROKEN', 'HitHeavy', { mode: 'scrub' });
      anim.scrub(CLIPS.HitHeavy.duration * 0.62);
      wobble = 0.85;
      this.staggerRateSet = false;
    } else if (cs === 'block') {
      anim.setAction('BLOCK', 'BlockLoop', { mode: 'play' });
      this.staggerRateSet = false;
    } else {
      this.staggerRateSet = false;
      // taunts: arrogant nemeses showboat when the player is watched
      if (anim.stateName === 'TAUNT' || anim.stateName === 'NEMESIS_INTRO') {
        /* let it finish */
      } else {
        anim.clearSustained();
      }
    }
    anim.setWobble(wobble);

    /* ---- head/chest tracking + low health ---- */
    if (this.aimAt && cs !== 'knockdown' && cs !== 'broken') {
      const relYaw = wrapPi(
        Math.atan2(-(this.aimAt.x - this.position.x), -(this.aimAt.z - this.position.z)) - this.facing
      );
      anim.setAim(relYaw, 0, Math.abs(relYaw) < 1.6 ? 0.75 : 0);
    } else {
      anim.setAim(0, 0, 0);
    }
    anim.lowHealth = Math.max(0, 1 - this.hp / Math.max(1, this.maxHp * 0.35)) * 0.8;

    anim.update(dt, rdt);

    /* ============================================================
       telegraph — WHO / WHEN / WHERE / HOW, all at once
       ============================================================ */
    const winding = cs === 'windup' || cs === 'hold';
    if (winding) {
      const p = this.combat.windupProgress();
      const def = this.combat.current;
      const intent = this.combat.intent;
      const lead = p >= TELEGRAPH.colourLeadFraction || cs === 'hold';
      const colour = !lead
        ? NEON.amber
        : intent === 'parryable'
          ? SIGNAL.parryable
          : intent === 'unblockable'
            ? SIGNAL.unblockable
            : SIGNAL.enemyAttack;

      // A held strike stops pulsing and sits still — the stillness is the tell.
      const pulse = cs === 'hold' ? 0.85 : 0.55 + Math.abs(Math.sin(p * Math.PI * 5)) * 0.45;
      this.telegraphMat.opacity = (0.42 + p * 0.58) * pulse;
      this.telegraphMat.color.setHex(colour);
      this.telegraph.scale.setScalar(1.4 - p * 0.5);
      this.telegraph.rotation.y += rdt * (4 + p * 8);

      const glowK = lead ? 0.35 + p * 0.65 : 0.15;
      for (let i = 0; i < this.glowMats.length; i++) {
        this.glowMats[i].color.copy(this.glowBase[i]).lerp(TELE_COLOR.setHex(colour), glowK * pulse);
      }

      if (def && !def.interruptible && lead) {
        const armour = 0.5 + Math.sin(this.pulseClock * 7.3) * 0.5;
        rig.skin.color.copy(this.baseSkin).lerp(WHITE, armour * 0.3);
      }

      // Ground danger circle: fixed ring (WHERE) + filling disc + CONTRACTING
      // pulse ring whose brightness rises into the impact (WHEN).
      if (def && def.areaRadius > 0 && this.areaRing && this.areaRingMat && this.areaFill && this.areaFillMat) {
        const parent = this.rig.root.parent;
        if (parent && !this.areaRing.parent) parent.add(this.areaRing, this.areaFill, this.areaPulse!);
        this.areaRing.visible = true;
        this.areaFill.visible = true;
        this.areaRing.position.set(this.position.x, 0.06, this.position.z);
        this.areaFill.position.set(this.position.x, 0.05, this.position.z);
        this.areaRing.scale.setScalar(def.areaRadius);
        this.areaFill.scale.setScalar(def.areaRadius * p);
        this.areaRingMat.color.setHex(colour);
        this.areaFillMat.color.setHex(colour);
        this.areaRingMat.opacity = 0.35 + p * 0.35;
        this.areaFillMat.opacity = 0.1 + p * 0.14;
        if (this.areaPulse && this.areaPulseMat) {
          this.areaPulse.visible = true;
          this.areaPulse.position.set(this.position.x, 0.07, this.position.z);
          // contracts from 1.45R onto the boundary as p -> 1
          this.areaPulse.scale.setScalar(def.areaRadius * (1.45 - 0.45 * p));
          this.areaPulseMat.color.setHex(colour);
          this.areaPulseMat.opacity = (0.12 + p * 0.55) * (cs === 'hold' ? 1 : pulse);
        }
      }
    } else {
      this.telegraphMat.opacity = Math.max(0, this.telegraphMat.opacity - rdt * 6);
      for (let i = 0; i < this.glowMats.length; i++) {
        this.glowMats[i].color.lerp(this.glowBase[i], Math.min(1, rdt * 9));
      }
      if (this.areaRing && this.areaRingMat && this.areaRing.visible) {
        this.areaRingMat.opacity = Math.max(0, this.areaRingMat.opacity - rdt * 5);
        if (this.areaFillMat) this.areaFillMat.opacity = Math.max(0, this.areaFillMat.opacity - rdt * 5);
        if (this.areaPulseMat) this.areaPulseMat.opacity = Math.max(0, this.areaPulseMat.opacity - rdt * 6);
        if (this.areaRingMat.opacity <= 0) {
          this.areaRing.visible = false;
          if (this.areaFill) this.areaFill.visible = false;
          if (this.areaPulse) this.areaPulse.visible = false;
        }
      }
    }

    /* posture break reads as a full-body white-out */
    if (this.combat.broken) {
      const flick = 0.55 + Math.sin(this.pulseClock * 4.7) * 0.25;
      for (let i = 0; i < this.glowMats.length; i++) {
        this.glowMats[i].color.copy(this.glowBase[i]).lerp(WHITE, flick);
      }
    }

    if (this.marker && this.markerMat) {
      this.marker.rotation.y += rdt * 1.6;
      this.markerMat.opacity = 0.45 + Math.sin(this.pulseClock * 0.5) * 0.22;
    }

    /* damage flash */
    if (this.hurtFlash > 0) {
      this.hurtFlash = Math.max(0, this.hurtFlash - rdt * 5.5);
      rig.skin.color.copy(this.baseSkin).lerp(WHITE, this.hurtFlash * 0.85);
    } else if (this.burning > 0) {
      rig.skin.color.copy(this.baseSkin).lerp(FIRE, 0.35 + Math.sin(this.pulseClock * 2) * 0.15);
    } else if (this.poisonTimer > 0) {
      rig.skin.color.copy(this.baseSkin).lerp(ACID, 0.3 + Math.sin(this.pulseClock * 1.7) * 0.12);
    } else {
      rig.skin.color.copy(this.baseSkin);
    }
  }

  /** Taunt / intro pose — named arrivals and killer celebrations. */
  taunt(clip = 'Taunt', rate = 1.15): boolean {
    this.hasTaunted = true;
    // TAUNT, not NEMESIS_INTRO — the intro state belongs to the encounter
    // director's staged pose; a mid-fight showboat is its own thing and the
    // QA/anim readout tells them apart.
    return this.rig.anim.playOneShot('TAUNT', clip, rate);
  }

  celebrate(clip = 'Taunt', rate = 1.15): boolean {
    return this.rig.anim.playOneShot('TAUNT', clip, rate);
  }

  dispose(): void {
    // NOTE: the chrome geometries are SHARED across every enemy (CHROME_GEO)
    // and must never be disposed here — only the per-instance materials are
    // ours to free. Disposing a shared geometry would blank the telegraph on
    // every other enemy on the field.
    for (const m of [this.areaRing, this.areaFill, this.areaPulse]) {
      if (!m) continue;
      m.parent?.remove(m);
    }
    this.areaRingMat?.dispose();
    this.areaFillMat?.dispose();
    this.areaPulseMat?.dispose();
    for (const m of this.glowMats) m.dispose();
    this.telegraph.parent?.remove(this.telegraph);
    this.telegraphMat.dispose();
    this.marker?.parent?.remove(this.marker);
    this.markerMat?.dispose();
    this.rig.skin.dispose();
    this.rig.anim.dispose();
    this.rig.root.parent?.remove(this.rig.root);
  }
}

/**
 * Per-enemy "chrome" — the telegraph cone, the ground danger ring/fill/pulse
 * and the named-enemy marker. Every enemy's copy was identical, so a crowd of
 * sixteen was uploading sixty-four indistinguishable buffers to the GPU and
 * churning them on every spawn and despawn. One shared set instead; the
 * materials stay per-instance because colour and opacity are the signal.
 */
const CHROME_GEO = {
  telegraph: new THREE.ConeGeometry(0.34, 0.6, 4),
  areaRing: new THREE.RingGeometry(0.93, 1, 48, 1),
  areaFill: new THREE.CircleGeometry(1, 40),
  areaPulse: new THREE.RingGeometry(0.9, 1, 48, 1),
  marker: new THREE.OctahedronGeometry(0.16, 0),
  contact: new THREE.RingGeometry(0.72, 1, 28, 1),
};

const TELE_COLOR = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const FIRE = new THREE.Color(0xff6a20);
const ACID = new THREE.Color(SIGNAL.poison);

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
