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
  encounterPrompt,
  journeyPrompt,
  recapBeatPrompt,
  timelinePrompt,
} from '../ai/AIPromptBuilder';
import type { StoryFacts } from '../ai/AITypes';
import { type Nemesis } from '../nemesis/Nemesis';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { RecapBeat, StoryArc, TimelineItem } from './StoryTypes';

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
