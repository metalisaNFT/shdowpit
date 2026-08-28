/**
 * Camera + duel replay for THE LONG GAME oracle view.
 */

import * as THREE from 'three';
import { generateGrunt } from '../nemesis/NemesisGenerator';
import { mixSeed } from '../core/RNG';
import { getArea } from '../data/areas';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import type { Arena } from '../world/Arena';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { VFX } from '../fx/VFX';
import type { DamageNumbers } from '../fx/DamageNumbers';
import type { AudioManager } from '../audio/AudioManager';
import type { DuelSpectacle } from '../god/GodTypes';
import { GodDuelProxy, type DuelFxHooksFull } from './GodDuelProxy';
import { GodWorldPop } from './GodWorldPop';
import type { GodRun } from '../god/GodRun';
import { populatedAreas } from './GodMap';

/** Cinematic pacing — sim time is compressed into readable beats. */
const BEAT_GAP = 1.05;
const BEAT_LEAD = 0.45;
const BEAT_TAIL = 1.35;

interface TimedBeat {
  t: number;
  actorId: string;
  kind: string;
  text: string;
}

export class GodSpectator {
  private camera: ThirdPersonCamera;
  private arena: Arena;
  private mgr: NemesisManager;
  private proxy: GodDuelProxy;
  private worldPop: GodWorldPop;
  private vfx: VFX | null;
  private dmg: DamageNumbers | null;
  private audio: AudioManager | null;

  private focus = new THREE.Vector3(0, 0, 0);
  private targetFocus = new THREE.Vector3(0, 0, 0);
  private distance = 48;
  private targetDistance = 48;
  private pitch = -0.52;
  private targetPitch = -0.52;
  private orbitYaw = 0;
  private targetOrbitYaw = 0;
  private idleAreas: string[] = [];
  private focusAreaId: string | null = null;
  private idleT = 0;
  private idleSkirmishT = 0;
  private areaTransition = 0;
  private ambientPlaying = false;
  private ambientT = 0;
  private ambientDur = 0;
  private ambientBeats: TimedBeat[] = [];
  private ambientBeatIdx = 0;

  private playing: DuelSpectacle | null = null;
  private timeline: TimedBeat[] = [];
  private playDur = 0;
  private playT = 0;
  private beatIdx = 0;

  onCaption: ((text: string) => void) | null = null;
  onSpectacleDone: (() => void) | null = null;

  constructor(
    camera: ThirdPersonCamera,
    arena: Arena,
    mgr: NemesisManager,
    opts?: { vfx?: VFX; damageNumbers?: DamageNumbers; audio?: AudioManager }
  ) {
    this.camera = camera;
    this.arena = arena;
    this.mgr = mgr;
    this.vfx = opts?.vfx ?? null;
    this.dmg = opts?.damageNumbers ?? null;
    this.audio = opts?.audio ?? null;
    this.proxy = new GodDuelProxy(arena.scene);
    this.proxy.setFx(this.fxHooks());
    this.worldPop = new GodWorldPop(arena.scene, arena);
  }

  syncWorld(run: GodRun): void {
    this.worldPop.sync(run);
    this.setIdleAreas(populatedAreas(run));
  }

  invalidateNav(): void {
    this.worldPop.invalidateNav();
  }

  clearWorld(): void {
    this.worldPop.clear();
  }

  setIdleAreas(areaIds: string[]): void {
    this.idleAreas = areaIds.length ? [...areaIds] : ['pit'];
    if (this.idleAreas.length && !this.playing) this.focusArea(this.idleAreas[0]!);
  }

  focusArea(areaId: string): void {
    this.focusAreaId = areaId;
    this.idleT = 0;
    this.areaTransition = 1;
    this.applyAreaFraming(areaId, true);
  }

  /** 3D juice when the player marks one or more characters. */
  markIntervention(actorIds: readonly string[], tone: 'good' | 'bad' | 'gold' | 'neutral'): void {
    if (this.playing || this.ambientPlaying) return;
    const color = tone === 'good' ? 0x6aff8a : tone === 'bad' ? 0xff5a4a : tone === 'gold' ? 0xffd56a : 0xc8d0ff;
    let nudged = false;
    for (const id of actorIds) {
      const pos = this.worldPop.positionOf(id);
      if (!pos) continue;
      this.worldPop.reactToMark(id);
      this.vfx?.ring(pos.x, 0.08, pos.z, color, 0.45, 5.8, 0.58, 0.88);
      this.vfx?.flash(pos.x, 1.25, pos.z, color, 0.75, 0.22);
      if (!nudged) {
        this.camera.nudgeToward(pos.x, 1.2, pos.z, 0.42);
        this.camera.pulseFov(2.5);
        nudged = true;
      }
    }
  }

