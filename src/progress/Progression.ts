/**
 * Permanent progression: skill tree, inventory, loadout compile.
 * Run stats and powers still live on PlayerStats — this only feeds them.
 */

import type { PlayerMeta } from '../core/SaveSystem';
import type { PowerId } from '../data/abilities';
import { ITEM_DEFS, ITEM_MAP, AFFIX_MAP, SET_BONUSES, weaponIdFor, RUN_ITEM_IDS, type ItemDef } from '../data/equipment';
import { SKILL_NODE_MAP, SKILL_NODES, canUnlock, respecRefund, type SkillNodeDef } from '../data/skillTree';
import type { PlayerStats } from '../player/PlayerStats';
import type { ItemHistory, ItemInstance, Loadout, PlayerProgress, SynergyTag, WeaponFamilyId } from './Types';
import { emptyProgress } from './Types';

export function migrateProgress(raw: Partial<PlayerProgress> | undefined): PlayerProgress {
  const d = emptyProgress();
  if (!raw) return d;
  return {
    cinders: typeof raw.cinders === 'number' ? raw.cinders : 5,
    skillNodes: Array.isArray(raw.skillNodes) ? raw.skillNodes.filter((id) => SKILL_NODE_MAP.has(id)) : [],
    inventory: Array.isArray(raw.inventory) ? raw.inventory.map(migrateItem) : [],
    stash: Array.isArray(raw.stash) ? raw.stash.map(migrateItem) : [],
    loadout: { ...d.loadout, ...(raw.loadout ?? {}) },
    mastery: { ...d.mastery, ...(raw.mastery ?? {}) },
    favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
    nextItemId: raw.nextItemId ?? 1,
  };
}

function migrateItem(it: ItemInstance): ItemInstance {
  return {
    id: String(it.id),
    defId: String(it.defId),
    kind: it.kind ?? 'weapon',
    slot: it.slot ?? 'weapon',
    family: it.family,
    name: it.name ?? it.defId,
    rarity: it.rarity ?? 'common',
    affixes: Array.isArray(it.affixes) ? it.affixes : [],
    history: Array.isArray(it.history) ? it.history : [],
    favorite: !!it.favorite,
    runOnly: !!it.runOnly,
    setId: it.setId,
  };
}

export function ensureStarterGear(meta: PlayerMeta): void {
  const p = meta.progress;
  if (!p.inventory.length) {
    const sword = mint(p, 'iron_sword');
    const light = mint(p, 'light_chest');
    p.inventory.push(sword, light);
    p.loadout.weapon = sword.id;
    p.loadout.chest = light.id;
  }
  syncLegacyWeapons(meta);
}

export function mint(p: PlayerProgress, defId: string, extra?: Partial<ItemInstance>): ItemInstance {
  const def = ITEM_MAP.get(defId);
  const id = 'i' + (p.nextItemId++).toString(36);
  const inst: ItemInstance = {
    id,
    defId,
    kind: def?.kind ?? 'weapon',
    slot: def?.slot ?? 'weapon',
    family: def?.family,
    name: def?.name ?? defId,
    rarity: def?.rarity ?? 'common',
    affixes: extra?.affixes ?? def?.affixes ?? [],
    history: extra?.history ?? [],
    favorite: false,
    runOnly: extra?.runOnly ?? def?.kind === 'run',
    setId: def?.setId,
  };
  return inst;
}

export function allItems(p: PlayerProgress): ItemInstance[] {
  return [...p.inventory, ...p.stash];
}

export function findItem(p: PlayerProgress, id: string | null | undefined): ItemInstance | null {
  if (!id) return null;
  return allItems(p).find((x) => x.id === id) ?? null;
}

export function equippedWeapon(p: PlayerProgress): ItemInstance | null {
  return findItem(p, p.loadout.weapon);
}

export function syncLegacyWeapons(meta: PlayerMeta): void {
  const p = meta.progress;
  const w = equippedWeapon(p);
  const wid = w ? weaponIdFor(w) : 'sword';
  meta.equipped = wid;
  const ids = new Set<string>(['sword']);
  for (const it of p.inventory) {
    if (it.kind === 'weapon') ids.add(weaponIdFor(it));
  }
  meta.weapons = Array.from(ids);
}

