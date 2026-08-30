/**
 * Run Narrative Document (RND) — derived presentation from simulation facts.
 * Nothing here is mechanical truth; every line must cite evidence.
 */

import type { ExchangeTurn, LineContext } from '../../data/dialogue';
import type { ActId, BeatWhy, ConditionKind } from '../../god/GodTypes';
import type { StoryArcKind } from '../StoryTypes';

export type MotifKind = 'fire' | 'debt' | 'throne' | 'mask' | 'knife' | 'chain' | 'crowd' | 'heretic';

export type EvidenceKind = 'event' | 'memory' | 'condition' | 'sim' | 'scar' | 'beat' | 'thread';

export interface EvidenceRef {
  kind: EvidenceKind;
  id: string;
  summary: string;
}

export interface MotifInstance {
  kind: MotifKind;
  strength: number;
  carriers: string[];
  refrain: string;
  evidence: EvidenceRef[];
}

export type GodThreadKind = 'divine_favour' | 'divine_wrath' | 'marked_target' | 'omen_fulfilled';

export interface RunThread {
  id: string;
  kind: GodThreadKind | StoryArcKind;
  title: string;
  state: string;
  characters: string[];
  activeCycle: number;
  unresolved: boolean;
  evidence: EvidenceRef[];
}

export interface GodEcho {
  cycle: number;
  act: ActId;
  line: string;
  texture: string;
  conditionKind?: ConditionKind;
  evidence: EvidenceRef[];
}

export interface ConversationRecord {
  id: string;
  cycle: number;
  act: ActId;
  context: LineContext;
  participants: string[];
  threadKind?: GodThreadKind;
  turns: ExchangeTurn[];
  evidence: EvidenceRef[];
}

export type RunStoryBeatKind = 'thread' | 'motif' | 'echo' | 'conversation';

export interface RunStoryBeat {
  kind: RunStoryBeatKind;
  headline: string;
  line: string;
  act: ActId;
  evidence: EvidenceRef[];
}

export interface RunStoryAct {
  id: ActId;
  name: string;
  beats: RunStoryBeat[];
}

export interface RunStoryEvidence {
  motifs: MotifInstance[];
  threads: RunThread[];
  echoes: GodEcho[];
  conversations: ConversationRecord[];
}

export interface RunStorySummary {
  thesis: string;
  acts: RunStoryAct[];
  dominantMotif: MotifKind | null;
  dominantThread: string | null;
  evidence: RunStoryEvidence;
  plainText: string;
}

export type RunStory = RunStorySummary;

export interface BeatWhySlice {
  beatId: string;
  cycle: number;
  act: ActId;
  why: BeatWhy;
}
