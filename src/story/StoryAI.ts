/**
 * Pit-run story AI policy.
 *
 * Same contract as GodAI: simulation wrote the facts; this file queues
 * presentation overlays only. Every getter falls back to template copy.
 */

import { hashKey } from '../ai/AICache';
import type { AIContentService } from '../ai/AIContentService';
import {
  arcPrompt,
  buildRichFacts,
  encounterLinePrompt,
  encounterPrompt,
  exchangePrompt,
  journeyPrompt,
  recapBeatPrompt,
  timelinePrompt,
} from '../ai/AIPromptBuilder';
import type { RichNemesisFacts, StoryFacts } from '../ai/AITypes';
import { type Nemesis } from '../nemesis/Nemesis';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { RecapBeat, StoryArc, TimelineItem } from './StoryTypes';
import { factsForNemesis } from './NemesisFactsProjection';
import { encounterLineContext, factAllowsLine } from '../nemesis/EncounterCopy';
import type { EncounterKind } from '../nemesis/EncounterKind';
import {
  exchangeContextForEncounter,
  exchangeFor,
  pickLine,
  type ExchangeTurn,
  type LineContext,
} from '../data/dialogue';
import { simOf } from '../god/GodTypes';

const MAX_RECAP_BEATS = 6;
const MAX_TIMELINE = 8;
const MAX_ARCS = 5;
const MAX_JOURNEY = 10;

function clean(s: string): string {
  return s
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesFromActors(mgr: NemesisManager, ids: string[]): string[] {
  return [...new Set(ids.map((id) => mgr.byId(id)?.name.toUpperCase()).filter(Boolean) as string[])];
}

export function storyInvented(text: string, facts: StoryFacts): boolean {
  const allowed = new Set(facts.names.map((n) => n.toLowerCase()));
  const skip = new Set([
    'you',
    'your',
    'they',
    'their',
    'the',
    'who',
    'and',
    'but',
    'for',
    'with',
    'from',
    'not',
    'has',
    'had',
    'was',
    'were',
  ]);
  const tokens = text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (skip.has(low)) continue;
    if (!allowed.has(low)) return true;
  }
  const t = text.toLowerCase();
  if (/\b(killed you|murdered you)\b/.test(t) && !facts.line?.toLowerCase().includes('killed you')) return true;
  if (/\b(stole|stolen)\b/.test(t) && !/stole|stolen|claimed|took/.test((facts.line ?? '').toLowerCase())) return true;
  return false;
}

function invented(text: string, facts: StoryFacts): boolean {
  return storyInvented(text, facts);
}

function validateStoryLine(raw: string, facts: StoryFacts, min: number, max: number): string {
  const t = clean(raw).split(/(?<=[.!?])\s+/)[0] ?? clean(raw);
  if (t.length < min || t.length > max) return '';
  if (invented(t, facts)) return '';
  return t;
}

function validateArcVoice(raw: string, facts: StoryFacts): string {
  const t = clean(raw);
  if (t.length < 16 || t.length > 220) return '';
  if (invented(t, facts)) return '';
  return t;
}

export function recapBeatKey(b: RecapBeat): string {
  return hashKey('story', 'recap_beat', b.act, b.headline, b.line, b.eventIds.join(','));
}

export function timelineKey(item: TimelineItem): string {
  return hashKey('story', 'timeline', item.id, item.headline, item.detail);
}

export function journeyKey(n: Nemesis, beat: string, index: number): string {
  return hashKey('story', 'journey', n.id, n.ai?.eventVersion ?? 0, index, beat);
}

export function arcKey(arc: StoryArc): string {
  return hashKey('story', 'arc', arc.id, arc.kind, arc.state, arc.next);
}

export function encounterKey(n: Nemesis, kind: string, headline: string): string {
  return hashKey('story', 'encounter', n.id, n.ai?.eventVersion ?? 0, kind, headline);
}

export function contextualLineKey(
  n: Nemesis,
  encounterKind: string,
  lineContext: LineContext,
  salt = 0
): string {
  return hashKey('story', 'contextual_line', n.id, n.ai?.eventVersion ?? 0, encounterKind, lineContext, salt);
}

