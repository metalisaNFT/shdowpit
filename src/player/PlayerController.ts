/**
 * Movement. Immediate response is the priority: high acceleration, short
 * stopping distance, and dodges that commit hard in a chosen direction.
 */

import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import type { Arena } from '../world/Arena';
import { DODGE_DURATION, type PlayerCombat } from './PlayerCombat';
import { turnToward, wrapAngle } from '../combat/Hitbox';

const WALK_SPEED = 7.4;
const SPRINT_SPEED = 11.6;
const ACCEL = 78;
const FRICTION = 16;
const DODGE_SPEED = 19;
const BLINK_DISTANCE = 7.5;
const TURN_RATE = 15;

export class PlayerController {
  velocity = new THREE.Vector3();
  /** intended movement direction in world space (unit or zero) */
  wish = new THREE.Vector3();
  sprinting = false;
  /** 0..1 for animation */
  moveAmount = 0;

  private fwd = new THREE.Vector3();
  private rgt = new THREE.Vector3();
  private tmp = { x: 0, z: 0 };
  private blinkDone = false;

  /**
   * @returns true if the player moved under their own power this frame
   */
  update(
    dt: number,
    input: Input,
    camera: ThirdPersonCamera,
    arena: Arena,
    combat: PlayerCombat,
    position: THREE.Vector3,
    radius: number,
    speedMul: number,
    lockPoint: THREE.Vector3 | null,
    setFacing: (yaw: number) => void,
    currentFacing: number,
    blink: boolean
  ): void {
    camera.forward(this.fwd);
    camera.right(this.rgt);

    this.wish.set(0, 0, 0);
    this.wish.addScaledVector(this.rgt, input.axisX);
    this.wish.addScaledVector(this.fwd, input.axisY);
    const wishLen = this.wish.length();
    if (wishLen > 1e-4) this.wish.multiplyScalar(1 / wishLen);

    this.sprinting = input.down('sprint') && wishLen > 0.1 && combat.action === 'idle';

    /* ---------------- skill travel (Shadow Step / reels) ---------------- */
    if ((combat.action === 'skill' || combat.action === 'ultimate') && combat.phase !== 'recover') {
      if (combat.skillPassThrough && combat.phase === 'active') {
        const speed = 42;
        this.velocity.set(combat.skillMoveX * speed, 0, combat.skillMoveZ * speed);
        if (combat.skillMoveX !== 0 || combat.skillMoveZ !== 0) {
          const yaw = Math.atan2(-combat.skillMoveX, -combat.skillMoveZ);
          setFacing(turnToward(currentFacing, yaw, TURN_RATE * 3 * dt));
        }
      } else if (combat.action === 'ultimate' || combat.skillId === 'ground_rupture') {
        this.velocity.multiplyScalar(Math.pow(0.02, dt));
      } else {
        this.velocity.multiplyScalar(Math.pow(0.15, dt));
      }
      if (combat.action === 'skill' && combat.skillId === 'void_grasp' && combat.skillMoveX) {
        this.velocity.set(combat.skillMoveX, 0, combat.skillMoveZ);
      }
    } else if (combat.action === 'dodge') {
      const p = combat.dodgeProgress();
      if (blink) {
        // BLINK: one instantaneous displacement instead of a slide.
        if (!this.blinkDone) {
          this.blinkDone = true;
          const nx = position.x + combat.dodgeX * BLINK_DISTANCE;
          const nz = position.z + combat.dodgeZ * BLINK_DISTANCE;
          arena.resolve(nx, nz, radius, this.tmp);
          position.x = this.tmp.x;
          position.z = this.tmp.z;
        }
        this.velocity.multiplyScalar(Math.pow(0.001, dt));
      } else {
        // Front-loaded burst so the dodge reads instantly.
        const curve = 1 - Math.pow(p, 1.8);
        this.velocity.set(combat.dodgeX * DODGE_SPEED * curve, 0, combat.dodgeZ * DODGE_SPEED * curve);
      }
      if (combat.dodgeX !== 0 || combat.dodgeZ !== 0) {
        const yaw = Math.atan2(-combat.dodgeX, -combat.dodgeZ);
        setFacing(turnToward(currentFacing, yaw, TURN_RATE * 2 * dt));
      }
    } else {
      this.blinkDone = false;

      /* ---------------- normal locomotion ---------------- */
      let maxSpeed = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * speedMul;
      // Attacks and parries root you, which is what makes commitment matter.
      if (combat.action === 'attack') {
        maxSpeed *= combat.phase === 'recover' ? 0.42 : 0.18;
      } else if (combat.action === 'parry') {
        maxSpeed *= 0.3;
      } else if (combat.action === 'stagger' || combat.action === 'execute' || combat.action === 'dead') {
        maxSpeed = 0;
      } else if (combat.action === 'skill' || combat.action === 'ultimate') {
        maxSpeed *= 0.22;
      }

      if (wishLen > 1e-4 && maxSpeed > 0) {
        const target = this.tmpVec(this.wish, maxSpeed);
        this.velocity.x += (target.x - this.velocity.x) * Math.min(1, ACCEL * dt / Math.max(1, maxSpeed));
        this.velocity.z += (target.z - this.velocity.z) * Math.min(1, ACCEL * dt / Math.max(1, maxSpeed));
      } else {
        const f = Math.max(0, 1 - FRICTION * dt);
        this.velocity.x *= f;
        this.velocity.z *= f;
      }

      /* ---------------- facing ---------------- */
      if (combat.action === 'attack' && combat.phase === 'windup') {
        // Aim the swing at the lock target, or at the camera direction.
        const yaw = lockPoint
          ? Math.atan2(-(lockPoint.x - position.x), -(lockPoint.z - position.z))
          : camera.yaw;
        setFacing(turnToward(currentFacing, yaw, TURN_RATE * 1.6 * dt));
      } else if (lockPoint) {
        const yaw = Math.atan2(-(lockPoint.x - position.x), -(lockPoint.z - position.z));
        setFacing(turnToward(currentFacing, yaw, TURN_RATE * dt));
      } else if (wishLen > 1e-4) {
        const yaw = Math.atan2(-this.wish.x, -this.wish.z);
        setFacing(turnToward(currentFacing, yaw, TURN_RATE * dt));
      }
    }

    /* ---------------- integrate + collide ---------------- */
    const nx = position.x + this.velocity.x * dt;
    const nz = position.z + this.velocity.z * dt;
    arena.resolve(nx, nz, radius, this.tmp);
    // If we were pushed, kill the velocity into the wall so we slide instead of jitter.
    if (Math.abs(this.tmp.x - nx) > 1e-4) this.velocity.x *= 0.1;
    if (Math.abs(this.tmp.z - nz) > 1e-4) this.velocity.z *= 0.1;
    position.x = this.tmp.x;
    position.z = this.tmp.z;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.moveAmount = Math.min(1, speed / WALK_SPEED);
    void DODGE_DURATION;
    void wrapAngle;
  }

  private scratch = new THREE.Vector3();
  private tmpVec(dir: THREE.Vector3, s: number): THREE.Vector3 {
    return this.scratch.copy(dir).multiplyScalar(s);
  }

  knockback(dirX: number, dirZ: number, force: number): void {
    this.velocity.x += dirX * force;
    this.velocity.z += dirZ * force;
  }

  stop(): void {
    this.velocity.set(0, 0, 0);
  }
}
