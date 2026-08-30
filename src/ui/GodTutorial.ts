/**
 * The teaching surface for THE LONG GAME.
 *
 * One rail under the header, never a modal, never a timer. It carries either
 * the current step of the guided first cycle or the one lesson this cycle
 * earned, and it can always be dismissed permanently in one click. Plus the
 * primer, for players who would rather read the rules than be walked through
 * them.
 */

import { button, clear, div, show } from './Dom';
import { explainBeat, partsLine } from '../god/Explain';
import { primer, type GuideStep, type Lesson, type PrimerSection } from '../god/Teaching';
import type { Beat, GodState } from '../god/GodTypes';
import { BeatReveal, ScreenChrome } from './primitives';

export interface RailHandlers {
  /** stop all teaching, permanently */
  onSkip: () => void;
  /** acknowledge the current lesson */
  onDismiss: () => void;
  onPrimer: () => void;
}

export type RailContent =
  | { kind: 'guide'; step: GuideStep; index: number; total: number }
  | { kind: 'lesson'; lesson: Lesson }
  | null;

export class GodTeachRail {
  readonly root = div('god-teach hidden');
  private handlers: RailHandlers | null = null;
  private content: RailContent = null;
  private bodyOpen = false;
  private pillCollapsed = false;

  constructor() {
    this.root.id = 'god-teach';
  }

  bind(handlers: RailHandlers): void {
    this.handlers = handlers;
  }

  set(content: RailContent): void {
    const prev = this.content?.kind === 'guide' ? this.content.step.id : null;
    const next = content?.kind === 'guide' ? content.step.id : null;
    if (prev !== next) this.bodyOpen = false;
    if (content?.kind === 'guide' && content.index >= 2) {
      this.pillCollapsed = true;
    }
    this.content = content;
    this.render();
  }

  get showing(): boolean {
    return !!this.content;
  }

  private render(): void {
    clear(this.root);
    const c = this.content;
    const h = this.handlers;
    if (!c || !h) {
      show(this.root, false);
      return;
    }
    show(this.root, true);
    this.root.classList.toggle('is-lesson', c.kind === 'lesson');
    this.root.classList.toggle('is-pill', this.pillCollapsed && c.kind === 'guide');

    if (this.pillCollapsed && c.kind === 'guide') {
      const pill = div('god-teach-pill');
      const track = div('god-teach-pill-track');
      const fill = div('god-teach-pill-fill');
      fill.style.width = `${(c.index / c.total) * 100}%`;
      track.append(fill);
      pill.append(track, div('god-teach-pill-label', `LEARNING · ${c.index}/${c.total}`));
      pill.addEventListener('click', () => {
        this.pillCollapsed = false;
        this.render();
      });
      this.root.append(pill);
      return;
    }

    const left = div('god-teach-body');
    if (c.kind === 'guide') {
      left.append(div('god-teach-kind', `LEARNING THE LOOP · ${c.index} OF ${c.total}`));
      left.append(div('god-teach-title', c.step.title));
      if (this.bodyOpen) {
        for (const line of c.step.body) left.append(div('god-teach-line', line));
      } else if (c.step.body[0]) {
        left.append(div('god-teach-line', c.step.body[0]));
      }
      left.append(div('god-teach-hint', '▸  ' + c.step.hint));
    } else {
      left.append(div('god-teach-kind', 'BECAUSE IT JUST HAPPENED'));
      left.append(div('god-teach-title', c.lesson.title));
      for (const line of c.lesson.body) left.append(div('god-teach-line', line));
      if (c.lesson.footnote) left.append(div('god-teach-hint', c.lesson.footnote));
    }

    const acts = div('god-teach-actions');
    if (c.kind === 'guide' && c.step.body.length > 1) {
      acts.append(
        button(this.bodyOpen ? 'LESS' : 'MORE', () => {
          this.bodyOpen = !this.bodyOpen;
          this.render();
        }, 'brut tiny')
      );
    }
    if (c.kind === 'lesson') acts.append(button('UNDERSTOOD', () => h.onDismiss(), 'brut tiny'));
    acts.append(button('THE PRIMER', () => h.onPrimer(), 'brut tiny'));
    acts.append(button('STOP TEACHING', () => h.onSkip(), 'brut tiny'));

    this.root.append(left, acts);
  }
}

