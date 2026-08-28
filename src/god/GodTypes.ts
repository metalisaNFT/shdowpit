/**
 * THE LONG GAME — the god layer's vocabulary.
 *
 * One rule governs every type in this file: the player writes CONDITIONS and
 * the world writes OUTCOMES. Interventions may only create `Condition`s and
 * nudge `SimState`; nothing an intervention does is allowed to set `alive`,
 * `rank` or `power` directly. The autonomous layer reads conditions as inputs
 * to utility scoring and decides for itself what actually happens.
 */

import type { Nemesis } from '../nemesis/Nemesis';

/* ============================================================
   cycle structure
   ============================================================ */

/** One cycle walks these in order. `ended` is terminal. */
export type GodPhase = 'observe' | 'interfere' | 'simulate' | 'consequences' | 'ended';

/** The shape of a run. Escalation is a property of the act, not of a timer. */
export type ActId = 'early' | 'rising' | 'late' | 'crisis';

export const ACT_ORDER: ActId[] = ['early', 'rising', 'late', 'crisis'];

export interface ActDef {
  id: ActId;
  name: string;
  /** cycle on which this act begins */
  from: number;
  blurb: string;
  /** multiplies how many actions the world takes per cycle */
  tempo: number;
  /** multiplies how lethal duels are allowed to be */
  lethality: number;
  /** multiplies ambition/challenge pressure in scoring */
  pressure: number;
}

/* ============================================================
   per-NPC simulation state
   ============================================================ */

export type GoalId =
  | 'survive'
  | 'climb'
  | 'revenge'
  | 'protect'
  | 'hoard'
  | 'conquer'
  | 'hide'
  | 'serve'
  | 'destroy_god';

export interface Deed {
  cycle: number;
  /** already-rendered sentence, kept short */
  text: string;
  /** legendary deeds are the ones the Book of Legends quotes */
  weight: number;
}

/**
 * The dimensions the brief asks for that the `Nemesis` record did not already
 * carry. Everything already on `Nemesis` (rank, level, traits, scars, memory,
 * rivalries, allies, master, stolen loot, returns, territory) is used directly
 * and deliberately NOT duplicated here.
 */
export interface SimState {
  /** 0..100 — rises from defeats and near-death, decays slowly */
  fear: number;
  /** 0..100 — rises from wins, falls from losses; gates who dares what */
  confidence: number;
  /** 0..100 — how hard they push upward; seeded from personality, drifts */
  ambition: number;
  /** 0..100 — toward their master and their faction */
  loyalty: number;
  /** 0..100 — accumulated unhealed wounds; heals over cycles unless re-opened */
  injury: number;
  /** how the world talks about them; feeds titles, legends and crisis choice */
  reputation: number;

  goal: GoalId;
  goalTargetId: string | null;
  /** cycles the current goal has been held; long-held goals are the good stories */
  goalAge: number;

  factionId: string | null;

  wins: number;
  losses: number;
  flights: number;
  /** ids of nemeses this one has personally killed */
  kills: string[];
  /** who put them in the ground last time */
  killedById: string | null;
  /** ids they have run from */
  escapedFrom: string[];
  /** ids they intend to answer for */
  revengeTargets: string[];

  /** hidden actors cannot be found by hunters until this cycle */
  hiddenUntil: number;
  /** area they are moving toward, resolved next cycle */
  travelTo: string | null;

  /** short rendered lines for the chronicle and the Book of Legends */
  deeds: Deed[];

  /** cycle they last acted, so the dev panel can show staleness */
  lastCycle: number;
  lastActionId: string;

  /** set once a run promotes them to the crisis */
  crisisBorn: boolean;
  /** they have decided the god is the problem (high chaos) */
  heretic: boolean;
}

