/**
 * AI runtime feedback: the `AI ●` indicator and the small status notices.
 *
 * Design constraints, all of them load-bearing:
 *   - nothing here is ever modal, and nothing blocks input
 *   - it lives in the top-left gutter, clear of the centre of the screen where
 *     combat and the arrival card are
 *   - `pointer-events` is off for everything except the indicator itself
 *   - a success notice is short-lived; a failure is quiet, not a popup
 *
 * This panel reads state. It never drives generation, so nothing it does can
 * stall or reorder the queue.
 */

import { div, show } from './Dom';
import type { AIRequest, AIRequestKind, AIRequestState } from '../ai/AITypes';

const GENERATING_LINES: Record<AIRequestKind, string[]> = {
  identity: ['A NEW NAME IS BEING WHISPERED...', 'THE WORLD IS NAMING THEM...'],
  taunt: ['REMEMBERING THE DEAD...', 'THE WORLD IS REMEMBERING...'],
  chronicle: ['THE CHRONICLE IS BEING WRITTEN...', 'WRITING THE HISTORY...'],
  portrait: ['PAINTING THE ENEMY...', 'CREATING NEMESIS PORTRAIT...', 'RECONSTRUCTING THE SURVIVOR...'],
  dossier: ['READING THEM...', 'THE RECORD IS BEING WORDED...'],
  beat: ['CAPTIONING THE CYCLE...', 'THE FEED IS BEING WORDED...'],
  crisis: ['NAMING THE CRISIS...', 'THE THREAT IS BEING WORDED...'],
  recap: ['CLOSING THE RECORD...', 'THE RUN IS BEING WORDED...'],
  legend: ['WRITING THEM INTO THE BOOK...', 'AN EPITAPH IS BEING WORDED...'],
  aftermath: ['WORDING THE CONSEQUENCE...', 'THE CHAIN IS BEING READ...'],
  situation: ['READING THE BOARD...', 'THE STAKES ARE BEING WORDED...'],
  recap_beat: ['POLISHING THE RECAP...', 'THE RECORD IS BEING READ...'],
  timeline: ['WRITING THE TIMELINE...', 'THE CHRONICLE SHIFTS...'],
  journey: ['POLISHING A LIFE...', 'THE JOURNEY IS BEING READ...'],
  arc: ['THREADING THE STORY...', 'AN OPEN THREAD IS BEING WORDED...'],
  encounter: ['SETTING THE SCENE...', 'THE MEETING IS BEING WORDED...'],
  relationship_chronicle: ['WEAVING THE THREADS...', 'THE HISTORY DEEPENS...'],
  contextual_line: ['FINDING THEIR WORDS...', 'THE ENEMY SPEAKS...'],
  exchange: ['VOICING THE EXCHANGE...', 'THE WORDS ARE SET...'],
};

const KIND_LABEL: Record<AIRequestKind, string> = {
  identity: 'NAME',
  taunt: 'DIALOGUE',
  chronicle: 'CHRONICLE',
  portrait: 'PORTRAIT',
  dossier: 'DOSSIER',
  beat: 'VOICE',
  crisis: 'CRISIS',
  recap: 'RECAP',
  legend: 'LEGEND',
  aftermath: 'AFTERMATH',
  situation: 'STAKES',
  recap_beat: 'RECAP',
  timeline: 'TIME',
  journey: 'JOURNEY',
  arc: 'THREAD',
  encounter: 'MEETING',
  relationship_chronicle: 'HISTORY',
  contextual_line: 'LINE',
  exchange: 'EXCHANGE',
};

const SUBTITLE: Record<AIRequestKind, string> = {
  identity: 'Forging a title',
  taunt: 'Recalling what they remember',
  chronicle: 'Writing their history',
  portrait: 'Generating Nemesis portrait',
  dossier: 'Wording the inspection',
  beat: 'Captioning a consequence',
  crisis: 'Wording the crisis',
  recap: 'Closing the run',
  legend: 'Writing an epitaph',
  aftermath: 'Voicing the consequence chain',
  situation: 'Voicing the stakes',
  recap_beat: 'Polishing a recap beat',
  timeline: 'Polishing the timeline',
  journey: 'Polishing a journey beat',
  arc: 'Voicing an open thread',
  encounter: 'Polishing the encounter',
  relationship_chronicle: 'Weaving relationship history',
  contextual_line: 'Finding their words',
  exchange: 'Voicing the exchange',
};

export type IndicatorState = 'off' | 'idle' | 'busy' | 'error';

interface Notice {
  root: HTMLElement;
  stateEl: HTMLElement;
  requestId: number;
  ttl: number;
}

export class AIStatus {
  readonly root = div('layer');

