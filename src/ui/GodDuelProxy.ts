/**
 * Choreographed duel fighters for the god-layer oracle viewport.
 *
 * Replays abstract duel beats as readable combat: attacks lunge, victims react,
 * parries spark, finishes land. Presentation-only — never touches sim state.
 */

import * as THREE from 'three';
import { buildEnemyRig } from '../nemesis/NemesisAppearance';
import type { Nemesis } from '../nemesis/Nemesis';
import type { DuelStage } from '../world/Arena';
import type { ImpactKind } from '../fx/VFX';
import type { DamageFloatKind } from '../fx/DamageNumbers';

export interface DuelFxHooks {
  impact(kind: ImpactKind, x: number, y: number, z: number, dirX?: number, dirZ?: number, power?: number): void;
  float(x: number, y: number, z: number, text: string, kind: DamageFloatKind): void;
  shake(amount: number): void;
  kick(amount: number): void;
  emphasis(x: number, y: number, z: number, strength: number): void;
  sfx?(name: string, opts?: { volume?: number; pitch?: number }): void;
}

interface Fighter {
  id: string;
  rig: ReturnType<typeof buildEnemyRig>;
  home: THREE.Vector3;
  facing: number;
}

const ATTACKS = ['Atk1H_A', 'Atk1H_B', 'Atk1H_C', 'AtkThrust', 'Atk2H_Slam', 'Shove'] as const;

export class GodDuelProxy {
  private scene: THREE.Group;
  private parent: THREE.Scene;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private fighters: Fighter[] = [];
  private center = new THREE.Vector3();
  private fx: DuelFxHooksFull | null = null;

  private lungeFrom = new THREE.Vector3();
  private lungeTo = new THREE.Vector3();
  private lungeT = 0;
  private lungeDur = 0;
  private lungeSide: Fighter | null = null;
  private lungeBack = false;

  private feintT = 0;
  private active = false;
  private ringPulse = 0;
  private pending: Array<{ t: number; fn: () => void }> = [];

