/**
 * Pause + settings.
 */

import { button, clear, div, el, show } from './Dom';
import type { Settings } from '../core/SaveSystem';
import { AISettingsPanel, type AISettingsHooks } from './AISettingsPanel';

export interface PauseHandlers {
  onResume: () => void;
  onExtract: () => void;
  onQuit: () => void;
  onSettingsChanged: (s: Settings) => void;
  /** AI section; provided by Game so the panel never touches the service directly */
  ai: AISettingsHooks;
  /** current run stats for the RUN STATS page; absent outside a run */
  runStats?: () => Array<{ name: string; text: string; count: number }>;
}

export class PauseScreen {
  readonly root = div('screen hidden');
  private body = div('body');
  private actions = div('actions');
  private settings: Settings | null = null;
  private handlers: PauseHandlers | null = null;
  private aiPanel = new AISettingsPanel();
  private aiTicker = 0;

  constructor() {
    this.root.id = 'pause-screen';
    const h1 = document.createElement('h1');
    h1.textContent = 'PAUSED';
    h1.style.fontSize = '34px';
    this.root.append(h1, this.body, this.actions);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(settings: Settings, handlers: PauseHandlers, canExtract: boolean): void {
    this.settings = settings;
    this.handlers = handlers;
    clear(this.body);
    clear(this.actions);

    const panel = div('detail');
    panel.style.minWidth = '460px';
    panel.append(
      this.cycle('RENDER QUALITY', ['high', 'medium', 'low'], settings.quality, (v) => {
        settings.quality = v as Settings['quality'];
        settings.autoQuality = false;
        handlers.onSettingsChanged(settings);
      }),
      this.slider('MASTER VOLUME', settings.masterVolume, 0, 1, (v) => {
        settings.masterVolume = v;
        handlers.onSettingsChanged(settings);
      }),
      this.slider('MOUSE SENSITIVITY', settings.mouseSensitivity, 0.2, 3, (v) => {
        settings.mouseSensitivity = v;
        handlers.onSettingsChanged(settings);
      }),
      this.slider('CAMERA SHAKE', settings.cameraShake, 0, 1.5, (v) => {
        settings.cameraShake = v;
        handlers.onSettingsChanged(settings);
      }),
      this.toggle('INVERT Y', settings.invertY, (v) => {
        settings.invertY = v;
        handlers.onSettingsChanged(settings);
      }),
      this.toggle('MINIMAP', settings.showMinimap, (v) => {
        settings.showMinimap = v;
        handlers.onSettingsChanged(settings);
      }),
      this.toggle('SOFT LOCK-ON', settings.softLockOn, (v) => {
        settings.softLockOn = v;
        handlers.onSettingsChanged(settings);
      })
    );
    this.body.append(panel);

    /* ---- RUN STATS — the build, in numbers ---- */
    if (handlers.runStats && canExtract) {
      const statsPanel = div('detail');
      statsPanel.style.minWidth = '300px';
      statsPanel.append(el('h3', undefined, 'RUN STATS'));
      const grid = div('run-stats');
      for (const s of handlers.runStats()) {
        const row = div('stat-row' + (s.count > 0 ? ' boosted' : ''));
        row.append(div('sname', s.name), div('sval', s.text + (s.count > 0 ? ` +${s.count}` : '')));
        grid.append(row);
      }
      statsPanel.append(grid);
      this.body.append(statsPanel);
    }

    this.aiPanel.mount(handlers.ai);
    this.aiPanel.root.style.minWidth = '460px';
    this.body.append(this.aiPanel.root);
    // Poll rather than subscribe: the panel is short-lived and this keeps the
    // AI service free of UI listeners it would have to clean up.
    window.clearInterval(this.aiTicker);
    this.aiTicker = window.setInterval(() => {
      if (this.visible) this.aiPanel.refresh();
      else window.clearInterval(this.aiTicker);
    }, 250);

    this.actions.append(button('RESUME  [ESC]', handlers.onResume));
    if (canExtract) {
      const b = button('EXTRACT — END RUN, KEEP NOTHING', handlers.onExtract);
      b.classList.add('danger');
      this.actions.append(b);
    }
    this.actions.append(button('QUIT TO TITLE', handlers.onQuit));
    show(this.root, true);
  }

  close(): void {
    window.clearInterval(this.aiTicker);
    show(this.root, false);
  }

  /** Scroll the AI block into view — used by the `AI ●` indicator click. */
  focusAI(): void {
    this.aiPanel.root.scrollIntoView({ block: 'center' });
  }

  private slider(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
    const wrap = div();
    wrap.style.margin = '10px 0';
    const l = div(undefined, `${label}  —  ${Math.round(value * 100) / 100}`);
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '0.05';
    input.value = String(value);
    input.style.width = '100%';
    input.style.pointerEvents = 'auto';
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      l.textContent = `${label}  —  ${Math.round(v * 100) / 100}`;
      onChange(v);
    });
    wrap.append(l, input);
    return wrap;
  }

  private cycle(label: string, options: string[], value: string, onChange: (v: string) => void): HTMLElement {
    let i = Math.max(0, options.indexOf(value));
    const b = button(`${label}: ${options[i].toUpperCase()}`, () => {
      i = (i + 1) % options.length;
      b.textContent = `${label}: ${options[i].toUpperCase()}`;
      onChange(options[i]);
    });
    b.style.margin = '4px 0';
    b.style.width = '100%';
    return b;
  }

  private toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const b = button(`${label}: ${value ? 'ON' : 'OFF'}`, () => {
      value = !value;
      b.textContent = `${label}: ${value ? 'ON' : 'OFF'}`;
      onChange(value);
    });
    b.style.margin = '4px 0';
    b.style.width = '100%';
    return b;
  }

  get currentSettings(): Settings | null {
    return this.settings;
  }

  get currentHandlers(): PauseHandlers | null {
    return this.handlers;
  }
}