  /** Ground-level mark when an intervention targets territory, not a person. */
  markArea(areaId: string, tone: 'good' | 'bad' | 'gold' | 'neutral'): void {
    if (this.playing || this.ambientPlaying) return;
    const bounds = this.worldPop.areaLiveBounds(areaId);
    const live = this.worldPop.areaLiveCentroid(areaId);
    const fallback = this.worldPop.areaCentroid(areaId) ?? this.arena.extractPoint(areaId);
    const x = bounds?.cx ?? live?.x ?? fallback.x;
    const z = bounds?.cz ?? live?.z ?? fallback.z;
    const resolved = { x, z };
    this.arena.resolve(x, z, 0.85, resolved);
    const color = tone === 'bad' ? 0xff5a4a : tone === 'good' ? 0x6aff8a : 0xffd56a;
    this.vfx?.ring(resolved.x, 0.1, resolved.z, color, 0.55, 8.5, 0.72, 0.75);
    this.vfx?.flash(resolved.x, 1.4, resolved.z, color, 0.95, 0.26);
    this.camera.nudgeToward(resolved.x, 1.3, resolved.z, 0.35);
    this.camera.pulseFov(2);
    this.focusArea(areaId);
  }

  playDuel(spec: DuelSpectacle): void {
    const a = this.mgr.byId(spec.aId);
    const b = this.mgr.byId(spec.bId);
    if (!a || !b) {
      this.onSpectacleDone?.();
      return;
    }
    const seed = duelStageSeed(spec.aId, spec.bId, spec.areaId);
    const stage = this.arena.duelStage(spec.areaId, seed);
    this.playing = spec;
    this.timeline = buildTimeline(spec.beats);
    this.playDur = BEAT_LEAD + spec.beats.length * BEAT_GAP + BEAT_TAIL;
    this.playT = 0;
    this.beatIdx = 0;

    this.targetFocus.set(stage.cx, 1.15, stage.cz);
    this.targetDistance = 24;
    this.targetPitch = -0.32;
    this.orbitYaw = Math.atan2(stage.ax - stage.bx, stage.az - stage.bz) + Math.PI / 2;
    this.targetOrbitYaw = this.orbitYaw;

    this.proxy.spawn(a, b, stage);
    this.worldPop.setSuppressed(true);
    this.ambientPlaying = false;
  }

  isPlaying(): boolean {
    return !!this.playing;
  }

  update(dt: number): void {
    if (this.playing) {
      this.ambientPlaying = false;
      this.playT += dt;
      while (this.beatIdx < this.timeline.length && this.timeline[this.beatIdx]!.t <= this.playT) {
        this.fireBeat(this.timeline[this.beatIdx]!);
        this.beatIdx++;
      }
      this.proxy.update(dt);

      // Orbit the duel so the viewport stays alive between beats.
      this.targetOrbitYaw += dt * 0.42;
      const c = this.proxy.duelCenter();
      this.targetFocus.set(c.x, 1.15, c.z);

      if (this.playT >= this.playDur) {
        this.playing = null;
        this.timeline = [];
        this.proxy.clear();
        this.worldPop.setSuppressed(false);
        if (this.focusAreaId) this.applyAreaFraming(this.focusAreaId, false);
        this.onSpectacleDone?.();
      }
    } else if (this.ambientPlaying) {
      this.ambientT += dt;
      while (this.ambientBeatIdx < this.ambientBeats.length && this.ambientBeats[this.ambientBeatIdx]!.t <= this.ambientT) {
        const b = this.ambientBeats[this.ambientBeatIdx]!;
        this.proxy.playBeat(b.actorId, b.kind);
        this.ambientBeatIdx++;
      }
      this.proxy.update(dt);
      this.targetOrbitYaw += dt * 0.55;
      const c = this.proxy.duelCenter();
      this.targetFocus.set(c.x, 1.1, c.z);
      this.targetDistance = 19;
      if (this.ambientT >= this.ambientDur) {
        this.proxy.clear();
        this.ambientPlaying = false;
        this.ambientBeats = [];
        this.ambientBeatIdx = 0;
        this.worldPop.setSuppressed(false);
        if (this.focusAreaId) this.applyAreaFraming(this.focusAreaId, false);
      }
    } else {
      if (this.focusAreaId) this.applyAreaFraming(this.focusAreaId, false);

      if (this.idleAreas.length > 1) {
        this.idleT += dt;
        if (this.idleT > 7) {
          this.idleT = 0;
          const next = this.idleAreas[Math.floor(performance.now() / 7000) % this.idleAreas.length]!;
          this.focusArea(next);
        }
      }

      this.idleSkirmishT += dt;
      if (this.idleSkirmishT > 4.2) {
        this.idleSkirmishT = 0;
        this.playAmbientSkirmish();
      }

      this.targetOrbitYaw += dt * 0.1;
    }

    this.areaTransition = Math.max(0, this.areaTransition - dt * 0.35);
    const focusGap = this.focus.distanceTo(this.targetFocus);
    const focusRate = 2.8 + focusGap * 0.22 + this.areaTransition * 4.5;
    const lerp = 1 - Math.exp(-dt * focusRate);
    this.focus.lerp(this.targetFocus, lerp);
    this.distance += (this.targetDistance - this.distance) * lerp;
    this.pitch += (this.targetPitch - this.pitch) * lerp;
    this.orbitYaw += wrapAngle(this.targetOrbitYaw - this.orbitYaw) * Math.min(1, dt * 2.4);

    this.camera.yaw = this.orbitYaw;
    this.camera.pitch = this.pitch;
    this.camera.distance = this.distance;
    this.camera.update(dt, dt, this.focus, null);
    if (!this.playing && !this.ambientPlaying) this.worldPop.update(dt);
  }

