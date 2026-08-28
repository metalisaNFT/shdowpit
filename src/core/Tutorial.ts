/**
 * Contextual first-run teaching. Short local copy, never AI.
 * Does not freeze the player during live danger; uses overlay prompts.
 */

import type { Settings } from './SaveSystem';

export type TutorialId =
  | 'basics'
  | 'posture'
  | 'parry'
  | 'skill'
  | 'named'
  | 'death'
  | 'second_run';

export const TUTORIAL_ORDER: TutorialId[] = [
  'basics',
  'posture',
  'parry',
  'skill',
  'named',
  'death',
  'second_run',
];

/**
 * Combat HUD copy: title + one scannable line. Longer explanation lives in
 * TUTORIAL_DETAIL (pause TEACHING) so the fight view never asks the player
 * to read a paragraph.
 */
export const TUTORIAL_COPY: Record<TutorialId, { title: string; body: string; glyphs: string }> = {
  basics: {
    title: 'STRIKE',
    body: '',
    glyphs: 'LMB LIGHT    RMB HEAVY    SPACE DODGE',
  },
  posture: {
    title: 'BREAK THEM',
    body: '',
    glyphs: 'RMB HEAVY · FILL CYAN · E EXECUTE',
  },
  parry: {
    title: 'PARRY',
    body: '',
    glyphs: 'Q ON CYAN    RED = MOVE',
  },
  skill: {
    title: 'SKILL',
    body: '',
    glyphs: '1 / 2 WHEN IT FLASHES',
  },
  named: {
    title: 'NAMED',
    body: '',
    glyphs: 'THEY REMEMBER    TAB WEB',
  },
  death: {
    title: 'THE WORLD TURNED',
    body: '',
    glyphs: 'DEATH ADVANCES ONE TURN',
  },
  second_run: {
    title: 'THE GROUND',
    body: '',
    glyphs: 'HEAT HUNTS    E EXTRACT / REMNANT',
  },
};

/** Pause-menu teaching. Not shown during live combat. */
export const TUTORIAL_DETAIL: Record<TutorialId, string> = {
  basics: 'Reach them. Light, heavy, and dodge are the whole first language.',
  posture: 'The second bar on their plate is posture. Fill it, then execute.',
  parry: 'Cyan is an offer. Time Q on the cut. Perfect timing fills Surge. Red cannot be parried — move.',
  skill: 'Skills are for gaps, not instead of attacking. Cooldown is the cost.',
  named: 'This one remembers. Memories, grudges, and stolen steel persist. A Vendetta is optional.',
  death: 'You died. They did not wait. The recap is the few things that mattered.',
  second_run: 'Heat draws hunters. Remnants are run-only, not Essence. Extract at a gate.',
};

export interface TutorialState {
  skipped: boolean;
  completed: Partial<Record<TutorialId, boolean>>;
  /**
   * THE LONG GAME teaches differently — it is turn-based, so it can afford
   * lessons that wait for the concept to become real instead of firing on a
   * timer. Kept in the same object so one SKIP TUTORIALS covers both games.
   */
  god: Record<string, boolean>;
  /** how far the guided first cycle got, so a reload does not restart it */
  godGuide: string;
}

export function defaultTutorial(): TutorialState {
  return { skipped: false, completed: {}, god: {}, godGuide: '' };
}

export function migrateTutorial(raw: unknown): TutorialState {
  const d = defaultTutorial();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<TutorialState>;
  d.skipped = !!o.skipped;
  d.completed = { ...(o.completed ?? {}) };
  d.god = { ...(o.god ?? {}) };
  d.godGuide = typeof o.godGuide === 'string' ? o.godGuide : '';
  return d;
}

export function tutorialDone(s: TutorialState, id: TutorialId): boolean {
  return s.skipped || !!s.completed[id];
}

export function markTutorial(settings: Settings, id: TutorialId): void {
  settings.tutorial.completed[id] = true;
}

export class TutorialController {
  prompt: { id: TutorialId; title: string; body: string; glyphs: string } | null = null;
  private hold = 0;
  private shown = new Set<TutorialId>();

  resetSession(): void {
    this.prompt = null;
    this.hold = 0;
    this.shown.clear();
  }

  skipAll(settings: Settings): void {
    settings.tutorial.skipped = true;
    this.prompt = null;
  }

  replay(settings: Settings, id?: TutorialId): void {
    settings.tutorial.skipped = false;
    if (id) {
      delete settings.tutorial.completed[id];
      this.offer(id, true);
    } else {
      settings.tutorial.completed = {};
      settings.tutorial.god = {};
      settings.tutorial.godGuide = '';
      this.resetSession();
      this.offer('basics', true);
    }
  }

  offer(id: TutorialId, force = false): boolean {
    const copy = TUTORIAL_COPY[id];
    if (!copy) return false;
    if (!force && this.shown.has(id)) return false;
    this.shown.add(id);
    this.prompt = { id, title: copy.title, body: copy.body, glyphs: copy.glyphs };
    this.hold = 6.5;
    return true;
  }

  dismiss(): void {
    this.prompt = null;
    this.hold = 0;
  }

  update(dt: number): void {
    if (!this.prompt) return;
    this.hold -= dt;
    if (this.hold <= 0) this.dismiss();
  }
}
