/**
 * CharacterAnimator — one animation brain for every humanoid.
 *
 * Four layers, applied in order every frame:
 *
 *   1. LOCOMOTION  velocity-blended Idle/Walk/Run/Strafe/Backpedal, all
 *                  phase-locked to one cycle so blending never scissors legs.
 *   2. ACTION      the current full-body state (attack, dodge, parry, hit,
 *                  stagger, death...). States have strict priorities; a lower
 *                  state can never interrupt a higher one. Combat actions are
 *                  SCRUBBED: the combat state machine's phase drives the clip
 *                  time through the strike anchor (impactT), so the blade and
 *                  the hitbox share one clock at any attack speed.
 *   3. ADDITIVE    procedural offsets on top of the clips: aim at target,
 *                  velocity lean, directional hit flinch, personality stance,
 *                  low-health slump, stagger wobble, hold shiver, breathing.
 *   4. QA          continuous readouts for the snap detector and facing tests.
 *
 * The animator owns BONES ONLY. Root position/yaw stay with the entity
 * (facing is gameplay state); the animator never moves the character.
 */

import * as THREE from 'three';
import { CLIPS, clipMeta } from './ClipLibrary';
import type { SPRig } from './Rig';
import { SEG } from './Rig';

export type AnimState =
  | 'IDLE'
  | 'LOCOMOTION'
  | 'ATTACK'
  | 'HEAVY_ATTACK'
  | 'ABILITY'
  | 'DODGE'
  | 'PARRY'
  | 'BLOCK'
  | 'HIT_REACT'
  | 'STAGGER'
  | 'BROKEN'
  | 'KNOCKDOWN'
  | 'EXECUTION'
  | 'TAUNT'
  | 'NEMESIS_INTRO'
  | 'DEATH';

/** Higher wins. LOCOMOTION/IDLE are the floor the action layer sits on. */
export const STATE_PRIORITY: Record<AnimState, number> = {
  DEATH: 100,
  EXECUTION: 90,
  KNOCKDOWN: 85,
  BROKEN: 80,
  STAGGER: 70,
  HIT_REACT: 60,
  HEAVY_ATTACK: 52,
  ATTACK: 50,
  ABILITY: 50,
  PARRY: 45,
  DODGE: 40,
  BLOCK: 38,
  TAUNT: 30,
  NEMESIS_INTRO: 32,
  LOCOMOTION: 10,
  IDLE: 0,
};

/** Crossfade seconds into each state. Exits use the incoming state's fade. */
const FADE_IN: Record<AnimState, number> = {
  DEATH: 0.14,
  EXECUTION: 0.07,
  KNOCKDOWN: 0.12,
  BROKEN: 0.16,
  STAGGER: 0.06,
  HIT_REACT: 0.05,
  HEAVY_ATTACK: 0.08,
  ATTACK: 0.06,
  ABILITY: 0.07,
  PARRY: 0.05,
  DODGE: 0.06,
  BLOCK: 0.09,
  TAUNT: 0.14,
  NEMESIS_INTRO: 0.12,
  LOCOMOTION: 0.14,
  IDLE: 0.18,
};

/** How the active window maps around a clip's strike anchor, seconds. */
const STRIKE_PRE = 0.03;
const STRIKE_POST = 0.11;

export interface StanceParams {
  /** forward body lean, radians (+ = toward the enemy) */
  lean: number;
  /** hips drop, source units (assassin crouch) */
  crouch: number;
  /** head pitch offset (+ = chin down) */
  headDown: number;
  /** arm flare outward, radians */
  armsOut: number;
  /** random idle tremble amplitude */
  twitch: number;
}

export const NEUTRAL_STANCE: StanceParams = { lean: 0, crouch: 0, headDown: 0, armsOut: 0, twitch: 0 };

interface ActionSlot {
  state: AnimState;
  clip: string;
  action: THREE.AnimationAction;
  mode: 'scrub' | 'play';
  /** for one-shots: drop when the clip finishes */
  oneShot: boolean;
  /** freeze at the end instead of dropping (deaths, knockdown) */
  holdEnd: boolean;
  rate: number;
}