export function emptySimState(): SimState {
  return {
    fear: 10,
    confidence: 45,
    ambition: 45,
    loyalty: 50,
    injury: 0,
    reputation: 0,
    goal: 'survive',
    goalTargetId: null,
    goalAge: 0,
    factionId: null,
    wins: 0,
    losses: 0,
    flights: 0,
    kills: [],
    killedById: null,
    escapedFrom: [],
    revengeTargets: [],
    hiddenUntil: 0,
    travelTo: null,
    deeds: [],
    lastCycle: 0,
    lastActionId: '',
    crisisBorn: false,
    heretic: false,
  };
}

/** `sim` is to the simulation what `ai` is to presentation: a namespace. */
export interface SimNemesis extends Nemesis {
  sim?: SimState;
}

/** Always returns a live object, creating and attaching it on first touch. */
export function simOf(n: Nemesis): SimState {
  const s = n as SimNemesis;
  if (!s.sim) s.sim = emptySimState();
  return s.sim;
}

/* ============================================================
   factions
   ============================================================ */

export interface Faction {
  id: string;
  name: string;
  /** hex, drawn from the world palette */
  colour: number;
  leaderId: string | null;
  memberIds: string[];
  territories: string[];
  /** summed power of living members */
  strength: number;
  /** 0..100 — below 25 it fractures, at 0 it collapses */
  stability: number;
  /** 0..100 — how readily it starts things */
  aggression: number;
  warWith: string[];
  bornCycle: number;
  destroyedCycle: number | null;
}

/* ============================================================
   conditions — the only thing the player writes
   ============================================================ */

export type ConditionKind =
  | 'blessing'
  | 'curse'
  | 'bounty'
  | 'rumour'
  | 'mark'
  | 'ward'
  | 'opportunity'
  | 'exposure'
  | 'omen'
  | 'unrest';

export type ConditionTargetKind = 'nemesis' | 'faction' | 'area' | 'world';

export interface Condition {
  id: string;
  kind: ConditionKind;
  targetKind: ConditionTargetKind;
  targetId: string;
  /** second party, for relational conditions (a rumour is always about two people) */
  otherId?: string;
  /** roughly 0..1, scales every effect the condition has */
  magnitude: number;
  createdCycle: number;
  expiresCycle: number;
  source: 'god' | 'world';
  /** one rendered line, shown on the board */
  note: string;
}

/* ============================================================
   utility scoring — kept in full so the dev panel can show the maths
   ============================================================ */

export interface ScoreParts {
  base: number;
  personality: number;
  relationship: number;
  memory: number;
  need: number;
  danger: number;
  opportunity: number;
  ambition: number;
  noise: number;
}

export interface ScoreBreakdown {
  actionId: string;
  actionName: string;
  targetId: string | null;
  targetName: string;
  /** a person, a piece of ground, or nothing — the explanation reads differently */
  targetKind: 'nemesis' | 'place' | 'none';
  /**
   * Which of the god's own marks were sitting on the target when this was
   * weighed. Captured only for the option actually taken, because that is the
   * one the player will ask about — and because "you had put a price on his
   * head" is the single most useful thing a tutorial can say.
   */
  marks?: string[];
  total: number;
  parts: ScoreParts;
  /** why it was rejected, when it was */
  veto?: string;
}

export interface Decision {
  cycle: number;
  actorId: string;
  actorName: string;
  chosen: ScoreBreakdown | null;
  considered: ScoreBreakdown[];
  /**
   * The cycle's appetite for violence was already spent, so their first choice
   * was pushed aside and they did the next thing they wanted. Surfaced rather
   * than hidden — a player who sees a higher-scoring option listed under "they
   * nearly did this instead" deserves to know why it did not happen.
   */
  rationed?: { actionName: string; targetName: string; total: number };
}

/**
 * Why a beat happened, kept with the beat.
 *
 * An emergent game is only teachable if it can account for itself after the
 * fact. The full reasoning behind the choice that produced this beat is
 * carried alongside it, so "why did he do that?" is answerable in cycle 2 and
 * in cycle 30, rather than only while a scripted tutorial is running.
 */
