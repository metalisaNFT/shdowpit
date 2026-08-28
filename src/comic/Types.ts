/**
 * Generative Comic Combat — shared types.
 *
 * Simulation writes facts into EncounterStory / StoryBeat records.
 * AI (optional) only illustrates; it never invents mechanical outcomes.
 */

export type ComicQualityProfileId = 'potato' | 'fast' | 'balanced' | 'offline';

export type ComicPanelRole = 'intro' | 'attack' | 'impact' | 'outcome';

export type ComicShotKind =
  | 'close_up'
  | 'low_hero'
  | 'over_shoulder'
  | 'wide'
  | 'dutch_impact'
  | 'high_wide';

export type ComicOutcomeKind = 'player_hurt' | 'player_dead' | 'enemy_dead' | 'enemy_escaped' | 'stalemate';

/** Deterministic facts about one dramatic beat. Never AI-authored. */
export interface StoryBeat {
  id: string;
  role: ComicPanelRole;
  importance: number;
  atMs: number;
  nemesisId: string;
  nemesisName: string;
  title: string;
  rank: string;
  weapon: string;
  attackId: string;
  attackLabel: string;
  critical: boolean;
  damage: number;
  playerHpFrac: number;
  enemyHpFrac: number;
  outcome: ComicOutcomeKind | null;
  locationName: string;
  relationshipNote: string;
  narration: string;
  speech: string;
  sfx: string;
  /** Preferred cinematography seed; director may override. */
  preferredShot: ComicShotKind;
}

/** Full encounter narrative assembled from sim events. */
export interface EncounterStory {
  id: string;
  startedAt: number;
  nemesisId: string;
  nemesisName: string;
  title: string;
  rank: string;
  weapon: string;
  locationName: string;
  relationshipNote: string;
  beats: StoryBeat[];
  /** Selected panel roles for this story (slice = 4). */
  selectedRoles: ComicPanelRole[];
}

export interface CameraCandidate {
  kind: ComicShotKind;
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fov: number;
  score: number;
  reasons: string[];
}

export interface CaptureBundle {
  rgbDataUrl: string;
  /** Greyscale depth as data URL when available; empty string if skipped. */
  depthDataUrl: string;
  width: number;
  height: number;
  shot: ComicShotKind;
  score: number;
}

export interface ComicStyleProfile {
  id: string;
  label: string;
  /** Appended to AI prompts when illustrating. */
  promptSuffix: string;
  negativePrompt: string;
  /** Potato / capture post: contrast, ink, grain. */
  contrast: number;
  inkStrength: number;
  grain: number;
  halftone: number;
  borderPx: number;
  inkColor: string;
  paperTint: string;
}

export interface ComicQualityProfile {
  id: ComicQualityProfileId;
  label: string;
  captureWidth: number;
  captureHeight: number;
  captureDepth: boolean;
  /** Attempt optional local/remote AI illustration. */
  tryAi: boolean;
  aiStepsHint: number;
  maxConcurrent: number;
  showDelayMs: number;
}

export type ComicPanelState = 'pending' | 'capturing' | 'stylizing' | 'ai' | 'ready' | 'failed';

export interface ComicPanel {
  id: string;
  beat: StoryBeat;
  shot: ComicShotKind;
  state: ComicPanelState;
  /** Final display image (potato stylized or AI). */
  imageDataUrl: string;
  /** Raw RGB capture before stylize (debug / ControlNet later). */
  captureRgb: string;
  captureDepth: string;
  prompt: string;
  usedAi: boolean;
  error: string;
  anim: {
    shake: number;
    pushIn: number;
    parallax: number;
  };
}

export interface ComicSequence {
  story: EncounterStory;
  panels: ComicPanel[];
  ready: boolean;
  profileId: ComicQualityProfileId;
  styleId: string;
}

/** Character reference pack hook — keyed by nemesis id. Generation may be stub. */
export interface CharacterRefPack {
  nemesisId: string;
  /** Local portrait / capture refs for IP-Adapter later. */
  refs: string[];
  notes: string;
  updatedAt: number;
}

export interface ComicStrikeInfo {
  critical: boolean;
  amount: number;
  attackId: string;
  attackLabel: string;
}
