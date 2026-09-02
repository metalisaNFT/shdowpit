/**
 * Per-area biome simulation — ecology, resources, abstract dungeon sites.
 * Persisted on SaveData.biomes; ticked once per world beat after autonomy.
 */

import { mixSeed, RNG } from '../core/RNG';
import { AREAS, BIOME_PROFILES, type BiomeProfile, type DungeonSiteDef } from '../data/areas';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { GodContext } from '../god/Context';
import type { SaveData } from '../core/SaveSystem';

export type MaterialId = string;

export type SiteStatus = 'sealed' | 'open' | 'cleared' | 'repopulating';

export interface SiteState {
  siteId: string;
  status: SiteStatus;
  /** worldTurn when repopulating completes */
  repopulateAt?: number;
}

export interface AreaBiomeState {
  faunaPressure: number;
  resourceStock: Record<MaterialId, number>;
  depletion: number;
  unrest: number;
  activeSites: SiteState[];
}

export type BiomeMap = Record<string, AreaBiomeState>;

const DEFAULT_STOCK = 12;

function emptySiteStates(profile: BiomeProfile): SiteState[] {
  return profile.dungeonSites.map((s) => ({
    siteId: s.id,
    status: s.id.includes('crypt') || s.id.includes('underworks') ? 'sealed' : 'open',
  }));
}

function seedStock(profile: BiomeProfile, rng: RNG): Record<MaterialId, number> {
  const out: Record<MaterialId, number> = {};
  for (const m of profile.resources) {
    out[m] = DEFAULT_STOCK + rng.int(0, 8);
  }
  return out;
}

/** Seed all six areas from authored profiles. */
export function seedBiomes(worldSeed: number): BiomeMap {
  const out: BiomeMap = {};
  for (const area of AREAS) {
    const profile = BIOME_PROFILES[area.id];
    const rng = new RNG(mixSeed(worldSeed, area.id.charCodeAt(0) * 7919) >>> 0);
    out[area.id] = {
      faunaPressure: area.id === 'pit' ? 0 : 0.25 + rng.range(0, 0.35),
      resourceStock: seedStock(profile, rng),
      depletion: 0,
      unrest: 0,
      activeSites: emptySiteStates(profile),
    };
  }
  return out;
}

export function ensureBiomes(data: SaveData): BiomeMap {
  if (!data.biomes || Object.keys(data.biomes).length === 0) {
    data.biomes = seedBiomes(data.worldSeed);
  }
  for (const area of AREAS) {
    const profile = BIOME_PROFILES[area.id];
    const b = data.biomes[area.id];
    if (!b) {
      data.biomes[area.id] = seedBiomes(data.worldSeed)[area.id];
      continue;
    }
    b.faunaPressure = clamp01(b.faunaPressure ?? 0.3);
    b.resourceStock = b.resourceStock ?? seedStock(profile, new RNG(mixSeed(data.worldSeed, area.id.charCodeAt(0))));
    b.depletion = Math.max(0, b.depletion ?? 0);
    b.unrest = clamp01(b.unrest ?? 0);
    if (!b.activeSites?.length) b.activeSites = emptySiteStates(profile);
    for (const site of profile.dungeonSites) {
      if (!b.activeSites.some((s) => s.siteId === site.id)) {
        b.activeSites.push({ siteId: site.id, status: 'open' });
      }
    }
  }
  return data.biomes;
}

export function getBiome(data: SaveData, areaId: string): AreaBiomeState {
  ensureBiomes(data);
  return data.biomes![areaId] ?? data.biomes!.pit;
}

export function getSiteDef(areaId: string, siteId: string): DungeonSiteDef | null {
  return BIOME_PROFILES[areaId]?.dungeonSites.find((s) => s.id === siteId) ?? null;
}

export function getSiteState(biome: AreaBiomeState, siteId: string): SiteState | null {
  return biome.activeSites.find((s) => s.siteId === siteId) ?? null;
}

export function aggregateStock(biome: AreaBiomeState): number {
  let t = 0;
  for (const v of Object.values(biome.resourceStock)) t += v;
  return t;
}

export interface BiomeTickOutcome {
  areaId: string;
  kind: 'fauna_surge' | 'growth' | 'dungeon_reopened' | 'dungeon_opened';
  detail?: string;
}

/** Deterministic ecology drift after autonomy resolves actions. */
export function tickBiomes(mgr: NemesisManager, turn: number): BiomeTickOutcome[] {
  const data = mgr.data;
  ensureBiomes(data);
  const rng = new RNG(mixSeed(data.worldSeed, turn * 9973) >>> 0);
  const notes: BiomeTickOutcome[] = [];

  for (const area of AREAS) {
    if (area.id === 'pit') continue;
    const biome = data.biomes![area.id];
    const profile = BIOME_PROFILES[area.id];
    const holder = mgr.territoryHolder(area.id);

    // Fauna pressure drifts up; hunters and tracking_patrols pull it down elsewhere.
    let faunaDelta = rng.range(0.008, 0.028);
    if (holder?.personality === 'hunter') faunaDelta -= 0.012;
    biome.faunaPressure = clamp01(biome.faunaPressure + faunaDelta - (profile.feralFauna.length ? 0 : 0.02));

    // Resource regrowth when not heavily depleted.
    if (biome.depletion < 0.65 && rng.chance(0.35)) {
      const mat = rng.pick(profile.resources);
      biome.resourceStock[mat] = (biome.resourceStock[mat] ?? 0) + rng.int(1, 3);
      if (aggregateStock(biome) > DEFAULT_STOCK * profile.resources.length * 1.4) {
        notes.push({ areaId: area.id, kind: 'growth' });
      }
    }

    biome.depletion = Math.max(0, biome.depletion - 0.02);

    if (biome.faunaPressure > 0.72 && rng.chance(0.12)) {
      notes.push({ areaId: area.id, kind: 'fauna_surge', detail: rng.pick(profile.feralFauna) });
    }

    // Dungeon site timers.
    for (const site of biome.activeSites) {
      const def = getSiteDef(area.id, site.siteId);
      if (!def) continue;
      if (site.status === 'repopulating' && site.repopulateAt != null && turn >= site.repopulateAt) {
        site.status = 'open';
        site.repopulateAt = undefined;
        notes.push({ areaId: area.id, kind: 'dungeon_reopened', detail: def.name });
      } else if (site.status === 'sealed' && rng.chance(0.08 + def.danger * 0.02)) {
        site.status = 'open';
        notes.push({ areaId: area.id, kind: 'dungeon_opened', detail: def.name });
      }
    }
  }

  return notes;
}

