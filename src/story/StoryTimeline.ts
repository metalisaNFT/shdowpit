/**
 * Chronological timeline with grouping of repetitive low-value events.
 */

import type { SaveData } from '../core/SaveSystem';
import type { WorldEvent, WorldEventType } from '../world/WorldEvent';
import { scoreEvent } from './StoryImportance';
import { copyForEvent, groupHeadline } from './StoryCopy';
import type { TimelineItem } from './StoryTypes';

const GROUPABLE: Set<WorldEventType> = new Set(['duel', 'injury', 'recruitment', 'birth', 'heat']);

export interface TimelineQuery {
  turn?: number;
  age?: number;
  nemesisId?: string;
  areaId?: string;
  actors?: string[];
  importantOnly?: boolean;
  includeUnknown?: boolean;
  debug?: boolean;
}

export function buildTimeline(data: SaveData, q: TimelineQuery = {}): TimelineItem[] {
  const roster = new Map(data.nemeses.map((n) => [n.id, n]));
  const items: TimelineItem[] = [];
  const pending: WorldEvent[] = [];

  const flushGroup = () => {
    if (!pending.length) return;
    const type = pending[0].type;
    if (pending.length === 1) {
      items.push(toItem(pending[0], data, roster));
    } else {
      const scored = pending.map((e) => ({ e, s: scoreEvent(e, data.worldTurn, roster).total }));
      scored.sort((a, b) => b.s - a.s);
      const sample = copyForEvent(scored[0].e, roster).line;
      items.push({
        id: `g-${pending[0].id ?? pending[0].turn}-${type}`,
        turn: pending[0].turn,
        age: pending[0].age,
        type,
        headline: groupHeadline(type, pending.length, sample),
        detail: pending.map((e) => e.text).join(' · '),
        actors: [...new Set(pending.flatMap((e) => e.actors))],
        important: pending.some((e) => e.important),
        witnessed: pending.some((e) => e.witnessed),
        known: pending.every((e) => e.known !== false),
        grouped: pending.length,
        sourceIds: pending.map((e) => e.id ?? ''),
        tone: pending[0].tone,
      });
    }
    pending.length = 0;
  };

  for (const ev of data.eventLog) {
    if (q.turn !== undefined && ev.turn !== q.turn) continue;
    if (q.age !== undefined && ev.age !== q.age) continue;
    if (q.nemesisId && !ev.actors.includes(q.nemesisId)) continue;
    if (q.areaId && ev.payload?.areaId !== q.areaId) continue;
    if (q.actors && !q.actors.every((a) => ev.actors.includes(a))) continue;
    if (!q.debug && !q.includeUnknown && ev.known === false) continue;
    if (q.importantOnly && scoreEvent(ev, data.worldTurn, roster).total < 28) continue;

    if (GROUPABLE.has(ev.type) && !ev.important && !ev.witnessed) {
      if (pending.length && pending[0].type === ev.type && pending[0].turn === ev.turn) {
        pending.push(ev);
        continue;
      }
      flushGroup();
      pending.push(ev);
      continue;
    }
    flushGroup();
    items.push(toItem(ev, data, roster));
  }
  flushGroup();
  return items;
}

function toItem(ev: WorldEvent, data: SaveData, roster: Map<string, import('../nemesis/Nemesis').Nemesis>): TimelineItem {
  const copy = copyForEvent(ev, roster);
  const sc = scoreEvent(ev, data.worldTurn, roster);
  return {
    id: ev.id ?? `t${ev.turn}-${ev.type}-${ev.actors.join(',')}`,
    turn: ev.turn,
    age: ev.age,
    type: ev.type,
    headline: copy.headline,
    detail: copy.line,
    actors: ev.actors,
    areaId: ev.payload?.areaId,
    important: ev.important || sc.total >= 36,
    witnessed: !!ev.witnessed,
    known: ev.known !== false,
    sourceIds: [ev.id ?? ''],
    tone: ev.tone,
  };
}
