/**
 * Active combat skills. Numbers live in balance.ts; this file is identity,
 * timing shape, tags, and weapon profiles.
 */

import { SKILLS, ULTIMATE } from './balance';

export type SkillId =
  | 'shadow_step'
  | 'ground_rupture'
  | 'void_grasp'
  | 'spectral_guard'
  | 'hunters_brand'
  | 'shadow_snare'
  | 'pit_eruption'
  | 'living_weapon'
  | 'last_defiance';
export type SkillSlot = 'skill1' | 'skill2' | 'ultimate';
export type WeaponFamily = 'sword' | 'greatsword' | 'spear' | 'hammer';
export type SkillCategory = 'movement' | 'slam' | 'control' | 'guard' | 'mark' | 'zone' | 'ultimate';
export type SkillTag = 'movement' | 'slam' | 'area' | 'displace' | 'shadow' | 'precision';
export type SkillShape = 'self' | 'line' | 'disk' | 'cone' | 'tether';

export interface WeaponSkillProfile {
  windupMul: number;
  recoverMul: number;
  reachMul: number;
  radiusMul: number;
  postureMul: number;
  damageMul: number;
  /** greatsword slam: resist stagger during the skill */
  armor: boolean;
  /** spear rupture is a fissure, not a disk */
  fissure: boolean;
}

export interface SkillDef {
  id: SkillId;
  name: string;
  category: SkillCategory;
  defaultSlot: SkillSlot;
  tags: SkillTag[];
  shape: SkillShape;
  cooldown: number;
  surgeCost: number;
  windup: number;
  active: number;
  recover: number;
  distance: number;
  radius: number;
  halfArc: number;
  damageMul: number;
  posture: number;
  knockback: number;
  desc: string;
  short: string;
  when: string;
  profiles: Record<WeaponFamily, WeaponSkillProfile>;
}

const NEUTRAL: WeaponSkillProfile = {
  windupMul: 1,
  recoverMul: 1,
  reachMul: 1,
  radiusMul: 1,
  postureMul: 1,
  damageMul: 1,
  armor: false,
  fissure: false,
};

export const STARTING_SKILLS: SkillId[] = ['shadow_step', 'ground_rupture'];
export const DEFAULT_LOADOUT: [SkillId, SkillId] = ['shadow_step', 'ground_rupture'];

