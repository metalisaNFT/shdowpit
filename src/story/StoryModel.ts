/**
 * Assemble the full derived story model from a save.
 */

import type { SaveData } from '../core/SaveSystem';
import { AREAS } from '../data/areas';
import { AREA_NAMES } from '../data/names';
import { rulesForHolder } from '../world/TerritoryRules';
import { buildStoryGraph } from './StoryGraph';
import { layoutStoryNodes, type NodePos } from './StoryLayout';
import { recogniseArcs } from './StoryArcs';
import { buildTimeline } from './StoryTimeline';
import {
  STORY_BUDGET,
  defaultStoryFilters,
  type StoryArc,
  type StoryEdge,
  type StoryFilters,
  type StoryNode,
  type TimelineItem,
} from './StoryTypes';
import { PLAYER_ID } from './StoryTypes';

export interface StoryModel {
  nodes: StoryNode[];
  edges: StoryEdge[];
  positions: Record<string, NodePos>;
  arcs: StoryArc[];
  timeline: TimelineItem[];
  visibleNodes: StoryNode[];
  visibleEdges: StoryEdge[];
}

export function buildStoryModel(data: SaveData, filters: StoryFilters = defaultStoryFilters(), debug = false): StoryModel {
  const g = buildStoryGraph(data, { revealUnknown: debug });
  let nodes = g.nodes.slice();
  let edges = g.edges.slice();

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    nodes = nodes.filter((n) => n.name.toLowerCase().includes(q) || n.title.toLowerCase().includes(q) || n.id === PLAYER_ID);
  }
  if (filters.living === 'living') nodes = nodes.filter((n) => n.alive || n.id === PLAYER_ID);
  if (filters.living === 'dead') nodes = nodes.filter((n) => !n.alive || n.id === PLAYER_ID);
  if (filters.territory) nodes = nodes.filter((n) => n.territory === filters.territory || n.id === PLAYER_ID);
  if (filters.playerHistoryOnly) {
    const keep = new Set(nodes.filter((n) => n.id === PLAYER_ID || n.killsYou > 0 || n.youKilled > 0 || n.playerRel > 8).map((n) => n.id));
    nodes = nodes.filter((n) => keep.has(n.id));
  }
  if (filters.unresolvedOnly) {
    const keep = new Set(nodes.filter((n) => n.unresolved || n.id === PLAYER_ID).map((n) => n.id));
    nodes = nodes.filter((n) => keep.has(n.id));
  }

  nodes.sort((a, b) => b.importance - a.importance);
  const visibleNodes = nodes.filter((n) => n.id === PLAYER_ID || n.importance >= filters.minImportance).slice(0, STORY_BUDGET.visibleNodes);
    const player = nodes.find((n) => n.id === PLAYER_ID);
    if (player && !visibleNodes.some((n) => n.id === PLAYER_ID)) visibleNodes.unshift(player);
  const vis = new Set(visibleNodes.map((n) => n.id));
  if (filters.focusId) {
    vis.add(filters.focusId);
    for (const e of edges) {
      if (e.from === filters.focusId) vis.add(e.to);
      if (e.to === filters.focusId) vis.add(e.from);
    }
  }
  const focused = nodes.filter((n) => vis.has(n.id));
  const extra = focused.filter((n) => !visibleNodes.some((x) => x.id === n.id));
  const shown = [...visibleNodes, ...extra].slice(0, STORY_BUDGET.visibleNodes + 8);
  const shownSet = new Set(shown.map((n) => n.id));

  let visEdges = edges.filter((e) => shownSet.has(e.from) && shownSet.has(e.to) && e.importance >= filters.minImportance - 6);
  if (filters.relations !== 'all') visEdges = visEdges.filter((e) => e.kind === filters.relations);
  visEdges.sort((a, b) => b.importance - a.importance);
  visEdges = visEdges.slice(0, STORY_BUDGET.visibleEdges);

  const positions = layoutStoryNodes(data, shown);
  const arcs = recogniseArcs(data);
  const timeline = buildTimeline(data, { debug, includeUnknown: debug });

  return {
    nodes: g.nodes,
    edges: g.edges,
    positions,
    arcs,
    timeline,
    visibleNodes: shown,
    visibleEdges: visEdges,
  };
}

export function territoryStories(data: SaveData): Array<{
  areaId: string;
  name: string;
  holderId: string | null;
  holderName: string;
  previous?: string;
  rule: string;
  heat: string;
}> {
  return AREAS.map((a) => {
    const holderId = data.territories[a.id] ?? null;
    const holder = holderId ? data.nemeses.find((n) => n.id === holderId) : undefined;
    const prev = [...data.eventLog].reverse().find((e) => e.type === 'territory' && e.payload?.areaId === a.id && e.actors[0] !== holderId);
      const rule = holder ? rulesForHolder(holder, a)[0]?.title ?? holder.personality : 'NONE';
    return {
      areaId: a.id,
      name: AREA_NAMES[a.id] ?? a.name,
      holderId,
      holderName: holder ? holder.name : 'UNCLAIMED',
      previous: prev ? data.nemeses.find((n) => n.id === prev.actors[0])?.name : undefined,
      rule,
      heat: data.run ? `HEAT ${data.run.heat}` : '',
    };
  });
}