export function unlockNode(meta: PlayerMeta, id: string): string {
  const p = meta.progress;
  const n = SKILL_NODE_MAP.get(id);
  if (!n) return 'unknown node';
  if (p.skillNodes.includes(id)) return 'already owned';
  if (!canUnlock(id, p.skillNodes)) return 'locked';
  if (p.cinders < n.cost) return 'need cinders';
  p.cinders -= n.cost;
  p.skillNodes.push(id);
  return 'ok';
}

export function respecTree(meta: PlayerMeta): void {
  const p = meta.progress;
  p.cinders += respecRefund(p.skillNodes);
  p.skillNodes = [];
}

export function salvageItem(meta: PlayerMeta, id: string): number {
  const p = meta.progress;
  const i = p.inventory.findIndex((x) => x.id === id);
  if (i < 0) return 0;
  const it = p.inventory[i];
  if (it.favorite) return 0;
  for (const k of Object.keys(p.loadout) as Array<keyof Loadout>) {
    if (p.loadout[k] === id) p.loadout[k] = null;
  }
  p.inventory.splice(i, 1);
  const gain = it.rarity === 'legendary' || it.rarity === 'nemesis' ? 5 : it.rarity === 'epic' ? 3 : it.rarity === 'rare' ? 2 : 1;
  p.cinders += gain;
  syncLegacyWeapons(meta);
  return gain;
}

export function equipItem(meta: PlayerMeta, id: string): boolean {
  const p = meta.progress;
  const it = findItem(p, id);
  if (!it || it.slot === 'run') return false;
  if (it.slot === 'relicA' || it.slot === 'relicB') {
    if (p.loadout.relicA === id || p.loadout.relicB === id) return true;
    if (!p.loadout.relicA) p.loadout.relicA = id;
    else if (!p.loadout.relicB) p.loadout.relicB = id;
    else p.loadout.relicA = id;
  } else {
    p.loadout[it.slot] = id;
  }
  syncLegacyWeapons(meta);
  return true;
}

export function grantCinders(meta: PlayerMeta, amount: number): void {
  meta.progress.cinders += Math.max(0, amount);
}

export function addMastery(meta: PlayerMeta, family: WeaponFamilyId, amount = 1): void {
  const cur = meta.progress.mastery[family] ?? 0;
  meta.progress.mastery[family] = Math.min(3, cur + amount);
}

export function applyBuildToStats(meta: PlayerMeta, stats: PlayerStats, runItems: string[] = []): CompiledBuild {
  const p = meta.progress;
  const powers: PowerId[] = [];
  const tags = new Map<SynergyTag, number>();
  const notes: string[] = [];
  stats.clearGear();

  for (const id of p.skillNodes) {
    const n = SKILL_NODE_MAP.get(id);
    if (!n) continue;
    for (const pw of n.powers) powers.push(pw);
    bumpTags(tags, n.tags);
    notes.push(n.name);
  }

  const worn: ItemInstance[] = [];
  for (const slot of ['weapon', 'head', 'chest', 'arms', 'legs', 'relicA', 'relicB'] as const) {
    const it = findItem(p, p.loadout[slot]);
    if (it) worn.push(it);
  }

  const setCount = new Map<string, number>();
  for (const it of worn) {
    const def = ITEM_MAP.get(it.defId);
    applyItem(def, it, stats, powers, tags, notes);
    if (it.setId) setCount.set(it.setId, (setCount.get(it.setId) ?? 0) + 1);
  }

  for (const [setId, n] of setCount) {
    const b = SET_BONUSES[setId];
    if (!b) continue;
    if (n >= 2 && b.two) notes.push(`${setId.toUpperCase()} 2: ${b.two}`);
    if (n >= 2 && b.twoPowers) powers.push(...b.twoPowers);
    if (n >= 3 && b.threePowers) powers.push(...b.threePowers);
    if (n >= 3 && b.three) notes.push(`${setId.toUpperCase()} 3: ${b.three}`);
  }

  for (const rid of runItems) {
    const def = ITEM_MAP.get(rid);
    if (def) applyItem(def, null, stats, powers, tags, notes);
  }

  const unique = Array.from(new Set(powers));
  for (const id of unique) {
    if (!stats.powers.has(id)) stats.addPower(id);
  }

  const w = equippedWeapon(p);
  if (w) stats.weaponId = weaponIdFor(w);

  const brokenMask = worn.some((i) => i.defId === 'broken_mask');
  const ashenEye = worn.some((i) => i.defId === 'ashen_eye');
  const varkMask = worn.some((i) => i.defId === 'vark_mask');
  const heavy = worn.some((i) => i.defId === 'heavy_chest');
  const light = worn.some((i) => i.defId === 'light_chest');
  stats.armorIncomingMul = heavy ? 0.82 : light ? 1.08 : 1;
  stats.brokenMask = brokenMask;
  stats.ashenEye = ashenEye;
  stats.varkMask = varkMask;

  const syn: string[] = [];
  for (const [t, c] of tags) if (c >= 2) syn.push(`${t} ×${c}`);

  return { powers: unique, notes, synergy: syn, tags };
}