export const SKILL_DEFS: SkillDef[] = [
  {
    id: 'shadow_step',
    name: 'SHADOW STEP',
    category: 'movement',
    defaultSlot: 'skill1',
    tags: ['movement', 'shadow'],
    shape: 'line',
    cooldown: 9,
    surgeCost: 0,
    windup: 0.06,
    active: 0.2,
    recover: 0.14,
    distance: 8.4,
    radius: 1.15,
    halfArc: 0.4,
    damageMul: 0,
    posture: 0,
    knockback: 0,
    desc: 'Pass through enemies along your facing. Crossed foes are marked; the next melee hit spends the mark for posture.',
    short: 'GAP CLOSE · MARK',
    when: 'Does not replace dodge. Cannot pass walls.',
    profiles: {
      sword: { ...NEUTRAL, windupMul: 0.85, recoverMul: 0.85, reachMul: 0.95 },
      greatsword: { ...NEUTRAL, windupMul: 1.15, recoverMul: 1.2, reachMul: 0.88, radiusMul: 1.15 },
      hammer: { ...NEUTRAL, windupMul: 1.18, recoverMul: 1.22, reachMul: 0.86, radiusMul: 1.2 },
      spear: { ...NEUTRAL, reachMul: 1.18, recoverMul: 0.95 },
    },
  },
  {
    id: 'ground_rupture',
    name: 'GROUND RUPTURE',
    category: 'slam',
    defaultSlot: 'skill2',
    tags: ['slam', 'area', 'displace'],
    shape: 'disk',
    cooldown: 16,
    surgeCost: 0,
    windup: 0.34,
    active: 0.12,
    recover: 0.46,
    distance: 0,
    radius: 4.4,
    halfArc: 0.7,
    damageMul: 0.42,
    posture: 40,
    knockback: 5.2,
    desc: 'Slam the weapon into the ground. A visible shockwave interrupts light enemies and deals strong posture, weak health.',
    short: 'POSTURE WAVE',
    when: 'Committed startup. Miss and you are open.',
    profiles: {
      sword: { ...NEUTRAL, windupMul: 0.82, recoverMul: 0.88, radiusMul: 0.88 },
      greatsword: { ...NEUTRAL, windupMul: 1.22, recoverMul: 1.18, radiusMul: 1.28, postureMul: 1.28, armor: true },
      hammer: { ...NEUTRAL, windupMul: 1.28, recoverMul: 1.22, radiusMul: 1.35, postureMul: 1.4, armor: true },
      spear: { ...NEUTRAL, windupMul: 0.95, reachMul: 1.45, radiusMul: 0.55, fissure: true },
    },
  },
  {
    id: 'void_grasp',
    name: 'VOID GRASP',
    category: 'control',
    defaultSlot: 'skill2',
    tags: ['displace', 'precision', 'shadow'],
    shape: 'tether',
    cooldown: 11,
    surgeCost: 0,
    windup: 0.16,
    active: 0.18,
    recover: 0.28,
    distance: 9.2,
    radius: 0.9,
    halfArc: 0.55,
    damageMul: 0.22,
    posture: 18,
    knockback: 0,
    desc: 'Pull a light enemy in, or pull yourself to a heavy or anchored target. Requires line of sight.',
    short: 'PULL / REEL',
    when: 'Overlords resist the pull. No free execute.',
    profiles: {
      sword: { ...NEUTRAL, windupMul: 0.9 },
      greatsword: { ...NEUTRAL, windupMul: 1.12, recoverMul: 1.1, postureMul: 1.15 },
      hammer: { ...NEUTRAL, windupMul: 1.15, recoverMul: 1.12, postureMul: 1.22 },
      spear: { ...NEUTRAL, reachMul: 1.22, windupMul: 0.92 },
    },
  },
  {
    id: 'spectral_guard',
    name: 'SPECTRAL GUARD',
    category: 'guard',
    defaultSlot: 'skill1',
    tags: ['shadow', 'precision'],
    shape: 'self',
    cooldown: 11,
    surgeCost: 0,
    windup: 0.08,
    active: 0.55,
    recover: 0.22,
    distance: 0,
    radius: 1.4,
    halfArc: Math.PI,
    damageMul: 0,
    posture: 22,
    knockback: 0,
    desc: 'Absorb one incoming hit. Time it as the blow lands to convert the read into Surge and posture — it does not replace parry.',
    short: 'ABSORB ONE',
    when: 'Wrong timing still spends the cooldown. Unblockables ignore a late guard.',
    profiles: {
      sword: { ...NEUTRAL, recoverMul: 0.9 },
      greatsword: { ...NEUTRAL, windupMul: 1.1, recoverMul: 1.12 },
      hammer: { ...NEUTRAL, windupMul: 1.12, recoverMul: 1.15 },
      spear: { ...NEUTRAL, recoverMul: 0.92 },
    },
  },
  {
    id: 'hunters_brand',
    name: "HUNTER'S BRAND",
    category: 'mark',
    defaultSlot: 'skill2',
    tags: ['precision', 'shadow'],
    shape: 'tether',
    cooldown: 13,
    surgeCost: 0,
    windup: 0.12,
    active: 0.14,
    recover: 0.24,
    distance: 11,
    radius: 0.8,
    halfArc: 0.7,
    damageMul: 0.08,
    posture: 8,
    knockback: 0,
    desc: 'Mark one enemy. Perfect parries, perfect dodges, and executes against the mark pay extra posture and Surge — not a damage multiplier.',
    short: 'MARK ONE',
    when: 'Requires line of sight. No unconditional damage bonus.',
    profiles: {
      sword: { ...NEUTRAL, windupMul: 0.9 },
      greatsword: { ...NEUTRAL, windupMul: 1.08 },
      hammer: { ...NEUTRAL, windupMul: 1.1 },
      spear: { ...NEUTRAL, reachMul: 1.2 },
    },
  },
  {
    id: 'shadow_snare',
    name: 'SHADOW SNARE',
    category: 'zone',
    defaultSlot: 'skill2',
    tags: ['area', 'displace', 'shadow'],
    shape: 'disk',
    cooldown: 14,
    surgeCost: 0,
    windup: 0.22,
    active: 0.12,
    recover: 0.36,
    distance: 0,
    radius: 5.2,
    halfArc: Math.PI,
    damageMul: 0.12,
    posture: 12,
    knockback: 1.4,
    desc: 'A short control zone. Enemies inside are slowed. Crowd-control resistance and a hard duration cap prevent permanent lockdown.',
    short: 'TEMP ZONE',
    when: 'Does not freeze named foes. Overlords shrug most of it.',
    profiles: {
      sword: { ...NEUTRAL, radiusMul: 0.92 },
      greatsword: { ...NEUTRAL, radiusMul: 1.12, armor: true },
      hammer: { ...NEUTRAL, radiusMul: 1.18, armor: true },
      spear: { ...NEUTRAL, fissure: true, reachMul: 1.25, radiusMul: 0.7 },
    },
  },
  {
    id: 'pit_eruption',
    name: 'PIT ERUPTION',
    category: 'ultimate',
    defaultSlot: 'ultimate',
    tags: ['area', 'slam', 'shadow', 'displace'],
    shape: 'disk',
    cooldown: 0,
    surgeCost: ULTIMATE.surgeCost,
    windup: 0.14,
    active: 0.22,
    recover: 0.36,
    distance: 0,
    radius: ULTIMATE.radius,
    halfArc: Math.PI,
    damageMul: ULTIMATE.gruntDamageMul,
    posture: ULTIMATE.posture,
    knockback: ULTIMATE.knockback,
    desc: 'Spend a full Surge meter. Shadows erupt under nearby enemies: grouping, posture, and a readable opening. Named foes survive.',
    short: 'FULL SURGE PULSE',
    when: 'Does not skip Nemesis memory, loot, or fake death.',
    profiles: {
      sword: { ...NEUTRAL, radiusMul: 0.92, windupMul: 0.9 },
      greatsword: { ...NEUTRAL, radiusMul: 1.12, postureMul: 1.2, armor: true },
      hammer: { ...NEUTRAL, radiusMul: 1.18, postureMul: 1.28, armor: true },
      spear: { ...NEUTRAL, reachMul: 1.1, radiusMul: 0.96 },
    },
  },
  {
    id: 'living_weapon',
    name: 'LIVING WEAPON',
    category: 'ultimate',
    defaultSlot: 'ultimate',
    tags: ['precision', 'shadow'],
    shape: 'self',
    cooldown: 0,
    surgeCost: ULTIMATE.surgeCost,
    windup: 0.12,
    active: 0.2,
    recover: 0.28,
    distance: 0,
    radius: 2.2,
    halfArc: Math.PI,
    damageMul: 0.15,
    posture: 10,
    knockback: 0,
    desc: 'Spend a full Surge meter. Your weapon’s form wakes for a few seconds: faster recoveries, stronger posture, still your basic attacks.',
    short: 'WEAPON FORM',
    when: 'Does not skip Nemesis outcomes. Ends on its own.',
    profiles: {
      sword: { ...NEUTRAL, recoverMul: 0.85 },
      greatsword: { ...NEUTRAL, postureMul: 1.2, armor: true },
      hammer: { ...NEUTRAL, postureMul: 1.25, armor: true },
      spear: { ...NEUTRAL, reachMul: 1.12 },
    },
  },
  {
    id: 'last_defiance',
    name: 'LAST DEFIANCE',
    category: 'ultimate',
    defaultSlot: 'ultimate',
    tags: ['shadow'],
    shape: 'self',
    cooldown: 0,
    surgeCost: ULTIMATE.surgeCost,
    windup: 0.1,
    active: 0.28,
    recover: 0.3,
    distance: 0,
    radius: 3.4,
    halfArc: Math.PI,
    damageMul: 0.2,
    posture: 18,
    knockback: 3,
    desc: 'A short comeback window when you are hurt: brief safety, a little life, a little Surge. It will not win the fight for you.',
    short: 'COMEBACK WINDOW',
    when: 'Weak if you are healthy. Named foes still process death, escape, and loot.',
    profiles: {
      sword: { ...NEUTRAL, recoverMul: 0.9 },
      greatsword: { ...NEUTRAL, armor: true },
      hammer: { ...NEUTRAL, armor: true },
      spear: { ...NEUTRAL },
    },
  },
];

