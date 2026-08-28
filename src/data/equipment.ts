/**
 * Data-driven weapons, armor, relics, affixes, run items, trophies.
 * Combat reads powers and stats; this file is identity and synergy tags.
 */

import type { PowerId } from './abilities';
import type { RunStatId } from './stats';
import type { EquipSlot, ItemInstance, ItemKind, Rarity, SynergyTag, WeaponFamilyId } from '../progress/Types';

export interface AffixDef {
  id: string;
  name: string;
  desc: string;
  tags: SynergyTag[];
  powers?: PowerId[];
  stat?: { id: RunStatId; add: number };
  mechanical?: boolean;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  slot: EquipSlot | 'run';
  family?: WeaponFamilyId;
  rarity: Rarity;
  tags: SynergyTag[];
  setId?: string;
  /** maps onto PLAYER_WEAPONS / RELIC_WEAPONS */
  weaponId?: string;
  powers?: PowerId[];
  statAdds?: Array<{ id: RunStatId; add: number }>;
  affixes?: string[];
  desc: string;
  special?: string;
}

export const AFFIXES: AffixDef[] = [
  { id: 'atk_speed', name: 'QUICK', desc: '+10% attack speed.', tags: ['MELEE'], stat: { id: 'attackSpeed', add: 0.1 } },
  { id: 'posture', name: 'BREAKER', desc: '+20% posture damage.', tags: ['POSTURE'], stat: { id: 'postureDamage', add: 0.2 } },
  { id: 'needles', name: 'SPLIT', desc: '+1 projectile.', tags: ['PROJECTILE'], stat: { id: 'projCount', add: 1 } },
  { id: 'toxic', name: 'VENOM', desc: 'Melee hits build poison.', tags: ['TOXIC'], powers: ['toxic_edge'], mechanical: true },
  { id: 'exec_surge', name: 'HARVEST', desc: 'Executions restore Surge.', tags: ['SURGE', 'EXECUTION'], powers: ['execution_surge'], mechanical: true },
  { id: 'crit', name: 'KEEN', desc: '+8% crit chance.', tags: ['CRIT'], stat: { id: 'critChance', add: 0.08 } },
  { id: 'shock', name: 'SHOCKWAVE', desc: 'Heavies create a shockwave.', tags: ['HAMMER', 'POSTURE'], powers: ['shockwave'], mechanical: true },
  { id: 'parry_shard', name: 'MIRROR EDGE', desc: 'Perfect parry reflects shots.', tags: ['PARRY', 'PROJECTILE'], powers: ['return_fire'], mechanical: true },
  { id: 'phantom', name: 'PHANTOM', desc: 'Dodge leaves an afterimage.', tags: ['DODGE'], powers: ['phantom'], mechanical: true },
];

export const AFFIX_MAP = new Map(AFFIXES.map((a) => [a.id, a]));

