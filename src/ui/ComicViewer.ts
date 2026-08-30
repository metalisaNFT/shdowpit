/**
 * Brutalist comic viewer — Dom UI, in-engine typography / SFX / motion.
 */

import { button, clear, div, show } from './Dom';
import type { ComicPanel, ComicSequence } from '../comic/Types';
import { enter, respectReducedMotion, stagger } from './motion';

export class ComicViewer {
  readonly root = div('layer hidden');
  private stage = div('comic-stage');
  private grid = div('comic-grid');
  private footer = div('comic-footer');
  private progress = div('comic-progress');
  private onClose: (() => void) | null = null;
  private panels: ComicPanel[] = [];
  private seq: ComicSequence | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private animRaf = 0;
  private t0 = 0;
  private activeIndex = 0;

  constructor() {
    this.root.id = 'comic-viewer';
    this.root.append(this.stage);
    this.stage.append(this.grid, this.footer);
    this.footer.append(this.progress);
    this.root.style.pointerEvents = 'auto';
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root && this.continueBtn && !this.continueBtn.disabled) this.hide();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Open shell — panels arrive via appendPanel while generating. */
  beginSequence(seq: ComicSequence, onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.seq = seq;
    this.panels = [];
    this.activeIndex = 0;
    clear(this.grid);
    clear(this.footer);
    clear(this.progress);

    const title = div('comic-title', `ENCOUNTER — ${seq.story.nemesisName.toUpperCase()}`);
    this.grid.append(title);
    enter(title, 'fade');

    this.footer.append(this.progress);
    this.continueBtn = button('CONTINUE', () => this.hide(), 'brut');
    this.continueBtn.disabled = true;
    this.footer.append(div('comic-meta', 'RENDERING…'), this.continueBtn);

    show(this.root, true);
    this.t0 = performance.now();
  }

  appendPanel(p: ComicPanel, seq: ComicSequence): void {
    if (this.seq !== seq) return;
    if (this.panels.some((x) => x.id === p.id)) return;
    this.panels.push(p);
    const cell = this.buildPanelEl(p);
    this.grid.append(cell);
    enter(cell, 'scale');
    this.syncProgress();
    this.kickAnim();
  }

  finalizeSequence(seq: ComicSequence): void {
    if (this.seq !== seq) return;
    if (this.continueBtn) this.continueBtn.disabled = false;
    const meta = this.footer.querySelector('.comic-meta');
    if (meta) {
      meta.textContent = `${seq.profileId.toUpperCase()} · ${seq.styleId} · ${seq.panels.filter((x) => x.usedAi).length} AI`;
    }
    this.syncProgress();
    this.kickAnim();
  }

  present(seq: ComicSequence, onClose?: () => void): void {
    this.beginSequence(seq, onClose);
    const cells: HTMLElement[] = [];
    for (const p of seq.panels) {
      this.panels.push(p);
      const cell = this.buildPanelEl(p);
      this.grid.append(cell);
      cells.push(cell);
    }
    stagger(cells, 80, 'scale');
    this.syncProgress();
    this.finalizeSequence(seq);
  }

  hide(): void {
    show(this.root, false);
    if (this.animRaf) cancelAnimationFrame(this.animRaf);
    this.animRaf = 0;
    this.seq = null;
    this.continueBtn = null;
    clear(this.progress);
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private buildPanelEl(p: ComicPanel): HTMLElement {
    const cell = div(`comic-panel role-${p.beat.role}`);
    cell.dataset.panelId = p.id;

    const frame = div('comic-frame');
    const img = document.createElement('img');
    img.className = 'comic-img';
    img.alt = p.beat.role;
    img.src = p.imageDataUrl || '';
    frame.append(img);

    if (p.captureDepth) {
      const depth = document.createElement('img');
      depth.className = 'comic-depth';
      depth.src = p.captureDepth;
      depth.alt = '';
      frame.append(depth);
    }

    const sfx = div('comic-sfx', p.beat.sfx);
    const narr = div('comic-narration', p.beat.narration);
    const speech = p.beat.speech ? div('comic-speech', `"${p.beat.speech}"`) : null;
    const tag = div('comic-tag', p.beat.role.toUpperCase());

    cell.append(frame, tag, sfx, narr);
    if (speech) cell.append(speech);
    return cell;
  }

  private syncProgress(): void {
    clear(this.progress);
    if (this.panels.length <= 1) return;
    this.progress.className = 'comic-progress';
    for (let i = 0; i < this.panels.length; i++) {
      const dot = div(`comic-progress-dot${i <= this.activeIndex ? ' on' : ''}`);
      this.progress.append(dot);
    }
  }

  private kickAnim(): void {
    if (this.animRaf) cancelAnimationFrame(this.animRaf);
    const reduced = respectReducedMotion();
    const step = (now: number) => {
      if (!this.visible) return;
      const t = (now - this.t0) / 1000;
      const cells = this.grid.querySelectorAll('.comic-panel');
      let active = 0;
      cells.forEach((node, i) => {
        const el = node as HTMLElement;
        const p = this.panels[i];
        if (!p) return;
        const local = Math.max(0, t - i * 0.18);
        if (local > 0) active = i;
        const shake = reduced ? 0 : p.anim.shake * Math.exp(-local * 3) * Math.sin(local * 55) * 6;
        const push = reduced ? 1 : 1 + p.anim.pushIn * Math.min(1, local * 2) * 0.04;
        const frame = el.querySelector('.comic-frame') as HTMLElement | null;
        const img = el.querySelector('.comic-img') as HTMLElement | null;
        if (frame) {
          frame.style.transform = reduced ? 'none' : `translate(${shake}px, ${-shake * 0.4}px) scale(${push})`;
        }
        if (img && !reduced) {
          const ken = 1 + Math.min(0.14, local * 0.06);
          const panX = Math.sin(local * 0.35 + i) * 2.5;
          const panY = Math.cos(local * 0.28 + i) * 1.8;
          img.style.transform = `scale(${ken}) translate(${panX}%, ${panY}%)`;
        }
        const depth = el.querySelector('.comic-depth') as HTMLElement | null;
        if (depth && !reduced) {
          const par = Math.sin(t * 1.2 + i) * p.anim.parallax * 4;
          depth.style.transform = `translate(${par}px, ${par * 0.5}px)`;
        }
        el.style.opacity = local > 0 || reduced ? '1' : '0';
        el.classList.toggle('is-active', i === active);
      });
      if (active !== this.activeIndex) {
        this.activeIndex = active;
        this.syncProgress();
      }
      this.animRaf = requestAnimationFrame(step);
    };
    this.animRaf = requestAnimationFrame(step);
  }
}