export const SKILL_MAP = new Map<SkillId, SkillDef>(SKILL_DEFS.map((s) => [s.id, s]));

export function getSkill(id: SkillId): SkillDef {
  return SKILL_MAP.get(id) ?? SKILL_DEFS[0];
}

export function weaponFamily(weaponId: string): WeaponFamily {
  if (weaponId === 'hammer' || weaponId === 'ashfang') return 'hammer';
  if (weaponId === 'greatsword') return 'greatsword';
  if (weaponId === 'spear' || weaponId === 'longtooth' || weaponId === 'sunspear') return 'spear';
  return 'sword';
}

export function profileFor(def: SkillDef, weaponId: string): WeaponSkillProfile {
  return def.profiles[weaponFamily(weaponId)];
}

export function cooldownFloor(base: number): number {
  return base * SKILLS.cooldownFloorFrac;
}

export function isUltimateSkill(id: string): boolean {
  return id === 'pit_eruption' || id === 'living_weapon' || id === 'last_defiance';
}

export function isUnlockableSkill(id: string): id is SkillId {
  return SKILL_MAP.has(id as SkillId);
}

export const ACTIVE_SKILL_IDS: SkillId[] = SKILL_DEFS.filter((s) => s.category !== 'ultimate').map((s) => s.id);
export const ULTIMATE_IDS: SkillId[] = SKILL_DEFS.filter((s) => s.category === 'ultimate').map((s) => s.id);
