/**
 * Debug explanations for why a node, line, recap beat, or thread exists.
 */

import type { SaveData } from '../core/SaveSystem';
import { buildStoryGraph } from './StoryGraph';
import { recogniseArcs } from './StoryArcs';
import { scoreEvent, scoreNode } from './StoryImportance';
import { copyForEvent } from './StoryCopy';
import { composeWorldTurnRecap } from './StoryRecap';
import { PLAYER_ID } from './StoryTypes';

export function inspectNode(data: SaveData, id: string): string {
  if (id === PLAYER_ID) return 'PLAYER ANCHOR\nAlways shown. Importance is structural, not a rivalry score.';
  const n = data.nemeses.find((x) => x.id === id);
  if (!n) return 'Unknown id.';
  const ov = data.nemeses.find((x) => x.alive && x.rank === 'overlord');
  const sc = scoreNode(n, data.worldTurn, ov?.id === n.id);
  const lines = [`${n.name} importance ${sc.total}`, ...sc.factors.map((f) => `  ${f.id}: ${f.value}`)];
  return lines.join('\n');
}

export function inspectEdge(data: SaveData, edgeId: string): string {
  const g = buildStoryGraph(data, { revealUnknown: true });
  const e = g.edges.find((x) => x.id === edgeId);
  if (!e) return 'No such connection.';
  return [
    `${e.kind} ${e.from} → ${e.to}`,
    `importance ${e.importance}`,
    e.why,
    e.eventId ? `source event ${e.eventId}` : 'derived from current roster lists',
    e.eventText ?? '',
  ].join('\n');
}

export function inspectArc(data: SaveData, arcId: string): string {
  const a = recogniseArcs(data).find((x) => x.id === arcId);
  if (!a) return 'No such thread.';
  return [
    a.title,
    `kind ${a.kind} unresolved=${a.unresolved} importance=${a.importance}`,
    `origin ${a.originEventId ?? 'state-derived'}`,
    ...a.developments,
    `state: ${a.state}`,
    `next: ${a.next}`,
  ].join('\n');
}

export function inspectRecap(data: SaveData): string {
  const events = data.eventLog.filter((e) => e.turn >= data.worldTurn - 1);
  const roster = new Map(data.nemeses.map((n) => [n.id, n]));
  const beats = composeWorldTurnRecap(data, events);
  return beats
    .map((b) => {
      const facts = b.eventIds
        .map((id) => data.eventLog.find((e) => e.id === id))
        .filter(Boolean)
        .map((e) => {
          const sc = scoreEvent(e!, data.worldTurn, roster);
          const copy = copyForEvent(e!, roster);
          return `  event ${e!.id} score=${sc.total} [${sc.factors.map((f) => f.id).join(',')}] → "${copy.headline}"`;
        });
      return `${b.act} | ${b.headline}\n${b.line}\n${facts.join('\n') || '  (derived from live roster / arcs)'}`;
    })
    .join('\n\n');
}
