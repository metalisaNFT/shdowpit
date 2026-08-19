/**
 * The player entity: rig, animation, stats and the glue between the
 * controller and the combat state machine.
 *
 * The player reads as a pale, sharp silhouette against charcoal enemies — the
 * one thing on screen that is brighter than the environment.
 *
 * As of the animation sprint the player is built on the SHADOW PIT HUMANOID
 * RIG (src/anim/Rig.ts, docs/RIG.md) and animated by CharacterAnimator with
 * baked CC0 clips + procedural additive layers. Combat actions SCRUB their
 * clips from the combat state machine's clock, so the blade can never drift
 * from the hitbox.
 */

import * as THREE from 'three';
import type { Combatant, DamageInfo, DamageResult } from '../combat/Types';
import { emptyResult } from '../combat/Types';
import { PlayerStats } from './PlayerStats';
import { PlayerCombat, RANGED_THROW_TIME } from './PlayerCombat';
import { PlayerController } from './PlayerController';
import { playerWeapon, type WeaponDef } from '../data/weapons';
import type { Arena } from '../world/Arena';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import type { Input } from '../core/Input';
import { SIGNAL, WORLD } from '../data/palette';
import { buildSkeleton, limbMesh, SEG, type SPRig } from '../anim/Rig';
import { CharacterAnimator } from '../anim/Animator';
import { CLIPS } from '../anim/ClipLibrary';
import { PLAYER } from '../data/balance';

const SKIN = 0xb9bcc2;
const TRIM = 0x15171c;
const ACCENT = SIGNAL.player;

/** Uniform rig scale: source rig is 1.40 tall; the player stands ~2.1 m. */
const PLAYER_SCALE = 1.5;

export class Player implements Combatant {
  readonly uid = 1;
  readonly isPlayer = true;

  position = new THREE.Vector3(0, 0, 20);
  facing = 0;
  radius = 0.52;
  height = 1.95;
  displayName = 'YOU';

  stats = new PlayerStats();
  combat = new PlayerCombat();
  controller = new PlayerController();

  /** the rig root — ground level, owns yaw and scale */
  readonly root: THREE.Group;
  readonly rig: SPRig;
  readonly anim: CharacterAnimator;

  private weaponMesh: THREE.Object3D | null = null;
  /** world anchors on the blade, for trails */
  readonly weaponTipAnchor = new THREE.Object3D();
  readonly weaponBaseAnchor = new THREE.Object3D();
  private trailMat!: THREE.MeshBasicMaterial;

  /** rendered yaw, which lags `facing` — see animate() */
  private rigYaw = 0;
  private hurtFlash = 0;
  private skinMat!: THREE.MeshLambertMaterial;
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private deathClip: 'DeathA' | 'DeathB' = 'DeathA';
  private lockPoint: THREE.Vector3 | null = null;

  /** debug/test invulnerability: takes no damage at all */
  godMode = false;

  /** world-space marker in front of the visor; see faceDirection() */
  readonly faceAnchor = new THREE.Object3D();
  private faceTmpA = new THREE.Vector3();
  private faceTmpB = new THREE.Vector3();

  /** burning DoT */
  burning = 0;
  private burnTick = 0;

  /** afterimages left by PHANTOM */
  phantoms: Array<{ x: number; z: number; life: number; mesh: THREE.Mesh }> = [];
  private phantomGeo: THREE.BoxGeometry | null = null;

  get hp(): number {
    return this.stats.hp;
  }
  set hp(v: number) {
    this.stats.hp = v;
  }
  get maxHp(): number {
    return this.stats.maxHp;
  }
  set maxHp(v: number) {
    this.stats.maxHp = v;
  }
  get alive(): boolean {
    return this.stats.hp > 0 && this.combat.action !== 'dead';
  }
  set alive(_v: boolean) {
    /* derived */
  }

  constructor() {
    this.rig = buildSkeleton(PLAYER_SCALE);
    this.root = this.rig.root;
    this.anim = new CharacterAnimator(this.rig);
    this.buildBody();
    this.rebuildWeapon();
  }

  get weapon(): WeaponDef {
    return playerWeapon(this.stats.weaponId);
  }

