/**
 * Weapons. Kept deliberately small: three for the player, five for enemies.
 * Distinctions are speed / reach / damage / stagger, nothing else.
 */

import type { WeaponType } from '../nemesis/Nemesis';

export interface WeaponDef {
  id: string;
  name: string;
  /** metres of reach from the wielder's centre */
  reach: number;
  /** arc half-angle in radians for the swing test */
  arc: number;
  damage: number;
  /** stagger points applied on hit */
  stagger: number;
  /** seconds of wind-up before the hit lands */
  windup: number;
  /** seconds of recovery after */
  recover: number;
  /** visual: blade length / thickness for the primitive mesh */
  bladeLen: number;
  bladeWidth: number;
  ranged?: boolean;
}

export const PLAYER_WEAPONS: Record<string, WeaponDef> = {
  sword: {
    id: 'sword',
    name: 'SWORD',
    reach: 2.5,
    arc: 1.05,
    damage: 13,
    stagger: 12,
    windup: 0.11,
    recover: 0.17,
    bladeLen: 1.35,
    bladeWidth: 0.1,
  },
  greatsword: {
    id: 'greatsword',
    name: 'GREATSWORD',
    reach: 3.15,
    arc: 1.35,
    damage: 20,
    stagger: 26,
    windup: 0.2,
    recover: 0.3,
    bladeLen: 1.95,
    bladeWidth: 0.17,
  },
  spear: {
    id: 'spear',
    name: 'SPEAR',
    reach: 3.9,
    arc: 0.45,
    damage: 15,
    stagger: 9,
    windup: 0.14,
    recover: 0.22,
    bladeLen: 2.5,
    bladeWidth: 0.07,
  },
};

/** Named relic weapons the player can win; these are what enemies steal. */
export const RELIC_WEAPONS: Record<string, WeaponDef> = {
  sunblade: {
    id: 'sunblade',
    name: 'THE SUN BLADE',
    reach: 2.7,
    arc: 1.1,
    damage: 17,
    stagger: 16,
    windup: 0.11,
    recover: 0.16,
    bladeLen: 1.5,
    bladeWidth: 0.12,
  },
  ashfang: {
    id: 'ashfang',
    name: 'ASHFANG',
    reach: 3.3,
    arc: 1.3,
    damage: 24,
    stagger: 30,
    windup: 0.21,
    recover: 0.3,
    bladeLen: 2.05,
    bladeWidth: 0.19,
  },
  longtooth: {
    id: 'longtooth',
    name: 'LONGTOOTH',
    reach: 4.2,
    arc: 0.45,
    damage: 18,
    stagger: 12,
    windup: 0.13,
    recover: 0.2,
    bladeLen: 2.7,
    bladeWidth: 0.08,
  },
};

export const ALL_PLAYER_WEAPONS: Record<string, WeaponDef> = {
  ...PLAYER_WEAPONS,
  ...RELIC_WEAPONS,
};

export const ENEMY_WEAPONS: Record<WeaponType, WeaponDef> = {
  sword: {
    id: 'sword',
    name: 'SWORD',
    reach: 2.4,
    arc: 0.85,
    damage: 9,
    stagger: 10,
    windup: 0.48,
    recover: 0.42,
    bladeLen: 1.3,
    bladeWidth: 0.1,
  },
  axe: {
    id: 'axe',
    name: 'AXE',
    reach: 2.3,
    arc: 1.0,
    damage: 14,
    stagger: 20,
    windup: 0.66,
    recover: 0.55,
    bladeLen: 1.15,
    bladeWidth: 0.16,
  },
  club: {
    id: 'club',
    name: 'CLUB',
    reach: 2.2,
    arc: 1.15,
    damage: 17,
    stagger: 30,
    windup: 0.82,
    recover: 0.66,
    bladeLen: 1.25,
    bladeWidth: 0.22,
  },
  spear: {
    id: 'spear',
    name: 'SPEAR',
    reach: 3.6,
    arc: 0.35,
    damage: 11,
    stagger: 8,
    windup: 0.55,
    recover: 0.45,
    bladeLen: 2.4,
    bladeWidth: 0.07,
  },
  bow: {
    id: 'bow',
    name: 'BOW',
    reach: 34,
    arc: 0.12,
    damage: 10,
    stagger: 5,
    windup: 0.85,
    recover: 0.6,
    bladeLen: 1.1,
    bladeWidth: 0.05,
    ranged: true,
  },
};

export function playerWeapon(id: string): WeaponDef {
  return ALL_PLAYER_WEAPONS[id] ?? PLAYER_WEAPONS.sword;
}

export function enemyWeapon(t: WeaponType): WeaponDef {
  return ENEMY_WEAPONS[t] ?? ENEMY_WEAPONS.sword;
}