/* ============================================================
   WHY — the panel that renders a beat's own reasoning
   ============================================================ */

export function buildWhyPanel(beat: Beat, onClose: () => void): HTMLElement {
  const root = div('god-why');
  const why = beat.why;
  if (!why) {
    root.append(div('god-why-empty', 'This one was not somebody\'s decision — it is the world settling up.'));
    root.append(button('CLOSE', onClose, 'brut tiny'));
    return root;
  }

  const ex = explainBeat(why);
  root.append(div('god-why-head', ex.headline));

  if (ex.yours.length) {
    root.append(div('god-why-sub yours', 'WHAT YOU HAD LEFT THERE'));
    for (const y of ex.yours) root.append(div('god-why-yours', y));
  }

  const list = div('god-why-reasons');
  if (ex.yours.length) root.append(div('god-why-sub', 'AND WHAT THEY BROUGHT'));
  for (const r of ex.reasons) list.append(div('god-why-reason', r));
  root.append(list);

  if (ex.alternatives.length) {
    root.append(div('god-why-sub', 'THEY NEARLY DID THIS INSTEAD'));
    for (const a of ex.alternatives) root.append(div('god-why-alt', a));
  }

  root.append(div('god-why-sub', 'THE ARITHMETIC'));
  root.append(div('god-why-maths', partsLine(why.parts)));
  root.append(div('god-why-note', ex.note));
  root.append(button('CLOSE', onClose, 'brut tiny'));
  return root;
}

/* ============================================================
   the primer
   ============================================================ */

export class PrimerScreen {
  readonly root = div('screen hidden');
  private headerEl = div('primer-head');
  private railEl = div('primer-rail');
  private bodyEl = div('body primer-body');
  private actionsEl = div('actions');
  private sections: PrimerSection[] = [];
  private page = 0;
  private onClose: () => void = () => void 0;
  private onReplay: (() => void) | null = null;

  constructor() {
    this.root.id = 'primer-screen';
    this.root.append(this.headerEl, this.railEl, this.bodyEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(god: GodState | null, onClose: () => void, onReplay?: () => void): void {
    this.onClose = onClose;
    this.onReplay = onReplay ?? null;
    this.sections = primer(god);
    this.page = 0;
    clear(this.headerEl);
    this.headerEl.append(
      ScreenChrome({
        kicker: 'REFERENCE',
        title: 'THE PRIMER',
        subtitle: 'HOW THE LONG GAME WORKS',
      })
    );
    this.renderPage();
    show(this.root, true);
  }

  hide(): void {
    show(this.root, false);
  }

  private renderPage(): void {
    clear(this.bodyEl);
    clear(this.actionsEl);
    clear(this.railEl);

    const total = this.sections.length;
    const section = this.sections[this.page];
    if (!section) return;

    for (let i = 0; i < total; i++) {
      const seg = div(`primer-rail-seg${i === this.page ? ' is-active' : i < this.page ? ' is-done' : ''}`);
      seg.title = this.sections[i]?.title ?? '';
      this.railEl.append(seg);
    }

    this.bodyEl.append(div('primer-page-kicker', `${this.page + 1} / ${total}`));
    this.bodyEl.append(div('primer-title', section.title));
    section.lines.forEach((line, i) => {
      this.bodyEl.append(BeatReveal({ text: line, className: 'primer-line', delayMs: i * 280, variant: 'beat' }));
    });

    this.actionsEl.append(button('BACK', () => this.onClose()));
    if (this.page > 0) {
      this.actionsEl.append(
        button('PREVIOUS', () => {
          this.page -= 1;
          this.renderPage();
        }, 'brut tiny')
      );
    }
    if (this.page < total - 1) {
      this.actionsEl.append(
        button('NEXT', () => {
          this.page += 1;
          this.renderPage();
        }, 'brut tiny')
      );
    }
    if (this.onReplay) {
      this.actionsEl.append(button('WALK ME THROUGH IT AGAIN', () => this.onReplay!(), 'brut tiny'));
    }
  }
}