export interface BeatWhy {
  actorId: string;
  actorName: string;
  /** their nature, in words — the single most explanatory fact about them */
  personality: string;
  actionName: string;
  targetName: string;
  targetKind: 'nemesis' | 'place' | 'none';
  total: number;
  parts: ScoreParts;
  /** god-sourced conditions on the target at the moment of the decision */
  marks: string[];
  /** the two things they nearly did instead */
  alternatives: Array<{ actionName: string; targetName: string; total: number }>;
  /** what the cycle's violence ration stopped them doing */
  rationed?: { actionName: string; targetName: string; total: number };
}

/* ============================================================
   the feed
   ============================================================ */

export type BeatPriority = 'background' | 'notable' | 'major' | 'legendary';

export const BEAT_RANK: Record<BeatPriority, number> = {
  background: 0,
  notable: 1,
  major: 2,
  legendary: 3,
};

/** Presentation-only replay payload for the oracle viewport. Never sim state. */
export interface DuelSpectacle {
  kind: 'duel';
  areaId: string;
  aId: string;
  bId: string;
  fightKind: string;
  beats: Array<{ t: number; text: string; actorId: string; kind: string }>;
  duration: number;
}

export interface Beat {
  id: string;
  cycle: number;
  priority: BeatPriority;
  /** the one readable sentence */
  headline: string;
  /** expandable lines: what changed, and why it will matter */
  detail: string[];
  actors: string[];
  tone: 'neutral' | 'bad' | 'good' | 'gold';
  kind: string;
  /** present on beats produced by a character's decision */
  why?: BeatWhy;
  /** optional 3D replay for major+ fights */
  spectacle?: DuelSpectacle;
}

/* ============================================================
   the observe board
   ============================================================ */

export type SituationKind =
  | 'rivalry'
  | 'ascendant'
  | 'wounded'
  | 'grudge'
  | 'faction_war'
  | 'power_vacuum'
  | 'underdog'
  | 'revenge'
  | 'betrayal_risk'
  | 'territory'
  | 'heresy'
  | 'crisis'
  | 'condition';

export interface Situation {
  id: string;
  kind: SituationKind;
  headline: string;
  detail: string;
  actors: string[];
  /** 0..1 — sorts the board; the player should never have to read everything */
  urgency: number;
  /** intervention ids that plausibly bite here — a hint, never a solution */
  suggest: string[];
}

/* ============================================================
   the crisis
   ============================================================ */

export type CrisisKind = 'warlord' | 'legend' | 'beast' | 'civil_war' | 'heresy';

export interface Crisis {
  kind: CrisisKind;
  title: string;
  /** the nemesis who embodies it, when one does */
  bodyId: string | null;
  factionId: string | null;
  power: number;
  /** power added each cycle it is left alone */
  growth: number;
  bornCycle: number;
  /** the cycle by which the world falls if nothing can stop it */
  deadline: number;
  resolved: 'none' | 'defeated' | 'consumed';
  description: string;
  /** who actually put it down, once someone has */
  slainById: string | null;
}

/* ============================================================
   run outcome and the Book of Legends
   ============================================================ */

export type RunEnding = 'triumph' | 'collapse' | 'stalemate' | 'abandoned';

export interface RunOutcome {
  ending: RunEnding;
  cycles: number;
  chaosPeak: number;
  influenceSpent: number;
  interventions: number;
  crisis: string;
  crisisKind: CrisisKind | null;
  slayerName: string;
  /** how many A-wants-B-wants-C chains were still live at the end */
  revengeChains: number;
  /** rendered summary lines for the end-of-run screen */
  highlights: string[];
  /** "crisis was X because you did Y" chain shown before the next run */
  recapChain: string[];
  legendsMade: string[];
  essence: number;
  unlocked: string[];
}

export interface LegendRecord {
  id: string;
  name: string;
  title: string;
  /** run index this legend was made in */
  run: number;
  age: number;
  faction: string;
  /** appearance seed, so the portrait is reproducible forever */
  appearanceSeed: number;
  archetype: string;
  personality: string;
  finalRank: string;
  finalPower: number;
  traits: string[];
  scars: string[];
  deeds: string[];
  kills: number;
  rivals: string[];
  causeOfDeath: string;
  /** how they felt about the god at the end, -100..200 */
  standing: number;
  /** what they leave behind in later runs */
  legacy: LegacyKind;
  epitaph: string;
}

