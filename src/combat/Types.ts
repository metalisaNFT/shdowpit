/**
 * Shared combat vocabulary. Both the player and every enemy implement
 * `Combatant`, so damage code never has to know which is which.
 */

import type * as THREE from 'three';

export type DamageSource =
  | 'light'
  | 'heavy'
  | 'ranged'
  | 'fire'
  | 'blast'
  | 'execute'
  | 'thorns'
  | 'counter'
  | 'environment'
  | 'skill';

export interface Combatant {
  readonly uid: number;
  readonly isPlayer: boolean;
  position: THREE.Vector3;
  facing: number;
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** display name for feedback; empty for anonymous grunts */
  displayName: string;
}

export interface DamageInfo {
  amount: number;
  source: DamageSource;
  /** stagger points; enemies have a stagger pool */
  stagger: number;
  attacker: Combatant | null;
  /** world position the blow came from, for knockback direction */
  fromX: number;
  fromZ: number;
  /** ignores parries and blocks */
  unblockable?: boolean;
  /** applies a burning damage-over-time */
  ignite?: boolean;
  /** knockback impulse in metres per second */
  knockback?: number;
  /** true when the hit landed behind the target */
  fromBehind?: boolean;
  /** the attacker already rolled a critical strike */
  critical?: boolean;
  /** cripple: movement multiplier applied to the target for `slowDuration` */
  slowFactor?: number;
  slowDuration?: number;
  /** poison buildup points */
  poison?: number;
  /** posture damage multiplier (POSTURE HUNTER etc.) */
  postureMul?: number;
  /**
   * Who owns this hit for proc purposes. Defaults to primary.
   * See combat/ProcRules.ts.
   */
  channel?: 'primary' | 'secondary' | 'dot' | 'afterimage' | 'reflect' | 'eve' | 'area';
  /** player may be credited for the kill (CHAIN, remnants, Vendetta) */
  grantsPlayerKill?: boolean;
  /** reaction depth — never increment past 1 */
  reactionDepth?: number;
}

export interface DamageResult {
  applied: number;
  killed: boolean;
  blocked: boolean;
  dodged: boolean;
  parried: boolean;
  /** posture BROKE — the big opening, not the flinch */
  staggered: boolean;
  /** the short flinch: attack cancelled, locomotion stopped, recoil played */
  flinched: boolean;
  critical: boolean;
  /** this hit pushed poison past the threshold */
  poisoned: boolean;
  /** fatal blow was cancelled by Second Wind */
  secondWind?: boolean;
}

export function emptyResult(): DamageResult {
  return {
    applied: 0,
    killed: false,
    blocked: false,
    dodged: false,
    parried: false,
    staggered: false,
    flinched: false,
    critical: false,
    poisoned: false,
  };
}