  private dot = div('ai-dot');
  private indicator = div('ai-indicator');
  private list = div('ai-notices');
  private herald = div('ai-herald hidden');
  private heraldTimer = 0;
  private notices: Notice[] = [];
  private seen = new Map<number, Notice>();
  private lastState: IndicatorState = 'off';

  onOpenSettings: (() => void) | null = null;

  constructor() {
    this.root.id = 'ai-layer';
    this.root.style.pointerEvents = 'none';

    this.indicator.append(div('ai-label', 'AI'), this.dot);
    this.indicator.title = 'AI content — click for settings';
    this.indicator.setAttribute('aria-label', 'AI status — open settings');
    this.indicator.style.pointerEvents = 'auto';
    this.indicator.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpenSettings?.();
    });

    this.herald.textContent = 'THE WORLD HAS BEGUN TO REMEMBER.';
    this.root.append(this.indicator, this.list, this.herald);
  }

  setVisible(v: boolean): void {
    show(this.root, v);
  }

  /** Indicator colour. GRAY off, GREEN idle, PULSING busy, RED error. */
  setIndicator(state: IndicatorState): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.dot.className = `ai-dot ai-${state}`;
    this.indicator.dataset.state = state;
    this.indicator.classList.toggle('dimmed', state === 'off');
  }

  /** Shown once, the first time this session produces generated content. */
  showHerald(): void {
    show(this.herald, true);
    this.herald.classList.remove('introFx');
    void this.herald.offsetWidth;
    this.herald.classList.add('introFx');
    this.heraldTimer = 4.2;
  }

  /**
   * Reconcile the visible notices with the queue. Called every frame; cheap,
   * and it only touches the DOM when something actually changed.
   */
  sync(requests: AIRequest[]): void {
    for (const r of requests) {
      const existing = this.seen.get(r.id);
      if (!existing) {
        // Cache hits are not worth a notice; they are instant by definition.
        if (r.state === 'cached') continue;
        this.add(r);
      } else if (existing.stateEl.dataset.state !== r.state) {
        this.applyState(existing, r);
      }
    }
  }

  private add(r: AIRequest): void {
    const root = div('ai-notice');
    const head = div('ai-head');
    const kind = div('ai-kind', KIND_LABEL[r.kind]);
    const stateEl = div('ai-state');
    head.append(kind, stateEl);

    const line = div('ai-line', this.pickLine(r));
    const who = div('ai-who', r.label);
    const bar = div('ai-bar');
    bar.append(div('ai-bar-fill'));

    root.append(head, line, who, bar);
    this.list.append(root);

    const notice: Notice = { root, stateEl, requestId: r.id, ttl: 30 };
    this.notices.push(notice);
    this.seen.set(r.id, notice);
    this.applyState(notice, r);

    // Never let the panel grow into the play area.
    while (this.notices.length > 3) {
      const dropped = this.notices.shift();
      if (dropped) {
        this.seen.delete(dropped.requestId);
        dropped.root.remove();
      }
    }
  }

  private pickLine(r: AIRequest): string {
    const opts = GENERATING_LINES[r.kind];
    return opts[r.id % opts.length];
  }

  private applyState(n: Notice, r: AIRequest): void {
    const state: AIRequestState = r.state;
    n.stateEl.dataset.state = state;
    n.stateEl.textContent = state.toUpperCase();
    n.root.classList.toggle('done', state === 'complete' || state === 'cached');
    n.root.classList.toggle('failed', state === 'failed');
    n.root.classList.toggle('working', state === 'generating' || state === 'queued');

    const line = n.root.querySelector('.ai-line');
    if (line) {
      if (state === 'complete') line.textContent = SUBTITLE[r.kind] + ' — done';
      else if (state === 'failed') line.textContent = 'Using local generation';
      else if (state === 'queued') line.textContent = 'Waiting its turn';
      else line.textContent = this.pickLine(r);
    }

    // Successes and failures both leave quickly. Nothing lingers.
    if (state === 'complete' || state === 'cached') n.ttl = 2.2;
    else if (state === 'failed') n.ttl = 3.2;
  }

  update(dt: number): void {
    if (this.heraldTimer > 0) {
      this.heraldTimer -= dt;
      if (this.heraldTimer <= 0) show(this.herald, false);
    }
    for (let i = this.notices.length - 1; i >= 0; i--) {
      const n = this.notices[i];
      const st = n.stateEl.dataset.state;
      if (st === 'queued' || st === 'generating') continue;
      n.ttl -= dt;
      if (n.ttl <= 0) {
        n.root.classList.add('fade-out');
        const target = n;
        window.setTimeout(() => target.root.remove(), 500);
        this.notices.splice(i, 1);
        this.seen.delete(n.requestId);
      }
    }
  }

  clear(): void {
    for (const n of this.notices) n.root.remove();
    this.notices = [];
    this.seen.clear();
  }
}
