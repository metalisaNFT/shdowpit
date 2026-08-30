/**
 * Combat overlay ownership. One major message at a time.
 *
 * This is presentation coordination over existing HUD / intro / modal
 * surfaces — not a new game system. Callers still open and close their own
 * screens; this only answers what may occupy the player's attention now,
 * and what is waiting.
 */

export type OverlayLane =
  | 'modal'
  | 'intro'
  | 'execute'
  | 'tutorial'
  | 'interact'
  | 'banner'
  | 'none';

/** Enter / exit / plate-delay timing per lane (intro → plate → execute). */
export interface LaneTiming {
  enterMs: number;
  exitMs: number;
  /** ms before the target plate may appear after this lane takes over */
  plateDelayMs: number;
}

export const LANE_TIMING: Record<OverlayLane, LaneTiming> = {
  modal: { enterMs: 500, exitMs: 340, plateDelayMs: 0 },
  intro: { enterMs: 640, exitMs: 500, plateDelayMs: 0 },
  execute: { enterMs: 340, exitMs: 260, plateDelayMs: 220 },
  tutorial: { enterMs: 340, exitMs: 260, plateDelayMs: 0 },
  interact: { enterMs: 260, exitMs: 200, plateDelayMs: 0 },
  banner: { enterMs: 500, exitMs: 500, plateDelayMs: 0 },
  none: { enterMs: 200, exitMs: 200, plateDelayMs: 0 },
};

export interface OverlayQuery {
  mode: string;
  introActive: boolean;
  encounterBusy: boolean;
  bannerActive: boolean;
  tutorialActive: boolean;
  executable: boolean;
  interact: boolean;
  remnantHeal: boolean;
  inCombat: boolean;
  pendingLabel: string | null;
  /** Full-screen comic viewer (not a Mode). */
  comicOpen: boolean;
  pendingComic: boolean;
}

export interface OverlayDecision {
  lane: OverlayLane;
  timing: LaneTiming;
  /** Target plate gets frame emphasis (execute lane or mid-combat focus). */
  emphasizePlate: boolean;
  /** Hide the nemesis plate while intro / modal owns centre. */
  hidePlate: boolean;
  showTutorial: boolean;
  showPurpose: boolean;
  showBanner: boolean;
  showToasts: boolean;
  showPrompt: boolean;
  allowRemnantPrompt: boolean;
  nextLabel: string | null;
  combatFocus: boolean;
}

const MODAL_MODES = new Set([
  'power',
  'choice',
  'paused',
  'hierarchy',
  'report',
  'build',
  'title',
  'god',
  'legends',
  'godend',
]);

export function decideOverlays(q: OverlayQuery): OverlayDecision {
  const modal = MODAL_MODES.has(q.mode) || q.comicOpen;
  const dying = q.mode === 'dying';
  const intro = !modal && (q.introActive || q.encounterBusy);

  let lane: OverlayLane = 'none';
  if (modal) lane = 'modal';
  else if (intro) lane = 'intro';
  else if (q.executable) lane = 'execute';
  else if (q.tutorialActive) lane = 'tutorial';
  else if (q.interact) lane = 'interact';
  else if (q.bannerActive) lane = 'banner';

  const timing = LANE_TIMING[lane];
  const hidePlate = modal || intro;
  const emphasizePlate = lane === 'execute' || (q.inCombat && !hidePlate && q.mode === 'playing');

  const queued = q.pendingLabel ?? (q.pendingComic ? 'ENCOUNTER' : null);

  let nextLabel: string | null = null;
  if (intro) {
    if (queued) nextLabel = queued;
    else if (q.executable) nextLabel = 'EXECUTE';
    else if (q.tutorialActive) nextLabel = 'INSTRUCTION';
  } else if (q.executable && queued) {
    nextLabel = queued;
  } else if (lane === 'tutorial' && queued) {
    nextLabel = queued;
  } else if (lane === 'none' && queued && !q.inCombat) {
    nextLabel = queued;
  }

  return {
    lane,
    timing,
    emphasizePlate,
    hidePlate,
    showTutorial: !modal && !intro && !dying && q.tutorialActive && !q.executable,
    showPurpose: !modal && !intro && !dying && !q.executable && (!q.inCombat || !q.tutorialActive),
    showBanner: !modal && !intro && !dying && !q.executable && !q.tutorialActive && !q.inCombat,
    // Encounter director callouts use toast(); only the intro card should gate them.
    showToasts: !modal && !dying && !q.introActive,
    showPrompt: !modal && !intro && !dying && (q.executable || q.interact || (!q.inCombat && q.remnantHeal)),
    allowRemnantPrompt: !q.inCombat && !intro && !q.executable && !q.interact && !dying && !modal,
    nextLabel,
    combatFocus: q.inCombat && !modal && q.mode === 'playing',
  };
}