  constructor(parent: THREE.Scene) {
    this.parent = parent;
    this.scene = new THREE.Group();
    this.scene.name = 'god-duel-proxy';
    parent.add(this.scene);

    const geo = new THREE.RingGeometry(3.2, 3.55, 48);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd56a,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.ring = new THREE.Mesh(geo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  setFx(hooks: DuelFxHooksFull | null): void {
    this.fx = hooks;
  }

  spawn(a: Nemesis, b: Nemesis, stage: DuelStage): void {
    this.ensureAttached();
    this.clearFighters();
    this.center.set(stage.cx, 0, stage.cz);
    this.active = true;
    this.feintT = 0.6;
    this.ringPulse = 0;
    this.ring.visible = true;
    this.ring.position.set(stage.cx, 0.06, stage.cz);

    const ra = buildEnemyRig(a);
    const rb = buildEnemyRig(b);
    ra.root.scale.setScalar(1.55);
    rb.root.scale.setScalar(1.55);

    const aHome = new THREE.Vector3(stage.ax, 0, stage.az);
    const bHome = new THREE.Vector3(stage.bx, 0, stage.bz);
    ra.root.position.copy(aHome);
    rb.root.position.copy(bHome);

    const dx = bHome.x - aHome.x;
    const dz = bHome.z - aHome.z;
    const face = Math.atan2(dx, dz) + Math.PI;
    ra.root.rotation.y = face;
    rb.root.rotation.y = face + Math.PI;

    this.scene.add(ra.root);
    this.scene.add(rb.root);
    this.fighters = [
      { id: a.id, rig: ra, home: aHome.clone(), facing: face },
      { id: b.id, rig: rb, home: bHome.clone(), facing: face + Math.PI },
    ];

    for (const f of this.fighters) {
      f.rig.anim.setAction('BLOCK', 'BlockLoop', { mode: 'play' });
    }
    this.fx?.sfx?.('world_event', { volume: 0.22, pitch: 0.82 });
    this.fx?.ringBurst?.(stage.cx, stage.cz);
  }

  playBeat(actorId: string, kind: string): void {
    const actor = this.fighter(actorId);
    const victim = this.opponent(actorId);
    if (!actor) return;

    const mid = this.midpoint(actor, victim);
    const dirX = victim ? victim.home.x - actor.home.x : 0;
    const dirZ = victim ? victim.home.z - actor.home.z : 0;

    switch (kind) {
      case 'open':
        this.startLunge(actor, victim, 0.55, 1.15);
        actor.rig.anim.playOneShot('ATTACK', 'Walk', 1.05);
        victim?.rig.anim.setAction('BLOCK', 'BlockLoop', { mode: 'play' });
        break;
      case 'parry':
        this.startLunge(actor, victim, 0.42, 1.05);
        actor.rig.anim.playOneShot('ATTACK', pickAttack(actor.id, kind), 1.15);
        if (victim) {
          this.schedule(0.18, () => victim.rig.anim.playOneShot('ATTACK', 'Parry', 1.1));
          this.schedule(0.2, () => {
            this.fx?.impact('parry', mid.x, 1.2, mid.z, dirX, dirZ, 1.1);
            this.fx?.float(mid.x, 1.65, mid.z, 'PARRY', 'parry');
            this.fx?.kick(0.12);
          });
        }
        break;
      case 'break':
        this.startLunge(actor, victim, 0.5, 1.2);
        actor.rig.anim.playOneShot('ATTACK', 'Atk2H_Slam', 1.05);
        if (victim) {
          this.schedule(0.22, () => {
            victim.rig.anim.playOneShot('STAGGER', 'HitHeavy', 1);
            this.fx?.impact('posture_break', victim.rig.root.position.x, 1.1, victim.rig.root.position.z, dirX, dirZ, 1.2);
            this.fx?.float(victim.rig.root.position.x, 1.75, victim.rig.root.position.z, 'BREAK', 'crit');
            this.fx?.shake(0.28);
            this.fx?.kick(0.14);
          });
        }
        break;
      case 'crush':
      case 'turn':
        this.startLunge(actor, victim, 0.48, 1.25);
        actor.rig.anim.playOneShot('ATTACK', kind === 'turn' ? 'Atk1H_C' : 'Atk2H_Slam', 1.12);
        if (victim) {
          this.schedule(0.2, () => {
            victim.rig.anim.playOneShot('HIT_REACT', 'HitHeavy', 1);
            this.fx?.impact('flesh', mid.x, 1.15, mid.z, dirX, dirZ, 1.15);
            this.fx?.float(mid.x, 1.7, mid.z, kind === 'turn' ? 'COUNTER' : 'CRACK', 'crit');
            this.fx?.shake(0.2);
            this.fx?.kick(0.1);
          });
        }
        break;
      case 'flee':
        actor.rig.anim.playOneShot('ATTACK', 'WalkBack', 1.1);
        victim?.rig.anim.playOneShot('ATTACK', pickAttack(victim.id, kind), 1);
        this.fx?.float(actor.rig.root.position.x, 1.65, actor.rig.root.position.z, 'FLED', 'miss');
        break;
      case 'finish':
        this.startLunge(actor, victim, 0.62, 1.35);
        actor.rig.anim.playOneShot('ATTACK', 'AtkExecute', 0.95);
        if (victim) {
          this.schedule(0.34, () => {
            victim.rig.anim.playOneShot('DEATH', 'DeathA', 1);
            this.fx?.impact('execute', victim.rig.root.position.x, 1.0, victim.rig.root.position.z, dirX, dirZ, 1.4);
            this.fx?.float(victim.rig.root.position.x, 1.85, victim.rig.root.position.z, 'DOWN', 'hurt');
            this.fx?.shake(0.42);
            this.fx?.kick(0.22);
          });
        }
        break;
      case 'stand':
        for (const f of this.fighters) f.rig.anim.setAction('BLOCK', 'BlockLoop', { mode: 'play' });
        this.fx?.float(mid.x, 1.55, mid.z, 'STALEMATE', 'block');
        break;
      default:
        this.startLunge(actor, victim, 0.4, 1.1);
        actor.rig.anim.playOneShot('ATTACK', pickAttack(actor.id, kind), 1.1);
        if (victim) {
          this.schedule(0.18, () => victim.rig.anim.playOneShot('HIT_REACT', 'HitLight', 1));
          this.schedule(0.2, () => this.fx?.impact('flesh', mid.x, 1.1, mid.z, dirX, dirZ, 0.85));
        }
        break;
    }
  }

  /** Light exchange between scripted beats so the center never goes dead. */
  private feint(): void {
    if (this.fighters.length < 2) return;
    const lead = this.fighters[Math.floor(Math.random() * 2)]!;
    const other = this.opponent(lead.id);
    this.startLunge(lead, other, 0.32, 0.95);
    lead.rig.anim.playOneShot('ATTACK', pickAttack(lead.id, 'feint'), 1.2);
    other?.rig.anim.playOneShot('ATTACK', 'BlockIn', 1.05);
    const mid = this.midpoint(lead, other);
    this.fx?.impact('armor', mid.x, 1.05, mid.z, 0, 0, 0.55);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.ensureAttached();

    this.ringPulse += dt;
    const pulse = 0.92 + Math.sin(this.ringPulse * 4.2) * 0.06;
    this.ring.scale.set(pulse, pulse, 1);
    this.ringMat.opacity = 0.35 + Math.sin(this.ringPulse * 3.1) * 0.12;

    if (this.lungeSide && this.lungeDur > 0) {
      this.lungeT += dt;
      const u = Math.min(1, this.lungeT / this.lungeDur);
      const ease = this.lungeBack ? 1 - (1 - u) * (1 - u) : u * (2 - u);
      this.lungeSide.rig.root.position.lerpVectors(this.lungeFrom, this.lungeTo, ease);
      if (u >= 1) {
        if (!this.lungeBack) {
          this.lungeBack = true;
          this.lungeFrom.copy(this.lungeSide.rig.root.position);
          this.lungeTo.copy(this.lungeSide.home);
          this.lungeT = 0;
          this.lungeDur = 0.38;
        } else {
          this.lungeSide = null;
          this.lungeDur = 0;
        }
      }
    }

    this.feintT -= dt;
    if (this.feintT <= 0 && this.lungeSide === null) {
      this.feintT = 0.75 + Math.random() * 0.35;
      this.feint();
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      p.t -= dt;
      if (p.t <= 0) {
        p.fn();
        this.pending.splice(i, 1);
      }
    }

    for (const { rig } of this.fighters) {
      rig.anim.update(dt, dt);
    }
  }

  clear(): void {
    this.clearFighters();
    this.active = false;
    this.ring.visible = false;
    this.lungeSide = null;
    this.lungeDur = 0;
    this.pending = [];
  }

  dispose(): void {
    this.clear();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.scene.parent?.remove(this.scene);
  }

  duelCenter(): THREE.Vector3 {
    return this.center;
  }

  private clearFighters(): void {
    for (const { rig } of this.fighters) {
      this.scene.remove(rig.root);
      rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.fighters = [];
  }

  private fighter(id: string): Fighter | undefined {
    return this.fighters.find((f) => f.id === id);
  }

  private opponent(id: string): Fighter | undefined {
    return this.fighters.find((f) => f.id !== id);
  }

  private midpoint(a: Fighter, b: Fighter | undefined): THREE.Vector3 {
    if (!b) return a.rig.root.position.clone();
    return new THREE.Vector3(
      (a.rig.root.position.x + b.rig.root.position.x) * 0.5,
      1.15,
      (a.rig.root.position.z + b.rig.root.position.z) * 0.5
    );
  }

  private startLunge(actor: Fighter, victim: Fighter | undefined, dur: number, reach: number): void {
    this.lungeSide = actor;
    this.lungeFrom.copy(actor.rig.root.position);
    if (victim) {
      const dx = victim.rig.root.position.x - actor.rig.root.position.x;
      const dz = victim.rig.root.position.z - actor.rig.root.position.z;
      const len = Math.hypot(dx, dz) || 1;
      this.lungeTo.set(
        actor.home.x + (dx / len) * reach,
        0,
        actor.home.z + (dz / len) * reach
      );
    } else {
      this.lungeTo.copy(actor.home);
    }
    this.lungeT = 0;
    this.lungeDur = dur;
    this.lungeBack = false;
  }

  private schedule(delay: number, fn: () => void): void {
    this.pending.push({ t: delay, fn });
  }

  private ensureAttached(): void {
    if (this.scene.parent !== this.parent) this.parent.add(this.scene);
  }
}

function pickAttack(id: string, kind: string): string {
  const i = Math.abs(id.length + kind.length) % ATTACKS.length;
  return ATTACKS[i] ?? 'Atk1H_A';
}

/** Extend hooks with optional ring burst used at duel start. */
export type DuelFxHooksFull = DuelFxHooks & {
  ringBurst?(x: number, z: number): void;
};
