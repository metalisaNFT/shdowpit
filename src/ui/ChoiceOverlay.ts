/**
 * Short choice overlay used for Vendetta commit, mercy, and Nemesis rewards.
 * Same brutalist cards as PowerSelect — no extra framework.
 */

import { clear, div, show } from './Dom';
import { CardGrid, ChoiceCard as buildChoiceCard } from './primitives';
import { enter } from './motion';
import { trapFocus, type FocusTrap } from './focusTrap';

export interface ChoiceCard {
  id: string;
  title: string;
  tag?: string;
  desc: string;
  delta?: string;
  disabled?: boolean;
}

export class ChoiceOverlay {
  readonly root = div('screen hidden');
  private grid = CardGrid();
  private subEl = document.createElement('h2');
  private h1 = document.createElement('h1');
  private handler: ((id: string) => void) | null = null;
  private current: ChoiceCard[] = [];
  private focusTrap: FocusTrap | null = null;

  constructor() {
    this.root.id = 'choice-screen';
    this.h1.className = 'screen-headline';
    this.h1.textContent = 'CHOOSE';
    this.subEl.textContent = '';
    const body = div('body');
    body.append(this.grid);
    this.root.append(this.h1, this.subEl, body);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(title: string, subtitle: string, cards: ChoiceCard[], onPick: (id: string) => void): void {
    this.handler = onPick;
    this.current = cards;
    this.h1.textContent = title;
    this.subEl.textContent = subtitle;
    clear(this.grid);
    // Seven-option screens (THEIR FATE) must fit a 720p frame without the
    // last card clipping at the screen edge.
    this.grid.classList.toggle('dense', cards.length > 5);
    cards.forEach((p, i) => {
      const card = buildChoiceCard({
        title: p.title,
        tag: p.tag,
        delta: p.delta,
        description: p.desc,
        hint: `PRESS ${i + 1}`,
        disabled: p.disabled,
        onClick: () => this.pick(p.id, card),
      });
      enter(card, 'fade');
      this.grid.append(card);
    });
    show(this.root, true);
    this.focusTrap?.release();
    this.focusTrap = trapFocus(this.root);
  }

  pickIndex(i: number): void {
    if (!this.visible) return;
    const p = this.current[i];
    if (p && !p.disabled) {
      const card = this.grid.children[i] as HTMLElement | undefined;
      this.pick(p.id, card);
    }
  }

  private releaseFocus(): void {
    this.focusTrap?.release();
    this.focusTrap = null;
  }

  private pick(id: string, card?: HTMLElement): void {
    const h = this.handler;
    this.handler = null;
    if (card) {
      card.classList.add('choice-picked');
      this.releaseFocus();
      window.setTimeout(() => show(this.root, false), 180);
    } else {
      this.releaseFocus();
      show(this.root, false);
    }
    window.setTimeout(() => h?.(id), card ? 190 : 0);
  }

  hide(): void {
    this.handler = null;
    this.releaseFocus();
    show(this.root, false);
  }
}