  private playAmbientSkirmish(): void {
    if (this.playing || this.ambientPlaying) return;
    const areaId = this.focusAreaId ?? this.idleAreas[0] ?? 'pit';
    const seed = mixSeed(mixSeed(performance.now() | 0, this.mgr.data.worldSeed), this.mgr.turn) >>> 0;
    const a = generateGrunt(seed, 2 + (seed % 4), this.mgr.mods, areaId);
    const b = generateGrunt(seed + 913, 2 + ((seed >> 4) % 4), this.mgr.mods, areaId);
    const stage = this.arena.duelStage(areaId, seed);
    this.ambientPlaying = true;
    this.ambientT = 0;
    this.ambientDur = 2.6;
    this.targetFocus.set(stage.cx, 1.1, stage.cz);
    this.targetDistance = 19;
    this.targetPitch = -0.3;
    this.proxy.spawn(a, b, stage);
    this.ambientBeats = [
      { t: 0.25, actorId: a.id, kind: 'open', text: '' },
      { t: 0.95, actorId: b.id, kind: 'crush', text: '' },
      { t: 1.65, actorId: a.id, kind: 'break', text: '' },
      { t: 2.15, actorId: a.id, kind: 'finish', text: '' },
    ];
    this.ambientBeatIdx = 0;
    this.worldPop.setSuppressed(true);
  }

  dispose(): void {
    this.proxy.dispose();
    this.worldPop.dispose();
    this.playing = null;
  }

  private applyAreaFraming(areaId: string, snapOrbit: boolean): void {
    const bounds = this.worldPop.areaLiveBounds(areaId);
    const live = this.worldPop.areaLiveCentroid(areaId);
    const fallback = this.worldPop.areaCentroid(areaId) ?? this.arena.extractPoint(areaId);
    const rawX = bounds?.cx ?? live?.x ?? fallback.x;
    const rawZ = bounds?.cz ?? live?.z ?? fallback.z;
    const out = { x: rawX, z: rawZ };
    this.arena.resolve(rawX, rawZ, 0.85, out);

    const crowd = this.worldPop.countInArea(areaId);
    const span = bounds?.span ?? 6 + crowd * 1.5;
    const a = getArea(areaId);

    this.targetFocus.set(out.x, 1.35 + Math.min(1.2, span * 0.04), out.z);
    this.targetDistance = 16 + span * 1.25 + Math.min(8, crowd * 0.9) + a.danger * 1.1;
    this.targetPitch = -0.28 - Math.min(0.14, span * 0.006) - a.danger * 0.012;

    if (snapOrbit) {
      const yaw = Math.atan2(out.x - a.cx, out.z - a.cz) + Math.PI * 0.55;
      this.orbitYaw = yaw;
      this.targetOrbitYaw = yaw;
    }
  }

  private fireBeat(b: TimedBeat): void {
    this.proxy.playBeat(b.actorId, b.kind);
    if (b.text) this.onCaption?.(b.text);
    if (b.kind === 'finish' || b.kind === 'crush' || b.kind === 'break') {
      this.targetDistance = Math.max(17, this.targetDistance - 2.2);
      this.targetPitch = Math.min(-0.2, this.targetPitch + 0.05);
      this.camera.pulseFov(4);
    }
  }

  private fxHooks(): DuelFxHooksFull {
    return {
      impact: (kind, x, y, z, dirX, dirZ, power) => {
        this.vfx?.impact(kind, x, y, z, dirX, dirZ, power);
      },
      float: (x, y, z, text, kind) => {
        this.dmg?.spawn(x, y, z, text, kind);
      },
      shake: (amount) => {
        this.camera.shake(amount);
      },
      kick: (amount) => {
        this.camera.kick(amount);
      },
      emphasis: (x, y, z, strength) => {
        this.camera.nudgeToward(x, y, z, strength);
      },
      sfx: (name, opts) => {
        this.audio?.play(name, opts);
      },
      ringBurst: (x, z) => {
        this.vfx?.ring(x, 0.06, z, 0xffd56a, 0.35, 7.5, 0.55, 0.65);
        this.vfx?.flash(x, 1.0, z, 0xffd56a, 0.55, 0.16);
      },
    };
  }
}

function buildTimeline(beats: DuelSpectacle['beats']): TimedBeat[] {
  return beats.map((b, i) => ({
    t: BEAT_LEAD + i * BEAT_GAP,
    actorId: b.actorId,
    kind: b.kind,
    text: b.text,
  }));
}

function duelStageSeed(aId: string, bId: string, areaId: string): number {
  let seed = 0x9e37;
  for (const s of [aId, bId, areaId]) {
    for (let i = 0; i < s.length; i++) seed = mixSeed(seed, s.charCodeAt(i));
  }
  return seed >>> 0;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
