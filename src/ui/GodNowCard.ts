/**
 * Single-focus narrative card for THE LONG GAME oracle UI.
 */

import { button, clear, div } from './Dom';
import type { CrisisRunway } from '../god/Crisis';
import type { GodRun } from '../god/GodRun';
import { INTERVENTION_MAP } from '../god/Interventions';
import type { Beat, Situation } from '../god/GodTypes';
import { buildWhyPanel } from './GodTutorial';

export type NowMode = 'situation' | 'beat' | 'aftermath' | 'spectacle' | 'caption' | 'crisis';

export interface NowCardModel {
  mode: NowMode;
  kicker: string;
  headline: string;
  body?: string;
  beat?: Beat;
  situation?: Situation;
  crisisRunway?: CrisisRunway;
  tone?: 'neutral' | 'hot' | 'gold' | 'bad';
  showDismiss?: boolean;
  showInterfere?: boolean;
  caption?: string;
  /** Cause line shown during spectacle before the fight headline. */
  causeCaption?: string;
}

export class GodNowCard {
  readonly root = div('god-now');
  private kickerEl = div('god-now-kicker');
  private causeEl = div('god-now-cause hidden');
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
    this.root.append(this.kickerEl, this.causeEl, this.headEl, this.bodyEl, this.captionEl, this.actionsEl);
  }

  render(model: NowCardModel, run: GodRun): void {
    clear(this.actionsEl);
    this.root.classList.toggle('god-now-crisis', model.mode === 'crisis');
    this.kickerEl.textContent = model.kicker;
    if (model.causeCaption) {
      this.causeEl.textContent = model.causeCaption;
      this.causeEl.classList.remove('hidden');
    } else {
      this.causeEl.textContent = '';
      this.causeEl.classList.add('hidden');
    }
    this.headEl.textContent = model.headline;
    this.headEl.className = `god-now-head tone-${model.tone ?? 'neutral'}`;

    clear(this.bodyEl);
    if (model.body) this.bodyEl.append(div('god-now-line', model.body));
    if (model.mode === 'crisis' && model.crisisRunway) {
      const r = model.crisisRunway;
      this.bodyEl.append(div('god-now-line god-now-crisis-stat', `GROWS +${r.growthPerCycle} POWER EACH CYCLE IT IS LEFT ALONE.`));
      this.bodyEl.append(div('god-now-line god-now-crisis-hope', r.hopeLine));
      this.bodyEl.append(
        div(
          'god-now-line god-now-crisis-deadline',
          r.cyclesLeft <= 3 ? `${r.cyclesLeft} CYCLES LEFT — THE RUNWAY IS GONE.` : `${r.cyclesLeft} CYCLES LEFT TO FIND AN ANSWER.`
        )
      );
    }
    if (model.beat?.detail.length) {
      for (const line of model.beat.detail.slice(0, 3)) {
        this.bodyEl.append(div('god-now-line', line));
      }
    }
    if (model.situation && !model.body) {
      this.bodyEl.append(div('god-now-line', model.situation.detail));
    }
    if (model.situation?.suggest.length) {
      const hints = model.situation.suggest
        .map((id) => INTERVENTION_MAP.get(id)?.name ?? id.toUpperCase())
        .join(' · ');
      this.bodyEl.append(div('god-now-hints', `COULD NUDGE — ${hints}`));
    }
    const whySource = model.beat;
    if (whySource?.why) {
      const whyBtn = button('WHY', () => {
        this.whyBeat = this.whyBeat?.id === whySource.id ? null : whySource;
        this.onWhy?.();
        this.render(model, run);
      }, 'brut tiny');
      this.actionsEl.append(whyBtn);
      if (this.whyBeat?.id === whySource.id) {
        this.bodyEl.append(buildWhyPanel(whySource, () => {
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
