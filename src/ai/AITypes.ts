/**
 * The contract between the simulation and the AI layer.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 * the game creates facts, AI interprets them. `NemesisFacts` is a read-only
 * projection of state the simulation already decided. Nothing the AI returns
 * is allowed back into a mechanical field — the results land in `Nemesis.ai`,
 * a presentation-only namespace, and every consumer treats them as text.
 *
 * If you find yourself wanting to write an AI result into `n.rank`, `n.power`,
 * `n.strengths` or anything else the combat or world code reads, stop. That is
 * the bug this architecture is designed to prevent.
 */

import type { Rank, PersonalityType, Archetype, WeaponType } from '../nemesis/Nemesis';

/* ============================================================
   settings
   ============================================================ */

export type AIMode = 'off' | 'text' | 'full';

/**
 * Which backend does the generating:
 *   openai — the existing OpenAI path (key held by the local game server)
 *   local  — the LOCAL AI ENGINE on 127.0.0.1 (no key, no cloud, works offline)
 *   auto   — local first when it is running, otherwise OpenAI
 */
export type AIProviderMode = 'openai' | 'local' | 'auto';

export interface AISettings {
  mode: AIMode;
  /** backend routing; 'auto' behaves exactly like 'openai' until the local
   *  engine is installed, so it is a safe default */
  provider: AIProviderMode;
  /** per-category switches, all meaningless when mode is 'off' */
  names: boolean;
  dialogue: boolean;
  chronicles: boolean;
  portraits: boolean;
}

export function defaultAISettings(): AISettings {
  return { mode: 'off', provider: 'auto', names: true, dialogue: true, chronicles: true, portraits: true };
}

/* ============================================================
   local engine status, as the settings UI sees it
   ============================================================ */

export interface LocalAIStatus {
  installed: boolean;
  running: boolean;
  status: string;
  textReady: boolean;
  imageReady: boolean;
  textModel: string;
  imageModel: string;
  device: string;
  port: number;
  dir: string;
  progress: {
    state: string;
    component?: string;
    downloaded?: number;
    total?: number;
    pct?: number;
    error?: string;
    errorCode?: string;
    steps?: Array<{ step: number; name: string; status: string; detail?: string }>;
    updatedAt?: number;
  } | null;
}

/* ============================================================
   myth events — the only things that justify spending a request
   ============================================================ */

export type MythEventKind =
  | 'promoted_captain'
  | 'promoted_warlord'
  | 'became_overlord'
  | 'killed_player'
  | 'survived_death'
  | 'returned_from_death'
  | 'major_scar'
  | 'stole_weapon'
  | 'killed_rival'
  | 'first_encounter';

/** Higher runs first. Mirrors the priority list in the design brief. */
export const MYTH_PRIORITY: Record<MythEventKind, number> = {
  first_encounter: 90,
  killed_player: 80,
  became_overlord: 70,
  survived_death: 65,
  returned_from_death: 65,
  promoted_warlord: 60,
  promoted_captain: 55,
  stole_weapon: 50,
  major_scar: 45,
  killed_rival: 30,
};

/* ============================================================
   deterministic facts handed to the AI
   ============================================================ */

/**
 * Everything here is a fact the simulation already established. The prompt
 * builder is forbidden from adding anything that is not in this object, and
 * the AI is instructed that it may not assert anything absent from it.
 */
export interface NemesisFacts {
  id: string;
  /** the locally-generated name; AI may embellish the title, never rename */
  name: string;
  currentTitle: string;
  seed: number;

  rank: Rank;
  level: number;
  archetype: Archetype;
  weapon: WeaponType;
  personality: PersonalityType;
  personalityLabel: string;

  killedPlayer: number;
  killedByPlayer: number;
  escapedPlayer: number;
  returns: number;
  grudge: number;
  relationship: string;

  strengths: string[];
  weaknesses: string[];
  adaptations: string[];
  scars: string[];
  stolen: string[];

  territory: string;
  worldTurn: number;
  worldAge: number;
  ageName: string;
  accentColor: string;

  rivals: string[];
  allies: string[];
  master: string | null;

  /** compressed history — see AIPromptBuilder */
  importantEvents: string[];
  recentEvents: string[];
  historicalSummary: string;

  /** what just happened, if this generation was triggered by a myth event */
  trigger: MythEventKind | null;
}

/**
 * Read-only projection of a long-game moment. Built in `src/god/GodAI.ts`
 * from simulation state; consumed only as prompt input. Nothing here is
 * written back into `GodState`, `Beat`, `SimState`, or `Nemesis` mechanical
 * fields.
 */
export interface GodFacts {
  kind: 'dossier' | 'beat' | 'crisis' | 'recap' | 'legend' | 'aftermath' | 'situation';
  run: number;
  cycle: number;
  act: string;
  chaos: number;
  /** names the model is allowed to mention */
  names: string[];
  actors: GodActorFact[];
  headline?: string;
  detail?: string[];
  beatKind?: string;
  priority?: string;
  crisisTitle?: string;
  crisisKind?: string;
  crisisDescription?: string;
  ending?: string;
  highlights?: string[];
  legendName?: string;
  legendTitle?: string;
  legendDeeds?: string[];
  legendCause?: string;
  legendEpitaph?: string;
}

