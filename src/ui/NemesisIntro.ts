/**
 * Named-NPC arrival / death card. Staged: name first, then line, then
 * portrait. Strengths and weaknesses stay in the Book of Enemies.
 */

import { div, clear, show } from './Dom';
import type { IntroCardPayload } from '../nemesis/NemesisEncounterDirector';

export class NemesisIntro {
  readonly root = div('layer hidden');
  private card = div();
  private timer = 0;
  private lineEl: HTMLElement | null = null;
  private portraitEl: HTMLElement | null = null;
  private chipEl: HTMLElement | null = null;

  constructor() {
    this.card.id = 'intro-card';
    this.root.append(this.card);
    this.root.style.pointerEvents = 'none';
  }

  present(p: IntroCardPayload): void {
    clear(this.card);
    this.card.className = `intro-variant-${p.variant}`;
    this.card.style.setProperty('--accent', p.accent);

    if (p.portraitSrc) {
      const fig = div('iportrait hidden');
      const img = document.createElement('img');
      img.src = p.portraitSrc;
      img.alt = '';
      fig.append(img);
      this.card.append(fig);
      this.portraitEl = fig;
    } else {
      this.portraitEl = null;
    }

    const name = div('iname', p.name);
    name.style.color = p.accent;
    const title = div('ititle', p.title);
    const rank = div('irank', p.rank);
    if (p.headline) this.card.append(div('iheadline', p.headline));
    this.card.append(name, title, rank);

    const chip = div('ichip hidden', p.chip);
    this.card.append(chip);
    this.chipEl = chip;

    const dial = div('iline hidden', p.line ? `"${p.line}"` : '');
    this.card.append(dial);
    this.lineEl = dial;

    if (p.stole && p.variant === 'death') {
      this.card.append(div('istole', `STOLE  ${p.stole}`));
    }

    this.card.classList.remove('introFx');
    void this.card.offsetWidth;
    this.card.classList.add('introFx');

    show(this.root, true);
    this.timer = p.duration;
  }

  reveal(part: 'line' | 'portrait' | 'chip'): void {
    const el = part === 'line' ? this.lineEl : part === 'portrait' ? this.portraitEl : this.chipEl;
    if (el) el.classList.remove('hidden');
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.card.classList.add('fade-out');
      window.setTimeout(() => {
        show(this.root, false);
        this.card.classList.remove('fade-out');
      }, 500);
    }
  }

  /** True while the arrival card owns the centre of the screen. */
  get active(): boolean {
    return this.timer > 0;
  }

  hide(): void {
    this.timer = 0;
    show(this.root, false);
  }
}
