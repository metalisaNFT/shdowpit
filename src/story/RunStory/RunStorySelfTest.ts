/**
 * Deterministic RunStory checks — mirror StorySelfTest pattern.
 */

import type { Nemesis } from '../../nemesis/Nemesis';
import type { SaveData } from '../../core/SaveSystem';
import { defaultPlayerMeta, defaultSettings, migrateEventLog, SAVE_VERSION, defaultGodHistory } from '../../core/SaveSystem';
import { makeEvent } from '../../world/WorldEvent';
import { addCondition } from '../../god/Conditions';
import { emptyGodState } from '../../god/GodRun';
import { simOf } from '../../god/GodTypes';
import type { Beat, RunOutcome } from '../../god/GodTypes';
import { detectMotifs, dominantMotif } from './MotifDetector';
import { projectGodEchoes, sliceBeatWhy } from './GodEchoProjector';
import { trackThreads, threadDialogueBoost } from './ThreadTracker';
import { latestWhisperLine, scheduleConversation, tickConversationLedger } from './ConversationLedger';
import { composeRunStory } from './RunStoryComposer';
import type { NemesisManager } from '../../nemesis/NemesisManager';

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
    pit: n[0]?.id ?? null,
    ruins: n.find((x) => x.territory === 'ruins')?.id ?? null,
    forest: null,
    caves: null,
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
    god: null,
    legends: [],
    godUnlocks: [],
    godHistory: defaultGodHistory(),
    ageModifiers: [],
    ageName: 'THE WASTES',
    nemeses: n,
    eventLog: events,
    chronicleArchives: [],
    territories,
    nextId: 20,
    nextEventId: 40,
    usedNames: [],
    playerMeta: { ...defaultPlayerMeta(), runs: 3 },
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

function sampleBeat(cycle: number, headline: string, actors: string[]): Beat {
  return {
    id: `b-${cycle}-${headline.slice(0, 8)}`,
    cycle,
    priority: 'major',
    headline,
    detail: [],
    actors,
    tone: 'neutral',
    kind: 'duel',
  };
}

function sampleOutcome(): RunOutcome {
  return {
    ending: 'stalemate',
    cycles: 12,
    chaosPeak: 40,
    influenceSpent: 30,
    interventions: 4,
    crisis: 'No crisis',
    crisisKind: null,
    slayerName: '',
    epithet: '',
    revengeChains: 1,
    highlights: ['The world turned without a single hand on the scale.'],
    recapChain: ['THE CRISIS NEVER FORMED.', 'AND THE RUNWAY RAN OUT.'],
    legendsMade: [],
    essence: 50,
    unlocked: [],
  };
}