export function exchangeTurnKey(n: Nemesis, lineContext: LineContext, turnIndex: number, salt = 0): string {
  return hashKey('story', 'exchange', n.id, n.ai?.eventVersion ?? 0, lineContext, turnIndex, salt);
}

function richFacts(
  mgr: NemesisManager,
  n: Nemesis,
  trigger: import('../ai/AITypes').MythEventKind | null = null
): RichNemesisFacts {
  const nameOf = (id: string | null) => {
    const x = id ? mgr.byId(id) : null;
    return x ? x.name.toUpperCase() : '';
  };
  const slice = factsForNemesis(mgr, n);
  let sim: { goal: string; deeds: string[]; kills: number } | undefined;
  try {
    const s = simOf(n);
    if (s.goal !== 'survive' || s.deeds.length || s.kills.length) {
      sim = { goal: s.goal, deeds: s.deeds.slice(-4).map((d) => d.text), kills: s.kills.length };
    }
  } catch {
    /* pit run — no sim slice */
  }
  return buildRichFacts(
    n,
    { turn: mgr.turn, age: mgr.age, ageName: mgr.ageState.name },
    nameOf,
    trigger,
    slice,
    sim
  );
}

export interface EncounterOverlayContext {
  legacyKind?: string;
  legacyHeadline?: string;
  conditionMarks?: string;
  recentProc?: string;
  combatNote?: string;
}

function express(
  ai: AIContentService,
  facts: StoryFacts,
  cacheKey: string,
  subjectId: string,
  label: string,
  kind: StoryFacts['kind'],
  priority: number,
  prompt: { system: string; user: string },
  maxTokens: number,
  validate: (raw: string) => string
): void {
  void facts;
  ai.expressText({
    kind,
    subjectId,
    label,
    cacheKey,
    priority,
    system: prompt.system,
    user: prompt.user,
    maxTokens,
    validate,
  });
}

export function observeRecapBeats(ai: AIContentService, mgr: NemesisManager, beats: readonly RecapBeat[]): void {
  const top = beats.slice(0, MAX_RECAP_BEATS);
  for (const b of top) {
    const facts: StoryFacts = {
      kind: 'recap_beat',
      names: namesFromActors(mgr, b.actors),
      headline: b.headline,
      line: b.line,
      detail: b.detail,
      act: b.act,
    };
    express(
      ai,
      facts,
      recapBeatKey(b),
      b.actors[0] ?? `recap:${b.act}`,
      b.headline.slice(0, 24),
      'recap_beat',
      88,
      recapBeatPrompt(facts),
      50,
      (raw) => validateStoryLine(raw, facts, 12, 150)
    );
  }
}

export function observeTimeline(ai: AIContentService, mgr: NemesisManager, items: readonly TimelineItem[]): void {
  const top = items.filter((i) => i.important || !i.grouped).slice(0, MAX_TIMELINE);
  for (const item of top) {
    const facts: StoryFacts = {
      kind: 'timeline',
      names: namesFromActors(mgr, item.actors),
      headline: item.headline,
      line: item.detail,
      detail: item.detail,
      eventType: item.type,
      witnessed: item.witnessed,
      known: item.known,
    };
    express(
      ai,
      facts,
      timelineKey(item),
      item.actors[0] ?? item.id,
      item.headline.slice(0, 24),
      'timeline',
      55,
      timelinePrompt(facts),
      50,
      (raw) => validateStoryLine(raw, facts, 12, 150)
    );
  }
}

export function observeJourney(
  ai: AIContentService,
  n: Nemesis,
  beats: readonly string[],
  opts?: { limit?: number }
): void {
  const cap = opts?.limit ?? MAX_JOURNEY;
  const top = beats.slice(-cap);
  top.forEach((beat, index) => {
    const facts: StoryFacts = {
      kind: 'journey',
      names: [n.name.toUpperCase()],
      line: beat,
      nemesisName: n.name,
      beatIndex: index,
    };
    express(
      ai,
      facts,
      journeyKey(n, beat, index),
      n.id,
      n.name.toUpperCase(),
      'journey',
      52,
      journeyPrompt(facts),
      45,
      (raw) => validateStoryLine(raw, facts, 10, 130)
    );
  });
}

