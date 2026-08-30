/**
 * Pause + settings.
 */

import { button, clear, div, el, show } from './Dom';
import { trapFocus, type FocusTrap } from './focusTrap';
import type { Settings } from '../core/SaveSystem';
import { AISettingsPanel, type AISettingsHooks } from './AISettingsPanel';
import type { SkillId } from '../data/skills';
import { TUTORIAL_COPY, TUTORIAL_DETAIL, TUTORIAL_ORDER } from '../core/Tutorial';

export interface PauseHandlers {
  onResume: () => void;
  onExtract: () => void;
  onQuit: () => void;
  onSettingsChanged: (s: Settings) => void;
  /** AI section; provided by Game so the panel never touches the service directly */
  ai: AISettingsHooks;
  /** current run stats for the RUN STATS page; absent outside a run */
  runStats?: () => Array<{ name: string; text: string; count: number }>;
  currencies?: { remnants: number; essence: number };
  onBuild?: () => void;
  skills?: {
    unlocked: string[];
    loadout: [string, string];
    ultimate: string;
    ultimates: Array<{ id: string; name: string; desc: string }>;
    descriptions: Array<{ id: string; name: string; desc: string }>;
    onEquip: (slot: 0 | 1, id: SkillId) => void;
    onEquipUltimate: (id: SkillId) => void;
  };
  onSkipTutorials?: () => void;
  onReplayTutorials?: () => void;
  telemetryOptIn?: boolean;
  onTelemetryOptInChanged?: (v: boolean) => void;
}

export type PauseOpenOpts = {
  /** Title-menu settings: same AI/hooks panel, no run actions. */
  asSettings?: boolean;
};

export class PauseScreen {
  readonly root = div('screen hidden');
  private body = div('body');
  private actions = div('actions');
  private heading = document.createElement('h1');
  private settings: Settings | null = null;
  private handlers: PauseHandlers | null = null;
  private aiPanel = new AISettingsPanel();
  private aiTicker = 0;
  private focusTrap: FocusTrap | null = null;

