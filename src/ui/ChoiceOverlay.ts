/**
 * Short choice overlay used for Vendetta commit, mercy, and Nemesis rewards.
 * Same brutalist cards as PowerSelect — no extra framework.
 */

import { clear, div, show } from './Dom';

export interface ChoiceCard {
  id: string;
  title: string;
  tag?: string;
  desc: string;
  disabled?: boolean;
}

export class ChoiceOverlay {
  readonly root = div('screen hidden');
  private grid = div('power-grid');
  private subEl = document.createElement('h2');
  private h1 = document.createElement('h1');
  private handler: ((id: string) => void) | null = null;
  private current: ChoiceCard[] = [];

  constructor() {
    this.root.id = 'choice-screen';
    this.h1.textContent = 'CHOOSE';
    this.h1.style.fontSize = '34px';
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
    cards.forEach((p, i) => {
      const c = div('power-card');
      if (p.disabled) c.style.opacity = '0.45';
      c.append(div('pname', p.title), div('ptag', p.tag ?? ''), div('pdesc', p.desc), div('pkey', `PRESS ${i + 1}`));
      c.addEventListener('click', () => {
        if (!p.disabled) this.pick(p.id);
      });
      this.grid.append(c);
    });
    show(this.root, true);
  }

  pickIndex(i: number): void {
    if (!this.visible) return;
    const p = this.current[i];
    if (p && !p.disabled) this.pick(p.id);
  }

  private pick(id: string): void {
    const h = this.handler;
    this.handler = null;
    show(this.root, false);
    h?.(id);
  }

  hide(): void {
    this.handler = null;
    show(this.root, false);
  }
}
