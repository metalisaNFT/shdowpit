import { describe, expect, it, beforeEach } from 'vitest';
import { RNG } from '../../src/core/RNG';
import { GodContext } from '../../src/god/Context';
import { emptyGodState } from '../../src/god/GodRun';
import { simOf } from '../../src/god/GodTypes';
import {
  activeQuests,
  assignQuests,
  expireQuests,
  resetQuestCounter,
  tryCompleteQuest,
} from '../../src/god/NpcQuests';
import { ensureBiomes } from '../../src/world/BiomeState';
import { SAVE_VERSION, defaultPlayerMeta, defaultSettings, defaultGodHistory, type SaveData } from '../../src/core/SaveSystem';
import type { NemesisManager } from '../../src/nemesis/NemesisManager';
import { actForCycle } from '../../src/god/Arc';

function stubMgr(seed = 424242): NemesisManager {
  const data: SaveData = {
    saveVersion: SAVE_VERSION,
    createdAt: 1,
    updatedAt: 1,
    worldSeed: seed,
    worldTurn: 3,
    worldAge: 1,
    ageModifiers: [],
    ageName: '',
    nemeses: [
      {
        id: 'n1',
        name: 'Alpha',
        title: '',
        rank: 'warlord',
        level: 5,
        power: 200,
        alive: true,
        territory: 'forest',
        personality: 'ambitious',
        archetype: 'brute',
        appearanceSeed: 1,
        weapon: 'sword',
        strengths: [],
        weaknesses: [],
        stolen: [],
        stolenFromThem: [],
        scars: [],
        memory: [],
        rivalries: [],
        allies: [],
        adaptations: [],
        master: null,
        diedOnTurn: null,
        returns: 0,
        bornTurn: 0,
        persistent: true,
        ai: { generatedAt: {} },
        playerRewardFarms: 0,
        informant: false,
        humiliations: 0,
        branded: false,
        abandonedTerritoryTurn: null,
        metPlayer: false,
        fakeDeathPenalty: 0,
        signatureKnown: false,
        killsAgainstPlayer: 0,
        defeatsByPlayer: 0,
        escapedPlayer: 0,
        playerRelationship: 0,
        revengeChance: 0.2,
      },
      {
        id: 'n2',
        name: 'Beta',
        title: '',
        rank: 'captain',
        level: 3,
        power: 120,
        alive: true,
        territory: 'forest',
        personality: 'loyalist',
        archetype: 'brute',
        appearanceSeed: 2,
        weapon: 'axe',
        strengths: [],
        weaknesses: [],
        stolen: [],
        stolenFromThem: [],
        scars: [],
        memory: [],
        rivalries: [],
        allies: [],
        adaptations: [],
        master: 'n1',
        diedOnTurn: null,
        returns: 0,
        bornTurn: 0,
        persistent: true,
        ai: { generatedAt: {} },
        playerRewardFarms: 0,
        informant: false,
        humiliations: 0,
        branded: false,
        abandonedTerritoryTurn: null,
        metPlayer: false,
        fakeDeathPenalty: 0,
        signatureKnown: false,
        killsAgainstPlayer: 0,
        defeatsByPlayer: 0,
        escapedPlayer: 0,
        playerRelationship: 0,
        revengeChance: 0.2,
      },
    ],
    eventLog: [],
    territories: { forest: 'n1', pit: null, ruins: null, caves: null, tower: null, fortress: null },
    nextId: 3,
    usedNames: [],
    playerMeta: defaultPlayerMeta(),
    settings: defaultSettings(),
    run: null,
    territoryMods: {},
    god: null,
    legends: [],
    godUnlocks: [],
    godHistory: defaultGodHistory(),
    npcQuests: [],
    nextQuestId: 1,
  };
  ensureBiomes(data);
  data.biomes!.forest.faunaPressure = 0.85;

  return {
    data,
    turn: data.worldTurn,
    mods: { resurrection: 1, spawn: 1, power: 1 },
    byId: (id: string) => data.nemeses.find((n) => n.id === id) ?? null,
    living: () => data.nemeses.filter((n) => n.alive),
    namedLiving: () => data.nemeses.filter((n) => n.alive),
    territoryHolder: (areaId: string) => {
      const id = data.territories[areaId];
      return id ? data.nemeses.find((n) => n.id === id) ?? null : null;
    },
    overlord: () => data.nemeses.find((n) => n.alive && n.rank === 'overlord') ?? null,
    ofRank: (rank: string) => data.nemeses.filter((n) => n.alive && n.rank === rank),
  } as unknown as NemesisManager;
}

describe('NpcQuests', () => {
  beforeEach(() => resetQuestCounter(1));

  it('assigns hunt_feral when fauna pressure is high', () => {
    const mgr = stubMgr();
    const rng = new RNG(424242);
    const god = emptyGodState(424242, 1);
    god.factions = [
      {
        id: 'f1',
        name: 'THE TEST HOUSE',
        colour: 0xc4ff2e,
        leaderId: 'n1',
        memberIds: ['n1', 'n2'],
        territories: ['forest'],
        strength: 320,
        stability: 60,
        treasury: {},
        aggression: 40,
        warWith: [],
        bornCycle: 1,
        destroyedCycle: null,
      },
    ];
    simOf(mgr.byId('n1')!).factionId = 'f1';
    simOf(mgr.byId('n2')!).factionId = 'f1';
    const ctx = new GodContext(mgr, god, rng, mgr.mods, actForCycle(1));
    ctx.silent = true;
    assignQuests(ctx);
    const quests = activeQuests(mgr.data);
    expect(quests.length).toBeGreaterThan(0);
    expect(quests.some((q) => q.kind === 'hunt_feral' || q.kind === 'gather' || q.kind === 'delve')).toBe(true);
  });

  it('completes gather quest and clears assignee goal', () => {
    const mgr = stubMgr();
    mgr.data.npcQuests = [
      {
        id: 'q1',
        assignerId: 'n1',
        assigneeId: 'n2',
        kind: 'gather',
        targetAreaId: 'forest',
        status: 'active',
      },
    ];
    const actor = mgr.byId('n2')!;
    simOf(actor).goal = 'hoard';
    const rng = new RNG(1);
    const god = emptyGodState(1, 1);
    const ctx = new GodContext(mgr, god, rng, mgr.mods, actForCycle(1));
    ctx.silent = true;
    const ok = tryCompleteQuest(ctx, actor, 'gather', 'forest');
    expect(ok).toBe(true);
    expect(mgr.data.npcQuests![0].status).toBe('done');
    expect(simOf(actor).goal).toBe('survive');
  });

  it('expires quests past deadline', () => {
    const mgr = stubMgr();
    mgr.data.npcQuests = [
      {
        id: 'q1',
        assignerId: 'n1',
        assigneeId: 'n2',
        kind: 'deliver',
        targetAreaId: 'forest',
        deadlineTurn: 2,
        status: 'active',
      },
    ];
    mgr.turn = 5;
    const rng = new RNG(1);
    const god = emptyGodState(1, 1);
    const ctx = new GodContext(mgr, god, rng, mgr.mods, actForCycle(1));
    ctx.silent = true;
    expireQuests(ctx);
    expect(mgr.data.npcQuests![0].status).toBe('failed');
  });
});
