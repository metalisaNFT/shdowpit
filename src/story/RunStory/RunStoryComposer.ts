/**
 * Assemble the Run Narrative Document at run end from derived facts only.
 */

import { getAct } from '../../god/Arc';
import { ACT_ORDER, type ActId, type GodState, type RunOutcome } from '../../god/GodTypes';
import type { NemesisManager } from '../../nemesis/NemesisManager';
import { detectMotifs, dominantMotif } from './MotifDetector';
import { projectGodEchoes } from './GodEchoProjector';
import { conversationPlain } from './ConversationLedger';
import { dominantThread, trackThreads } from './ThreadTracker';
import type {
  ConversationRecord,
  GodEcho,
  MotifInstance,
  RunStoryAct,
  RunStoryBeat,
  RunStorySummary,
  RunThread,
} from './RunStoryTypes';

function actName(id: ActId): string {
  return getAct(id).name;
}

function beatFromThread(t: RunThread, act: ActId): RunStoryBeat {
  return {
    kind: 'thread',
    headline: t.title,
    line: t.state,
    act,
    evidence: t.evidence,
  };
}

function beatFromMotif(m: MotifInstance, act: ActId): RunStoryBeat {
  return {
    kind: 'motif',
    headline: m.kind.toUpperCase(),
    line: m.refrain,
    act,
    evidence: m.evidence,
  };
}

function beatFromEcho(e: GodEcho): RunStoryBeat {
  return {
    kind: 'echo',
    headline: e.texture,
    line: e.line,
    act: e.act,
    evidence: e.evidence,
  };
}

function beatFromConversation(rec: ConversationRecord, mgr: NemesisManager): RunStoryBeat {
  const line = conversationPlain(rec, mgr);
  return {
    kind: 'conversation',
    headline: rec.context.toUpperCase(),
    line,
    act: rec.act,
    evidence: rec.evidence,
  };
}

function actForItem(cycle: number, actHint?: ActId): ActId {
  if (actHint) return actHint;
  let act: ActId = 'early';
  for (const id of ACT_ORDER) {
    if (cycle >= getAct(id).from) act = id;
  }
  return act;
}

function capBeats(beats: RunStoryBeat[], min = 2, max = 4): RunStoryBeat[] {
  const sorted = beats.sort((a, b) => a.evidence[0]?.summary.localeCompare(b.evidence[0]?.summary ?? '') ?? 0);
  if (sorted.length <= max) return sorted.length >= min ? sorted : sorted;
  const kinds = new Set<RunStoryBeat['kind']>();
  const picked: RunStoryBeat[] = [];
  for (const b of sorted) {
    if (picked.length >= max) break;
    if (kinds.has(b.kind) && picked.length >= min) continue;
    kinds.add(b.kind);
    picked.push(b);
  }
  while (picked.length < min && sorted[picked.length]) picked.push(sorted[picked.length]);
  return picked.slice(0, max);
}

function buildThesis(motif: MotifInstance | null, thread: RunThread | null, outcome: RunOutcome): string {
  const motifPart = motif ? `The run kept returning to ${motif.kind}.` : 'No single image dominated.';
  const threadPart = thread ? ` ${thread.title} — ${thread.state}` : '';
  const endPart =
    outcome.ending === 'triumph'
      ? ' Someone in the world was enough.'
      : outcome.ending === 'collapse'
        ? ' The crisis outgrew every price.'
        : ' The board never settled.';
  return (motifPart + threadPart + endPart).trim();
}

function plainText(acts: RunStoryAct[], thesis: string): string {
  const lines = [thesis, ''];
  for (const act of acts) {
    lines.push(act.name);
    for (const b of act.beats) lines.push(`  ${b.headline}. ${b.line}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function composeRunStory(mgr: NemesisManager, god: GodState, outcome: RunOutcome): RunStorySummary {
  const motifs = detectMotifs(mgr, god);
  const threads = trackThreads(mgr, god);
  const echoes = projectGodEchoes(god, god.feed);
  const conversations = god.conversations ?? [];

  const domMotif = dominantMotif(motifs);
  const domThread = dominantThread(threads);

  const pool = new Map<ActId, RunStoryBeat[]>();
  for (const id of ACT_ORDER) pool.set(id, []);

  for (const t of threads.filter((x) => x.unresolved).slice(0, 8)) {
    const act = actForItem(t.activeCycle);
    pool.get(act)!.push(beatFromThread(t, act));
  }
  for (const m of motifs.slice(0, 6)) {
    const act = actForItem(m.evidence[0]?.summary.length ?? 1 ? god.cycle : 1);
    pool.get(act)!.push(beatFromMotif(m, act));
  }
  for (const e of echoes.slice(-12)) {
    pool.get(e.act)!.push(beatFromEcho(e));
  }
  for (const c of conversations.slice(-16)) {
    pool.get(c.act)!.push(beatFromConversation(c, mgr));
  }

  const acts: RunStoryAct[] = [];
  for (const id of ACT_ORDER) {
    const beats = capBeats(pool.get(id) ?? []);
    if (!beats.length && id !== 'early') continue;
    acts.push({ id, name: actName(id), beats: beats.length ? beats : [] });
  }

  if (!acts.some((a) => a.beats.length) && outcome.highlights.length) {
    const earlyIdx = acts.findIndex((a) => a.id === 'early');
    const early =
      earlyIdx >= 0
        ? acts[earlyIdx]
        : { id: 'early' as ActId, name: actName('early'), beats: [] as RunStoryBeat[] };
    early.beats.push({
      kind: 'thread',
      headline: 'THE RUN',
      line: outcome.highlights[0],
      act: 'early',
      evidence: [{ kind: 'beat', id: 'highlight:0', summary: outcome.highlights[0] }],
    });
    if (earlyIdx < 0) acts.unshift(early);
  }

  const thesis = buildThesis(domMotif, domThread, outcome);
  const summary: RunStorySummary = {
    thesis,
    acts: acts.filter((a) => a.beats.length),
    dominantMotif: domMotif?.kind ?? null,
    dominantThread: domThread?.title ?? null,
    evidence: { motifs, threads, echoes, conversations },
    plainText: plainText(acts.filter((a) => a.beats.length), thesis),
  };

  if (outcome.recapChain.length) {
    const crisis = summary.acts.find((a) => a.id === 'crisis') ?? summary.acts[summary.acts.length - 1];
    if (crisis) {
      crisis.beats.push({
        kind: 'thread',
        headline: 'WHY IT ENDED',
        line: outcome.recapChain.join(' '),
        act: crisis.id,
        evidence: outcome.recapChain.map((line, i) => ({ kind: 'thread', id: `recap:${i}`, summary: line })),
      });
    }
  }

  return summary;
}
