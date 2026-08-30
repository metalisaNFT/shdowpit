import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, defaultPlayerMeta, defaultSettings, defaultGodHistory, type SaveData } from '../../src/core/SaveSystem';
import {
  aggregateStock,
  ensureBiomes,
  getBiome,
  seedBiomes,
  tickBiomes,
} from '../../src/world/BiomeState';
import { mixSeed, RNG } from '../../src/core/RNG';

function minimalSave(seed = 424242): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    createdAt: 1,
    updatedAt: 1,
    worldSeed: seed,
    worldTurn: 1,
    worldAge: 1,
    ageModifiers: [],
    ageName: '',
    nemeses: [],
    eventLog: [],
    territories: {},
    nextId: 1,
    usedNames: [],
    playerMeta: defaultPlayerMeta(),
    settings: defaultSettings(),
    run: null,
    territoryMods: {},
    god: null,
    legends: [],
    godUnlocks: [],
    godHistory: defaultGodHistory(),
  };
}

describe('BiomeState', () => {
  it('seeds six areas deterministically from worldSeed', () => {
    const a = seedBiomes(424242);
    const b = seedBiomes(424242);
    expect(Object.keys(a).sort()).toEqual(['caves', 'forest', 'fortress', 'pit', 'ruins', 'tower']);
    expect(a.forest.faunaPressure).toBe(b.forest.faunaPressure);
    expect(a.caves.activeSites.length).toBeGreaterThan(0);
    expect(a.pit.activeSites.length).toBe(0);
  });

  it('migrates old saves without biomes field', () => {
    const data = minimalSave(99);
    delete data.biomes;
    ensureBiomes(data);
    expect(data.biomes?.forest).toBeTruthy();
    expect(data.biomes!.forest.resourceStock.herbs).toBeGreaterThan(0);
  });

  it('tickBiomes is deterministic for same seed and turn', () => {
    const data = minimalSave(424242);
    ensureBiomes(data);
    const mgr = {
      data,
      turn: 5,
      territoryHolder: () => null,
    } as unknown as import('../../src/nemesis/NemesisManager').NemesisManager;

    const rng1 = new RNG(mixSeed(424242, 5 * 9973) >>> 0);
    tickBiomes(mgr, 5);
    const snap1 = JSON.stringify(data.biomes);

    data.biomes = seedBiomes(424242);
    tickBiomes(mgr, 5);
    const snap2 = JSON.stringify(data.biomes);
    expect(snap1).toBe(snap2);
    expect(rng1.next()).toBe(new RNG(mixSeed(424242, 5 * 9973) >>> 0).next());
  });

  it('aggregateStock sums resource buckets', () => {
    const data = minimalSave();
    ensureBiomes(data);
    const biome = getBiome(data, 'forest');
    const total = aggregateStock(biome);
    expect(total).toBeGreaterThan(0);
  });
});
