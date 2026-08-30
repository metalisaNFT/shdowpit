/**
 * Story arcs plus god-thread kinds — threads stay active per cycle.
 */

import type { NemesisManager } from '../../nemesis/NemesisManager';
import { recogniseArcs } from '../StoryArcs';
import type { StoryArc, StoryArcKind } from '../StoryTypes';
import type { GodState } from '../../god/GodTypes';
import type { EvidenceRef, GodThreadKind, RunThread } from './RunStoryTypes';

function arcEvidence(a: StoryArc): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (a.originEventId) refs.push({ kind: 'thread', id: a.originEventId, summary: a.title });
  for (const d of a.developments.slice(-2)) {
    refs.push({ kind: 'thread', id: `${a.id}:dev`, summary: d });
  }
  return refs;
}

function godThread(
  id: string,
  kind: GodThreadKind,
  title: string,
  state: string,
  characters: string[],
  cycle: number,
  unresolved: boolean,
  evidence: EvidenceRef[]
): RunThread {
  return { id, kind, title, state, characters, activeCycle: cycle, unresolved, evidence };
}

function detectGodThreads(mgr: NemesisManager, god: GodState): RunThread[] {
  const out: RunThread[] = [];
  const cycle = god.cycle;

  const godConds = god.conditions.filter((c) => c.source === 'god');
  for (const c of godConds) {
    const n = mgr.byId(c.targetId);
    if (!n) continue;
  const ev: EvidenceRef = { kind: 'condition', id: c.id, summary: c.note };
    if (c.kind === 'blessing' || c.kind === 'ward' || c.kind === 'opportunity') {
      out.push(
        godThread(
          `gf-${c.id}`,
          'divine_favour',
          `${n.name.toUpperCase()} — FAVOURED`,
          c.note,
          [n.id],
          c.createdCycle,
          c.expiresCycle >= cycle,
          [ev]
        )
      );
    }
    if (c.kind === 'curse' || c.kind === 'bounty' || c.kind === 'exposure') {
      out.push(
        godThread(
          `gw-${c.id}`,
          'divine_wrath',
          `${n.name.toUpperCase()} — MARKED`,
          c.note,
          [n.id],
          c.createdCycle,
          c.expiresCycle >= cycle,
          [ev]
        )
      );
    }
    if (c.kind === 'mark' || c.kind === 'bounty') {
      out.push(
        godThread(
          `mt-${c.id}`,
          'marked_target',
          `THE MARK ON ${n.name.toUpperCase()}`,
          c.note,
          [n.id],
          c.createdCycle,
          c.expiresCycle >= cycle,
          [ev]
        )
      );
    }
    if (c.kind === 'omen') {
      out.push(
        godThread(
          `om-${c.id}`,
          'omen_fulfilled',
          `OMEN — ${n.name.toUpperCase()}`,
          c.note,
          [n.id],
          c.createdCycle,
          !god.feed.some((b) => b.cycle > c.createdCycle && b.actors.includes(n.id) && b.priority !== 'background'),
          [ev]
        )
      );
    }
  }

  return out;
}

function arcToThread(a: StoryArc, cycle: number): RunThread {
  return {
    id: a.id,
    kind: a.kind as StoryArcKind,
    title: a.title,
    state: a.state,
    characters: a.characters,
    activeCycle: cycle,
    unresolved: a.unresolved,
    evidence: arcEvidence(a),
  };
}

export function trackThreads(mgr: NemesisManager, god: GodState): RunThread[] {
  const arcs = recogniseArcs(mgr.data).map((a) => arcToThread(a, god.cycle));
  const godThreads = detectGodThreads(mgr, god);
  const merged = [...godThreads, ...arcs];
  merged.sort((a, b) => {
    const au = a.unresolved ? 1 : 0;
    const bu = b.unresolved ? 1 : 0;
    if (bu !== au) return bu - au;
    return b.activeCycle - a.activeCycle;
  });
  return merged.slice(0, 28);
}

export function activeThreadsForCycle(threads: RunThread[], cycle: number): RunThread[] {
  return threads.filter((t) => t.unresolved && t.activeCycle <= cycle);
}

export function dominantThread(threads: RunThread[]): RunThread | null {
  const open = threads.filter((t) => t.unresolved);
  if (!open.length) return threads[0] ?? null;
  const godFirst = open.find((t) =>
    (['divine_favour', 'divine_wrath', 'marked_target', 'omen_fulfilled'] as GodThreadKind[]).includes(t.kind as GodThreadKind)
  );
  return godFirst ?? open[0];
}

/** Priority boosts for dialogue.ts when a thread is live on this character. */
export function threadDialogueBoost(threads: RunThread[], nemesisId: string): number {
  let boost = 0;
  for (const t of threads) {
    if (!t.unresolved || !t.characters.includes(nemesisId)) continue;
    switch (t.kind) {
      case 'divine_favour':
        boost += 6;
        break;
      case 'divine_wrath':
      case 'marked_target':
        boost += 10;
        break;
      case 'omen_fulfilled':
        boost += 8;
        break;
      case 'revenge':
      case 'stolen_weapon':
        boost += 12;
        break;
      case 'betrayal':
      case 'broken_alliance':
        boost += 9;
        break;
      default:
        boost += 3;
        break;
    }
  }
  return boost;
}