export const ITEM_DEFS: ItemDef[] = [
  /* weapons */
  { id: 'iron_sword', name: 'IRON SWORD', kind: 'weapon', slot: 'weapon', family: 'sword', rarity: 'common', tags: ['MELEE', 'SWORD', 'PARRY'], weaponId: 'sword', desc: 'Balanced. Fast. Built for riposte.', special: '3-hit combo, thrust, charged slash.' },
  { id: 'pit_hammer', name: 'PIT HAMMER', kind: 'weapon', slot: 'weapon', family: 'hammer', rarity: 'common', tags: ['MELEE', 'HAMMER', 'POSTURE'], weaponId: 'hammer', desc: 'Slow, heavy, interrupts. Ground slam on heavy.', special: 'Heavy slam shockwave.' },
  { id: 'ash_spear', name: 'ASH SPEAR', kind: 'weapon', slot: 'weapon', family: 'spear', rarity: 'common', tags: ['MELEE', 'SPEAR', 'PROJECTILE'], weaponId: 'spear', desc: 'Reach and pursuit. Weak when surrounded.', special: 'Charged piercing thrust.' },
  { id: 'sunspear', name: 'SUN SPEAR', kind: 'weapon', slot: 'weapon', family: 'spear', rarity: 'legendary', tags: ['SPEAR', 'NEMESIS', 'POSTURE'], weaponId: 'sunspear', desc: 'A unique spear of the Pit. Nemeses will try to take it.', special: 'Precision interrupt. History matters.' },
  { id: 'duelist_blade', name: 'DUELIST BLADE', kind: 'weapon', slot: 'weapon', family: 'sword', rarity: 'uncommon', tags: ['SWORD', 'PARRY'], weaponId: 'sword', affixes: ['atk_speed'], desc: 'A quicker sword for parry specialists.' },
  { id: 'breaker_maul', name: 'BREAKER MAUL', kind: 'weapon', slot: 'weapon', family: 'hammer', rarity: 'rare', tags: ['HAMMER', 'POSTURE'], weaponId: 'hammer', affixes: ['posture', 'shock'], desc: 'Built to crack captains.' },
  { id: 'long_needle', name: 'LONG NEEDLE', kind: 'weapon', slot: 'weapon', family: 'spear', rarity: 'uncommon', tags: ['SPEAR', 'PROJECTILE'], weaponId: 'spear', affixes: ['needles'], desc: 'A spear that wants you to keep throwing.' },
  { id: 'sunblade', name: 'THE SUN BLADE', kind: 'weapon', slot: 'weapon', family: 'sword', rarity: 'legendary', tags: ['SWORD'], weaponId: 'sunblade', desc: 'Overlord relic. Burns on heavy.' },
  { id: 'ashfang', name: 'ASHFANG', kind: 'weapon', slot: 'weapon', family: 'hammer', rarity: 'legendary', tags: ['HAMMER', 'POSTURE'], weaponId: 'ashfang', desc: 'Overlord relic. Crowd iron.' },
  { id: 'longtooth', name: 'LONGTOOTH', kind: 'weapon', slot: 'weapon', family: 'spear', rarity: 'legendary', tags: ['SPEAR'], weaponId: 'longtooth', desc: 'Overlord relic. Void reach.' },
  { id: 'toxic_spear', name: 'TOXIC SPEAR OF THE PIT', kind: 'weapon', slot: 'weapon', family: 'spear', rarity: 'epic', tags: ['SPEAR', 'TOXIC'], weaponId: 'spear', affixes: ['toxic'], desc: 'Poison on every poke.' },
  { id: 'cinder_sword', name: 'SWORD OF ASH', kind: 'weapon', slot: 'weapon', family: 'sword', rarity: 'rare', tags: ['SWORD', 'POSTURE'], weaponId: 'sword', affixes: ['posture'], desc: 'Heavier edge, slower hand.' },

  /* armor */
  { id: 'light_chest', name: 'LIGHT HARNESS', kind: 'armor', slot: 'chest', rarity: 'common', tags: ['DODGE'], setId: 'light', desc: 'Faster dodge, thinner hide.', statAdds: [{ id: 'dodgeCooldown', add: -0.18 }, { id: 'moveSpeed', add: 0.06 }] },
  { id: 'heavy_chest', name: 'HEAVY PLATE', kind: 'armor', slot: 'chest', rarity: 'common', tags: ['POSTURE'], setId: 'heavy', desc: 'Takes a hit. Dodge is late.', statAdds: [{ id: 'dodgeCooldown', add: 0.2 }] },
  { id: 'toxic_chest', name: 'TOXIC WEAVE', kind: 'armor', slot: 'chest', rarity: 'uncommon', tags: ['TOXIC'], setId: 'toxic', desc: 'Poison lingers. Neon identity.', powers: ['toxic_edge'], statAdds: [{ id: 'poisonDamage', add: 0.2 }] },
  { id: 'toxic_helm', name: 'TOXIC HOOD', kind: 'armor', slot: 'head', rarity: 'uncommon', tags: ['TOXIC'], setId: 'toxic', desc: '2-piece: poison lasts longer.', statAdds: [{ id: 'poisonDamage', add: 0.1 }] },
  { id: 'hunter_legs', name: 'HUNTER GREAVES', kind: 'armor', slot: 'legs', rarity: 'uncommon', tags: ['NEMESIS', 'DODGE'], setId: 'hunter', desc: 'Named enemies take more from you.', powers: ['hunters_mark'] },

  /* relics */
  { id: 'broken_mask', name: 'THE BROKEN MASK', kind: 'relic', slot: 'relicA', rarity: 'rare', tags: ['PARRY', 'SURGE'], desc: 'Perfect parries build extra Surge.', special: 'Build-defining parry loop.' },
  { id: 'ashen_eye', name: 'THE ASHEN EYE', kind: 'relic', slot: 'relicA', rarity: 'rare', tags: ['NEMESIS'], desc: 'Bonus damage to scarred Nemeses.', special: 'History as a weapon.' },
  { id: 'thief_bone', name: "THE THIEF'S BONE", kind: 'relic', slot: 'relicA', rarity: 'rare', tags: ['NEMESIS'], desc: 'Enemies carrying stolen gear are easier to track.', powers: ['hunters_mark'] },
  { id: 'last_cinder', name: 'THE LAST CINDER', kind: 'relic', slot: 'relicA', rarity: 'epic', tags: ['EXECUTION'], desc: 'Once per run, avoid death.', powers: ['second_wind'] },
  { id: 'pit_anvil', name: 'THE PIT ANVIL', kind: 'relic', slot: 'relicA', rarity: 'rare', tags: ['POSTURE', 'HAMMER'], desc: '+40% posture damage. Hammer builds live here.', statAdds: [{ id: 'postureDamage', add: 0.4 }] },
  { id: 'toxic_lens', name: 'TOXIC LENS', kind: 'relic', slot: 'relicA', rarity: 'rare', tags: ['TOXIC', 'PROJECTILE'], desc: 'Needles apply poison.', powers: ['toxic_shot'] },

  /* trophies — created from real Nemesis history */
  { id: 'vark_mask', name: "VARK'S CRACKED MASK", kind: 'trophy', slot: 'relicA', rarity: 'nemesis', tags: ['NEMESIS', 'POSTURE'], desc: '+15% posture vs enemies who have killed you.', special: 'Only from Vark.' },
  { id: 'ashen_trophy', name: 'ASHEN BLADE CHARM', kind: 'trophy', slot: 'relicA', rarity: 'nemesis', tags: ['NEMESIS'], desc: 'Dropped by a burned Nemesis. Heavies ignite.', powers: ['ember'] },
  { id: 'corroded_charm', name: 'CORRODED CHARM', kind: 'trophy', slot: 'relicA', rarity: 'nemesis', tags: ['TOXIC', 'NEMESIS'], desc: 'Dropped by a poisoned Nemesis.', powers: ['toxic_edge'] },

  /* run-only */
  { id: 'run_toxic_shot', name: 'TOXIC SHOT', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['TOXIC', 'PROJECTILE'], powers: ['toxic_shot'], desc: 'This run: needles poison.', run: true },
  { id: 'run_proj', name: '+1 PROJECTILE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['PROJECTILE'], statAdds: [{ id: 'projCount', add: 1 }], desc: 'This run: one extra needle.' },
  { id: 'run_posture', name: '+40% POSTURE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['POSTURE'], statAdds: [{ id: 'postureDamage', add: 0.4 }], desc: 'This run: break them faster.' },
  { id: 'run_dash', name: 'DASH STRIKE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['DODGE'], powers: ['dash_strike'], desc: 'This run: dodge into lunge.' },
  { id: 'run_shock', name: 'SHOCKWAVE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['HAMMER'], powers: ['shockwave'], desc: 'This run: heavies blast.' },
  { id: 'run_riposte', name: 'RIPOSTE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['PARRY'], powers: ['riposte'], desc: 'This run: parry counters.' },
  { id: 'run_surge', name: 'EXECUTION SURGE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['SURGE'], powers: ['execution_surge'], desc: 'This run: executes feed Surge.' },
  { id: 'run_multishot', name: 'MULTISHOT', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['PROJECTILE'], powers: ['multishot'], desc: 'This run: extra needle.' },
  { id: 'run_cripple', name: 'CRIPPLING BOLT', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['PROJECTILE'], powers: ['crippling_bolt'], desc: 'This run: needles pin runners.' },
  { id: 'run_phase', name: 'PHASE STEP', kind: 'run', slot: 'run', rarity: 'rare', tags: ['DODGE'], powers: ['phase_step'], desc: 'This run: dodge phases.' },
  { id: 'run_second', name: 'SECOND WIND', kind: 'run', slot: 'run', rarity: 'rare', tags: ['EXECUTION'], powers: ['second_wind'], desc: 'This run: survive once.' },
  { id: 'run_crit', name: 'KEEN EDGE', kind: 'run', slot: 'run', rarity: 'uncommon', tags: ['CRIT'], statAdds: [{ id: 'critChance', add: 0.12 }], desc: 'This run: crits more often.' },
] as Array<ItemDef & { run?: boolean }>;

export const ITEM_MAP = new Map(ITEM_DEFS.map((d) => [d.id, d]));

export const RUN_ITEM_IDS = ITEM_DEFS.filter((d) => d.kind === 'run').map((d) => d.id);

export const SET_BONUSES: Record<string, { two?: string; three?: string; twoPowers?: PowerId[]; threePowers?: PowerId[] }> = {
  toxic: {
    two: 'Poison duration increased.',
    three: 'Executing a poisoned enemy detonates.',
    twoPowers: [],
    threePowers: ['toxic_detonation'],
  },
  light: { two: 'Dodge window feels larger.' },
  heavy: { two: 'Heavies hit a wider arc.' },
};

export function weaponIdFor(inst: ItemInstance): string {
  return ITEM_MAP.get(inst.defId)?.weaponId ?? inst.family ?? 'sword';
}

export function compareLines(cur: ItemInstance | null, next: ItemInstance): Array<{ label: string; a: string; b: string; better: number }> {
  const cd = cur ? ITEM_MAP.get(cur.defId) : null;
  const nd = ITEM_MAP.get(next.defId);
  const lines: Array<{ label: string; a: string; b: string; better: number }> = [];
  lines.push({
    label: 'RARITY',
    a: cur?.rarity.toUpperCase() ?? '—',
    b: next.rarity.toUpperCase(),
    better: 0,
  });
  lines.push({
    label: 'SPECIAL',
    a: cd?.special ?? cd?.desc ?? '—',
    b: nd?.special ?? nd?.desc ?? '—',
    better: 0,
  });
  const ca = (cur?.affixes ?? []).join(', ') || 'none';
  const na = (next.affixes ?? []).join(', ') || 'none';
  lines.push({ label: 'AFFIXES', a: ca, b: na, better: next.affixes.length - (cur?.affixes.length ?? 0) });
  return lines;
}