export function runRunStorySelfTest(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];

  const drok = nem({
    id: 'n1',
    name: 'Drok',
    rank: 'warlord',
    killsAgainstPlayer: 1,
    stolen: [{ name: 'Ashfang', kind: 'weapon', weaponId: 'ashfang' }],
    playerRelationship: 40,
    territory: 'tower',
    scars: [{ id: 'burn', turn: 3 }],
    memory: [{ type: 'I_STOLE_PLAYER_WEAPON', turn: 4, subject: 'player' }],
  });
  const vara = nem({ id: 'n2', name: 'Vara', rank: 'overlord', territory: 'fortress' });
  const aruk = nem({
    id: 'n3',
    name: 'Aruk',
    rank: 'captain',
    personality: 'traitor',
    master: 'n2',
    memory: [{ type: 'I_WAS_BETRAYED', turn: 5, subject: 'n2' }],
  });
  simOf(aruk).heretic = true;

  const events = [
    makeEvent(4, 1, 'betrayal', 'Aruk turned on Vara.', ['n3', 'n2'], true, 'bad', { id: 'e3' }),
    makeEvent(5, 1, 'weapon_theft', 'Drok took Ashfang.', ['n1'], true, 'gold', {
      id: 'e4',
      payload: { itemName: 'Ashfang' },
    }),
    makeEvent(7, 1, 'promotion', 'Vara became Overlord.', ['n2'], true, 'gold', {
      id: 'e8',
      payload: { rankTo: 'overlord' },
    }),
  ];
  const data = save([drok, vara, aruk], events);
  const mgr = {
    data,
    roster: data.nemeses,
    byId: (id: string | null | undefined) => data.nemeses.find((n) => n.id === id) ?? null,
  } as unknown as NemesisManager;
  const god = emptyGodState(42, 1);
  god.cycle = 10;
  god.act = 'rising';
  god.conversations = [];
  god.nextConversationId = 1;

  addCondition(god, {
    kind: 'bounty',
    targetKind: 'nemesis',
    targetId: 'n1',
    magnitude: 0.8,
    duration: 4,
    note: 'a price on his head',
    source: 'god',
  });
  addCondition(god, {
    kind: 'blessing',
    targetKind: 'nemesis',
    targetId: 'n2',
    magnitude: 0.6,
    duration: 3,
    note: 'yours from the first cycle',
    source: 'god',
  });

  const motifs = detectMotifs(mgr, god);
  check(results, 'motif detection', motifs.length >= 3, motifs.map((m) => m.kind).join(','));
  check(results, 'debt motif from theft', motifs.some((m) => m.kind === 'debt' && m.evidence.length > 0), '');
  check(results, 'knife motif from betrayal', motifs.some((m) => m.kind === 'knife'), '');
  check(results, 'heretic motif from sim', motifs.some((m) => m.kind === 'heretic'), '');
  check(results, 'motif evidence refs', motifs.every((m) => m.evidence.length > 0 && m.refrain.length > 8), '');

  const beat: Beat = {
    ...sampleBeat(9, 'DROK FOUGHT VARA', ['n1', 'n2']),
    why: {
      actorId: 'n1',
      actorName: 'Drok',
      personality: 'avenger',
      actionName: 'DUEL',
      targetName: 'Vara',
      targetKind: 'nemesis',
      total: 42,
      parts: { base: 10, personality: 5, relationship: 4, memory: 3, need: 2, danger: 1, opportunity: 8, ambition: 6, noise: 3 },
      marks: ['bounty on Drok'],
      alternatives: [{ actionName: 'FLEE', targetName: 'ruins', total: 38 }],
      rationed: { actionName: 'HUNT', targetName: 'Aruk', total: 44 },
    },
  };
  god.feed = [beat];

  const echoes = projectGodEchoes(god, god.feed);
  check(results, 'god echo projection', echoes.length >= 2, String(echoes.length));
  check(
    results,
    'echo never says god',
    echoes.every((e) => !/\b(the god|god cursed|god blessed)\b/i.test(e.line)),
    echoes.map((e) => e.line).join('|')
  );
  check(results, 'echo cites evidence', echoes.every((e) => e.evidence.length > 0), '');
  check(results, 'beat why slice', sliceBeatWhy(god.feed).length === 1, '');

  const threads = trackThreads(mgr, god);
  check(results, 'thread tracking', threads.length >= 4, String(threads.length));
  check(
    results,
    'god threads',
    threads.some((t) => t.kind === 'divine_favour' || t.kind === 'divine_wrath' || t.kind === 'marked_target'),
    threads.map((t) => t.kind).join(',')
  );
  check(results, 'thread dialogue boost', threadDialogueBoost(threads, 'n1') > 0, '');

  tickConversationLedger(mgr, god, [], [beat], threads, motifs);
  check(results, 'conversation ledger tick', (god.conversations?.length ?? 0) >= 1, String(god.conversations?.length));
  const scheduled = scheduleConversation(mgr, god, {
    actorId: 'n1',
    ctx: 'steal',
    cycle: 10,
    threads,
    evidence: [{ kind: 'beat', id: 'dup', summary: 'test' }],
    key: 'dup-test',
  });
  check(results, 'conversation schedule', !!scheduled && scheduled.turns.length > 0, '');
  const whisper = latestWhisperLine(god, god.feed);
  check(results, 'latest whisper', !!whisper && whisper.length > 4, whisper ?? '');

  const outcome = sampleOutcome();
  const story = composeRunStory(mgr, god, outcome);
  check(results, 'run story compose', story.acts.length >= 1 && story.thesis.length > 10, story.thesis);
  check(results, 'run story acts have beats', story.acts.some((a) => a.beats.length >= 1), '');
  check(results, 'dominant motif', story.dominantMotif === dominantMotif(motifs)?.kind, String(story.dominantMotif));
  check(results, 'plain text export', story.plainText.includes(story.thesis), '');
  check(results, 'recap chain integrated', story.acts.some((a) => a.beats.some((b) => b.headline === 'WHY IT ENDED')), '');

  const t0 = performance.now();
  for (let i = 0; i < 40; i++) composeRunStory(mgr, god, outcome);
  const dt = performance.now() - t0;
  check(results, 'compose performance', dt < 400, `${dt.toFixed(1)}ms`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  return { passed, failed, results };
}

export function formatRunStorySelfTest(r: ReturnType<typeof runRunStorySelfTest>): string {
  return (
    r.results.map((x) => `${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? ' — ' + x.detail : ''}`).join('\n') +
    `\n${r.passed} passed / ${r.failed} failed`
  );
}
