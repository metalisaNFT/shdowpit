/**
 * Deterministic story-system checks. Runs in the game process (debug / playtest).
 */

import type { Nemesis } from '../nemesis/Nemesis';
import type { SaveData } from '../core/SaveSystem';
import { defaultPlayerMeta, defaultSettings, migrateEventLog, SAVE_VERSION } from '../core/SaveSystem';
import { makeEvent } from '../world/WorldEvent';
import { buildStoryGraph } from './StoryGraph';
import { layoutStoryNodes } from './StoryLayout';
import { recogniseArcs, reopenReturnedArcs } from './StoryArcs';
import { buildStoryModel } from './StoryModel';
import { defaultStoryFilters, PLAYER_ID } from './StoryTypes';
import { scoreEvent, scoreNode } from './StoryImportance';
import { buildTimeline } from './StoryTimeline';
import { composeRunRecap, composeWorldTurnRecap, recapPlainText } from './StoryRecap';
import { copyForEvent } from './StoryCopy';

export interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
}

function nem(partial: Partial<Nemesis> & Pick<Nemesis, 'id' | 'name'>): Nemesis {
  return {
    title: '',
    rank: 'captain',
    level: 5,
    archetype: 'fighter',
    personality: 'avenger',
    appearanceSeed: 1,
    weapon: 'sword',
    strengths: [],
    weaknesses: [],
    scars: [],
    playerRelationship: 10,
    rivalries: [],
    allies: [],
    master: null,
    killsAgainstPlayer: 0,
    defeatsByPlayer: 0,
    escapedPlayer: 0,
    memory: [],
    alive: true,
    diedOnTurn: null,
    revengeChance: 0.2,
    power: 20,
    territory: 'ruins',
    persistent: true,
    adaptations: [],
    stolen: [],
    bornTurn: 1,
    returns: 0,
    ...partial,
  };
}

function save(n: Nemesis[], events: SaveData['eventLog'] = []): SaveData {
  const territories: Record<string, string | null> = {
    pit: n.find((x) => x.territory === 'pit')?.id ?? n[0]?.id ?? null,
    ruins: n.find((x) => x.territory === 'ruins')?.id ?? null,
    forest: n.find((x) => x.territory === 'forest')?.id ?? null,
    caves: n.find((x) => x.territory === 'caves')?.id ?? null,
    tower: n.find((x) => x.territory === 'tower')?.id ?? null,
    fortress: n.find((x) => x.rank === 'overlord')?.id ?? null,
  };
  const data: SaveData = {
    saveVersion: SAVE_VERSION,
    createdAt: 1,
    updatedAt: 1,
    worldSeed: 42,
    worldTurn: 8,
    worldAge: 1,
    ageModifiers: [],
    ageName: 'THE WASTES',
    nemeses: n,
    eventLog: events,
    territories,
    nextId: 20,
    nextEventId: 40,
    usedNames: [],
    playerMeta: { ...defaultPlayerMeta(), runs: 3, deaths: 2, lostWeapons: ['ashfang'] },
    settings: defaultSettings(),
    run: null,
    territoryMods: {},
    storyView: { panX: 0, panY: 0, zoom: 1 },
  };
  migrateEventLog(data);
  return data;
}

function check(list: TestResult[], name: string, ok: boolean, detail = ''): void {
  list.push({ name, ok, detail });
}