/** Post-pass: territory ownership, holder personality, house feuds, fractures. */
export function reconcileBiomes(mgr: NemesisManager, ctx?: GodContext): void {
  const data = mgr.data;
  ensureBiomes(data);
  const turn = mgr.turn;

  for (const area of AREAS) {
    if (area.id === 'pit') continue;
    const biome = data.biomes![area.id];
    const holder = mgr.territoryHolder(area.id);
    const profile = BIOME_PROFILES[area.id];

    if (!holder) {
      biome.unrest = clamp01(biome.unrest + 0.04);
      continue;
    }

    if (holder.personality === 'collector') {
      for (const m of profile.resources) {
        biome.resourceStock[m] = Math.max(0, (biome.resourceStock[m] ?? 0) - 0.5);
      }
      biome.depletion = clamp01(biome.depletion + 0.03);
    }
    if (holder.personality === 'hunter') {
      biome.faunaPressure = clamp01(biome.faunaPressure - 0.04);
    }

    biome.unrest = clamp01(biome.unrest - 0.02 + (ctx?.cond.weight(area.id, 'unrest') ?? 0) * 0.05);
  }

  // Sync repopulating sites that missed a tick edge.
  for (const area of AREAS) {
    const biome = data.biomes![area.id];
    if (!biome) continue;
    for (const site of biome.activeSites) {
      if (site.status === 'repopulating' && site.repopulateAt != null && turn >= site.repopulateAt) {
        site.status = 'open';
        site.repopulateAt = undefined;
      }
    }
  }
}

/** Apply action outcomes to biome state (called from Actions perform). */
export function applyBiomeAction(
  data: SaveData,
  areaId: string,
  patch: Partial<Pick<AreaBiomeState, 'faunaPressure' | 'depletion' | 'unrest'>> & {
    takeMaterial?: MaterialId;
    giveMaterial?: { id: MaterialId; qty: number };
    siteId?: string;
    siteStatus?: SiteStatus;
    repopulateTurns?: number;
  },
  turn: number
): void {
  const biome = getBiome(data, areaId);
  if (patch.faunaPressure != null) biome.faunaPressure = clamp01(patch.faunaPressure);
  if (patch.depletion != null) biome.depletion = clamp01(patch.depletion);
  if (patch.unrest != null) biome.unrest = clamp01(patch.unrest);
  if (patch.takeMaterial) {
    biome.resourceStock[patch.takeMaterial] = Math.max(0, (biome.resourceStock[patch.takeMaterial] ?? 0) - 1);
    biome.depletion = clamp01(biome.depletion + 0.04);
  }
  if (patch.giveMaterial) {
    biome.resourceStock[patch.giveMaterial.id] =
      (biome.resourceStock[patch.giveMaterial.id] ?? 0) + patch.giveMaterial.qty;
  }
  if (patch.siteId && patch.siteStatus) {
    const site = biome.activeSites.find((s) => s.siteId === patch.siteId);
    if (site) {
      site.status = patch.siteStatus;
      if (patch.siteStatus === 'repopulating' && patch.repopulateTurns) {
        site.repopulateAt = turn + patch.repopulateTurns;
      }
    }
  }
}

export function totalMaterials(materials: Record<MaterialId, number> | undefined): number {
  if (!materials) return 0;
  let t = 0;
  for (const v of Object.values(materials)) t += v;
  return t;
}

export function addMaterial(
  materials: Record<MaterialId, number>,
  id: MaterialId,
  qty: number
): void {
  materials[id] = (materials[id] ?? 0) + qty;
}

export function takeMaterial(
  materials: Record<MaterialId, number>,
  id: MaterialId,
  qty: number
): number {
  const have = materials[id] ?? 0;
  const taken = Math.min(have, qty);
  materials[id] = have - taken;
  return taken;
}


function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function biomeSentence(_areaId: string, biome: AreaBiomeState): string {
  const parts: string[] = [];
  if (biome.faunaPressure > 0.65) parts.push('feral pressure high');
  else if (biome.faunaPressure < 0.25) parts.push('ferals quiet');
  const stock = aggregateStock(biome);
  if (stock < 8) parts.push('resources scarce');
  else if (stock > 28) parts.push('abundant growth');
  if (biome.activeSites.some((s) => s.status === 'repopulating' || s.status === 'open')) {
    parts.push('dungeon pulse');
  }
  return parts.length ? parts.join(', ') : 'steady';
}