export function observeArcs(ai: AIContentService, mgr: NemesisManager, arcs: readonly StoryArc[]): void {
  const top = arcs.filter((a) => a.unresolved).slice(0, MAX_ARCS);
  for (const arc of top) {
    const facts: StoryFacts = {
      kind: 'arc',
      names: namesFromActors(mgr, arc.characters),
      arcTitle: arc.title,
      arcKind: arc.kind,
      arcState: arc.state,
      arcNext: arc.next,
      headline: arc.title,
      line: arc.state,
      detail: arc.next,
    };
    express(
      ai,
      facts,
      arcKey(arc),
      arc.characters[0] ?? arc.id,
      arc.title.slice(0, 24),
      'arc',
      58,
      arcPrompt(facts),
      60,
      (raw) => validateArcVoice(raw, facts)
    );
  }
}

export function observeEncounter(
  ai: AIContentService,
  n: Nemesis,
  kind: string,
  fallbackHeadline: string,
  relationshipChip?: string,
  overlay?: EncounterOverlayContext
): void {
  const facts: StoryFacts = {
    kind: 'encounter',
    names: [n.name.toUpperCase()],
    headline: fallbackHeadline,
    encounterKind: kind,
    relationshipChip,
    legacyKind: overlay?.legacyKind,
    legacyHeadline: overlay?.legacyHeadline,
    conditionMarks: overlay?.conditionMarks,
    recentProc: overlay?.recentProc,
    combatNote: overlay?.combatNote,
  };
  express(
    ai,
    facts,
    encounterKey(n, kind, fallbackHeadline),
    n.id,
    n.name.toUpperCase(),
    'encounter',
    72,
    encounterPrompt(facts),
    35,
    (raw) => validateStoryLine(raw, facts, 8, 90)
  );
}

function validateContextualLine(raw: string, n: Nemesis, fallback: string, names: string[]): string {
  const t = clean(raw);
  if (t.length < 4 || t.length > 90) return '';
  if (t.split(/\s+/).length > 12) return '';
  if (!factAllowsLine(n, t)) return '';
  const facts: StoryFacts = { kind: 'encounter', names, line: fallback };
  if (invented(t, facts)) return '';
  return t;
}

export function observeEncounterLine(
  ai: AIContentService,
  mgr: NemesisManager,
  n: Nemesis,
  encounterKind: EncounterKind,
  salt: number,
  fallbackLine: string,
  overlay?: EncounterOverlayContext
): void {
  const lineContext = encounterLineContext(encounterKind, n);
  const rf = richFacts(mgr, n);
  const names = [n.name.toUpperCase(), ...rf.storyArcs.flatMap((a) => a.characters)].filter(Boolean);
  const cacheKey = contextualLineKey(n, encounterKind, lineContext, salt);
  const prompt = encounterLinePrompt({
    f: rf,
    encounterKind,
    lineContext,
    fallbackLine,
    legacyKind: overlay?.legacyKind,
    legacyHeadline: overlay?.legacyHeadline,
  });
  ai.expressText({
    kind: 'contextual_line',
    subjectId: n.id,
    label: n.name.toUpperCase(),
    cacheKey,
    priority: 74,
    system: prompt.system,
    user: prompt.user,
    maxTokens: 32,
    validate: (raw) => validateContextualLine(raw, n, fallbackLine, names),
  });

  const exCtx = exchangeContextForEncounter(encounterKind);
  if (exCtx) observeExchange(ai, mgr, n, exCtx, salt);
}

