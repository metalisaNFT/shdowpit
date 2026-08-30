/**
 * Power offer screen. Three cards, one choice, no going back.
 */

import { clear, div, show } from './Dom';
import type { PowerDef } from '../data/abilities';
import { CardGrid, ChoiceCard } from './primitives';
import { enter } from './motion';
import { trapFocus, type FocusTrap } from './focusTrap';

export class PowerSelect {
  readonly root = div('screen hidden');
  private grid = CardGrid();
  private subEl = document.createElement('h2');
  private handler: ((p: PowerDef) => void) | null = null;
  private current: PowerDef[] = [];
  private focusTrap: FocusTrap | null = null;

  constructor() {
    this.root.id = 'power-screen';
    const h1 = document.createElement('h1');
    h1.className = 'screen-headline';
    h1.textContent = 'TAKE ONE';
    this.subEl.textContent = 'IT LASTS UNTIL YOU DIE';
    const body = div('body');
    body.append(this.grid);
    this.root.append(h1, this.subEl, body);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(options: PowerDef[], subtitle: string, onPick: (p: PowerDef) => void, extra?: { reactions?: string; onReroll?: () => void; rerolls?: number; layer?: string }): void {
    this.handler = onPick;
    this.current = options;
    const layer = extra?.layer ? `${extra.layer} · ` : '';
    this.subEl.textContent = extra?.reactions ? `${layer}${subtitle}\n${extra.reactions}` : `${layer}${subtitle}`;
    clear(this.grid);
    options.forEach((p, i) => {
      const tag = `${p.tag}${p.family ? ' · ' + p.family : ''}`;
      const delta = powerDelta(p);
      const card = ChoiceCard({
        title: p.name,
        tag,
        delta,
        description: p.desc,
        hint: `PRESS ${i + 1}`,
        onClick: () => this.pick(p, card),
      });
      enter(card, 'fade');
      this.grid.append(card);
    });
    if (extra?.onReroll && (extra.rerolls ?? 0) > 0) {
      const reroll = ChoiceCard({
        title: 'REROLL',
        tag: 'REMNANT',
        description: `Spend a Remnant or reroll token. ${extra.rerolls} left.`,
        hint: 'PRESS R',
        onClick: () => extra.onReroll?.(),
      });
      enter(reroll, 'fade');
      this.grid.append(reroll);
    }
    show(this.root, true);
    this.focusTrap?.release();
    this.focusTrap = trapFocus(this.root);
  }

  /** Number-key selection. */
  pickIndex(i: number): void {
    if (!this.visible) return;
    const p = this.current[i];
    if (p) {
      const card = this.grid.children[i] as HTMLElement | undefined;
      this.pick(p, card);
    }
  }

  private releaseFocus(): void {
    this.focusTrap?.release();
    this.focusTrap = null;
  }

  private pick(p: PowerDef, card?: HTMLElement): void {
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
    window.setTimeout(() => h?.(p), card ? 190 : 0);
  }

  hide(): void {
    this.handler = null;
    this.releaseFocus();
    show(this.root, false);
  }
}

function powerDelta(p: PowerDef): string | undefined {
  if (p.tag === 'STAT' || p.tag === 'RISK') return p.short;
  if (/[+\-↑↓]/.test(p.short)) return p.short;
  return undefined;
}
