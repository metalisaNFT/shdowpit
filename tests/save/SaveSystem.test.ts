import { describe, expect, it, beforeEach } from 'vitest';
import {
  SaveSystem,
  migrateEventLog,
  SAVE_VERSION,
  defaultPlayerMeta,
  defaultSettings,
  defaultGodHistory,
  type SaveData,
} from '../../src/core/SaveSystem';

function mockLocalStorage() {
  const bag: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => bag[key] ?? null,
    setItem: (key: string, value: string) => {
      bag[key] = value;
    },
    removeItem: (key: string) => {
      delete bag[key];
    },
    clear: () => {
      for (const k of Object.keys(bag)) delete bag[k];
    },
    key: (i: number) => Object.keys(bag)[i] ?? null,
    get length() {
      return Object.keys(bag).length;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  return bag;
}

describe('SaveSystem migrations', () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it('migrateEventLog assigns ids and known flags', () => {
    const data = {
      saveVersion: 1,
      eventLog: [{ turn: 1, age: 1, type: 'duel' as const, text: 'A fought B.', actors: ['n1', 'n2'], important: false }],
      nextEventId: 1,
    } as SaveData;
    migrateEventLog(data);
    expect(data.eventLog[0].id).toBeTruthy();
    expect(data.eventLog[0].known).toBe(true);
    expect((data.nextEventId ?? 0) > 1).toBe(true);
  });

  it('loads and migrates an old save blob to current version', () => {
    const bag = mockLocalStorage();
    const key = 'shdowpit.test';
    const old: SaveData = {
      saveVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      worldSeed: 42,
      worldTurn: 2,
      worldAge: 1,
      ageModifiers: [],
      ageName: '',
      nemeses: [],
      eventLog: [{ turn: 1, age: 1, type: 'duel', text: 'A FOUGHT B.', actors: ['n1', 'n2'], important: false }],
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
    bag[key] = JSON.stringify(old);

    const sys = new SaveSystem(key);
    const loaded = sys.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.saveVersion).toBe(SAVE_VERSION);
    expect(loaded!.eventLog[0].id).toBeTruthy();
    expect(loaded!.godHistory.runs).toBe(0);
  });
});