export function observeExchange(
  ai: AIContentService,
  mgr: NemesisManager,
  n: Nemesis,
  lineContext: LineContext,
  salt: number
): void {
  const script = exchangeFor(n, lineContext, salt);
  if (!script?.length) return;
  const rf = richFacts(mgr, n);
  const names = [n.name.toUpperCase(), 'YOU'];
  script.forEach((turn, turnIndex) => {
    const fallback =
      turn.speaker === 'nemesis' ? pickLine(n, lineContext, salt + turnIndex) || turn.fallback : turn.fallback;
    const prompt = exchangePrompt({
      f: rf,
      lineContext,
      turnIndex,
      speaker: turn.speaker,
      fallbackLine: fallback,
    });
    ai.expressText({
      kind: 'exchange',
      subjectId: n.id,
      label: `${n.name.toUpperCase()} T${turnIndex + 1}`,
      cacheKey: exchangeTurnKey(n, lineContext, turnIndex, salt),
      priority: 68 - turnIndex,
      system: prompt.system,
      user: prompt.user,
      maxTokens: turn.speaker === 'player' ? 24 : 32,
      validate: (raw) => {
        const t = clean(raw);
        if (t.length < 2 || t.length > 90) return '';
        if (turn.speaker === 'nemesis' && !factAllowsLine(n, t)) return '';
        const facts: StoryFacts = { kind: 'encounter', names, line: fallback };
        if (invented(t, facts)) return '';
        return t;
      },
    });
  });
}

export function contextualLineFor(
  ai: AIContentService,
  n: Nemesis,
  encounterKind: EncounterKind,
  lineContext: LineContext,
  salt: number,
  fallback: string
): string {
  const overlay = ai.peekOverlay(contextualLineKey(n, encounterKind, lineContext, salt));
  if (!overlay || !factAllowsLine(n, overlay)) return fallback;
  return overlay;
}

export function exchangeTurnFor(
  ai: AIContentService,
  n: Nemesis,
  lineContext: LineContext,
  turnIndex: number,
  salt: number,
  fallback: string
): string {
  return ai.peekOverlay(exchangeTurnKey(n, lineContext, turnIndex, salt)) ?? fallback;
}

/** HUD taunt plate — contextual when available, else template. */
export function tauntLineFor(ai: AIContentService, n: Nemesis, salt: number): string {
  const fallback = pickLine(n, 'taunt', salt);
  const overlay = ai.peekOverlay(contextualLineKey(n, 'INTERRUPTION', 'taunt', salt));
  if (overlay && factAllowsLine(n, overlay)) return overlay;
  return fallback;
}

/** Last words on named defeat — AI overlay with template fallback. */
export function lastWordsFor(ai: AIContentService, n: Nemesis, salt: number): string {
  const fallback = pickLine(n, 'last_words', salt);
  if ((n.appearanceSeed ^ salt) % 5 === 0 && !fallback) return '';
  const overlay = ai.peekOverlay(contextualLineKey(n, 'NEMESIS_DEFEATED', 'last_words', salt));
  if (overlay && factAllowsLine(n, overlay)) return overlay;
  return fallback;
}

export function exchangeScriptFor(
  ai: AIContentService,
  n: Nemesis,
  lineContext: LineContext,
  salt: number
): ExchangeTurn[] | null {
  const script = exchangeFor(n, lineContext, salt);
  if (!script) return null;
  return script.map((turn, i) => ({
    speaker: turn.speaker,
    fallback:
      turn.speaker === 'nemesis'
        ? exchangeTurnFor(ai, n, lineContext, i, salt, pickLine(n, lineContext, salt + i) || turn.fallback)
        : exchangeTurnFor(ai, n, lineContext, i, salt, turn.fallback),
  }));
}

export function recapBeatLineFor(ai: AIContentService, b: RecapBeat): string {
  return ai.peekOverlay(recapBeatKey(b)) ?? b.line;
}

export function timelineDetailFor(ai: AIContentService, item: TimelineItem): string {
  return ai.peekOverlay(timelineKey(item)) ?? item.detail;
}

export function journeyLineFor(ai: AIContentService, n: Nemesis, beat: string, index: number): string {
  return ai.peekOverlay(journeyKey(n, beat, index)) ?? beat;
}

export function arcVoiceFor(ai: AIContentService, arc: StoryArc): { state: string; next: string } {
  const voice = ai.peekOverlay(arcKey(arc));
  if (!voice) return { state: arc.state, next: arc.next };
  const parts = voice.split(/(?<=[.!?])\s+/);
  if (parts.length >= 2) return { state: parts[0], next: parts.slice(1).join(' ') };
  return { state: voice, next: arc.next };
}

export function encounterHeadlineFor(ai: AIContentService, n: Nemesis, kind: string, fallback: string): string {
  return ai.peekOverlay(encounterKey(n, kind, fallback)) ?? fallback;
}
