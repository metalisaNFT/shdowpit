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
    showTutorial: !modal && !intro && !dying && q.tutorialActive && !q.executable,
    showPurpose: !modal && !intro && !dying && !q.executable && (!q.inCombat || !q.tutorialActive),
    showBanner: !modal && !intro && !dying && !q.executable && !q.tutorialActive && !q.inCombat,
    showToasts: !modal && !intro && !dying,
    showPrompt: !modal && !intro && !dying && (q.executable || q.interact || (!q.inCombat && q.remnantHeal)),
    allowRemnantPrompt: !q.inCombat && !intro && !q.executable && !q.interact && !dying && !modal,
    nextLabel,
    combatFocus: q.inCombat && !modal && q.mode === 'playing',
  };
}