/** How a legend reaches forward into later runs. */
export type LegacyKind = 'relic' | 'bloodline' | 'rumour' | 'grudge' | 'title';

/** A legend's echo in the living world — who inherited what, and why. */
export interface LegacyEcho {
  legendId: string;
  kind: LegacyKind;
  headline: string;
  detail: string;
  actorId: string | null;
}

/* ============================================================
   run summary retained per cycle (small, for the dev panel + recap)
   ============================================================ */

export interface CycleSummary {
  cycle: number;
  act: ActId;
  chaos: number;
  influence: number;
  living: number;
  deaths: number;
  beats: number;
  topActor: string;
}

/* ============================================================
   the state itself
   ============================================================ */

export const GOD_STATE_VERSION = 2;

/** Why you are going into 3D, and what success/fail means for the board. */
export interface DescentBrief {
  nemesisId: string;
  reason: string;
  goal: string;
  situationId: string | null;
  conditionNote: string;
  cyclesWhileGone: number;
  scenario: 'tower' | 'hunt';
}

/** Strategic return card after a descent. */
export interface DescentReport {
  targetId: string;
  targetName: string;
  outcome: 'killed' | 'spared' | 'fled' | 'player_died' | 'escaped';
  cyclesElapsed: number;
  lines: string[];
}

export interface CausalLink {
  label: string;
  text: string;
}

/** Load-bearing beats shown before the full feed. */
export interface AftermathReport {
  cycle: number;
  intention: string;
  links: CausalLink[];
  nextProblem: string;
  uncertainty: string;
  /** Beat carrying WHY for the decision that mattered most this cycle. */
  explainBeat?: Beat | null;
}

export interface ScenarioFlags {
  towerCommander: boolean;
}

export interface GodState {
  version: number;
  /** which roguelite run this is */
  run: number;
  seed: number;
  /** snapshot of the run RNG so an accelerated run replays identically */
  rngState: number;

  cycle: number;
  phase: GodPhase;
  act: ActId;

  influence: number;
  influenceMax: number;
  /** rises with every intervention; bends the whole simulation */
  chaos: number;
  chaosPeak: number;
  /** highest chaos tier threshold (`at`) already announced this run */
  chaosTierAt: number;
  /** legendary heresy-threshold beat has fired */
  heresyThresholdAnnounced: boolean;

  conditions: Condition[];
  nextConditionId: number;

  factions: Faction[];
  nextFactionId: number;

  crisis: Crisis | null;

  /** the character the god has invested most in; derived, not chosen */
  championId: string | null;

  feed: Beat[];
  nextBeatId: number;

  situations: Situation[];

  /** last cycle's decisions, for the dev panel. Not persisted. */
  decisions: Decision[];

  interventionsUsed: Record<string, number>;
  influenceSpent: number;
  descents: number;
  /**
   * The one intervention that puts you in the world yourself. Set by DESCEND,
   * consumed by the Game, which drops into the third-person run against this
   * character while the cycles keep turning without you.
   */
  pendingDescent: DescentBrief | null;

  /** Progressive disclosure — one focus before the full board. */
  focusSituationId: string | null;
  /** First interfere or advance has been acknowledged. */
  openingDone: boolean;
  /** Full OBSERVE list unlocked (still available via inspect earlier). */
  boardUnlocked: boolean;
  /** Last ADVANCE causal strip; UI clears when the player continues. */
  lastAftermath: AftermathReport | null;
  /** Shown when returning from 3D. */
  lastDescentReport: DescentReport | null;
  scenarioFlags: ScenarioFlags;

  history: CycleSummary[];

  /** Who inherited each recent legend — used when descending into the pit. */
  legacyEchoes: LegacyEcho[];

  ended: boolean;
  outcome: RunOutcome | null;
}