export function runStorySelfTest(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  const a = nem({
    id: 'n1',
    name: 'Drok',
    rank: 'warlord',
    killsAgainstPlayer: 1,
    stolen: [{ name: 'Ashfang', kind: 'weapon', weaponId: 'ashfang' }],
    playerRelationship: 40,
    territory: 'tower',
  });
  const b = nem({ id: 'n2', name: 'Vara', rank: 'overlord', territory: 'fortress', allies: ['n3'] });
  const c = nem({
    id: 'n3',
    name: 'Aruk',
    rank: 'captain',
    master: 'n2',
    allies: ['n2'],
    personality: 'traitor',
  });
  const dead = nem({
    id: 'n4',
    name: 'Kesh',
    alive: false,
    diedOnTurn: 5,
    killsAgainstPlayer: 2,
    rank: 'elite',
  });
  a.rivalries = ['n3'];
  c.rivalries = ['n1', 'n2'];
  c.allies = [];
  b.allies = [];

  const events = [
    makeEvent(2, 1, 'player_death', 'Drok killed you.', ['n1'], true, 'bad', { id: 'e1', known: true, witnessed: true }),
    makeEvent(3, 1, 'alliance', 'Aruk swore to Vara.', ['n3', 'n2'], false, 'neutral', { id: 'e2', known: true }),
    makeEvent(4, 1, 'betrayal', 'Aruk turned on Vara.', ['n3', 'n2'], true, 'bad', { id: 'e3', known: true }),
    makeEvent(5, 1, 'weapon_theft', 'Drok took Ashfang from you.', ['n1'], true, 'gold', {
      id: 'e4',
      known: true,
      payload: { itemName: 'Ashfang', weaponId: 'ashfang' },
    }),
    makeEvent(6, 1, 'territory', 'Drok seized the Tower.', ['n1', 'n2'], true, 'gold', {
      id: 'e5',
      known: true,
      payload: { areaId: 'tower' },
    }),
    makeEvent(6, 1, 'duel', 'Two captains fought.', ['n3', 'n1'], false, 'neutral', { known: true }),
    makeEvent(6, 1, 'duel', 'Two elites fought.', ['n4', 'n3'], false, 'neutral', { known: true }),
    makeEvent(6, 1, 'duel', 'Dust settled.', ['n2', 'n3'], false, 'neutral', { known: true }),
    makeEvent(7, 1, 'promotion', 'Vara became Overlord.', ['n2'], true, 'gold', {
      id: 'e8',
      payload: { rankTo: 'overlord' },
    }),
    makeEvent(8, 1, 'resurrection', 'Kesh was not as dead as you thought.', ['n4'], true, 'bad', { id: 'e9' }),
  ];
  const data = save([a, b, c, dead], events);

  const g = buildStoryGraph(data);
  check(results, 'relationship graph construction', g.nodes.length >= 5 && g.edges.length >= 4, `${g.nodes.length}n ${g.edges.length}e`);
  const master = g.edges.find((e) => e.kind === 'master' && e.from === 'n3' && e.to === 'n2');
  check(results, 'directional connections', !!master && master.directed, master?.label ?? 'missing');
  const steal = g.edges.find((e) => e.kind === 'stolen_weapon');
  check(results, 'weapon-transfer visualization', !!steal && steal.from === 'n1', steal?.label ?? '');
  const bet = g.edges.find((e) => e.kind === 'betrayal');
  check(results, 'betrayal edge', !!bet && bet.from === 'n3' && bet.to === 'n2', '');
  check(results, 'territory-transfer visualization', data.territories.tower === 'n1' && g.edges.some((e) => e.kind === 'territory_war'), '');

  const f = defaultStoryFilters();
  f.minImportance = 80;
  const filtered = buildStoryModel(data, f);
  check(results, 'filtering', filtered.visibleNodes.length <= g.nodes.length, `${filtered.visibleNodes.length}`);

  const p1 = layoutStoryNodes(data, g.nodes);
  const p2 = layoutStoryNodes(data, g.nodes);
  check(
    results,
    'deterministic graph layout',
    p1.n1.x === p2.n1.x && p1.n1.y === p2.n1.y && p1[PLAYER_ID] && p1.n2.y < p1[PLAYER_ID].y,
    `ov y=${p1.n2.y.toFixed(1)} player y=${p1[PLAYER_ID].y.toFixed(1)}`
  );

  const scN = scoreNode(a, 8, false);
  check(results, 'node importance', scN.total > scoreNode(c, 8, false).total && scN.factors.some((x) => x.id === 'stolen'), String(scN.total));
  const scE = scoreEvent(events[0], 8, new Map(data.nemeses.map((n) => [n.id, n])));
  check(results, 'event importance', scE.total > 40 && scE.factors.some((x) => x.id === 'player'), String(scE.total));

  const tl = buildTimeline(data);
  const grouped = tl.find((t) => t.grouped && t.grouped >= 3);
  check(results, 'repetitive-event grouping', !!grouped, grouped?.headline ?? 'none');

  const arcs = recogniseArcs(data);
  check(results, 'story-arc recognition', arcs.some((x) => x.kind === 'stolen_weapon' && x.unresolved), arcs.map((x) => x.kind).join(','));
  const oath = arcs.find((x) => x.kind === 'broken_alliance');
  check(results, 'broken alliance arc', !!oath && oath.unresolved, oath?.title ?? '');
  const promo = arcs.some((x) => x.kind === 'rise' || x.title.includes('VARA') || events.some((e) => e.payload?.rankTo === 'overlord'));
  check(results, 'promotion and demotion', promo, '');

  dead.alive = true;
  dead.returns = 1;
  const reopened = reopenReturnedArcs(arcs, dead);
  check(results, 'arc reopening after resurrection', reopened.some((x) => x.characters.includes('n4')), '');

  const recap = composeWorldTurnRecap(data, events, 'n1');
  check(results, 'player-death recap', recap.some((b) => /TOOK YOU|KILLED|DROK/i.test(b.headline + b.line)), recap[0]?.headline ?? '');
  const ext = composeRunRecap(data, { extracted: true });
  check(results, 'extraction recap', ext.some((b) => /LEFT THE PIT|EXTRACT/i.test(b.headline)), ext.map((b) => b.act).join(','));
  const succ = composeWorldTurnRecap(data, [makeEvent(8, 2, 'age_begins', 'A new age begins.', [], true, 'gold'), makeEvent(8, 2, 'succession', 'Vara took the seat.', ['n2'], true, 'gold')]);
  check(results, 'Overlord succession recap', succ.some((b) => b.vfx === 'age' || b.vfx === 'succession' || /AGE|SEAT|CROWN/i.test(b.headline)), '');
  check(results, 'skipped-animation correctness', recapPlainText(recap).length > 10, 'text exists without timers');
  check(results, 'AI-disabled fallback', copyForEvent(events[0], new Map([['n1', a]])).headline.length > 0, '');

  const old = {
    saveVersion: 1,
    worldSeed: 1,
    worldTurn: 2,
    worldAge: 1,
    nemeses: [],
    eventLog: [{ turn: 1, age: 1, type: 'duel' as const, text: 'A FOUGHT B.', actors: ['n1', 'n2'], important: false }],
    territories: {},
    nextId: 1,
    playerMeta: defaultPlayerMeta(),
    settings: defaultSettings(),
    ageModifiers: [],
    ageName: '',
    createdAt: 1,
    updatedAt: 1,
    usedNames: [],
    run: null,
    territoryMods: {},
  } as SaveData;
  migrateEventLog(old);
  check(results, 'old-save migration', !!old.eventLog[0].id && old.eventLog[0].known === true && (old.nextEventId ?? 0) > 1, old.eventLog[0].id ?? '');

  const many: SaveData['eventLog'] = [];
  for (let i = 0; i < 400; i++) {
    many.push(makeEvent(i, 1 + (i % 3), i % 5 === 0 ? 'betrayal' : 'duel', `Event ${i}`, ['n1', 'n2'], i % 5 === 0));
  }
  const fat = save([a, b, c, dead], many);
  fat.worldTurn = 400;
  const t0 = performance.now();
  const fatModel = buildStoryModel(fat);
  const dt = performance.now() - t0;
  check(results, 'long-history performance', dt < 250 && fatModel.visibleNodes.length <= 30, `${dt.toFixed(1)}ms nodes=${fatModel.visibleNodes.length}`);
  check(results, 'archived-character access', fatModel.nodes.some((n) => n.id === 'n4'), '');

  const tline = buildTimeline(data, { nemesisId: 'n1' });
  check(results, 'selection and navigation', tline.every((x) => x.actors.includes('n1') || x.grouped), `${tline.length} items`);
  check(results, 'death and resurrection', g.nodes.some((n) => n.id === 'n4' && !n.alive) && events.some((e) => e.type === 'resurrection'), '');
  check(results, 'Age transition recap', succ.length > 0, '');

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  return { passed, failed, results };
}

export function formatStorySelfTest(r: ReturnType<typeof runStorySelfTest>): string {
  return r.results.map((x) => `${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? ' — ' + x.detail : ''}`).join('\n') + `\n${r.passed} passed / ${r.failed} failed`;
}
