/**
 * Mode → UI data-mode and screen visibility coordination.
 */

export type UIMode =
  | 'title'
  | 'playing'
  | 'paused'
  | 'hierarchy'
  | 'report'
  | 'power'
  | 'dying'
  | 'choice'
  | 'build'
  | 'god'
  | 'legends'
  | 'godend';

export class UIOrchestrator {
  private _mode: UIMode = 'title';

  constructor(private uiRoot: HTMLElement) {}

  get mode(): UIMode {
    return this._mode;
  }

  setMode(mode: UIMode): void {
    this._mode = mode;
    this.syncDataset();
  }

  /** Keep #ui[data-mode] aligned with the logical mode for CSS layer rules. */
  syncDataset(): void {
    if (this.uiRoot.dataset.mode !== this._mode) {
      this.uiRoot.dataset.mode = this._mode;
    }
  }

  isPlayingFamily(): boolean {
    return this._mode === 'playing' || this._mode === 'dying';
  }

  isModalScreen(): boolean {
    return (
      this._mode === 'paused' ||
      this._mode === 'hierarchy' ||
      this._mode === 'power' ||
      this._mode === 'choice' ||
      this._mode === 'report' ||
      this._mode === 'build' ||
      this._mode === 'godend'
    );
  }
}