  constructor() {
    this.root.id = 'pause-screen';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.heading.className = 'screen-headline';
    this.heading.textContent = 'PAUSED';
    this.root.append(this.heading, this.body, this.actions);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(settings: Settings, handlers: PauseHandlers, canExtract: boolean, opts?: PauseOpenOpts): void {
    this.settings = settings;
    this.handlers = handlers;
    const asSettings = !!opts?.asSettings;
    this.heading.textContent = asSettings ? 'SETTINGS' : 'PAUSED';
    clear(this.body);
    clear(this.actions);
    const reopen = () => this.open(settings, handlers, canExtract, opts);

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
      }),
      this.toggle('REDUCED MOTION', settings.reducedMotion, (v) => {
        settings.reducedMotion = v;
        handlers.onSettingsChanged(settings);
      }),
      this.toggle('REDUCED FLASH', settings.reducedFlash, (v) => {
        settings.reducedFlash = v;
        handlers.onSettingsChanged(settings);
      }),
      this.slider('HUD SCALE', settings.hudScale ?? 1, 0.85, 1.15, (v) => {
        settings.hudScale = v;
        handlers.onSettingsChanged(settings);
      }),
      this.toggle('PURPOSE PANEL', settings.showPurpose !== false, (v) => {
        settings.showPurpose = v;
        handlers.onSettingsChanged(settings);
      }),
      ...(handlers.onTelemetryOptInChanged
        ? [
            this.toggle('TELEMETRY RECORDING', handlers.telemetryOptIn ?? false, (v) => {
              handlers.onTelemetryOptInChanged?.(v);
            }),
          ]
        : [])
    );
    this.body.append(panel);

    if (!asSettings) {
      const controls = div('detail');
      controls.append(el('h3', undefined, 'CONTROLS'));
      for (const [k, v] of [
        ['LMB', 'LIGHT'],
        ['RMB', 'HEAVY'],
        ['SPACE', 'DODGE'],
        ['Q', 'PARRY'],
        ['R / MMB', 'VOID NEEDLE'],
        ['1 / C', 'SKILL 1'],
        ['2 / V', 'SKILL 2'],
        ['3 / G', 'ULTIMATE'],
        ['E', 'EXECUTE'],
        ['F', 'LOCK-ON'],
      ] as Array<[string, string]>) {
        const row = div('stat-row');
        row.append(div('sname', k), div('sval', v));
        controls.append(row);
      }
      this.body.append(controls);
    }

    if (handlers.onSkipTutorials || handlers.onReplayTutorials) {
      const help = div('detail');
      help.append(el('h3', undefined, 'TEACHING'));
      if (handlers.onSkipTutorials) help.append(button('SKIP TUTORIALS', () => handlers.onSkipTutorials?.()));
      if (handlers.onReplayTutorials) help.append(button('REPLAY TUTORIALS', () => handlers.onReplayTutorials?.()));
      help.append(div('sval', 'Skip covers both combat and THE LONG GAME. Combat shows one instruction. The board teaches the loop, then WHY.'));
      for (const id of TUTORIAL_ORDER) {
        const copy = TUTORIAL_COPY[id];
        const row = div('teach-row');
        row.append(div('sname', copy.title), div('sval', `${copy.glyphs}  —  ${TUTORIAL_DETAIL[id]}`));
        help.append(row);
      }
      this.body.append(help);
    }

    if (handlers.skills) {
      const sk = handlers.skills;
      const kit = div('detail');
      kit.append(el('h3', undefined, 'SKILL LOADOUT'));
      kit.append(el('h3', undefined, 'ULTIMATE'));
      for (const d of sk.ultimates ?? []) {
        const on = sk.ultimate === d.id;
        const b = button(`${on ? '● ' : '○ '}${d.name}`, () => {
          sk.onEquipUltimate(d.id as SkillId);
          reopen();
        });
        b.style.width = '100%';
        b.style.margin = '4px 0';
        kit.append(b);
        kit.append(div('sval', d.desc));
      }
      kit.append(el('h3', undefined, 'ACTIVE SKILLS'));
      for (const slot of [0, 1] as const) {
        kit.append(el('h3', undefined, slot === 0 ? 'SKILL 1' : 'SKILL 2'));
        for (const d of sk.descriptions) {
          const on = sk.loadout[slot] === d.id;
          const b = button(`${on ? '● ' : '○ '}${d.name}`, () => {
            sk.onEquip(slot, d.id as SkillId);
            reopen();
          });
          b.style.width = '100%';
          b.style.margin = '4px 0';
          kit.append(b);
          kit.append(div('sval', d.desc));
        }
      }
      this.body.append(kit);
    }

    /* ---- RUN STATS — the build, in numbers ---- */
    if (handlers.runStats && canExtract) {
      const statsPanel = div('detail');
      statsPanel.style.minWidth = '300px';
      statsPanel.append(el('h3', undefined, 'RUN STATS'));
      if (handlers.currencies) {
        statsPanel.append(
          div(
            'sval',
            `REMNANTS  ${handlers.currencies.remnants}  (this run)    ESSENCE  ${handlers.currencies.essence}  (kept)`
          )
        );
      }
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

    if (asSettings) {
      this.actions.append(button('CLOSE  [ESC]', handlers.onResume));
    } else {
      this.actions.append(button('RESUME  [ESC]', handlers.onResume));
      if (handlers.onBuild) this.actions.append(button('BUILD / LOADOUT', handlers.onBuild));
      if (canExtract) {
        const b = button('ABANDON RUN — BANK ESSENCE, WORLD STILL', handlers.onExtract);
        b.classList.add('danger');
        this.actions.append(b);
      }
      this.actions.append(button('QUIT TO TITLE', handlers.onQuit));
    }
    show(this.root, true);
    this.focusTrap?.release();
    this.focusTrap = trapFocus(this.root);
  }

  close(): void {
    window.clearInterval(this.aiTicker);
    this.focusTrap?.release();
    this.focusTrap = null;
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
    });
    input.addEventListener('change', () => {
      onChange(parseFloat(input.value));
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
