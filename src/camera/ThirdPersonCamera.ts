/**
 * Third-person camera.
 *
 * Priorities, in order: the player stays readable, the camera responds
 * immediately to the mouse, and it never clips through a wall. It is
 * deliberately not cinematic.
 */

import * as THREE from 'three';
import type { Arena } from '../world/Arena';

const MIN_PITCH = -0.95;
const MAX_PITCH = 0.72;
/**
 * Closest the lens may ever get to the player's chest or its look point.
 * The near plane is 0.1, so anything under ~1.5m starts cutting the character
 * open and filling the frame with the inside of a torso.
 */
const MIN_SEPARATION = 1.7;

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  yaw = 0;
  pitch = -0.22;

  /** desired orbit distance */
  distance = 9;
  /** the distance gameplay uses; menus can borrow `distance` and restore this */
  readonly gameplayDistance = 9;
  private currentDistance = 9;
  minDistance = 3.2;
  maxDistance = 15;

  /** height of the look-at point above the player's feet */
  targetHeight = 1.45;

  /** 0..1, how strongly the camera drifts to frame a nearby enemy */
  framingStrength = 0.16;

  shakeAmount = 0;
  shakeScale = 1;
  private kickAmt = 0;

  private baseFov = 58;
  private fovPunch = 0;
  private emphasis = 0;
  private emphasisPoint = new THREE.Vector3();
  private storyFocus = 0;
  private storyFocusTarget = 0;
  private storyFocusPoint = new THREE.Vector3();
  private storyHeld = false;

  private pos = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private shakeOffset = new THREE.Vector3();
  private initialised = false;

  /** soft lock-on target position, or null */
  lockTarget: THREE.Vector3 | null = null;
  lockStrength = 0;

  private arena: Arena | null = null;
  private probe = { x: 0, z: 0 };

  /**
   * Bodies the camera should not end up inside. The QA pass found the camera
   * sitting inside an enemy torso in a crowd, filling the frame with a grey
   * box — walls were probed, but the things actually trying to stand next to
   * you were not.
   */
  private obstacles: Array<{ x: number; z: number; r: number }> = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.1, 900);
  }

  setArena(a: Arena): void {
    this.arena = a;
  }

  /** Refreshed each frame by Game with the live enemy list. */
  setObstacles(list: Array<{ x: number; z: number; r: number }>): void {
    this.obstacles = list;
  }

  /** The distance actually used after wall collision — not the desired one. */
  get currentDist(): number {
    return this.currentDistance;
  }

  /** True lens-to-chest distance, including shake and every push-out. */
  distanceToChest(target: THREE.Vector3): number {
    return Math.hypot(
      this.camera.position.x - target.x,
      this.camera.position.y - (target.y + this.targetHeight),
      this.camera.position.z - target.z
    );
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Mouse look. dx/dy are raw pointer-lock pixels. */
  applyLook(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const damp = 1 - this.storyFocus * 0.82;
    this.yaw -= dx * sensitivity * damp;
    this.pitch -= (invertY ? -dy : dy) * sensitivity * damp;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  zoom(delta: number): void {
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + delta * 0.9));
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(0.85, this.shakeAmount + amount * this.shakeScale);
  }

  /**
   * Directed camera punch. Distinct from shake: one axis, fast decay.
   * Light connects, heavies, and getting hit each use a different amount.
   */
  kick(amount: number): void {
    this.kickAmt = Math.min(0.42, this.kickAmt + amount * this.shakeScale);
  }

  /** Brief FOV punch used by named-NPC intros. Auto-decays. */
  pulseFov(delta = 5): void {
    this.fovPunch = Math.max(this.fovPunch, delta);
  }

  /** Soft push of framing toward a world point. Does not steal look. */
  nudgeToward(x: number, y: number, z: number, strength = 0.4): void {
    this.emphasisPoint.set(x, y, z);
    this.emphasis = Math.max(this.emphasis, strength);
  }

  /**
   * Named-NPC arrival look. Call every frame while the intro owns the camera.
   * Blends look-at toward their chest and yaws to put them in frame.
   */
  setStoryFocus(x: number, y: number, z: number, amount = 1): void {
    this.storyFocusPoint.set(x, y, z);
    this.storyFocusTarget = Math.max(this.storyFocusTarget, amount);
    this.storyHeld = true;
  }

  clearStoryFocus(): void {
    this.storyFocusTarget = 0;
    this.storyHeld = false;
  }

  /** Direction the player should move "forward" in, flattened to the ground. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /**
   * @param target player position (feet)
   * @param framingPoint optional nearby enemy to gently keep on screen
   */
  update(dt: number, rdt: number, target: THREE.Vector3, framingPoint: THREE.Vector3 | null): void {
    if (!this.initialised) {
      this.smoothTarget.copy(target);
      this.initialised = true;
    }
    // Follow the player with a short, consistent lag.
    const follow = 1 - Math.pow(0.0009, rdt);
    this.smoothTarget.lerp(target, follow);

    /* ---- soft lock-on ---- */
    if (this.lockTarget) {
      this.lockStrength = Math.min(1, this.lockStrength + rdt * 5);
      const dx = this.lockTarget.x - this.smoothTarget.x;
      const dz = this.lockTarget.z - this.smoothTarget.z;
      const wantYaw = Math.atan2(-dx, -dz);
      this.yaw = lerpAngle(this.yaw, wantYaw, Math.min(1, rdt * 7 * this.lockStrength));
      const dy = this.lockTarget.y + 1.0 - (this.smoothTarget.y + this.targetHeight);
      const flat = Math.hypot(dx, dz);
      const wantPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, flat) - 0.12));
      this.pitch += (wantPitch - this.pitch) * Math.min(1, rdt * 4 * this.lockStrength);
    } else {
      this.lockStrength = Math.max(0, this.lockStrength - rdt * 4);
      /* ---- gentle framing help ---- */
      if (framingPoint && this.framingStrength > 0) {
        const dx = framingPoint.x - this.smoothTarget.x;
        const dz = framingPoint.z - this.smoothTarget.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 2 && dist < 22) {
          const wantYaw = Math.atan2(-dx, -dz);
          let diff = wrapAngle(wantYaw - this.yaw);
          // Only nudge; never take control away.
          diff = Math.max(-0.9, Math.min(0.9, diff));
          if (Math.abs(diff) > 0.25) {
            this.yaw += diff * (this.framingStrength + this.emphasis * 0.5) * rdt * 3;
          }
        }
      }
    }

    if (this.emphasis > 0.001) {
      const dx = this.emphasisPoint.x - this.smoothTarget.x;
      const dz = this.emphasisPoint.z - this.smoothTarget.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2 && dist < 28) {
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wrapAngle(wantYaw - this.yaw);
        diff = Math.max(-0.7, Math.min(0.7, diff));
        this.yaw += diff * this.emphasis * rdt * 2.4;
      }
      this.emphasis *= Math.pow(0.04, rdt);
      if (this.emphasis < 0.01) this.emphasis = 0;
    }

    /* ---- named-NPC story focus ---- */
    {
      const focusEase = 1 - Math.pow(0.0006, rdt);
      this.storyFocus += (this.storyFocusTarget - this.storyFocus) * focusEase;
      if (!this.storyHeld) this.storyFocusTarget = Math.max(0, this.storyFocusTarget - rdt * 2.2);
    }
    if (this.storyFocus > 0.001) {
      const t = this.storyFocus;
      const dx = this.storyFocusPoint.x - this.smoothTarget.x;
      const dz = this.storyFocusPoint.z - this.smoothTarget.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.8) {
        const wantYaw = Math.atan2(-dx, -dz);
        this.yaw = lerpAngle(this.yaw, wantYaw, Math.min(1, rdt * 9 * t));
        const dy = this.storyFocusPoint.y - (this.smoothTarget.y + this.targetHeight);
        const wantPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, dist) - 0.08));
        this.pitch += (wantPitch - this.pitch) * Math.min(1, rdt * 5.5 * t);
      }
      if (!this.storyHeld) {
        this.storyFocus *= Math.pow(0.06, rdt);
        if (this.storyFocus < 0.02) this.storyFocus = 0;
      }
      this.storyHeld = false;
    }

    /* ---- orbit position ---- */
    this.lookAt.set(this.smoothTarget.x, this.smoothTarget.y + this.targetHeight, this.smoothTarget.z);
    if (this.storyFocus > 0.001) {
      this.lookAt.lerp(this.storyFocusPoint, Math.min(1, 0.64 * this.storyFocus * rdt * 8));
    }

    const cp = Math.cos(this.pitch);
    const dir = this.tmp.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();

    let want = this.distance - this.storyFocus * 1.7;
    if (this.arena) want = this.probeDistance(this.lookAt, dir, this.distance);
    want = this.probeObstacles(this.lookAt, dir, want);
    // Pull in fast when blocked, ease out when clear — avoids wall pop. The
    // pull-in used to be an instant snap (k = 1), which registered as a
    // camera teleport whenever a body crossed the orbit ray; very fast is
    // enough to stay out of geometry without reading as a cut.
    const k = want < this.currentDistance ? 1 - Math.pow(0.0000012, rdt) : 1 - Math.pow(0.006, rdt);
    this.currentDistance += (want - this.currentDistance) * k;

    this.pos.copy(this.lookAt).addScaledVector(dir, this.currentDistance);

    // Keep the camera above the floor — but lifting it straight up at a steep
    // pitch drags it toward the player, and near a wall (where currentDistance
    // is already short) that put it 1.1m away, inside the character. Restore
    // the lost separation horizontally instead of just accepting it.
    if (this.pos.y < 0.9) {
      this.pos.y = 0.9;
      const dx = this.pos.x - this.lookAt.x;
      const dy = this.pos.y - this.lookAt.y;
      const dz = this.pos.z - this.lookAt.z;
      const have = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Never accept less than ~1.8m even when the wall probe already pulled
      // the orbit in — below that the near plane clips into the character.
      const wantSep = Math.max(1.8, Math.min(this.currentDistance, this.minDistance));
      if (have < wantSep) {
        const flat = Math.hypot(dx, dz);
        if (flat > 0.001) {
          const need = Math.sqrt(Math.max(0, wantSep * wantSep - dy * dy));
          this.pos.x = this.lookAt.x + (dx / flat) * need;
          this.pos.z = this.lookAt.z + (dz / flat) * need;
        }
      }
    }

    /* ---- shake ---- */
    if (this.shakeAmount > 0.0005) {
      // Shake shrinks as the orbit shortens: at a wall, full-strength shake
      // was what finally pushed the lens inside the character.
      const s = this.shakeAmount * Math.min(1, this.currentDistance / 5);
      this.shakeOffset.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s * 0.65,
        (Math.random() - 0.5) * s
      );
      this.pos.add(this.shakeOffset);
      this.shakeAmount *= Math.pow(0.0009, rdt);
      if (this.shakeAmount < 0.0005) this.shakeAmount = 0;
    }

    if (this.kickAmt > 0.0004) {
      const k = this.kickAmt * Math.min(1, this.currentDistance / 5);
      this.right(this.tmp);
      this.pos.addScaledVector(this.tmp, k * 0.28);
      this.pos.y += k * 0.16;
      this.kickAmt *= Math.pow(0.00015, rdt);
      if (this.kickAmt < 0.0004) this.kickAmt = 0;
    }

    // HARD FLOOR: whatever pushed the camera in — wall probe, floor guard,
    // shake, a story focus dragging the look point onto someone else — the
    // lens never sits closer than MIN_SEPARATION to the look point OR to the
    // player's own chest. Below that the near plane (0.1) starts slicing the
    // character open. Enforcing it against the look point alone was not
    // enough: during a named arrival the look point IS the nemesis, so the
    // camera could still swing through the player on its way there.
    this.pushOut(this.lookAt.x, this.lookAt.y, this.lookAt.z);
    this.pushOut(target.x, target.y + this.targetHeight, target.z);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.lookAt);

    const fov = this.baseFov + this.fovPunch - this.storyFocus * 9;
    if (Math.abs(this.camera.fov - fov) > 0.04) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.fovPunch > 0.05) {
      this.fovPunch *= Math.pow(0.0008, rdt);
    } else {
      this.fovPunch = 0;
    }

    void dt;
  }

  /**
   * Shove the camera radially out until it is at least MIN_SEPARATION from
   * the given world point. Radial, so the framing direction is preserved.
   */
  private pushOut(x: number, y: number, z: number): void {
    const dx = this.pos.x - x;
    const dy = this.pos.y - y;
    const dz = this.pos.z - z;
    const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (sep >= MIN_SEPARATION) return;
    if (sep < 0.0001) {
      // Exactly coincident: back straight out along the current view axis.
      this.pos.set(x + Math.sin(this.yaw) * MIN_SEPARATION, y + 0.4, z + Math.cos(this.yaw) * MIN_SEPARATION);
      return;
    }
    const k = MIN_SEPARATION / sep;
    this.pos.set(x + dx * k, y + dy * k, z + dz * k);
  }

  /**
   * Stop short of any body on the orbit ray. Cheap: a handful of enemies, a
   * flat circle test each. Keeps a little more clearance than the geometry
   * probe because an enemy is a moving thing and popping is worse than a
   * slightly tighter camera.
   */
  private probeObstacles(from: THREE.Vector3, dir: THREE.Vector3, want: number): number {
    if (!this.obstacles.length) return want;
    let best = want;
    const steps = 7;
    for (let i = 1; i <= steps; i++) {
      const d = (want * i) / steps;
      const px = from.x + dir.x * d;
      const pz = from.z + dir.z * d;
      const py = from.y + dir.y * d;
      // Only bodies whose height the camera is actually passing through.
      if (py > 2.9 || py < 0.2) continue;
      for (const o of this.obstacles) {
        const clear = o.r + 0.55;
        if ((px - o.x) ** 2 + (pz - o.z) ** 2 < clear * clear) {
          best = Math.min(best, Math.max(this.minDistance, d - 0.7));
          break;
        }
      }
    }
    return best;
  }

  /** Step along the orbit ray and stop short of geometry. */
  private probeDistance(from: THREE.Vector3, dir: THREE.Vector3, want: number): number {
    if (!this.arena) return want;
    const steps = 8;
    for (let i = steps; i >= 1; i--) {
      const d = (want * i) / steps;
      const x = from.x + dir.x * d;
      const z = from.z + dir.z * d;
      const y = from.y + dir.y * d;
      if (y < 1.2) continue;
      this.probe.x = x;
      this.probe.z = z;
      this.arena.resolve(x, z, 0.6, this.probe);
      if (Math.hypot(this.probe.x - x, this.probe.z - z) < 0.02) {
        return d;
      }
    }
    // Every step was blocked: hug the player rather than teleporting 3.2m
    // out into whatever is standing there.
    return Math.max(1.6, want / steps);
  }

  snapBehind(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pitch = -0.24;
    this.distance = this.gameplayDistance;
    this.smoothTarget.copy(target);
    this.currentDistance = this.distance;
    this.initialised = true;
    this.fovPunch = 0;
    this.emphasis = 0;
    this.storyFocus = 0;
    this.storyHeld = false;
    this.shakeAmount = 0;
    this.kickAmt = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
