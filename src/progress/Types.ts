/**
 * Shared types for the three progression layers:
 *   A. permanent skill tree
 *   B. run-only build
 *   C. equipment
 */

export type SynergyTag =
  | 'TOXIC'
  | 'PROJECTILE'
  | 'PARRY'
  | 'DODGE'
  | 'POSTURE'
  | 'EXECUTION'
  | 'SURGE'
  | 'CRIT'
  | 'NEMESIS'
  | 'MELEE'
  | 'HAMMER'
  | 'SPEAR'
  | 'SWORD';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'nemesis' | 'legendary';

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'nemesis', 'legendary'];

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'arms' | 'legs' | 'relicA' | 'relicB';

export type ItemKind = 'weapon' | 'armor' | 'relic' | 'trophy' | 'run';

export type WeaponFamilyId = 'sword' | 'hammer' | 'spear';

export interface ItemHistory {
  type: 'stolen_by' | 'recovered_from' | 'bloodied' | 'trophy' | 'scar_loot';
  nemesisId: string;
  nemesisName: string;
  turn: number;
  note?: string;
}

export interface ItemInstance {
  id: string;
  defId: string;
  kind: ItemKind;
  slot: EquipSlot | 'run';
  family?: WeaponFamilyId;
  name: string;
  rarity: Rarity;
  affixes: string[];
  history: ItemHistory[];
  favorite: boolean;
  /** run-only: discarded unless extracted */
  runOnly: boolean;
  setId?: string;
}

export interface Loadout {
  weapon: string | null;
  head: string | null;
  chest: string | null;
  arms: string | null;
  legs: string | null;
  relicA: string | null;
  relicB: string | null;
}

export function emptyLoadout(): Loadout {
  return { weapon: null, head: null, chest: null, arms: null, legs: null, relicA: null, relicB: null };
}

export interface PlayerProgress {
  cinders: number;
  skillNodes: string[];
  inventory: ItemInstance[];
  stash: ItemInstance[];
  loadout: Loadout;
  mastery: Record<WeaponFamilyId, number>;
  favorites: string[];
  nextItemId: number;
}

export function emptyProgress(): PlayerProgress {
  return {
    cinders: 5,
    skillNodes: [],
    inventory: [],
    stash: [],
    loadout: emptyLoadout(),
    mastery: { sword: 0, hammer: 0, spear: 0 },
    favorites: [],
    nextItemId: 1,
  };
}

export type EffectTrigger =
  | 'ON_HIT'
  | 'ON_HEAVY_HIT'
  | 'ON_PARRY'
  | 'ON_PERFECT_PARRY'
  | 'ON_DODGE'
  | 'ON_PERFECT_DODGE'
  | 'ON_KILL'
  | 'ON_EXECUTION'
  | 'ON_POSTURE_BREAK'
  | 'ON_PROJECTILE_HIT'
  | 'ON_POISON'
  | 'ON_DAMAGE_TAKEN'
  | 'ON_NEMESIS_KILL'
  | 'ON_PLAYER_DEATH';
