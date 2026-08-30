/**
 * Long-game AI policy.
 *
 * THE RULE: the simulation already happened. This file decides whether a
 * moment is worth spending a request on, projects it into `GodFacts`, and
 * asks `AIContentService` to word it. Nothing here writes `alive`, `rank`,
 * `sim`, conditions, the crisis, or the feed headlines. Generated copy is
 * an overlay keyed in the existing text cache; the authored sentence stays.
 *
 * Every getter has a deterministic fallback, so THE LONG GAME is fully
 * playable with the provider off, down, slow, or wrong.
 */

import { hashKey } from '../ai/AICache';
import type { AIContentService } from '../ai/AIContentService';
import {
  aftermathLinkPrompt,
  beatVoicePrompt,
  crisisVoicePrompt,
  dossierPrompt,
  legendPrompt,
  recapPrompt,
  situationPrompt,
} from '../ai/AIPromptBuilder';
import type { GodActorFact, GodFacts, MythEventKind, StoryFacts } from '../ai/AITypes';
import { arcSnippetsFor, runStoryFactsFor } from '../story/NemesisFactsProjection';
import type { RunStorySummary } from '../story/RunStory/RunStoryTypes';
import { storyInvented } from '../story/StoryAI';
import { getPersonality } from '../data/personalities';
import { traitName } from '../data/traits';
import { SCAR_NAMES } from '../nemesis/NemesisMemory';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { factionFor } from './Factions';
import {
  BEAT_RANK,
  simOf,
  type Beat,
  type Crisis,
  type GodState,
  type LegendRecord,
  type RunOutcome,
  type AftermathReport,
  type Situation,
} from './GodTypes';

const WORTHY_KINDS = new Set([
  'duel',
  'hunt',
  'betrayal',
  'revenge',
  'promotion',
  'return',
  'crisis',
  'faction',
  'territory',
  'theft',
  'run',
  'build',
]);

const GOAL_LABEL: Record<string, string> = {
  survive: 'stay alive',
  climb: 'climb',
  revenge: 'revenge',
  protect: 'protect someone',
  hoard: 'take things',
  conquer: 'take everything',
  hide: 'not be found',
  serve: 'serve',
  destroy_god: 'destroy the hand that moves things',
};

/* ============================================================
   importance
   ============================================================ */

export function beatIsWorthy(b: Beat): boolean {
  if (BEAT_RANK[b.priority] < BEAT_RANK.major) return false;
  if (!b.actors.length && b.kind !== 'crisis' && b.kind !== 'run' && b.kind !== 'faction') return false;
  return WORTHY_KINDS.has(b.kind) || b.priority === 'legendary';
}

export function mythKindForBeat(b: Beat, n: Nemesis): MythEventKind | null {
  const primary = b.actors[0];
  if (primary && n.id !== primary) return null;
  switch (b.kind) {
    case 'return':
      return 'returned_from_death';
    case 'promotion':
      if (n.rank === 'overlord') return 'became_overlord';
      if (n.rank === 'warlord') return 'promoted_warlord';
      return 'promoted_captain';
    case 'betrayal':
      return /KILL|DIED|DEAD|THE GROUND|EXECUTE/.test(b.headline) ? 'killed_rival' : null;
    case 'theft':
      return 'stole_weapon';
    case 'build':
      return 'major_scar';
    case 'duel':
    case 'hunt':
    case 'revenge':
      if (/KILL|DIED|DEAD|THE GROUND|EXECUTE/.test(b.headline)) return 'killed_rival';
      return null;
    default:
      return null;
  }
}

/* ============================================================
   facts
   ============================================================ */

function actorFact(n: Nemesis): GodActorFact {
  const s = simOf(n);
  return {
    id: n.id,
    name: n.name,
    title: n.title,
    rank: n.rank,
    alive: n.alive,
    personality: getPersonality(n.personality).name,
    goal: GOAL_LABEL[s.goal] ?? s.goal,
    scars: n.scars.map((x) => SCAR_NAMES[x.id]),
    stolen: n.stolen.map((x) => x.name),
    returns: n.returns,
    kills: s.kills.length,
    deeds: s.deeds.slice(-6).map((d) => d.text),
    killedPlayer: n.killsAgainstPlayer,
    strengths: n.strengths.map(traitName),
    heretic: s.heretic,
    crisisBorn: s.crisisBorn,
  };
}

