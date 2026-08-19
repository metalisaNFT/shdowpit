/**
 * Power offer screen. Three cards, one choice, no going back.
 */

import { clear, div, show } from './Dom';
import type { PowerDef } from '../data/abilities';

export class PowerSelect {
  readonly root = div('screen hidden');
  private grid = div('power-grid');
  private subEl = document.createElement('h2');
  private handler: ((p: PowerDef) => void) | null = null;
  private current: PowerDef[] = [];

  constructor() {
    this.root.id = 'power-screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'TAKE ONE';
    h1.style.fontSize = '34px';
    this.subEl.textContent = 'IT LASTS UNTIL YOU DIE';
    const body = div('body');
    body.append(this.grid);
    this.root.append(h1, this.subEl, body);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(options: PowerDef[], subtitle: string, onPick: (p: PowerDef) => void, extra?: { reactions?: string; onReroll?: () => void; rerolls?: number }): void {
    this.handler = onPick;
    this.current = options;
    this.subEl.textContent = extra?.reactions ? `${subtitle}\n${extra.reactions}` : subtitle;
    clear(this.grid);
    options.forEach((p, i) => {
      const c = div('power-card');
      const tag = `${p.tag}${p.family ? ' · ' + p.family : ''}`;
      c.append(div('pname', p.name), div('ptag', tag), div('pdesc', p.desc), div('pkey', `PRESS ${i + 1}`));
      c.addEventListener('click', () => this.pick(p));
      this.grid.append(c);
    });
    if (extra?.onReroll && (extra.rerolls ?? 0) > 0) {
      const r = div('power-card');
      r.append(div('pname', 'REROLL'), div('ptag', 'REMNANT'), div('pdesc', `Spend a Remnant or reroll token. ${extra.rerolls} left.`), div('pkey', 'PRESS R'));
      r.addEventListener('click', () => extra.onReroll?.());
      this.grid.append(r);
    }
    show(this.root, true);
  }

  /** Number-key selection. */
  pickIndex(i: number): void {
    if (!this.visible) return;
    const p = this.current[i];
    if (p) this.pick(p);
  }

  private pick(p: PowerDef): void {
    const h = this.handler;
    this.handler = null;
    show(this.root, false);
    h?.(p);
  }

  hide(): void {
    this.handler = null;
    show(this.root, false);
  }
}
