/**
 * Story-layer helpers that gather arcs and world events for AI fact projection.
 * Simulation owns truth; this only reads SaveData and Nemesis records.
 */

import type { SaveData } from '../core/SaveSystem';
import type { RunOutcome } from '../god/GodTypes';
import type { GodState } from '../god/GodTypes';
import type { Nemesis } from '../nemesis/Nemesis';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { WorldEvent } from '../world/WorldEvent';
import { MEMORY_TEXT } from '../nemesis/NemesisMemory';
import { recogniseArcs } from './StoryArcs';

export interface ResolvedMemoryLine {
  turn: number;
  type: string;
  text: string;
}

export interface WorldEventFact {
  turn: number;
  type: string;
  text: string;
  payloadSummary: string;
}

export interface ArcFact {
  title: string;
  kind: string;
  state: string;
  next: string;
  characters: string[];
}

export interface NemesisFactSlice {
  arcs: ArcFact[];
  worldEvents: WorldEventFact[];
  resolvedMemory: ResolvedMemoryLine[];
  chronicleArchives: string[];
}

function payloadSummary(ev: WorldEvent): string {
  const p = ev.payload;
  if (!p) return '';
  const bits: string[] = [];
  if (p.itemName) bits.push(`item ${p.itemName}`);
  if (p.rankFrom && p.rankTo) bits.push(`${p.rankFrom}→${p.rankTo}`);
  if (p.areaId) bits.push(`area ${p.areaId}`);
  if (p.scarId) bits.push(`scar ${p.scarId}`);
  if (p.vendettaState) bits.push(p.vendettaState);
  return bits.join(', ');
}

function resolveMemory(n: Nemesis, nameOf: (id: string | null) => string): ResolvedMemoryLine[] {
  return n.memory.slice(-12).map((m) => {
    const base = MEMORY_TEXT[m.type] ?? m.type;
    const sub = m.subject ? nameOf(m.subject) : '';
    const text = sub ? `${base} (${sub})` : base;
    return { turn: m.turn, type: m.type, text: `T${m.turn} ${text}` };
  });
}

function arcsForNemesis(data: SaveData, n: Nemesis, nameOf: (id: string | null) => string, limit = 3): ArcFact[] {
  const all = recogniseArcs(data);
  return all
    .filter((a) => a.characters.includes(n.id))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit)
    .map((a) => ({
      title: a.title,
      kind: a.kind,
      state: a.state,
      next: a.next,
      characters: a.characters.map((id) => nameOf(id)).filter(Boolean),
    }));
}

function eventsForNemesis(log: WorldEvent[], nemesisId: string, limit = 5): WorldEventFact[] {
  const out: WorldEventFact[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = log[i];
    if (!ev.actors.includes(nemesisId)) continue;
    out.push({
      turn: ev.turn,
      type: ev.type,
      text: ev.text,
      payloadSummary: payloadSummary(ev),
    });
  }
  return out.reverse();
}

/** Recent archived chronicle summaries — deep history without the full event log. */
export function chronicleSummariesFor(data: SaveData, limit = 2): string[] {
  const archives = data.chronicleArchives ?? [];
  return archives.slice(-limit).map((a) => a.summary);
}

/** Gather story arcs, world events, and resolved memory for one nemesis. */
export function factsForNemesis(
  mgr: NemesisManager,
  n: Nemesis,
  opts?: { arcLimit?: number; eventLimit?: number }
): NemesisFactSlice {
  const nameOf = (id: string | null) => {
    if (!id) return '';
    const x = mgr.byId(id);
    return x ? x.name.toUpperCase() : '';
  };
  return {
    arcs: arcsForNemesis(mgr.data, n, nameOf, opts?.arcLimit ?? 3),
    worldEvents: eventsForNemesis(mgr.data.eventLog, n.id, opts?.eventLimit ?? 5),
    resolvedMemory: resolveMemory(n, nameOf),
    chronicleArchives: chronicleSummariesFor(mgr.data, 2),
  };
}

/** Top unresolved arcs involving this nemesis (for chronicle / dossier context). */
export function arcSnippetsFor(mgr: NemesisManager, n: Nemesis, limit = 2): string[] {
  return factsForNemesis(mgr, n, { arcLimit: limit }).arcs.map((a) => `${a.title}: ${a.state}`);
}

export interface RunStoryFactSlice {
  thesis: string;
  dominantMotif: string | null;
  dominantThread: string | null;
  actSummaries: string[];
  plainEvidence: string[];
}

/** Fact slice for AI polish of the end-of-run narrative document. */
export function runStoryFactsFor(
  _mgr: NemesisManager,
  _god: GodState,
  _outcome: RunOutcome,
  story: import('./RunStory/RunStoryTypes').RunStorySummary
): RunStoryFactSlice {
  const plainEvidence: string[] = [];
  for (const m of story.evidence.motifs) {
    for (const e of m.evidence) plainEvidence.push(e.summary);
  }
  for (const t of story.evidence.threads.slice(0, 8)) {
    plainEvidence.push(`${t.title}: ${t.state}`);
  }
  for (const e of story.evidence.echoes.slice(-6)) plainEvidence.push(e.line);
  for (const c of story.evidence.conversations.slice(-4)) {
    plainEvidence.push(c.turns.map((t) => t.fallback).join(' / '));
  }
  return {
    thesis: story.thesis,
    dominantMotif: story.dominantMotif,
    dominantThread: story.dominantThread,
    actSummaries: story.acts.map((a) => `${a.name}: ${a.beats.map((b) => b.line).join('; ')}`),
    plainEvidence: plainEvidence.slice(0, 24),
  };
}
