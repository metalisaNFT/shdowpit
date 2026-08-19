/**
 * Weapon techniques — sidegrades, not a rarity ladder.
 * Activation conditions are part of the description.
 */

export type TechniqueId =
  | 'sword_riposte_drive'
  | 'sword_needle_bind'
  | 'gs_breaker'
  | 'gs_spin'
  | 'spear_chase'
  | 'spear_pin'
  | 'sun_ignite'
  | 'ash_execute'
  | 'tooth_pierce';

export interface TechniqueDef {
  id: TechniqueId;
  weaponId: string;
  name: string;
  desc: string;
  /** when it actually fires */
  when: string;
}

export const TECHNIQUES: TechniqueDef[] = [
  {
    id: 'sword_riposte_drive',
    weaponId: 'sword',
    name: 'RIPOSTE DRIVE',
    desc: 'After a perfect parry, the next light is a thrusting counter.',
    when: 'Perfect parry → next light attack',
  },
  {
    id: 'sword_needle_bind',
    weaponId: 'sword',
    name: 'NEEDLE BIND',
    desc: 'A Void Needle that lands during a parry window refunds a charge.',
    when: 'Needle hit while parry is active',
  },
  {
    id: 'gs_breaker',
    weaponId: 'greatsword',
    name: 'PIT BREAKER',
    desc: 'Charged heavies deal extra posture if the target is attacking.',
    when: 'Heavy attack vs windup/active enemy',
  },
  {
    id: 'gs_spin',
    weaponId: 'greatsword',
    name: 'CROWD IRON',
    desc: 'Light combo finisher hits a wider arc.',
    when: 'Light combo step 3',
  },
  {
    id: 'spear_chase',
    weaponId: 'spear',
    name: 'HUNTER STEP',
    desc: 'Dodge attacks lunge farther and apply slow.',
    when: 'Dash Strike',
  },
  {
    id: 'spear_pin',
    weaponId: 'spear',
    name: 'PIN',
    desc: 'Perfect parry vs a charging enemy roots them briefly.',
    when: 'Perfect parry vs sprinting/charging foe',
  },
  {
    id: 'sun_ignite',
    weaponId: 'sunblade',
    name: 'SOLAR EDGE',
    desc: 'Heavies ignite. The Age of ash made this blade.',
    when: 'Heavy attack',
  },
  {
    id: 'ash_execute',
    weaponId: 'ashfang',
    name: 'CINDER CLEAVE',
    desc: 'Executions on burning enemies detonate the fire.',
    when: 'Execute a burning enemy',
  },
  {
    id: 'tooth_pierce',
    weaponId: 'longtooth',
    name: 'VOID TOOTH',
    desc: 'Light finishers pierce to a second target in line.',
    when: 'Light combo step 3',
  },
];

export const TECHNIQUE_MAP = new Map<TechniqueId, TechniqueDef>(TECHNIQUES.map((t) => [t.id, t]));

export function techniquesForWeapon(weaponId: string): TechniqueDef[] {
  const base = weaponId === 'sunblade' ? 'sword' : weaponId === 'ashfang' ? 'greatsword' : weaponId === 'longtooth' ? 'spear' : weaponId;
  return TECHNIQUES.filter((t) => t.weaponId === weaponId || t.weaponId === base);
}

export function hasTechnique(owned: string[] | undefined, id: TechniqueId): boolean {
  return !!owned?.includes(id);
}
