import { describe, expect, it } from 'vitest';
import type { NemesisManager } from '../../src/nemesis/NemesisManager';
import type { Nemesis } from '../../src/nemesis/Nemesis';
import type { SaveData } from '../../src/core/SaveSystem';
import { defaultPlayerMeta, defaultSettings, defaultGodHistory, SAVE_VERSION } from '../../src/core/SaveSystem';
import { factsForNemesis } from '../../src/story/NemesisFactsProjection';
import { buildRichFacts } from '../../src/ai/AIPromptBuilder';

function mockMgr(n: Nemesis, events: SaveData['eventLog']): NemesisManager {
  const data: SaveData = {
    saveVersion: SAVE_VERSION,
    createdAt: 1,
    updatedAt: 1,
    worldSeed: 42,
    worldTurn: 8,
    worldAge: 1,
    god: null,
    legends: [],
    godUnlocks: [],
    godHistory: defaultGodHistory(),
    ageModifiers: [],
    ageName: 'THE WASTES',
    nemeses: [n],
    eventLog: events,
    territories: { pit: n.id, ruins: null, forest: null, caves: null, tower: null, fortress: null },
    playerMeta: defaultPlayerMeta(),
    settings: defaultSettings(),
    chronicleArchives: [],
  };
  return {
    data,
    turn: data.worldTurn,
    age: data.worldAge,
    ageState: { name: data.ageName },
    byId: (id: string | null) => (id ? data.nemeses.find((x) => x.id === id) ?? null : null),
  } as NemesisManager;
}

describe('NemesisFactsProjection', () => {
  it('projects world events into rich facts', () => {
    const n: Nemesis = {
      id: 'vark',
      name: 'Vark',
      title: 'THE GRUNT',
      rank: 'captain',
      level: 5,
      archetype: 'fighter',
      personality: 'avenger',
      appearanceSeed: 1,
      weapon: 'sword',
      strengths: [],
      weaknesses: [],
      scars: [],
      playerRelationship: 40,
      rivalries: [],
      allies: [],
      master: null,
      killsAgainstPlayer: 1,
      defeatsByPlayer: 0,
      escapedPlayer: 0,
      memory: [],
      alive: true,
      diedOnTurn: null,
      revengeChance: 0.3,
      power: 20,
      territory: 'pit',
      persistent: true,
      adaptations: [],
      stolen: [],
      bornTurn: 1,
      returns: 0,
    };
    const events = [
      {
        turn: 3,
        age: 1,
        type: 'player_death' as const,
        text: 'VARK KILLED YOU.',
        actors: ['vark', 'player'],
        important: true,
      },
    ];
    const mgr = mockMgr(n, events);
    const slice = factsForNemesis(mgr, n);
    expect(slice.worldEvents.length).toBe(1);
    expect(slice.worldEvents[0].text).toBe('VARK KILLED YOU.');
    const rich = buildRichFacts(
      n,
      { turn: 8, age: 1, ageName: 'THE WASTES' },
      (id) => (id ? mgr.byId(id)?.name.toUpperCase() ?? '' : ''),
      null,
      slice
    );
    expect(rich.recentWorldEvents[0].type).toBe('player_death');
  });
});