/**
 * Read-only projection of a pit-run story moment for AI polish.
 * Built in `src/story/StoryAI.ts`; never written back to simulation state.
 */
export interface StoryFacts {
  kind: 'recap_beat' | 'timeline' | 'journey' | 'arc' | 'encounter' | 'aftermath' | 'situation';
  /** names the model may mention */
  names: string[];
  headline?: string;
  line?: string;
  detail?: string;
  act?: string;
  eventType?: string;
  witnessed?: boolean;
  known?: boolean;
  /** arc-specific */
  arcTitle?: string;
  arcKind?: string;
  arcState?: string;
  arcNext?: string;
  /** encounter-specific */
  encounterKind?: string;
  relationshipChip?: string;
  /** journey-specific */
  nemesisName?: string;
  beatIndex?: number;
  /** aftermath/situation */
  linkLabel?: string;
  linkText?: string;
  cycle?: number;
  intention?: string;
}

export interface GodActorFact {
  id: string;
  name: string;
  title: string;
  rank: string;
  alive: boolean;
  personality: string;
  goal: string;
  scars: string[];
  stolen: string[];
  returns: number;
  kills: number;
  deeds: string[];
  killedPlayer: number;
  strengths: string[];
  heretic: boolean;
  crisisBorn: boolean;
}

/* ============================================================
   requests
   ============================================================ */

export type AIRequestKind =
  | 'identity'
  | 'taunt'
  | 'chronicle'
  | 'portrait'
  | 'dossier'
  | 'beat'
  | 'crisis'
  | 'recap'
  | 'legend'
  | 'recap_beat'
  | 'timeline'
  | 'journey'
  | 'arc'
  | 'encounter'
  | 'aftermath'
  | 'situation';

/** Long-game flavour kinds. Dropped when a run is abandoned, reset, or replaced. */
export const GOD_AI_KINDS: ReadonlySet<AIRequestKind> = new Set([
  'dossier',
  'beat',
  'crisis',
  'recap',
  'legend',
  'aftermath',
  'situation',
]);

/** Pit-run story polish kinds. */
export const STORY_AI_KINDS: ReadonlySet<AIRequestKind> = new Set([
  'recap_beat',
  'timeline',
  'journey',
  'arc',
  'encounter',
]);

export type AIRequestState = 'queued' | 'generating' | 'complete' | 'failed' | 'cached';

export interface AIRequest {
  id: number;
  kind: AIRequestKind;
  nemesisId: string;
  /** display name at the time of the request, for the status UI */
  label: string;
  priority: number;
  state: AIRequestState;
  startedAt: number;
  finishedAt: number;
  latencyMs: number;
  error: string;
  cacheKey: string;
}

/* ============================================================
   generated content
   ============================================================ */

export interface AIIdentity {
  /** an earned epithet, e.g. "THE CINDER-EYED" — never a new given name */
  title: string;
}

export interface AITaunts {
  lines: string[];
}

export interface AIChronicle {
  summary: string;
}

export interface AIPortrait {
  /** an IndexedDB key, not the bytes; see AIPortraitStore */
  key: string;
  prompt: string;
  /** the title this portrait depicts, for the evolution timeline */
  title: string;
  turn: number;
  /** true when it is the deterministic SVG rather than a generated image */
  procedural: boolean;
}

/**
 * The presentation-only namespace stored on `Nemesis.ai`. Nothing in here is
 * ever read by combat, the world simulation, or progression.
 */
export interface NemesisAIContent {
  /** AI-authored title, kept separate from the mechanical `Nemesis.title` */
  title?: string;
  taunts?: string[];
  chronicle?: string;
  /** current portrait */
  portrait?: AIPortrait;
  /** every portrait this nemesis has ever had, oldest first */
  portraitHistory?: AIPortrait[];
  /** bumps when appearance-relevant state changes; part of the cache key */
  visualVersion: number;
  /** bumps when history-relevant state changes; part of the cache key */
  eventVersion: number;
  /** kinds already generated at the current versions, so we do not repeat */
  generatedAt?: Record<string, string>;
}

export function emptyAIContent(): NemesisAIContent {
  return { visualVersion: 0, eventVersion: 0, generatedAt: {} };
}

/* ============================================================
   provider interfaces — the rest of the game never names a vendor
   ============================================================ */

export interface AITextResult {
  ok: boolean;
  text: string;
  error: string;
  latencyMs: number;
}

export interface AIImageResult {
  ok: boolean;
  dataUrl: string;
  error: string;
  latencyMs: number;
}

export interface AITextProvider {
  readonly name: string;
  isAvailable(): boolean;
  generate(system: string, user: string, opts?: { maxTokens?: number; json?: boolean }): Promise<AITextResult>;
}

export interface AIImageProvider {
  readonly name: string;
  isAvailable(): boolean;
  generate(prompt: string): Promise<AIImageResult>;
}

export interface ConnectionStatus {
  provider: string;
  connected: boolean;
  verified: boolean;
  /** last human-readable error from a connection attempt, never a key */
  error: string;
}
