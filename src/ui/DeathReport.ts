/**
 * "WHILE YOU WERE DEAD" / run recap.
 *
 * Simulation has already finished before this screen opens. Presentation
 * never writes world state. Skip jumps to Continue.
 */

import { button, clear, div, show, esc } from './Dom';
import type { WorldEvent } from '../world/WorldEvent';
import type { RecapBeat } from '../story/StoryTypes';
import { recapPlainText } from '../story/StoryRecap';

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
  recap?: RecapBeat[];
  reducedMotion?: boolean;
  reducedFlash?: boolean;
  /** highlight these nemesis names in the text */
  highlight?: string[];
  buttonLabel: string;
  onContinue: () => void;
  extras?: Array<{ label: string; onClick: () => void }>;
  spotlight?: ReportSpotlight;
  recapLineFor?: (b: RecapBeat) => string;
}

export class DeathReport {
  readonly root = div('screen hidden');
  private titleEl = document.createElement('h1');
  private subEl = document.createElement('h2');
  private bodyEl = div('body');
  private actionsEl = div('actions');
  private sr = div('sr-only');
  private timers: number[] = [];
  private recapBeats: RecapBeat[] = [];

  constructor() {
    this.root.id = 'death-screen';
    this.sr.setAttribute('aria-live', 'polite');
    this.root.append(this.titleEl, this.subEl, this.sr, this.bodyEl, this.actionsEl);
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
    this.root.classList.toggle('reduced-motion', !!opts.reducedMotion);
    this.root.classList.toggle('reduced-flash', !!opts.reducedFlash);

    if (opts.spotlight) {
      const s = opts.spotlight;
      const spot = div('killer-spot');
      if (s.portrait) {
        const img = document.createElement('img');
        img.src = s.portrait;
        img.alt = s.name;
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

    const recap = opts.recap ?? [];
    this.recapBeats = recap;
    this.sr.textContent = recap.length
      ? recapPlainText(recap)
      : opts.events.map((e) => e.text).join('. ');

    if (recap.length) {
      const acts: RecapBeat['act'][] = ['opening', 'rising', 'turn', 'end', 'consequence'];
      for (const act of acts) {
        const group = recap.filter((b) => b.act === act);
        if (!group.length) continue;
        this.bodyEl.append(div('tier-label', act.replace('_', ' ').toUpperCase()));
        group.forEach((b, i) => {
          const card = div(`recap-card vfx-${b.vfx}`);
          if (!opts.reducedMotion) card.style.animationDelay = `${i * 0.12}s`;
          else card.style.animation = 'none';
          card.append(div('recap-h', b.headline));
          card.append(div('recap-l', opts.recapLineFor ? opts.recapLineFor(b) : b.line));
          if (b.detail) card.append(div('recap-d', b.detail));
          this.bodyEl.append(card);
        });
      }
    } else {
      const highlight = new Set((opts.highlight ?? []).map((h) => h.toUpperCase()));
      const lines = opts.events.length
        ? opts.events.slice(0, 4)
        : [
            {
              turn: 0,
              age: 0,
              type: 'death' as const,
              text: 'NOTHING HAPPENED. THE WORLD DID NOT NOTICE.',
              actors: [] as string[],
              important: false,
              tone: 'neutral' as const,
            },
          ];
      this.bodyEl.append(div('tier-label', 'THE WORLD'));
      lines.forEach((ev, i) => {
        const line = div('report-line');
        if (opts.reducedMotion) {
          line.style.animation = 'none';
          line.style.opacity = '1';
        } else {
          line.style.animationDelay = `${Math.min(i, 12) * 0.08}s`;
        }
        let text = esc(ev.text);
        for (const h of highlight) {
          if (!h) continue;
          text = text.replace(new RegExp(`\\b${escapeRegExp(h)}\\b`, 'g'), `<span class="who">${h}</span>`);
        }
        const toneClass = ev.tone === 'bad' ? 'bad' : ev.tone === 'good' ? 'ok' : ev.tone === 'gold' ? 'who' : '';
        const seen = ev.witnessed ? 'SAW' : 'WHILE GONE';
        const turnTag = `<span class="turn">T${ev.turn} ${seen}</span>`;
        line.innerHTML = toneClass ? `${turnTag}<span class="${toneClass}">${text}</span>` : `${turnTag}${text}`;
        this.bodyEl.append(line);
      });
    }

    const finish = () => {
      this.cancelTimers();
      clear(this.actionsEl);
      for (const x of opts.extras ?? []) this.actionsEl.append(button(x.label, x.onClick));
      this.actionsEl.append(button(opts.buttonLabel, opts.onContinue));
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    };

    this.actionsEl.append(button('SKIP', finish));
    const revealAt = opts.reducedMotion ? 0 : Math.min(2800, (opts.recap?.length ?? 4) * 700 + 400);
    this.timers.push(window.setTimeout(finish, revealAt));

    show(this.root, true);
  }

  /** Patch AI-generated recap lines without rebuilding the whole screen. */
  patchRecap(recapLineFor: (b: RecapBeat) => string): void {
    if (!this.recapBeats.length) return;
    const lines = this.bodyEl.querySelectorAll<HTMLElement>('.recap-l');
    let i = 0;
    for (const b of this.recapBeats) {
      const el = lines[i++];
      if (!el) break;
      el.textContent = recapLineFor(b);
    }
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
