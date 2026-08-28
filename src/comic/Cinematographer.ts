/**
 * Virtual cinematographer — score candidate cameras and pick the best.
 * Designed so a later invisible replay can feed the same scorer.
 */

import * as THREE from 'three';
import type { CameraCandidate, ComicPanelRole, ComicShotKind } from './Types';

export interface CineSubjects {
  player: THREE.Vector3;
  enemy: THREE.Vector3;
  /** Radians yaw facing for enemy (game convention). */
  enemyFacing: number;
  playerFacing: number;
}

const SHOT_PREF: Record<ComicPanelRole, ComicShotKind[]> = {
  intro: ['low_hero', 'wide', 'close_up'],
  attack: ['over_shoulder', 'dutch_impact', 'close_up'],
  impact: ['dutch_impact', 'close_up', 'low_hero'],
  outcome: ['wide', 'high_wide', 'low_hero'],
};

function candidate(
  kind: ComicShotKind,
  pos: THREE.Vector3,
  look: THREE.Vector3,
  fov: number,
  score: number,
  reasons: string[]
): CameraCandidate {
  return {
    kind,
    position: { x: pos.x, y: pos.y, z: pos.z },
    lookAt: { x: look.x, y: look.y, z: look.z },
    fov,
    score,
    reasons,
  };
}

function mid(a: THREE.Vector3, b: THREE.Vector3, y = 1.2): THREE.Vector3 {
  return new THREE.Vector3((a.x + b.x) * 0.5, y, (a.z + b.z) * 0.5);
}

/**
 * Build and score a small set of dramatic cameras for one beat.
 * Higher score wins. Reasons are for F1 / debug.
 */
export function scoreCameras(role: ComicPanelRole, s: CineSubjects, preferred?: ComicShotKind): CameraCandidate[] {
  const p = s.player.clone();
  const e = s.enemy.clone();
  p.y = 0;
  e.y = 0;
  const toPlayer = new THREE.Vector3().subVectors(p, e);
  const dist = Math.max(1.2, toPlayer.length());
  toPlayer.normalize();
  const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);
  const fwdE = new THREE.Vector3(-Math.sin(s.enemyFacing), 0, -Math.cos(s.enemyFacing));
  const lookChest = mid(p, e, 1.35);
  const enemyChest = e.clone().setY(1.45);

  const out: CameraCandidate[] = [];

  // Low hero — enemy towering
  {
    const pos = e.clone().addScaledVector(fwdE, -2.2).addScaledVector(side, 0.4);
    pos.y = 0.55;
    let score = role === 'intro' ? 12 : 6;
    const reasons = ['low_hero'];
    if (role === 'intro') {
      score += 4;
      reasons.push('intro_bias');
    }
    out.push(candidate('low_hero', pos, enemyChest, 52, score, reasons));
  }

  // Close-up on enemy face/torso
  {
    const pos = e.clone().addScaledVector(fwdE, -1.6).addScaledVector(side, 0.25);
    pos.y = 1.55;
    let score = 8;
    const reasons = ['close_up'];
    if (role === 'impact') {
      score += 5;
      reasons.push('impact_bias');
    }
    out.push(candidate('close_up', pos, enemyChest, 48, score, reasons));
  }

  // Over-the-shoulder (player looking at enemy)
  {
    const pos = p.clone().addScaledVector(toPlayer, -0.35).addScaledVector(side, 0.55);
    pos.y = 1.65;
    // toPlayer is enemy→player; OTS wants behind player toward enemy
    const behind = new THREE.Vector3().subVectors(e, p).normalize();
    pos.copy(p).addScaledVector(behind, -1.8).addScaledVector(side, 0.7);
    pos.y = 1.7;
    let score = 7;
    const reasons = ['ots'];
    if (role === 'attack') {
      score += 6;
      reasons.push('attack_bias');
    }
    out.push(candidate('over_shoulder', pos, enemyChest, 55, score, reasons));
  }

  // Wide two-shot
  {
    const pos = mid(p, e, 3.2).addScaledVector(side, Math.min(6, dist * 0.85));
    pos.y = 3.4;
    let score = 5 + Math.min(4, dist * 0.3);
    const reasons = ['wide', `sep_${dist.toFixed(1)}`];
    if (role === 'outcome' || role === 'intro') {
      score += 3;
      reasons.push(`${role}_bias`);
    }
    out.push(candidate('wide', pos, lookChest, 62, score, reasons));
  }

  // Dutch impact — tilted low near contact
  {
    const hit = mid(p, e, 1.1);
    const pos = hit.clone().addScaledVector(side, 2.2).addScaledVector(toPlayer, 0.3);
    pos.y = 0.9;
    let score = role === 'impact' ? 14 : 4;
    const reasons = ['dutch'];
    if (role === 'impact') reasons.push('impact_bias');
    out.push(candidate('dutch_impact', pos, hit.setY(1.2), 58, score, reasons));
  }

  // High wide aftermath
  {
    const pos = mid(p, e, 7);
    pos.y = 8.5;
    let score = role === 'outcome' ? 11 : 3;
    const reasons = ['high_wide'];
    out.push(candidate('high_wide', pos, lookChest, 55, score, reasons));
  }

  // Preferred shot bump
  if (preferred) {
    for (const c of out) {
      if (c.kind === preferred) {
        c.score += 3;
        c.reasons.push('preferred');
      }
    }
  }

  // Role preference order soft bonus
  const prefs = SHOT_PREF[role];
  for (const c of out) {
    const idx = prefs.indexOf(c.kind);
    if (idx >= 0) {
      c.score += 2 - idx * 0.5;
      c.reasons.push(`pref_${idx}`);
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

export function pickBestCamera(role: ComicPanelRole, s: CineSubjects, preferred?: ComicShotKind): CameraCandidate {
  return scoreCameras(role, s, preferred)[0];
}

/** Apply a candidate to a PerspectiveCamera (mutates). */
export function applyCamera(cam: THREE.PerspectiveCamera, c: CameraCandidate, aspect: number): void {
  cam.aspect = aspect;
  cam.fov = c.fov;
  cam.near = 0.15;
  cam.far = 400;
  cam.position.set(c.position.x, c.position.y, c.position.z);
  cam.lookAt(c.lookAt.x, c.lookAt.y, c.lookAt.z);
  // Mild dutch for impact shots
  if (c.kind === 'dutch_impact') {
    cam.rotateZ(0.18);
  }
  cam.updateProjectionMatrix();
}
