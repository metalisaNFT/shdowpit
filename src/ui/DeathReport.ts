/**
 * "WHILE YOU WERE DEAD".
 *
 * This screen is one of the central experiences of the game, so it gets the
 * theatrical treatment: lines land one at a time, the important ones are
 * coloured, and the button only appears once the world has finished talking.
 */

import { button, clear, div, show, esc } from './Dom';
import type { WorldEvent } from '../world/WorldEvent';

export interface ReportSpotlight {
  portrait: string;
  name: string;
  title: string;
  line: string;
  stole?: string;
  rankFrom?: string;
  rankTo?: string;
}

export interface ReportOptions {
  title: string;
  subtitle: string;
  events: WorldEvent[];
  /** highlight these nemesis names in the text */
  highlight?: string[];
  buttonLabel: string;
  onContinue: () => void;
  /** extra buttons, e.g. "VIEW HIERARCHY" */
  extras?: Array<{ label: string; onClick: () => void }>;
  spotlight?: ReportSpotlight;
}

export class DeathReport {
  readonly root = div('screen hidden');
  private titleEl = document.createElement('h1');
  private subEl = document.createElement('h2');
  private bodyEl = div('body');
  private actionsEl = div('actions');
  private timers: number[] = [];

  constructor() {
    this.root.id = 'death-screen';
    this.root.append(this.titleEl, this.subEl, this.bodyEl, this.actionsEl);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  present(opts: ReportOptions): void {
    this.cancelTimers();
    clear(this.bodyEl);
    clear(this.actionsEl);
    this.titleEl.textContent = opts.title;
    this.subEl.textContent = opts.subtitle;

    if (opts.spotlight) {
      const s = opts.spotlight;
      const spot = div('killer-spot');
      if (s.portrait) {
        const img = document.createElement('img');
        img.src = s.portrait;
        img.alt = '';
        img.className = 'killer-portrait';
        spot.append(img);
      }
      const who = div('killer-who', s.name);
      const title = div('killer-title', s.title);
      spot.append(who, title);
      if (s.line) spot.append(div('killer-line', `"${s.line}"`));
      if (s.stole) spot.append(div('killer-stole', `STOLE  ${s.stole}`));
      if (s.rankFrom && s.rankTo && s.rankFrom !== s.rankTo) {
        spot.append(div('killer-rank', `${s.rankFrom}  →  ${s.rankTo}`));
      }
      this.bodyEl.append(spot);
    }

    const highlight = new Set((opts.highlight ?? []).map((h) => h.toUpperCase()));

    const lines = opts.events.length
      ? opts.events
      : [
          {
            turn: 0,
            age: 0,
            type: 'death' as const,
            text: 'NOTHING HAPPENED. THE WORLD DID NOT NOTICE.',
            actors: [],
            important: false,
            tone: 'neutral' as const,
          },
        ];

    lines.forEach((ev, i) => {
      const line = div('report-line');
      line.style.animationDelay = `${i * 0.11}s`;
      let text = esc(ev.text);
      for (const h of highlight) {
        if (!h) continue;
        text = text.replace(new RegExp(`\\b${escapeRegExp(h)}\\b`, 'g'), `<span class="who">${h}</span>`);
      }
      const toneClass = ev.tone === 'bad' ? 'bad' : ev.tone === 'good' ? 'ok' : ev.tone === 'gold' ? 'who' : '';
      const turnTag = `<span class="turn">T${ev.turn}</span>`;
      line.innerHTML = toneClass ? `${turnTag}<span class="${toneClass}">${text}</span>` : `${turnTag}${text}`;
      if (ev.important) line.style.fontSize = '16px';
      this.bodyEl.append(line);
    });

    const revealAt = Math.min(2600, lines.length * 110 + 500);
    this.timers.push(
      window.setTimeout(() => {
        for (const x of opts.extras ?? []) this.actionsEl.append(button(x.label, x.onClick));
        this.actionsEl.append(button(opts.buttonLabel, opts.onContinue));
        this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
      }, revealAt)
    );

    show(this.root, true);
  }

  hide(): void {
    this.cancelTimers();
    show(this.root, false);
  }

  private cancelTimers(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