const LOCO_CLIPS = ['Walk', 'WalkProud', 'Run', 'StrafeL', 'StrafeR', 'WalkBack'] as const;

export class CharacterAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();

  private idleAction: THREE.AnimationAction;
  private loco: Record<(typeof LOCO_CLIPS)[number], THREE.AnimationAction>;
  private locoWeights = { Idle: 1, Walk: 0, WalkProud: 0, Run: 0, StrafeL: 0, StrafeR: 0, WalkBack: 0 };
  /** shared normalized gait cycle, 0..1 */
  locoPhase = Math.random();
  private locoAmount = 0;

  private current: ActionSlot | null = null;
  private actionLayerWeight = 0;

  /* ---- additive state ---- */
  stance: StanceParams = { ...NEUTRAL_STANCE };
  /** personality walk: swap Walk for WalkProud when far/idle-ish */
  proudWalk = false;
  private aimYaw = 0;
  private aimPitch = 0;
  private aimWeight = 0;
  private aimYawTarget = 0;
  private aimPitchTarget = 0;
  private aimWeightTarget = 0;
  private leanX = 0;
  private leanZ = 0;
  private leanXT = 0;
  private leanZT = 0;
  private flinchX = 0;
  private flinchZ = 0;
  private flinchVX = 0;
  private flinchVZ = 0;
  private wobble = 0;
  private shiver = 0;
  lowHealth = 0;
  /** scales hit-flinch impulses (arrogant nemeses barely react) */
  flinchScale = 1;
  private breath = Math.random() * 6;
  private time = Math.random() * 10;

  /* ---- QA readouts ---- */
  get stateName(): AnimState {
    return this.current?.state ?? (this.locoAmount > 0.12 ? 'LOCOMOTION' : 'IDLE');
  }
  get clipName(): string {
    return this.current?.clip ?? (this.locoAmount > 0.12 ? 'Locomotion' : 'Idle');
  }
  get clipTime(): number {
    return this.current ? this.current.action.time : this.locoPhase;
  }

  constructor(private rig: SPRig) {
    this.mixer = new THREE.AnimationMixer(rig.root);
    this.idleAction = this.action('Idle');
    this.idleAction.play();
    this.loco = {
      Walk: this.action('Walk'),
      WalkProud: this.action('WalkProud'),
      Run: this.action('Run'),
      StrafeL: this.action('StrafeL'),
      StrafeR: this.action('StrafeR'),
      WalkBack: this.action('WalkBack'),
    };
    for (const a of Object.values(this.loco)) {
      a.play();
      a.setEffectiveWeight(0);
      // gait actions are scrubbed to the shared phase; the mixer never
      // advances them on its own.
      a.paused = true;
    }
    this.mixer.addEventListener('finished', (e) => {
      if (this.current && e.action === this.current.action && this.current.oneShot && !this.current.holdEnd) {
        this.clearAction(this.current.state);
      }
    });
  }

  private action(clip: string): THREE.AnimationAction {
    let a = this.actions.get(clip);
    if (!a) {
      const meta = clipMeta(clip);
      a = this.mixer.clipAction(meta.clip);
      a.setLoop(meta.loop ? THREE.LoopRepeat : THREE.LoopOnce, meta.loop ? Infinity : 1);
      if (!meta.loop) a.clampWhenFinished = true;
      this.actions.set(clip, a);
    }
    return a;
  }

  /* ============================================================
     locomotion layer
     ============================================================ */

  /**
   * Feed the character's motion. `localX/localZ` are the velocity rotated
   * into the character frame (forward = -Z), `speed` in m/s.
   */
  setLocomotion(localX: number, localZ: number, speed: number, dt: number): void {
    const walkClip = this.proudWalk ? 'WalkProud' : 'Walk';
    const m = Math.min(1, speed / 3.2);
    this.locoAmount = m;

    // one shared cycle: rate matches ground speed so feet grip the floor.
    const runStride = (clipMeta('Run').stride ?? 1) * this.rig.scale;
    const walkStride = (clipMeta(walkClip).stride ?? 0.7) * this.rig.scale;
    const runMix = smoothstep(2.6, 6.4, speed);
    const stride = walkStride + (runStride - walkStride) * runMix;
    const rate = m < 0.02 ? 0 : THREE.MathUtils.clamp(speed / Math.max(0.2, stride * 6), 0.55, 2.3);
    this.locoPhase = (this.locoPhase + dt * rate) % 1;

    // direction split in the character frame
    const l = Math.hypot(localX, localZ);
    let fw = 0;
    let bw = 0;
    let sr = 0;
    let sl = 0;
    if (l > 0.05) {
      const nx = localX / l;
      const nz = localZ / l;
      fw = Math.max(0, -nz);
      bw = Math.max(0, nz);
      sr = Math.max(0, nx);
      sl = Math.max(0, -nx);
      const sum = fw + bw + sr + sl || 1;
      fw = (fw / sum) * m;
      bw = (bw / sum) * m;
      sr = (sr / sum) * m;
      sl = (sl / sum) * m;
    }

    const t = this.locoWeights;
    const k = Math.min(1, dt * 10);
    const walkW = fw * (1 - runMix);
    t.Idle += (1 - m - t.Idle) * k;
    t.Walk += ((this.proudWalk ? 0 : walkW) - t.Walk) * k;
    t.WalkProud += ((this.proudWalk ? walkW : 0) - t.WalkProud) * k;
    t.Run += (fw * runMix - t.Run) * k;
    t.StrafeR += (sr - t.StrafeR) * k;
    t.StrafeL += (sl - t.StrafeL) * k;
    t.WalkBack += (bw - t.WalkBack) * k;
  }

  /* ============================================================
     action layer
     ============================================================ */

  /**
   * Enter (or keep) a sustained state driven by combat. Repeat calls with the
   * same state+clip are cheap. Returns false if a higher-priority state holds.
   */
  setAction(
    state: AnimState,
    clip: string,
    opts: { mode?: 'scrub' | 'play'; rate?: number; holdEnd?: boolean; restart?: boolean } = {}
  ): boolean {
    const cur = this.current;
    if (cur && cur.state === state && cur.clip === clip && !opts.restart) return true;
    if (cur && STATE_PRIORITY[cur.state] > STATE_PRIORITY[state]) {
      // a one-shot that already finished no longer defends its slot
      if (!(cur.oneShot && !cur.action.isRunning())) return false;
    }
    this.enter(state, clip, opts.mode ?? 'play', false, opts.holdEnd ?? false, opts.rate ?? 1);
    return true;
  }

  /** Fire-and-forget full-body reaction (hit react, taunt...). */
  playOneShot(state: AnimState, clip: string, rate = 1): boolean {
    const cur = this.current;
    if (cur && STATE_PRIORITY[cur.state] > STATE_PRIORITY[state] && cur.action.isRunning() && !cur.oneShot) {
      return false;
    }
    if (cur && STATE_PRIORITY[cur.state] > STATE_PRIORITY[state] && cur.oneShot && cur.action.isRunning()) {
      return false;
    }
    this.enter(state, clip, 'play', true, false, rate);
    return true;
  }

  private enter(state: AnimState, clip: string, mode: 'scrub' | 'play', oneShot: boolean, holdEnd: boolean, rate: number): void {
    const prev = this.current;
    const a = this.action(clip);
    const fade = FADE_IN[state];

    a.reset();
    a.setEffectiveTimeScale(mode === 'scrub' ? 0 : rate);
    a.paused = mode === 'scrub';
    a.setEffectiveWeight(1);
    a.play();
    if (holdEnd) a.clampWhenFinished = true;

    if (prev && prev.action !== a) prev.action.fadeOut(fade);
    else if (prev && prev.action === a) a.setEffectiveWeight(1);
    a.fadeIn(fade);

    this.current = { state, clip, action: a, mode, oneShot, holdEnd, rate };
  }

  /** Leave `state` (no-op if something else took over already). */
  clearAction(state?: AnimState): void {
    const cur = this.current;
    if (!cur) return;
    if (state && cur.state !== state) return;
    cur.action.fadeOut(FADE_IN.LOCOMOTION);
    this.current = null;
  }

  /** Combat went idle: release any sustained (non-one-shot) state. */
  clearSustained(): void {
    const cur = this.current;
    if (!cur || cur.oneShot || cur.state === 'DEATH') return;
    cur.action.fadeOut(FADE_IN.LOCOMOTION);
    this.current = null;
  }

  /** Back to a clean idle (respawn). */
  reset(): void {
    if (this.current) {
      this.current.action.stop();
      this.current = null;
    }
    for (const a of this.actions.values()) {
      if (a !== this.idleAction && !Object.values(this.loco).includes(a)) a.stop();
    }
    this.idleAction.reset().play();
    this.locoWeights.Idle = 1;
    for (const n of LOCO_CLIPS) this.locoWeights[n] = 0;
    this.actionLayerWeight = 0;
    this.flinchX = this.flinchZ = this.flinchVX = this.flinchVZ = 0;
    this.wobble = 0;
    this.shiver = 0;
    this.lowHealth = 0;
    this.throwT = -1;
  }

  /* off-hand throw overlay (VOID NEEDLE): 0..1 progress, -1 = off */
  private throwT = -1;
  setThrow(t01: number): void {
    this.throwT = t01;
  }

  /** Scrub the current action's clip time directly (combat clock). */
  scrub(time: number): void {
    const cur = this.current;
    if (!cur) return;
    const d = cur.action.getClip().duration;
    cur.action.time = THREE.MathUtils.clamp(time, 0, d - 1e-4);
  }

  /**
   * Combat-clocked attack scrubbing. Maps the combat phase onto the clip
   * around its baked strike anchor:
   *   windup  [0 .. impactT-PRE]      anticipation
   *   hold    frozen just before      (+ shiver additive)
   *   active  [impact-PRE .. +POST]   the strike sweeps through the anchor
   *   recover [impact+POST .. end]    follow-through and settle
   */
  scrubAttack(phase: 'windup' | 'hold' | 'active' | 'recover', t01: number, shiver = 0): void {
    const cur = this.current;
    if (!cur) return;
    const meta = CLIPS[cur.clip];
    const d = meta.duration;
    const impact = meta.impactT ?? d * 0.45;
    const pre = Math.min(STRIKE_PRE, impact * 0.3);
    const post = Math.min(STRIKE_POST, (d - impact) * 0.5);
    let t: number;
    const k = THREE.MathUtils.clamp(t01, 0, 1);
    switch (phase) {
      case 'windup':
        t = k * (impact - pre);
        break;
      case 'hold':
        t = impact - pre;
        break;
      case 'active':
        t = impact - pre + k * (pre + post);
        break;
      default:
        t = impact + post + k * Math.max(0.0001, d - impact - post);
        break;
    }
    this.scrub(t);
    this.shiver = phase === 'hold' ? Math.max(this.shiver, shiver || 0.7) : 0;
  }

  /* ============================================================
     additive layer inputs
     ============================================================ */

  /** Aim the chest/head toward a target: yaw/pitch relative to facing. */
  setAim(relYaw: number, relPitch: number, weight: number): void {
    this.aimYawTarget = THREE.MathUtils.clamp(relYaw, -1.1, 1.1);
    this.aimPitchTarget = THREE.MathUtils.clamp(relPitch, -0.6, 0.6);
    this.aimWeightTarget = THREE.MathUtils.clamp(weight, 0, 1);
  }

  /** Velocity lean in the character frame (fed by the entity). */
  setLean(forwardLean: number, sideLean: number): void {
    this.leanXT = THREE.MathUtils.clamp(forwardLean, -0.5, 0.5);
    this.leanZT = THREE.MathUtils.clamp(sideLean, -0.4, 0.4);
  }

  /**
   * Directional hit reaction impulse. `dirX/dirZ` is the world direction the
   * blow travelled (attacker -> victim); converted to a flinch away from it.
   */
  notifyHit(dirX: number, dirZ: number, facing: number, heavy: boolean): void {
    // into the character frame
    const c = Math.cos(-facing);
    const s = Math.sin(-facing);
    const lx = dirX * c - dirZ * s;
    const lz = dirX * s + dirZ * c;
    const power = (heavy ? 0.55 : 0.28) * this.flinchScale;
    // blow travelling -Z (from the front) arches the chest BACK (+X pitch)
    this.flinchVX += -lz * power * 3.4;
    this.flinchVZ += -lx * power * 3.0;
  }

  /** Stagger/broken sway amplitude, 0..1. */
  setWobble(amount: number): void {
    this.wobble = amount;
  }

  /* ============================================================
     tick
     ============================================================ */

  update(dt: number, rdt: number): void {
    this.time += dt;
    this.breath += rdt;

    /* --- locomotion weights + shared gait phase --- */
    const inAction = this.current !== null;
    const target = inAction ? 0 : 1;
    this.actionLayerWeight += (1 - target - this.actionLayerWeight) * Math.min(1, rdt * 9);
    const locoScale = 1 - this.actionLayerWeight;

    this.idleAction.setEffectiveWeight(this.locoWeights.Idle * locoScale);
    // keep idle advancing on its own clock
    this.idleAction.paused = false;
    for (const name of LOCO_CLIPS) {
      const a = this.loco[name];
      a.setEffectiveWeight(this.locoWeights[name] * locoScale);
      a.time = this.locoPhase * (CLIPS[name].duration - 1e-4);
    }

    this.mixer.update(dt);

    /* --- additive layers, applied to bone locals after the mixer --- */
    const bones = this.rig.bones;
    const k = Math.min(1, rdt * 11);
    this.aimYaw += (this.aimYawTarget - this.aimYaw) * k;
    this.aimPitch += (this.aimPitchTarget - this.aimPitch) * k;
    this.aimWeight += (this.aimWeightTarget - this.aimWeight) * k;
    this.leanX += (this.leanXT - this.leanX) * Math.min(1, rdt * 8);
    this.leanZ += (this.leanZT - this.leanZ) * Math.min(1, rdt * 8);

    // flinch spring
    const spring = 34;
    const damp = 9.5;
    this.flinchVX += (-this.flinchX * spring - this.flinchVX * damp) * rdt;
    this.flinchVZ += (-this.flinchZ * spring - this.flinchVZ * damp) * rdt;
    this.flinchX += this.flinchVX * rdt;
    this.flinchZ += this.flinchVZ * rdt;

    const st = this.stance;
    const wob = this.wobble;
    const wobX = wob * Math.sin(this.time * 8.2) * 0.1;
    const wobZ = wob * Math.sin(this.time * 6.1 + 1.7) * 0.12;
    const shiv = this.shiver > 0 ? Math.sin(this.breath * 55) * 0.028 * this.shiver : 0;
    const breathe = this.locoAmount < 0.2 && !this.current ? Math.sin(this.breath * 1.9) * 0.012 : 0;
    const slump = this.lowHealth * 0.14;

    // Hips: lean + wobble + crouch (parent is Root => character space)
    // negative pitch = lean toward -Z (forward); stance.lean is + = forward.
    const hips = bones.Hips;
    const hipPitch = this.leanX - st.lean * 0.5 + wobX + shiv * 0.5 + slump * 0.4;
    const hipRoll = this.leanZ + wobZ;
    if (hipPitch !== 0 || hipRoll !== 0) {
      Q_TMP.setFromEuler(E_TMP.set(hipPitch, 0, hipRoll));
      hips.quaternion.premultiply(Q_TMP);
    }
    if (st.crouch !== 0) hips.position.y -= st.crouch;

    // Chest: aim yaw/pitch + stance lean + flinch + breathing
    const chest = bones.Chest;
    const cYaw = this.aimYaw * 0.42 * this.aimWeight;
    const cPitch = this.aimPitch * 0.3 * this.aimWeight - st.lean * 0.5 + this.flinchX + breathe + slump;
    const cRoll = this.flinchZ;
    if (cYaw !== 0 || cPitch !== 0 || cRoll !== 0) {
      Q_TMP.setFromEuler(E_TMP.set(cPitch, cYaw, cRoll));
      chest.quaternion.multiply(Q_TMP);
    }

    // Head: the rest of the aim + stance + a share of the flinch
    const head = bones.Head;
    const hYaw = this.aimYaw * 0.55 * this.aimWeight;
    const hPitch = this.aimPitch * 0.5 * this.aimWeight + st.headDown + this.flinchX * 0.6 + slump * 0.8 + wobX * 0.6;
    if (hYaw !== 0 || hPitch !== 0) {
      Q_TMP.setFromEuler(E_TMP.set(hPitch, hYaw, 0));
      head.quaternion.multiply(Q_TMP);
    }

    // arm flare (personality)
    if (st.armsOut !== 0) {
      Q_TMP.setFromEuler(E_TMP.set(0, 0, -st.armsOut));
      bones.UpperArm_R.quaternion.multiply(Q_TMP);
      Q_TMP.setFromEuler(E_TMP.set(0, 0, st.armsOut));
      bones.UpperArm_L.quaternion.multiply(Q_TMP);
    }
    // idle twitch (mad personalities)
    if (st.twitch > 0) {
      const tw = Math.sin(this.time * 13.7) * Math.sin(this.time * 3.1) * st.twitch * 0.05;
      Q_TMP.setFromEuler(E_TMP.set(tw, 0, -tw * 0.6));
      head.quaternion.multiply(Q_TMP);
    }

    // VOID NEEDLE off-hand throw: cock back, whip forward. An overlay, so it
    // plays over locomotion, recovery, even mid-swing — the body never locks.
    if (this.throwT >= 0) {
      const tp = this.throwT;
      const ang = tp < 0.3 ? -0.7 * (tp / 0.3) : -0.7 + 2.3 * Math.min(1, (tp - 0.3) / 0.45);
      Q_TMP.setFromEuler(E_TMP.set(0, 0, ang));
      bones.UpperArm_L.quaternion.multiply(Q_TMP);
    }

    if (this.shiver > 0) this.shiver = Math.max(0, this.shiver - rdt * 2);
  }

  /* ---- QA: continuous scalar readouts (see tools/qa.mjs) ---- */

  private qaTmpA = new THREE.Vector3();
  private qaTmpB = new THREE.Vector3();

  /** Right-arm elevation angle, radians: -pi/2 hanging, 0 forward, +pi/2 up. */
  armAngle(): number {
    this.rig.bones.UpperArm_R.getWorldPosition(this.qaTmpA);
    this.rig.bones.Hand_R.getWorldPosition(this.qaTmpB);
    const dx = this.qaTmpB.x - this.qaTmpA.x;
    const dy = this.qaTmpB.y - this.qaTmpA.y;
    const dz = this.qaTmpB.z - this.qaTmpA.z;
    return Math.atan2(dy, Math.hypot(dx, dz) + 1e-6);
  }

  chestPitch(): number {
    const e = E_TMP.setFromQuaternion(this.rig.bones.Chest.quaternion, 'YXZ');
    return e.x;
  }

  hipsOffsetY(): number {
    return (this.rig.bones.Hips.position.y - SEG.hipsY) * this.rig.scale;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig.root);
  }
}

const Q_TMP = new THREE.Quaternion();
const E_TMP = new THREE.Euler();

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