function baseFacts(
  god: GodState,
  kind: GodFacts['kind'],
  actors: Nemesis[],
  extraNames: string[] = []
): GodFacts {
  const names = [...actors.map((n) => n.name.toUpperCase()), ...extraNames.map((x) => x.toUpperCase())];
  return {
    kind,
    run: god.run,
    cycle: god.cycle,
    act: god.act,
    chaos: god.chaos,
    names: [...new Set(names.filter(Boolean))],
    actors: actors.map(actorFact),
  };
}

export function dossierKey(n: Nemesis, god: GodState): string {
  const s = simOf(n);
  return hashKey(
    'god',
    'dossier',
    god.run,
    n.id,
    n.rank,
    n.alive ? 1 : 0,
    n.ai?.eventVersion ?? 0,
    s.goal,
    s.deeds.length,
    s.kills.length,
    n.returns,
    n.scars.length
  );
}

export function beatKey(b: Beat, god: GodState): string {
  return hashKey('god', 'beat', god.run, b.id, b.headline);
}

export function crisisKey(c: Crisis, god: GodState): string {
  return hashKey('god', 'crisis', god.run, c.kind, c.bodyId ?? '', c.bornCycle, c.resolved);
}

export function recapKey(o: RunOutcome, run: number): string {
  return hashKey('god', 'recap', run, o.ending, o.cycles, o.crisis);
}

export function runStoryKey(story: RunStorySummary, run: number): string {
  return hashKey('god', 'runstory', run, story.thesis, story.dominantMotif ?? '', story.acts.length);
}

export function legendKey(l: LegendRecord): string {
  return hashKey('god', 'legend', l.id, l.epitaph, l.deeds.length);
}

export function aftermathLinkKey(run: number, cycle: number, label: string, text: string): string {
  return hashKey('god', 'aftermath', run, cycle, label, text);
}

export function situationKey(s: Situation, god: GodState): string {
  return hashKey('god', 'situation', god.run, god.cycle, s.id, s.headline);
}

/* ============================================================
   fallbacks — always available, always grounded
   ============================================================ */

export function fallbackDossier(n: Nemesis, god: GodState, mgr: NemesisManager): string {
  const s = simOf(n);
  const p = getPersonality(n.personality).name.toLowerCase();
  const f = factionFor(god, n);
  const target = s.goalTargetId ? mgr.byId(s.goalTargetId) : null;
  const bits: string[] = [];
  bits.push(
    `${n.name.toUpperCase()} is ${p}, ${n.alive ? 'still standing' : 'dead'}, ${n.rank}${f ? ` of ${f.name}` : ''}.`
  );
  const want = GOAL_LABEL[s.goal] ?? s.goal;
  bits.push(
    target
      ? `They want ${want}: ${fullName(target)}.`
      : `They want ${want}.`
  );
  if (s.deeds.length) bits.push(`Last recorded: ${s.deeds[s.deeds.length - 1].text}.`);
  else if (n.returns) bits.push(`Returned from death ${n.returns === 1 ? 'once' : n.returns + ' times'}.`);
  return bits.join(' ');
}

export function fallbackCrisisVoice(c: Crisis): string {
  return c.description;
}

export function fallbackRecapLine(o: RunOutcome): string {
  if (o.ending === 'triumph') return 'Somebody in there was enough.';
  if (o.ending === 'collapse') return 'Nobody in there was enough.';
  if (o.ending === 'stalemate') return 'It never came to anything.';
  return 'You stopped.';
}

export function fallbackLegendVoice(l: LegendRecord): string {
  return l.epitaph;
}

/* ============================================================
   validation — reject invented mechanical claims
   ============================================================ */

