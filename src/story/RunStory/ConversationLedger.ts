/**
 * Persist god-run conversations on GodState — scheduled from situations, beats, motifs.
 */

import type { ExchangeTurn, LineContext } from '../../data/dialogue';
import { exchangeFor, pickLine } from '../../data/dialogue';
import { fullName } from '../../nemesis/Nemesis';
import type { NemesisManager } from '../../nemesis/NemesisManager';
import { actForCycle } from '../../god/Arc';
import type { Beat, GodState, Situation } from '../../god/GodTypes';
import { BEAT_RANK } from '../../god/GodTypes';
import type { MotifInstance } from './RunStoryTypes';
import type { ConversationRecord, EvidenceRef, GodThreadKind, RunThread } from './RunStoryTypes';
import { latestWhisperEcho } from './GodEchoProjector';
import { threadDialogueBoost } from './ThreadTracker';

const SITUATION_CTX: Partial<Record<Situation['kind'], LineContext>> = {
  rivalry: 'rival',
  revenge: 'taunt',
  betrayal_risk: 'rival',
  grudge: 'taunt',
  heresy: 'taunt',
  ascendant: 'promotion',
  wounded: 'taunt',
};

function beatContext(b: Beat): LineContext | null {
  if (b.kind === 'betrayal') return 'rival';
  if (b.kind === 'promotion') return 'promotion';
  if (b.kind === 'return' || b.kind === 'resurrection') return 'return';
  if (b.kind === 'theft') return 'steal';
  if (/KILL|DIED|DEAD/i.test(b.headline)) return 'kill';
  return 'taunt';
}

function evidenceFor(sit: Situation | null, beat: Beat | null): EvidenceRef[] {
  if (sit) return [{ kind: 'thread', id: sit.id, summary: sit.headline }];
  if (beat) return [{ kind: 'beat', id: beat.id, summary: beat.headline }];
  return [];
}

function buildTurns(
  mgr: NemesisManager,
  nId: string,
  ctx: LineContext,
  threads: RunThread[],
  salt: number
): ExchangeTurn[] {
  const n = mgr.byId(nId);
  if (!n) return [];
  const boost = threadDialogueBoost(threads, nId);
  const script = exchangeFor(n, ctx, salt);
  if (script?.length) {
    return script.map((t, i) => ({
      speaker: t.speaker,
      fallback: t.speaker === 'nemesis' ? pickLine(n, ctx, salt + i, boost) || t.fallback : t.fallback,
    }));
  }
  const line = pickLine(n, ctx, salt, boost);
  return line ? [{ speaker: 'nemesis', fallback: line }] : [];
}

function nextId(god: GodState): string {
  const n = god.nextConversationId ?? 1;
  god.nextConversationId = n + 1;
  return `conv-${n}`;
}

function alreadyScheduled(god: GodState, key: string): boolean {
  return (god.conversations ?? []).some((c) => c.id === key || c.evidence.some((e) => e.id === key));
}

export function scheduleConversation(
  mgr: NemesisManager,
  god: GodState,
  opts: {
    actorId: string;
    ctx: LineContext;
    cycle: number;
    threads: RunThread[];
    threadKind?: GodThreadKind;
    evidence: EvidenceRef[];
    key: string;
    participants?: string[];
  }
): ConversationRecord | null {
  if (alreadyScheduled(god, opts.key)) return null;
  const n = mgr.byId(opts.actorId);
  if (!n) return null;
  const turns = buildTurns(mgr, opts.actorId, opts.ctx, opts.threads, opts.cycle);
  if (!turns.length) return null;
  const rec: ConversationRecord = {
    id: opts.key || nextId(god),
    cycle: opts.cycle,
    act: actForCycle(opts.cycle).id,
    context: opts.ctx,
    participants: opts.participants ?? [opts.actorId],
    threadKind: opts.threadKind,
    turns,
    evidence: opts.evidence,
  };
  if (!god.conversations) god.conversations = [];
  god.conversations.push(rec);
  if (god.conversations.length > 48) god.conversations.shift();
  return rec;
}

export function tickConversationLedger(
  mgr: NemesisManager,
  god: GodState,
  situations: Situation[],
  beats: Beat[],
  threads: RunThread[],
  motifs: MotifInstance[]
): void {
  const cycle = god.cycle;

  for (const sit of situations.slice(0, 3)) {
    const actor = sit.actors[0];
    if (!actor) continue;
    const ctx = SITUATION_CTX[sit.kind] ?? 'taunt';
    const thread = threads.find((t) => t.characters.includes(actor));
    scheduleConversation(mgr, god, {
      actorId: actor,
      ctx,
      cycle,
      threads,
      threadKind: thread?.kind as GodThreadKind | undefined,
      evidence: evidenceFor(sit, null),
      key: `sit:${sit.id}:${cycle}`,
      participants: sit.actors,
    });
  }

  for (const b of beats) {
    if (BEAT_RANK[b.priority] < BEAT_RANK.major) continue;
    const actor = b.actors[0];
    if (!actor) continue;
    const ctx = beatContext(b);
    if (!ctx) continue;
    scheduleConversation(mgr, god, {
      actorId: actor,
      ctx,
      cycle: b.cycle,
      threads,
      evidence: evidenceFor(null, b),
      key: `beat:${b.id}`,
      participants: b.actors,
    });
  }

  const strong = motifs.filter((m) => m.strength >= 14);
  for (const m of strong.slice(0, 2)) {
    const carrier = m.carriers[0];
    if (!carrier) continue;
    scheduleConversation(mgr, god, {
      actorId: carrier,
      ctx: m.kind === 'debt' ? 'steal' : m.kind === 'fire' ? 'arrival' : 'taunt',
      cycle,
      threads,
      evidence: m.evidence.slice(0, 2),
      key: `motif:${m.kind}:${cycle}`,
    });
  }
}

export function latestConversation(god: GodState): ConversationRecord | null {
  const list = god.conversations ?? [];
  return list.length ? list[list.length - 1] : null;
}

export function latestWhisperLine(god: GodState, beats: readonly Beat[]): string | null {
  const conv = latestConversation(god);
  if (conv?.turns.length) {
    const turn = conv.turns.find((t) => t.speaker === 'nemesis') ?? conv.turns[0];
    return turn.fallback;
  }
  const echo = latestWhisperEcho(god, beats);
  return echo?.line ?? null;
}

export function conversationPlain(rec: ConversationRecord, mgr: NemesisManager): string {
  const n = mgr.byId(rec.participants[0]);
  const name = n ? fullName(n) : '?';
  return rec.turns
    .map((t) => `${t.speaker === 'player' ? 'YOU' : name}: ${t.fallback}`)
    .join(' ');
}