function applyItem(
  def: ItemDef | undefined,
  it: ItemInstance | null,
  stats: PlayerStats,
  powers: PowerId[],
  tags: Map<SynergyTag, number>,
  notes: string[]
): void {
  if (!def) return;
  bumpTags(tags, def.tags);
  if (def.powers) powers.push(...def.powers);
  if (def.statAdds) {
    for (const s of def.statAdds) stats.addGearStat(s.id, s.add);
  }
  const affixIds = it?.affixes ?? def.affixes ?? [];
  for (const aid of affixIds) {
    const a = AFFIX_MAP.get(aid);
    if (!a) continue;
    bumpTags(tags, a.tags);
    if (a.powers) powers.push(...a.powers);
    if (a.stat) stats.addGearStat(a.stat.id, a.stat.add);
  }
  notes.push(def.name);
}

function bumpTags(m: Map<SynergyTag, number>, tags: SynergyTag[]): void {
  for (const t of tags) m.set(t, (m.get(t) ?? 0) + 1);
}

export interface CompiledBuild {
  powers: PowerId[];
  notes: string[];
  synergy: string[];
  tags: Map<SynergyTag, number>;
}

export function historyLine(h: ItemHistory): string {
  if (h.type === 'recovered_from') return `Recovered from ${h.nemesisName}`;
  if (h.type === 'stolen_by') return `Stolen by ${h.nemesisName}`;
  if (h.type === 'bloodied') return `Bloodied by ${h.nemesisName}`;
  if (h.type === 'trophy') return `Trophy of ${h.nemesisName}`;
  return h.note ?? h.type;
}

export function markRecovered(it: ItemInstance, nemesisId: string, nemesisName: string, turn: number): void {
  it.history.push({ type: 'recovered_from', nemesisId, nemesisName, turn, note: `Recovered from ${nemesisName}` });
  if (!it.name.includes('Recovered')) {
    /* name stays; history is the marker */
  }
}

export function randomDef(kind: ItemKindFilter, age = 1): ItemDef {
  const pool = ITEM_DEFS.filter((d) => {
    if (kind === 'weapon') return d.kind === 'weapon' && d.rarity !== 'legendary';
    if (kind === 'armor') return d.kind === 'armor';
    if (kind === 'relic') return d.kind === 'relic';
    if (kind === 'run') return d.kind === 'run';
    return d.kind === kind;
  });
  const aged = age >= 3 ? pool : pool.filter((d) => d.rarity !== 'epic' && d.rarity !== 'nemesis');
  const list = aged.length ? aged : pool;
  return list[Math.floor(Math.random() * list.length)] ?? ITEM_DEFS[0];
}

export type ItemKindFilter = 'weapon' | 'armor' | 'relic' | 'run' | 'trophy';

export function runLootChoices(age: number): ItemDef[] {
  const pool = RUN_ITEM_IDS.map((id) => ITEM_MAP.get(id)!).filter(Boolean);
  const out: ItemDef[] = [];
  const left = pool.slice();
  while (out.length < 3 && left.length) {
    const i = Math.floor(Math.random() * left.length);
    out.push(left.splice(i, 1)[0]);
  }
  void age;
  return out;
}

export function nodePreview(id: string): SkillNodeDef | undefined {
  return SKILL_NODE_MAP.get(id);
}

export function treeCostRemaining(owned: string[]): number {
  return SKILL_NODES.filter((n) => !owned.includes(n.id)).reduce((s, n) => s + n.cost, 0);
}