  /**
   * Teleport the rendered yaw to the logical one. Only for test hooks that set
   * `facing` directly — normal gameplay turns the camera, which the rig
   * follows smoothly.
   */
  snapFacing(): void {
    this.rigYaw = this.facing;
    this.root.rotation.y = this.rigYaw;
  }

  /**
   * The direction the model's FACE is rendered pointing, on XZ, unit length.
   * Derived from the actual scene graph, so it catches any regression in the
   * rig's forward axis — compare against (-sin facing, -cos facing).
   */
  faceDirection(out: THREE.Vector3): THREE.Vector3 {
    this.faceAnchor.updateWorldMatrix(true, false);
    this.faceAnchor.getWorldPosition(this.faceTmpA);
    this.rig.bones.Head.updateWorldMatrix(true, false);
    this.rig.bones.Head.getWorldPosition(this.faceTmpB);
    out.set(this.faceTmpA.x - this.faceTmpB.x, 0, this.faceTmpA.z - this.faceTmpB.z);
    const l = out.length();
    return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, 0, -1);
  }

  /**
   * QA-only readout of the rig's actual rendered pose. Animation snapping and
   * foot sliding are frame-to-frame properties of these numbers, so they come
   * from the rig itself rather than from the logical state. All values are
   * continuous scalars (see tools/qa.mjs's snap detector).
   */
  qaRig(): { rigYaw: number; armR: number; bodyX: number; bodyY: number; walkPhase: number } {
    return {
      rigYaw: this.root.rotation.y,
      armR: this.anim.armAngle(),
      bodyX: this.anim.chestPitch(),
      bodyY: this.anim.hipsOffsetY(),
      walkPhase: this.anim.locoPhase * Math.PI * 2,
    };
  }

  /* ============================================================
     body — pale boxes on the standard skeleton
     ============================================================ */

  /**
   * THE FACING CONVENTION, once and for all: yaw 0 faces -Z, forward is
   * (-sin yaw, 0, -cos yaw). The skeleton's rest pose ships facing -Z (the
   * 180° from the source pack is baked in tools/bakeclips.mjs) — so the visor
   * and chest glow attach on the bones' -Z side with NO compensation here,
   * and none is allowed anywhere else.
   */
  private buildBody(): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(0.5, 1, 4);
    this.disposables.push(box, cone);

    this.skinMat = new THREE.MeshLambertMaterial({ color: SKIN, flatShading: true });
    const trimMat = new THREE.MeshLambertMaterial({ color: TRIM, flatShading: true });
    const glowMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, fog: false });
    this.trailMat = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.35,
      toneMapped: false,
      fog: false,
      depthWrite: false,
    });
    this.disposables.push(this.skinMat, trimMat, glowMat, this.trailMat);

    const B = this.rig.bones;

    // pelvis + torso: hips box on Hips, lower torso on Spine, chest on Chest
    const pelvis = limbMesh(box, trimMat, 0.4, 0.2, 0.26);
    pelvis.position.y = 0.02;
    B.Hips.add(pelvis);

    const lower = limbMesh(box, this.skinMat, 0.36, SEG.chestLen * 0.94, 0.24);
    B.Spine.add(lower);

    const chest = limbMesh(box, this.skinMat, 0.46, SEG.headLen * 0.95, 0.3);
    B.Chest.add(chest);

    // chest glow — on the FRONT, which is -Z
    const mark = new THREE.Mesh(box, glowMat);
    mark.scale.set(0.1, 0.2, 0.02);
    mark.position.set(0, SEG.headLen * 0.5, -0.16);
    B.Chest.add(mark);

    // head
    const headMesh = new THREE.Mesh(box, this.skinMat);
    headMesh.scale.set(0.26, 0.28, 0.26);
    headMesh.position.y = 0.12;
    headMesh.castShadow = true;
    const visor = new THREE.Mesh(box, glowMat);
    visor.scale.set(0.22, 0.05, 0.02);
    visor.position.set(0, 0.14, -0.14);
    const crest = new THREE.Mesh(cone, trimMat);
    crest.scale.set(0.1, 0.3, 0.1);
    crest.position.set(0, 0.3, 0.04);
    B.Head.add(headMesh, visor, crest);
    // QA anchor just past the visor; faceDirection() reads it back.
    this.faceAnchor.position.set(0, 0.14, -0.45);
    B.Head.add(this.faceAnchor);

    // arms
    for (const side of ['L', 'R'] as const) {
      const up = limbMesh(box, this.skinMat, 0.13, SEG.upperArm, 0.13);
      B[`UpperArm_${side}`].add(up);
      const lo = limbMesh(box, trimMat, 0.11, SEG.lowerArm * 0.92, 0.11);
      B[`LowerArm_${side}`].add(lo);
      const hand = new THREE.Mesh(box, this.skinMat);
      hand.scale.set(0.11, 0.12, 0.11);
      hand.position.y = 0.03;
      hand.castShadow = true;
      B[`Hand_${side}`].add(hand);
    }

    // legs
    for (const side of ['L', 'R'] as const) {
      const up = limbMesh(box, trimMat, 0.15, SEG.upperLeg, 0.16);
      B[`UpperLeg_${side}`].add(up);
      const lo = limbMesh(box, trimMat, 0.13, SEG.lowerLeg, 0.14);
      B[`LowerLeg_${side}`].add(lo);
      const foot = new THREE.Mesh(box, this.skinMat);
      foot.scale.set(0.12, 0.08, 0.2);
      foot.position.set(0, SEG.foot * 0.55, 0);
      foot.castShadow = true;
      B[`Foot_${side}`].add(foot);
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
  }

  /**
   * Weapon on the HandSlot_R mount. Blade extends along the slot's +Y (which
   * points along the character's forward at rest). Weapon defs are sized in
   * world metres; the rig is uniformly scaled, so sizes divide by the scale.
   */
  rebuildWeapon(): void {
    if (this.weaponMesh) {
      this.rig.bones.HandSlot_R.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    const def = this.weapon;
    const k = 1 / PLAYER_SCALE;
    const g = new THREE.Group();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const steelMat = new THREE.MeshLambertMaterial({
      color: def.id === 'sunblade' ? SIGNAL.critical : def.id === 'ashfang' ? SIGNAL.unblockable : WORLD.metal,
      flatShading: true,
    });
    const gripMat = new THREE.MeshLambertMaterial({ color: WORLD.shadow, flatShading: true });
    this.disposables.push(box, steelMat, gripMat);

    const len = def.bladeLen * k;
    const w = def.bladeWidth * 1.4 * k;

    const blade = new THREE.Mesh(box, steelMat);
    blade.scale.set(w, len, w * 0.34);
    blade.position.y = len * 0.5;
    blade.castShadow = true;

    const guard = new THREE.Mesh(box, gripMat);
    guard.scale.set(w * 4, 0.05, w * 1.4);

    const grip = new THREE.Mesh(box, gripMat);
    grip.scale.set(w * 1.2, 0.2, w * 1.2);
    grip.position.y = -0.11;

    g.add(blade, guard, grip);
    if (def.id === 'sunblade' || def.id === 'ashfang' || def.id === 'longtooth') {
      const glowMat = new THREE.MeshBasicMaterial({
        color: def.id === 'sunblade' ? SIGNAL.critical : def.id === 'ashfang' ? SIGNAL.unblockable : SIGNAL.parryable,
        toneMapped: false,
        fog: false,
      });
      this.disposables.push(glowMat);
      const edge = new THREE.Mesh(box, glowMat);
      edge.scale.set(w * 0.4, len * 0.94, w * 0.12);
      edge.position.set(w * 0.4, len * 0.5, 0);
      g.add(edge);
    }

    this.weaponTipAnchor.position.set(0, len, 0);
    this.weaponBaseAnchor.position.set(0, 0.05, 0);
    g.add(this.weaponTipAnchor, this.weaponBaseAnchor);

    this.weaponMesh = g;
    this.rig.bones.HandSlot_R.add(g);
  }

  /* ============================================================
     lifecycle
     ============================================================ */

  spawn(x: number, z: number, facing: number, vigour: number, weaponId: string): void {
    this.position.set(x, 0, z);
    this.facing = facing;
    this.stats.reset(vigour, weaponId);
    this.combat.reset();
    this.controller.stop();
    this.burning = 0;
    this.hurtFlash = 0;
    this.clearPhantoms();
    this.rebuildWeapon();
    this.anim.reset();
    this.root.visible = true;
  }

  /* ============================================================
     damage
     ============================================================ */

  applyDamage(info: DamageInfo): DamageResult {
    const res = emptyResult();
    if (!this.alive) return res;
    if (this.godMode) {
      res.dodged = true;
      return res;
    }

    if (this.combat.invulnerable && !info.unblockable) {
      res.dodged = true;
      return res;
    }
    /* skill armor: still take the hit, but do not stagger — red melee still staggers */
    const armored = this.combat.skillArmor > 0 && !info.unblockable;

    let amount = info.amount * this.stats.defenceMultiplier();
    if (this.stats.powers.has('momentum')) this.stats.momentum = 0;

    amount = Math.max(1, amount);

    if (this.stats.hp - amount <= 0 && this.stats.powers.has('second_wind') && !this.stats.secondWindUsed) {
      this.stats.secondWindUsed = true;
      this.stats.hp = Math.max(12, Math.round(this.stats.maxHp * 0.22));
      res.applied = amount;
      this.hurtFlash = 1;
      return res;
    }

    this.stats.hp -= amount;
    res.applied = amount;
    this.hurtFlash = 1;
    if (this.stats.run && this.stats.run.remnants > 0 && amount > 8) {
      this.stats.run.remnants = Math.max(0, this.stats.run.remnants - 1);
      this.stats.run.remnantUnstable += 0.2;
    }

    if (info.ignite) this.burning = Math.max(this.burning, 3);

    const kb = info.knockback ?? 3;
    const dx = this.position.x - info.fromX;
    const dz = this.position.z - info.fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.controller.knockback(dx / len, dz / len, kb);

    // Directional flinch — always additive; a full-body react only when the
    // body is actually free (never desync a swing from its live hitbox).
    const heavyBlow = amount > this.stats.maxHp * 0.12;
    this.anim.notifyHit(dx / len, dz / len, this.rigYaw, heavyBlow);
    if (this.combat.action === 'idle' && heavyBlow) {
      this.anim.playOneShot('HIT_REACT', 'HitLight', 1.35);
    }

    if (!armored && (info.stagger > 16 || amount > this.stats.maxHp * 0.18)) {
      this.combat.stagger();
      res.staggered = true;
    }

    if (this.stats.hp <= 0) {
      this.stats.hp = 0;
      // fall away from the blow if it came from behind, toward it otherwise
      const fx = -Math.sin(this.facing);
      const fz = -Math.cos(this.facing);
      const fromBehind = (dx * fx + dz * fz) / len > 0.2;
      this.deathClip = fromBehind ? 'DeathB' : 'DeathA';
      this.combat.die();
      res.killed = true;
    }
    return res;
  }

  /* ============================================================
     update
     ============================================================ */

  update(
    dt: number,
    rdt: number,
    input: Input,
    camera: ThirdPersonCamera,
    arena: Arena,
    lockPoint: THREE.Vector3 | null
  ): void {
    this.stats.tick(dt);
    this.combat.attackSpeedMul = this.stats.stat('attackSpeed');
    this.combat.parryWindowMul = this.stats.stat('parryWindow');
    this.combat.dodgeCooldownMul = this.stats.stat('dodgeCooldown');
    this.combat.update(dt, this.weapon, this.stats);
    this.lockPoint = lockPoint;

    if (this.alive) {
      this.controller.update(
        dt,
        input,
        camera,
        arena,
        this.combat,
        this.position,
        this.radius,
        this.stats.moveSpeedMultiplier(),
        lockPoint,
        (y) => {
          this.facing = y;
        },
        this.facing,
        this.stats.powers.has('blink')
      );
    } else {
      this.controller.stop();
    }

    if (this.burning > 0) {
      this.burning -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.5;
        this.stats.hp = Math.max(0, this.stats.hp - 2);
        if (this.stats.hp <= 0) this.combat.die();
      }
    }

    this.updatePhantoms(dt);
    this.animate(dt, rdt);
  }

  /* ============================================================
     animation — state mapping + additive inputs
     ============================================================ */

  private animate(dt: number, rdt: number): void {
    const c = this.combat;
    const anim = this.anim;

    this.root.position.set(this.position.x, this.position.y, this.position.z);

    // Turn at a finite rate; the hit arc still uses the logical facing.
    const yawErr = wrapPi(this.facing - this.rigYaw);
    const turnRate = c.action === 'attack' || c.action === 'execute' ? 23 : 14;
    const step = Math.sign(yawErr) * Math.min(Math.abs(yawErr), turnRate * rdt);
    this.rigYaw = wrapPi(this.rigYaw + step);
    this.root.rotation.y = this.rigYaw;

    // locomotion in the character frame
    const v = this.controller.velocity;
    const speed = Math.hypot(v.x, v.z);
    const cos = Math.cos(-this.rigYaw);
    const sin = Math.sin(-this.rigYaw);
    const localX = v.x * cos - v.z * sin;
    const localZ = v.x * sin + v.z * cos;
    anim.setLocomotion(localX, localZ, speed, dt);

    // lean into travel; extra when sprinting
    if (speed > 0.4) {
      const fwdLean = -Math.max(0, -localZ / Math.max(1, speed)) * Math.min(0.17, speed * 0.02) - (this.controller.sprinting ? 0.06 : 0);
      const sideLean = (localX / Math.max(1, speed)) * Math.min(0.16, speed * 0.022);
      anim.setLean(fwdLean, sideLean);
    } else {
      anim.setLean(0, 0);
    }

    /* ---- state mapping ---- */
    switch (c.action) {
      case 'attack': {
        const heavy = c.attackKind === 'heavy';
        const clip = heavy ? 'Atk2H_Slam' : LIGHT_CLIPS[c.comboIndex] ?? LIGHT_CLIPS[0];
        anim.setAction(heavy ? 'HEAVY_ATTACK' : 'ATTACK', clip, { mode: 'scrub' });
        const t = c.timings(this.weapon);
        const t01 =
          c.phase === 'windup'
            ? c.t / Math.max(0.01, t.windup)
            : c.phase === 'active'
              ? c.t / Math.max(0.01, t.active)
              : c.t / Math.max(0.01, t.recover);
        anim.scrubAttack(c.phase, t01);
        break;
      }
      case 'dodge': {
        const rel = wrapPi(Math.atan2(-c.dodgeX, -c.dodgeZ) - this.rigYaw);
        const clip =
          Math.abs(rel) < Math.PI * 0.25
            ? 'DodgeF'
            : Math.abs(rel) > Math.PI * 0.75
              ? 'DodgeB'
              : rel > 0
                ? 'DodgeL'
                : 'DodgeR';
        anim.setAction('DODGE', clip, { mode: 'scrub' });
        anim.scrub(c.dodgeProgress() * (CLIPS[clip].duration - 0.01));
        break;
      }
      case 'parry': {
        anim.setAction('PARRY', 'Parry', { mode: 'scrub' });
        const p = c.parryProgress();
        const impact = CLIPS.Parry.impactT ?? 0.375;
        const t = p < 0.35 ? (p / 0.35) * impact : impact + ((p - 0.35) / 0.65) * 0.4;
        anim.scrub(t);
        break;
      }
      case 'skill':
      case 'ultimate': {
        const id = c.skillId;
        const clip =
          id === 'shadow_step'
            ? 'DodgeF'
            : id === 'void_grasp'
              ? 'AtkThrust'
              : id === 'pit_eruption'
                ? 'Atk2H_Slam'
                : 'Atk2H_Slam';
        const state = 'ABILITY';
        anim.setAction(state, clip, { mode: 'scrub' });
        const p = c.skillProgress();
        if (p < 0.35) anim.scrubAttack('windup', p / 0.35);
        else if (p < 0.55) anim.scrubAttack('active', (p - 0.35) / 0.2);
        else anim.scrubAttack('recover', (p - 0.55) / 0.45);
        break;
      }
      case 'stagger': {
        anim.setAction('STAGGER', 'HitHeavy', {
          mode: 'play',
          rate: CLIPS.HitHeavy.duration / Math.max(0.2, PLAYER.staggerDuration),
        });
        anim.setWobble(0.5);
        break;
      }
      case 'execute': {
        anim.setAction('EXECUTION', 'AtkExecute', { mode: 'scrub' });
        const p = c.executeProgress();
        if (p < 0.45) anim.scrubAttack('windup', p / 0.45);
        else anim.scrubAttack(p < 0.58 ? 'active' : 'recover', p < 0.58 ? (p - 0.45) / 0.13 : (p - 0.58) / 0.42);
        break;
      }
      case 'dead': {
        anim.setAction('DEATH', this.deathClip, { mode: 'play', holdEnd: true });
        break;
      }
      default: {
        anim.clearSustained();
        anim.setWobble(0);
        break;
      }
    }

    /* ---- aim at the lock target (head + chest track) ---- */
    if (this.lockPoint && c.action !== 'dead') {
      const relYaw = wrapPi(
        Math.atan2(-(this.lockPoint.x - this.position.x), -(this.lockPoint.z - this.position.z)) - this.rigYaw
      );
      anim.setAim(relYaw, 0, Math.abs(relYaw) < 1.5 ? 0.85 : 0);
    } else {
      anim.setAim(0, 0, 0);
    }

    /* ---- VOID NEEDLE throw overlay ---- */
    anim.setThrow(c.rangedTimer > 0 ? 1 - c.rangedTimer / RANGED_THROW_TIME : -1);

    /* ---- low health posture ---- */
    anim.lowHealth = this.alive ? Math.max(0, 1 - this.stats.hp / Math.max(1, this.stats.maxHp * 0.35)) * 0.7 : 0;

    anim.update(dt, rdt);

    /* damage flash */
    if (this.hurtFlash > 0) {
      this.hurtFlash = Math.max(0, this.hurtFlash - rdt * 5);
      this.skinMat.color.setHex(SKIN).lerp(HURT_COLOR, this.hurtFlash);
    }
    if (this.burning > 0) {
      this.skinMat.color.lerp(FIRE_COLOR, 0.05);
    }
  }

  /* ============================================================
     PHANTOM afterimages
     ============================================================ */

  spawnPhantom(scene: THREE.Object3D): void {
    if (!this.phantomGeo) this.phantomGeo = new THREE.BoxGeometry(0.6, 1.7, 0.36);
    const m = new THREE.Mesh(this.phantomGeo, this.trailMat);
    m.position.set(this.position.x, 0.95, this.position.z);
    m.rotation.y = this.facing;
    scene.add(m);
    this.phantoms.push({ x: this.position.x, z: this.position.z, life: 2.4, mesh: m });
  }

  private updatePhantoms(dt: number): void {
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const p = this.phantoms[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 3;
      p.mesh.scale.setScalar(Math.max(0.01, p.life / 2.4));
      if (p.life <= 0) {
        p.mesh.parent?.remove(p.mesh);
        this.phantoms.splice(i, 1);
      }
    }
  }

  clearPhantoms(): void {
    for (const p of this.phantoms) p.mesh.parent?.remove(p.mesh);
    this.phantoms.length = 0;
  }

  /** World position of the weapon tip, for trail effects. */
  weaponTip(out: THREE.Vector3): THREE.Vector3 {
    if (!this.weaponMesh) return out.copy(this.position);
    this.weaponTipAnchor.getWorldPosition(out);
    return out;
  }

  /** World position of the weapon guard, for trail ribbons. */
  weaponBase(out: THREE.Vector3): THREE.Vector3 {
    if (!this.weaponMesh) return out.copy(this.position);
    this.weaponBaseAnchor.getWorldPosition(out);
    return out;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.phantomGeo?.dispose();
    this.anim.dispose();
    this.clearPhantoms();
  }
}

const LIGHT_CLIPS = ['Atk1H_A', 'Atk1H_B', 'Atk1H_C'] as const;
const HURT_COLOR = new THREE.Color(SIGNAL.unblockable);
const FIRE_COLOR = new THREE.Color(0xff6a20);

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
