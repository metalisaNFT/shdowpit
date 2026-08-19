/**
 * Derived story model. Nothing here is a mechanical fact of its own —
 * it is assembled from Nemesis records and WorldEvents.
 */

import type { Rank } from '../nemesis/Nemesis';
import type { WorldEvent, WorldEventType } from '../world/WorldEvent';

export const PLAYER_ID = 'player';

export type Knowledge = 'known' | 'rumored' | 'unknown';

export type StoryMode = 'web' | 'hierarchy' | 'world' | 'timeline' | 'threads' | 'you';

export type EdgeKind =
  | 'rival'
  | 'ally'
  | 'former_ally'
  | 'master'
  | 'revenge'
  | 'betrayal'
  | 'stolen_weapon'
  | 'territory_war';

export interface StoryNode {
  id: string;
  kind: 'player' | 'nemesis';
  name: string;
  title: string;
  rank: Rank | 'player';
  alive: boolean;
  territory: string;
  weapon: string;
  scar?: string;
  stolen?: string;
  unresolved: boolean;
  importance: number;
  playerRel: number;
  killsYou: number;
  youKilled: number;
  knowledge: Knowledge;
}

export interface StoryEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  directed: boolean;
  importance: number;
  spectral: boolean;
  label: string;
  why: string;
  eventId?: string;
  eventText?: string;
}

export interface StoryArc {
  id: string;
  kind: StoryArcKind;
  title: string;
  characters: string[];
  originEventId?: string;
  developments: string[];
  state: string;
  next: string;
  unresolved: boolean;
  importance: number;
}

export type StoryArcKind =
  | 'revenge'
  | 'stolen_weapon'
  | 'rivalry'
  | 'rise'
  | 'fall'
  | 'betrayal'
  | 'survivor'
  | 'returned'
  | 'territory_war'
  | 'vendetta'
  | 'broken_alliance'
  | 'succession'
  | 'repeated_escape'
  | 'hunter_prey';

export interface TimelineItem {
  id: string;
  turn: number;
  age: number;
  type: WorldEventType;
  headline: string;
  detail: string;
  actors: string[];
  areaId?: string;
  important: boolean;
  witnessed: boolean;
  known: boolean;
  grouped?: number;
  sourceIds: string[];
  tone?: WorldEvent['tone'];
}

export type RecapAct = 'opening' | 'rising' | 'turn' | 'end' | 'consequence';

export interface RecapBeat {
  act: RecapAct;
  headline: string;
  line: string;
  detail?: string;
  actors: string[];
  eventIds: string[];
  importance: number;
  vfx: RecapVfx;
}

export type RecapVfx =
  | 'none'
  | 'betrayal'
  | 'promotion'
  | 'death'
  | 'resurrection'
  | 'theft'
  | 'territory'
  | 'revenge'
  | 'succession'
  | 'age';

export interface StoryFilters {
  minImportance: number;
  living: 'all' | 'living' | 'dead';
  relations: 'all' | EdgeKind;
  unresolvedOnly: boolean;
  playerHistoryOnly: boolean;
  territory: string | null;
  search: string;
  focusId: string | null;
}

export function defaultStoryFilters(): StoryFilters {
  return {
    minImportance: 18,
    living: 'all',
    relations: 'all',
    unresolvedOnly: false,
    playerHistoryOnly: false,
    territory: null,
    search: '',
    focusId: null,
  };
}

export const STORY_BUDGET = {
  visibleNodes: 22,
  visibleEdges: 36,
  recapBeats: 10,
  timelineCards: 80,
  layoutMs: 8,
};
