/**
 * Single-focus narrative card for THE LONG GAME oracle UI.
 */

import { button, clear, div } from './Dom';
import type { GodRun } from '../god/GodRun';
import type { Beat, Situation } from '../god/GodTypes';
import { buildWhyPanel } from './GodTutorial';

export type NowMode = 'situation' | 'beat' | 'aftermath' | 'spectacle' | 'caption';

export interface NowCardModel {
  mode: NowMode;
  kicker: string;
  headline: string;
  body?: string;
  beat?: Beat;
  situation?: Situation;
  tone?: 'neutral' | 'hot' | 'gold' | 'bad';
  showDismiss?: boolean;
  showInterfere?: boolean;
  caption?: string;
}

export class GodNowCard {
  readonly root = div('god-now');
  private kickerEl = div('god-now-kicker');
  private headEl = div('god-now-head');
  private bodyEl = div('god-now-body');
  private captionEl = div('god-now-caption hidden');
  private actionsEl = div('god-now-actions');
  private whyBeat: Beat | null = null;

  onDismiss: (() => void) | null = null;
  onInterfere: (() => void) | null = null;
  onInspect: ((id: string) => void) | null = null;
  onWhy: (() => void) | null = null;

  constructor() {
    this.root.append(this.kickerEl, this.headEl, this.bodyEl, this.captionEl, this.actionsEl);
  }

  render(model: NowCardModel, run: GodRun): void {
    clear(this.actionsEl);
    this.kickerEl.textContent = model.kicker;
    this.headEl.textContent = model.headline;
    this.headEl.className = `god-now-head tone-${model.tone ?? 'neutral'}`;

    clear(this.bodyEl);
    if (model.body) this.bodyEl.append(div('god-now-line', model.body));
    if (model.beat?.detail.length) {
      for (const line of model.beat.detail.slice(0, 3)) {
        this.bodyEl.append(div('god-now-line', line));
      }
    }
    if (model.situation && !model.body) {
      this.bodyEl.append(div('god-now-line', model.situation.detail));
    }
    if (model.beat?.why) {
      const whyBtn = button('WHY', () => {
        this.whyBeat = this.whyBeat?.id === model.beat!.id ? null : model.beat!;
        this.onWhy?.();
        this.render(model, run);
      }, 'brut tiny');
      this.actionsEl.append(whyBtn);
      if (this.whyBeat?.id === model.beat.id) {
        this.bodyEl.append(buildWhyPanel(model.beat, () => {
          this.whyBeat = null;
          this.render(model, run);
        }));
      }
    }

    if (model.caption) {
      showCaption(this.captionEl, model.caption);
    } else {
      showCaption(this.captionEl, '');
    }

    if (model.showInterfere) {
      this.actionsEl.append(
        button('INTERFERE ▸', () => this.onInterfere?.(), 'brut')
      );
    }
    if (model.showDismiss) {
      this.actionsEl.append(
        button('CONTINUE ▸', () => this.onDismiss?.(), 'brut')
      );
    }
    if (model.situation) {
      this.actionsEl.append(
        button('LET TIME PASS ▸', () => this.onDismiss?.(), 'brut tiny')
      );
    }
  }

  appendAction(label: string, onClick: () => void, cls = 'brut'): void {
    this.actionsEl.append(button(label, onClick, cls));
  }

  setCaption(text: string): void {
    showCaption(this.captionEl, text);
  }
}

function showCaption(el: HTMLElement, text: string): void {
  if (!text) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = text;
}