function clean(s: string): string {
  return s
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function invented(text: string, facts: GodFacts): boolean {
  const t = text.toLowerCase();
  const burned = facts.actors.some((a) => a.scars.some((s) => /burn/i.test(s)));
  if (/\b(fire|burn|burnt|burned|flame|ash|cinder|ember|scorch)\w*/.test(t) && !burned) return true;

  const lostEye = facts.actors.some((a) => a.scars.some((s) => /eye/i.test(s)));
  if (/\b(eyeless|empty socket)\b/.test(t) && !lostEye) return true;

  const stolen = facts.actors.some((a) => a.stolen.length > 0);
  if (/\b(stole|stolen|took your)\b/.test(t) && !stolen) return true;

  const returned = facts.actors.some((a) => a.returns > 0) || facts.beatKind === 'return';
  if (/\b(returned from|came back from|rose from|undead|resurrect)\w*/.test(t) && !returned) return true;

  const killedPlayer = facts.actors.some((a) => a.killedPlayer > 0);
  if (/\b(killed you|murdered you|slew you)\b/.test(t) && !killedPlayer) return true;

  return false;
}

export function validateDossier(raw: string, facts: GodFacts): string {
  const t = clean(raw);
  if (t.length < 24 || t.length > 280) return '';
  if (t.split(/(?<=[.!?])\s+/).length > 3) return '';
  if (invented(t, facts)) return '';
  return t;
}

export function validateBeatVoice(raw: string, facts: GodFacts): string {
  const t = clean(raw).split(/(?<=[.!?])\s+/)[0] ?? '';
  if (t.length < 12 || t.length > 140) return '';
  if (invented(t, facts)) return '';
  return t;
}

export function validateCrisisVoice(raw: string, facts: GodFacts): string {
  const t = clean(raw);
  if (t.length < 20 || t.length > 240) return '';
  if (invented(t, facts)) return '';
  return t;
}

export function validateRecap(raw: string, facts: GodFacts): string {
  const t = clean(raw).split(/(?<=[.!?])\s+/)[0] ?? '';
  if (t.length < 8 || t.length > 96) return '';
  if (invented(t, facts)) return '';
  return t;
}

export function validateLegend(raw: string, facts: GodFacts): string {
  const t = clean(raw).split(/(?<=[.!?])\s+/)[0] ?? '';
  if (t.length < 12 || t.length > 160) return '';
  if (invented(t, facts)) return '';
  return t;
}

function validateStoryOverlay(raw: string, facts: StoryFacts, min: number, max: number): string {
  const t = clean(raw).split(/(?<=[.!?])\s+/)[0] ?? clean(raw);
  if (t.length < min || t.length > max) return '';
  if (storyInvented(t, facts)) return '';
  return t;
}

/* ============================================================
   observe — never blocks
   ============================================================ */

export function observeGodBeats(
  ai: AIContentService,
  mgr: NemesisManager,
  god: GodState,
  beats: readonly Beat[]
): void {
  const worthy = beats.filter(beatIsWorthy);
  const congested = ai.queue.queuedCount + ai.queue.activeCount >= 10;
  for (const b of worthy) {
    const primary = b.actors[0];
    if (primary) {
      const n = mgr.byId(primary);
      if (n) {
        const myth = mythKindForBeat(b, n);
        if (myth && !congested) ai.onMythEvent(n, myth);
        else if (b.priority === 'legendary' || rankIndex(n.rank) >= 2) ai.ensureFor(n, 40);
      }
    }
    expressBeat(ai, mgr, god, b);
  }

  if (god.crisis && god.crisis.resolved === 'none') {
    expressCrisis(ai, mgr, god, god.crisis);
    const body = mgr.byId(god.crisis.bodyId);
    if (body) ai.ensureFor(body, 55);
  }
}

export function observeInspect(
  ai: AIContentService,
  mgr: NemesisManager,
  god: GodState,
  n: Nemesis
): void {
  ai.ensureFor(n, 95);
  const facts = baseFacts(god, 'dossier', [n], [factionFor(god, n)?.name ?? '']);
  const arcs = arcSnippetsFor(mgr, n, 2);
  if (arcs.length) facts.detail = arcs;
  const { system, user } = dossierPrompt(facts);
  ai.expressText({
    kind: 'dossier',
    subjectId: n.id,
    label: n.name.toUpperCase(),
    cacheKey: dossierKey(n, god),
    priority: 92,
    system,
    user,
    maxTokens: 80,
    validate: (raw) => validateDossier(raw, facts),
  });
}

export function observeEnding(
  ai: AIContentService,
  mgr: NemesisManager,
  god: GodState,
  outcome: RunOutcome,
  legends: readonly LegendRecord[]
): void {
  const champ = mgr.byId(god.championId);
  const crisisBody = mgr.byId(god.crisis?.bodyId);
  const facts = baseFacts(
    god,
    'recap',
    [champ, crisisBody].filter((x): x is Nemesis => !!x),
    [outcome.slayerName, outcome.crisis]
  );
  facts.ending = outcome.ending;
  facts.highlights = outcome.highlights.slice(0, 4);
  if (god.crisis) {
    facts.crisisTitle = god.crisis.title;
    facts.crisisKind = god.crisis.kind;
    facts.crisisDescription = god.crisis.description;
  }
  const { system, user } = recapPrompt(facts);
  ai.expressText({
    kind: 'recap',
    subjectId: `run:${god.run}`,
    label: 'THE RUN',
    cacheKey: recapKey(outcome, god.run),
    priority: 88,
    system,
    user,
    maxTokens: 40,
    validate: (raw) => validateRecap(raw, facts),
  });

  for (const l of legends) {
    const n = mgr.byId(l.id.split(':')[1] ?? '');
    const lf = baseFacts(god, 'legend', n ? [n] : [], [l.name, l.faction]);
    lf.legendName = l.name;
    lf.legendTitle = l.title;
    lf.legendDeeds = l.deeds.slice(0, 6);
    lf.legendCause = l.causeOfDeath;
    lf.legendEpitaph = l.epitaph;
    const p = legendPrompt(lf);
    ai.expressText({
      kind: 'legend',
      subjectId: l.id,
      label: l.name.toUpperCase(),
      cacheKey: legendKey(l),
      priority: 70,
      system: p.system,
      user: p.user,
      maxTokens: 60,
      validate: (raw) => validateLegend(raw, lf),
    });
    if (n) ai.ensureFor(n, 50);
  }
}

export function observeRunStory(
  ai: AIContentService,
  mgr: NemesisManager,
  god: GodState,
  outcome: RunOutcome,
  story: RunStorySummary
): void {
  const facts = runStoryFactsFor(mgr, god, outcome, story);
  const champ = mgr.byId(god.championId);
  const gf = baseFacts(
    god,
    'recap',
    champ ? [champ] : [],
    [outcome.slayerName, story.dominantThread ?? '']
  );
  gf.ending = outcome.ending;
  gf.highlights = [story.thesis, ...story.acts.flatMap((a) => a.beats.map((b) => b.line))].slice(0, 6);
  gf.detail = facts.plainEvidence;
  const { system, user } = recapPrompt(gf);
  ai.expressText({
    kind: 'recap',
    subjectId: `runstory:${god.run}`,
    label: 'THE RUN STORY',
    cacheKey: runStoryKey(story, god.run),
    priority: 72,
    system,
    user,
    maxTokens: 80,
    validate: (raw) => validateRecap(raw, gf),
  });
}

function expressBeat(ai: AIContentService, mgr: NemesisManager, god: GodState, b: Beat): void {
  const actors = b.actors.map((id) => mgr.byId(id)).filter((n): n is Nemesis => !!n);
  const facts = baseFacts(god, 'beat', actors);
  facts.headline = b.headline;
  facts.detail = b.detail.slice(0, 4);
  facts.beatKind = b.kind;
  facts.priority = b.priority;
  const { system, user } = beatVoicePrompt(facts);
  ai.expressText({
    kind: 'beat',
    subjectId: b.actors[0] ?? b.id,
    label: (actors[0]?.name ?? b.kind).toUpperCase(),
    cacheKey: beatKey(b, god),
    priority: b.priority === 'legendary' ? 78 : 52,
    system,
    user,
    maxTokens: 40,
    validate: (raw) => validateBeatVoice(raw, facts),
  });
}

function expressCrisis(ai: AIContentService, mgr: NemesisManager, god: GodState, c: Crisis): void {
  const body = mgr.byId(c.bodyId);
  const facts = baseFacts(god, 'crisis', body ? [body] : [], [c.title]);
  facts.crisisTitle = c.title;
  facts.crisisKind = c.kind;
  facts.crisisDescription = c.description;
  const { system, user } = crisisVoicePrompt(facts);
  ai.expressText({
    kind: 'crisis',
    subjectId: c.bodyId ?? c.kind,
    label: c.title,
    cacheKey: crisisKey(c, god),
    priority: 80,
    system,
    user,
    maxTokens: 70,
    validate: (raw) => validateCrisisVoice(raw, facts),
  });
}

export function observeAftermath(
  ai: AIContentService,
  mgr: NemesisManager,
  god: GodState,
  report: AftermathReport
): void {
  for (const link of report.links) {
    const actorIds = god.conditions
      .filter((c) => link.text.includes(c.targetId))
      .map((c) => c.targetId);
    const actors = actorIds.map((id) => mgr.byId(id)).filter((n): n is Nemesis => !!n);
    const facts: StoryFacts = {
      kind: 'aftermath',
      names: [...new Set(actors.map((n) => n.name.toUpperCase()))],
      linkLabel: link.label,
      linkText: link.text,
      cycle: report.cycle,
      intention: report.intention,
      line: link.text,
    };
    const { system, user } = aftermathLinkPrompt(facts);
    ai.expressText({
      kind: 'aftermath',
      subjectId: `aftermath:${report.cycle}:${link.label}`,
      label: link.label,
      cacheKey: aftermathLinkKey(god.run, report.cycle, link.label, link.text),
      priority: 90,
      system,
      user,
      maxTokens: 55,
      validate: (raw) => validateStoryOverlay(raw, facts, 12, 170),
    });
  }
}

export function observeSituations(
  ai: AIContentService,
  mgr: NemesisManager,
  god: GodState,
  situations: readonly Situation[]
): void {
  for (const s of situations.slice(0, 5)) {
    const actors = s.actors.map((id) => mgr.byId(id)).filter((n): n is Nemesis => !!n);
    const facts: StoryFacts = {
      kind: 'situation',
      names: actors.map((n) => n.name.toUpperCase()),
      headline: s.headline,
      detail: s.detail.slice(0, 120),
      line: s.headline,
    };
    const { system, user } = situationPrompt(facts);
    ai.expressText({
      kind: 'situation',
      subjectId: s.actors[0] ?? s.id,
      label: s.headline.slice(0, 24),
      cacheKey: situationKey(s, god),
      priority: 56,
      system,
      user,
      maxTokens: 50,
      validate: (raw) => validateStoryOverlay(raw, facts, 12, 150),
    });
  }
}

/* ============================================================
   getters — instant, never null where a fallback exists
   ============================================================ */

export function dossierFor(
  ai: AIContentService,
  n: Nemesis,
  god: GodState,
  mgr: NemesisManager
): string {
  return ai.peekOverlay(dossierKey(n, god)) ?? fallbackDossier(n, god, mgr);
}

export function beatVoiceFor(ai: AIContentService, b: Beat, god: GodState): string | null {
  return ai.peekOverlay(beatKey(b, god));
}

export function crisisVoiceFor(ai: AIContentService, god: GodState): string | null {
  if (!god.crisis) return null;
  return ai.peekOverlay(crisisKey(god.crisis, god)) ?? fallbackCrisisVoice(god.crisis);
}

export function recapLineFor(ai: AIContentService, outcome: RunOutcome, run: number): string {
  return ai.peekOverlay(recapKey(outcome, run)) ?? '';
}

export function legendVoiceFor(ai: AIContentService, l: LegendRecord): string {
  return ai.peekOverlay(legendKey(l)) ?? fallbackLegendVoice(l);
}

export function aftermathLinkFor(
  ai: AIContentService,
  run: number,
  cycle: number,
  label: string,
  fallback: string
): string {
  return ai.peekOverlay(aftermathLinkKey(run, cycle, label, fallback)) ?? fallback;
}

export function runStoryVoiceFor(ai: AIContentService, story: RunStorySummary, run: number): string {
  return ai.peekOverlay(runStoryKey(story, run)) ?? story.thesis;
}

/** End-screen subtitle + run-story thesis (AI polish when available). */
export function endScreenVoicesFor(
  ai: AIContentService,
  outcome: RunOutcome,
  run: number
): { subtitle: string; thesis: string } {
  return {
    subtitle: recapLineFor(ai, outcome, run),
    thesis: outcome.runStory ? runStoryVoiceFor(ai, outcome.runStory, run) : '',
  };
}

export function situationVoiceFor(ai: AIContentService, s: Situation, god: GodState): string | null {
  return ai.peekOverlay(situationKey(s, god));
}

/** Mechanical fields only — used to prove AI never writes the simulation. */
export function mechanicalSnapshot(mgr: NemesisManager, god: GodState): Record<string, unknown> {
  return {
    cycle: god.cycle,
    chaos: god.chaos,
    influence: god.influence,
    phase: god.phase,
    crisisResolved: god.crisis?.resolved ?? 'none',
    crisisPower: god.crisis ? Math.round(god.crisis.power) : 0,
    conditions: god.conditions.map((c) => `${c.kind}:${c.targetId}:${c.magnitude}`),
    feedHeadlines: god.feed.map((b) => b.headline),
    people: mgr.roster.map((n) => {
      const s = simOf(n);
      return {
        id: n.id,
        alive: n.alive,
        rank: n.rank,
        power: n.power,
        title: n.title,
        fear: Math.round(s.fear),
        confidence: Math.round(s.confidence),
        ambition: Math.round(s.ambition),
        loyalty: Math.round(s.loyalty),
        injury: Math.round(s.injury),
        goal: s.goal,
        kills: s.kills.length,
        standing: n.playerRelationship,
        returns: n.returns,
        scars: n.scars.length,
      };
    }),
  };
}
