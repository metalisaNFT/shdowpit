import { button, clear, div, show } from '../Dom';

export interface DrawerOptions {
  title: string;
  className?: string;
  side?: 'left' | 'right';
  closeLabel?: string;
}

/** Slide-in panel with backdrop — shared by god feed / inspect drawers. */
export class Drawer {
  readonly root: HTMLDivElement;
  readonly backdrop: HTMLDivElement;
  private headEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private _open = false;
  onClose: (() => void) | null = null;

  constructor(opts: DrawerOptions) {
    const side = opts.side ?? 'right';
    this.backdrop = div('drawer-backdrop hidden');
    this.backdrop.addEventListener('click', () => this.close());

    this.root = div(`drawer drawer-${side}${opts.className ? ' ' + opts.className : ''} hidden`);
    this.headEl = div('drawer-head');
    this.headEl.append(div('drawer-title', opts.title));
    this.headEl.append(
      button(opts.closeLabel ?? 'CLOSE', () => this.close(), 'brut tiny')
    );
    this.bodyEl = div('drawer-body');
    this.root.append(this.headEl, this.bodyEl);
  }

  get body(): HTMLDivElement {
    return this.bodyEl;
  }

  isOpen(): boolean {
    return this._open;
  }

  mount(...parents: HTMLElement[]): void {
    for (const p of parents) p.append(this.backdrop, this.root);
  }

  open(): void {
    this._open = true;
    show(this.backdrop, true);
    show(this.root, true);
    this.root.classList.add('drawer-open');
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.root.classList.remove('drawer-open');
    show(this.backdrop, false);
    show(this.root, false);
    this.onClose?.();
  }

  toggle(): void {
    if (this._open) this.close();
    else this.open();
  }

  clear(): void {
    clear(this.bodyEl);
  }
}
