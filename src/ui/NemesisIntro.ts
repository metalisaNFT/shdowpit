/**
 * Named-NPC arrival / death card. Staged: name first, then line, then
 * portrait. Strengths and weaknesses stay in the Book of Enemies.
 */

import { div, clear, show } from './Dom';
import { enter, stagger, respectReducedMotion } from './motion';
import type { IntroCardPayload } from '../nemesis/NemesisEncounterDirector';

export class NemesisIntro {
  readonly root = div('layer hidden');
  private card = div();
  private timer = 0;
  private fadeTimer = 0;
  private lineEl: HTMLElement | null = null;
  private portraitEl: HTMLElement | null = null;
  private chipEl: HTMLElement | null = null;
  private typewriterTimer = 0;
  private typewriterFull = '';
  private typewriterIdx = 0;

  constructor() {
    this.card.id = 'intro-card';
    this.root.append(this.card);
    this.root.style.pointerEvents = 'none';
  }

  present(p: IntroCardPayload): void {
    if (this.fadeTimer) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = 0;
    }
    this.clearTypewriter();
    clear(this.card);
    this.card.className = `intro-variant-${p.variant}`;
    this.card.style.setProperty('--accent', p.accent);
    this.card.style.setProperty('--enter-ms', `${Math.round(p.duration * 180)}ms`);

    if (p.portraitSrc) {
      const fig = div('iportrait hidden');
      const img = document.createElement('img');
      img.src = p.portraitSrc;
      img.alt = '';
      fig.append(img);
      this.card.append(fig);
      this.portraitEl = fig;
    } else {
      const glyph = div('iglyph hidden', archetypeGlyph(p.rank));
      glyph.style.color = p.accent;
      this.card.append(glyph);
      this.portraitEl = glyph;
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

    const dial = div('iline hidden');
    this.card.append(dial);
    this.lineEl = dial;
    this.typewriterFull = p.line ? `"${p.line}"` : '';

    if (p.stole && p.variant === 'death') {
      this.card.append(div('istole', `STOLE  ${p.stole}`));
    }

    this.card.classList.remove('introFx', 'intro-enter');
    void this.card.offsetWidth;
    this.card.classList.add('introFx', 'intro-enter');

    const staged = [name, title, rank].filter(Boolean) as HTMLElement[];
    stagger(staged, 70, 'slide-up');
    enter(this.card, 'scale');

    show(this.root, true);
    this.timer = p.duration;
  }

  reveal(part: 'line' | 'portrait' | 'chip'): void {
    const el = part === 'line' ? this.lineEl : part === 'portrait' ? this.portraitEl : this.chipEl;
    if (!el) return;
    el.classList.remove('hidden');
    if (part === 'line' && this.lineEl && this.typewriterFull) {
      this.startTypewriter();
    } else {
      enter(el, part === 'portrait' ? 'scale' : 'fade');
    }
  }

  update(dt: number): void {
    if (this.typewriterTimer > 0) {
      this.typewriterTimer -= dt;
      while (this.typewriterTimer <= 0 && this.typewriterIdx < this.typewriterFull.length) {
        this.typewriterIdx++;
        if (this.lineEl) this.lineEl.textContent = this.typewriterFull.slice(0, this.typewriterIdx);
        this.typewriterTimer += respectReducedMotion() ? 0 : 0.028;
      }
    }

    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.card.classList.add('fade-out', 'intro-exit');
      this.fadeTimer = window.setTimeout(() => {
        this.fadeTimer = 0;
        show(this.root, false);
        this.card.classList.remove('fade-out', 'intro-exit', 'intro-enter');
        this.clearTypewriter();
      }, 500);
    }
  }

  /** True while the arrival card owns the centre of the screen. */
  get active(): boolean {
    return this.timer > 0;
  }

  hide(): void {
    this.timer = 0;
    if (this.fadeTimer) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = 0;
    }
    this.clearTypewriter();
    show(this.root, false);
  }

  private startTypewriter(): void {
    if (!this.lineEl || !this.typewriterFull) return;
    this.typewriterIdx = 0;
    this.lineEl.textContent = '';
    this.lineEl.classList.add('typing');
    this.typewriterTimer = respectReducedMotion() ? 0 : 0.12;
    if (respectReducedMotion()) {
      this.lineEl.textContent = this.typewriterFull;
      this.typewriterIdx = this.typewriterFull.length;
    }
  }

  private clearTypewriter(): void {
    this.typewriterTimer = 0;
    this.typewriterFull = '';
    this.typewriterIdx = 0;
    if (this.lineEl) this.lineEl.classList.remove('typing');
  }
}

function archetypeGlyph(rank: string): string {
  if (rank.includes('OVERLORD')) return '◆';
  if (rank.includes('WARLORD')) return '★';
  if (rank.includes('CAPTAIN')) return '▣';
  if (rank.includes('ELITE')) return '◇';
  return '▽';
}
