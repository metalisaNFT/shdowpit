/**
 * The AI section of the settings menu.
 *
 * SECURITY BEHAVIOUR — this is the only place a key is ever typed:
 *   - the input is `type=password`, `autocomplete=off`, and is cleared the
 *     moment CONNECT succeeds
 *   - the key is passed straight to the backend and never held in a field,
 *     a closure, localStorage, the save, or a log line
 *   - the panel only ever renders `API KEY: CONNECTED`, never the key, its
 *     length, or a prefix
 *   - the eye button reveals what the user is currently typing, and auto-hides
 *     after a few seconds so it cannot be left on screen
 */

import { button, clear, div, el, show } from './Dom';
import type { AIMode, AIProviderMode, AISettings, LocalAIStatus } from '../ai/AITypes';

export interface AISettingsHooks {
  getSettings(): AISettings;
  setSettings(s: AISettings): void;
  status(): { connected: boolean; verified: boolean; error: string; backendReachable: boolean };
  connect(key: string): Promise<{ ok: boolean; error: string }>;
  disconnect(): Promise<void>;
  test(): Promise<{ ok: boolean; error: string; latencyMs: number }>;
  /** live one-line summary: "Idle", "Generating portrait", ... */
  activity(): string;
  /** can generation succeed under the current provider mode? */
  textAvailable(): boolean;
  /* ---- LOCAL AI ENGINE ---- */
  localStatus(): Promise<LocalAIStatus | null>;
  localInstall(): Promise<void>;
  localStart(): Promise<void>;
  localStop(): Promise<void>;
  localRestart(): Promise<void>;
  localRemove(purgeModels: boolean): Promise<void>;
  localOpenFolder(): Promise<void>;
}

const MODES: AIMode[] = ['off', 'text', 'full'];
const MODE_LABEL: Record<AIMode, string> = {
  off: 'OFF',
  text: 'TEXT ONLY',
  full: 'FULL',
};

const PROVIDERS: AIProviderMode[] = ['openai', 'local', 'auto'];
const PROVIDER_LABEL: Record<AIProviderMode, string> = {
  openai: 'OPENAI',
  local: 'LOCAL',
  auto: 'AUTO',
};

export class AISettingsPanel {
  readonly root = div('detail ai-settings');

  private hooks: AISettingsHooks | null = null;
  private keyInput = el('input');
  private revealBtn = el('button');
  private connLine = div('ai-conn');
  private msgLine = div('ai-msg ai-msg-main');
  private activityLine = div('ai-activity');
  private setupNotice = div('ai-setup hidden');
  private revealTimer = 0;
  private busy = false;

  /* ---- local engine ---- */
  private localBox = div('ai-local');
  private lastLocal: LocalAIStatus | null = null;
  private localPollAccum = 99;
  private localPolling = false;
  private localBusy = false;

  constructor() {
    this.keyInput.type = 'password';
    this.keyInput.placeholder = 'sk-...';
    this.keyInput.autocomplete = 'off';
    this.keyInput.spellcheck = false;
    this.keyInput.className = 'ai-key';
    this.keyInput.style.pointerEvents = 'auto';
    // Belt and braces: a stray form submit must not put a key in a URL.
    this.keyInput.setAttribute('name', 'shdowpit-ephemeral');
  }

  mount(hooks: AISettingsHooks): void {
    this.hooks = hooks;
    this.render();
  }

  /** Called on a timer while the settings screen is open. */
  refresh(): void {
    if (!this.hooks) return;
    this.renderConnection();
    this.activityLine.textContent = this.hooks.activity();
    if (this.revealTimer > 0) {
      this.revealTimer -= 0.25;
      if (this.revealTimer <= 0) this.setRevealed(false);
    }
    // Local engine status: poll ~1s (faster while installing, for the bars).
    this.localPollAccum += 0.25;
    const interval = this.lastLocal?.progress?.state === 'installing' ? 0.5 : 1.25;
    if (this.localPollAccum >= interval && !this.localPolling) {
      this.localPollAccum = 0;
      this.localPolling = true;
      void this.hooks
        .localStatus()
        .then((s) => {
          if (s) {
            this.lastLocal = s;
            this.renderLocal();
          }
        })
        .finally(() => {
          this.localPolling = false;
        });
    }
  }

  private render(): void {
    const h = this.hooks;
    if (!h) return;
    clear(this.root);
    const s = h.getSettings();

    /* ---- mode ---- */
    this.root.append(div('ai-h', 'AI CONTENT'));
    const modeRow = div('ai-row');
    for (const m of MODES) {
      const b = button(
        MODE_LABEL[m],
        () => {
          const next = { ...h.getSettings(), mode: m };
          h.setSettings(next);
          this.render();
        },
        `ai-chip${s.mode === m ? ' on' : ''}`
      );
      modeRow.append(b);
    }
    this.root.append(modeRow);
    this.root.append(
      div(
        'ai-hint',
        s.mode === 'off'
          ? 'Everything uses local deterministic generation.'
          : s.mode === 'text'
            ? 'Names, titles, taunts and chronicles come from the model. Portraits stay procedural.'
            : 'Adds generated Nemesis portraits. Costs image credits.'
      )
    );

    /* ---- provider routing ---- */
    this.root.append(div('ai-h', 'PROVIDER'));
    const provRow = div('ai-row');
    for (const p of PROVIDERS) {
      // `ai-prov`, not `ai-chip`: the mode chips are a stable, tested trio and
      // selectors that count `.ai-chip` must keep meaning exactly that.
      const b = button(
        PROVIDER_LABEL[p],
        () => {
          h.setSettings({ ...h.getSettings(), provider: p });
          this.render();
        },
        `ai-prov${(s.provider ?? 'auto') === p ? ' on' : ''}`
      );
      provRow.append(b);
    }
    this.root.append(provRow);
    this.root.append(
      div(
        'ai-hint',
        (s.provider ?? 'auto') === 'openai'
          ? 'All generation uses the OpenAI API.'
          : (s.provider ?? 'auto') === 'local'
            ? 'All generation uses the Local AI Engine on this machine. No key, no cloud, works offline.'
            : 'Local AI Engine first when it is running; falls back to OpenAI. Takes effect immediately.'
      )
    );

    /* ---- LOCAL AI ENGINE ---- */
    this.root.append(div('ai-h', 'LOCAL AI'));
    this.root.append(this.localBox);
    this.renderLocal();

    /* ---- first-time setup notice ---- */
    this.root.append(this.setupNotice);

    /* ---- connection ---- */
    this.root.append(div('ai-h', 'OPENAI'));
    this.root.append(this.connLine);

    const keyRow = div('ai-row');
    this.revealBtn.className = 'ai-eye';
    this.revealBtn.type = 'button';
    this.revealBtn.textContent = '👁';
    this.revealBtn.title = 'Reveal while typing';
    this.revealBtn.style.pointerEvents = 'auto';
    this.revealBtn.onclick = (e) => {
      e.stopPropagation();
      this.setRevealed(this.keyInput.type === 'password');
    };
    keyRow.append(this.keyInput, this.revealBtn);
    this.root.append(div('ai-sub', 'API KEY'), keyRow);
    this.root.append(
      div('ai-hint', 'Held in memory by the local server only. Never saved, never logged, never in your save file.')
    );

    const btnRow = div('ai-row');
    btnRow.append(
      button('CONNECT', () => void this.doConnect(), 'ai-btn'),
      button('TEST CONNECTION', () => void this.doTest(), 'ai-btn'),
      button('DISCONNECT', () => void this.doDisconnect(), 'ai-btn danger')
    );
    this.root.append(btnRow);
    this.root.append(this.msgLine);

    /* ---- categories ---- */
    this.root.append(div('ai-h', 'GENERATED CONTENT'));
    const cats: Array<[keyof AISettings, string]> = [
      ['names', 'NAMES & TITLES'],
      ['dialogue', 'DIALOGUE'],
      ['chronicles', 'CHRONICLES'],
      ['portraits', 'PORTRAITS'],
    ];
    for (const [k, label] of cats) {
      const on = Boolean(s[k]);
      const disabled = s.mode === 'off' || (k === 'portraits' && s.mode !== 'full');
      const b = button(
        `${label}: ${on ? 'ON' : 'OFF'}`,
        () => {
          const next = { ...h.getSettings(), [k]: !on } as AISettings;
          h.setSettings(next);
          this.render();
        },
        `ai-toggle${disabled ? ' off' : ''}`
      );
      this.root.append(b);
    }

    /* ---- status ---- */
    this.root.append(div('ai-h', 'AI STATUS'));
    this.root.append(this.activityLine);

    this.renderConnection();
    this.activityLine.textContent = h.activity();
  }

  private setRevealed(on: boolean): void {
    this.keyInput.type = on ? 'text' : 'password';
    this.revealBtn.classList.toggle('on', on);
    this.revealTimer = on ? 8 : 0;
  }

  /* ============================================================
     LOCAL AI ENGINE section — the one-button states
     ============================================================ */

  private renderLocal(): void {
    const h = this.hooks;
    if (!h) return;
    const s = this.lastLocal;
    clear(this.localBox);

    const localAct = (label: string, fn: () => Promise<void>, cls = 'ai-btn') =>
      button(
        label,
        () => {
          if (this.localBusy) return;
          this.localBusy = true;
          void fn().finally(() => {
            this.localBusy = false;
            this.localPollAccum = 99; // refresh status right away
          });
        },
        cls
      );

    // Backend not reachable at all (e.g. plain static hosting).
    if (s === null && !h.status().backendReachable) {
      this.localBox.append(div('ai-hint', 'Local AI needs the game server (npm run dev / preview / serve).'));
      return;
    }

    const installing = s?.progress?.state === 'installing';

    if (installing && s?.progress) {
      const p = s.progress;
      this.localBox.append(div('ai-local-line', 'INSTALLING LOCAL AI...'));
      const stepNow = p.steps?.find((x) => x.status === 'pending' || x.status === 'running');
      const done = (p.steps ?? []).filter((x) => x.status === 'complete' || x.status === 'skipped').length;
      this.localBox.append(div('ai-hint', `step ${Math.min(12, done + 1)}/12 — ${stepNow?.name ?? 'working'}`));
      if (p.component && (p.total ?? 0) > 0) {
        const pct = p.pct ?? 0;
        const bar = div('ai-bar');
        const fill = div('ai-bar-fill');
        fill.style.width = `${pct}%`;
        bar.append(fill);
        this.localBox.append(
          div('ai-hint', `${p.component} — ${((p.downloaded ?? 0) / 1e6).toFixed(0)} / ${((p.total ?? 0) / 1e6).toFixed(0)} MB (${pct}%)`),
          bar
        );
      }
      return;
    }

    if (!s || !s.installed) {
      this.localBox.append(div('ai-local-line', 'LOCAL AI — NOT INSTALLED'));
      this.localBox.append(
        div(
          'ai-hint',
          'Runs a small text model and a fast image model on this machine. ' +
            'No account, no key, works offline. Downloads ~3 GB once.'
        )
      );
      if (s?.progress?.state === 'failed') {
        this.localBox.append(div('ai-msg bad', `Install failed: ${s.progress.errorCode ?? ''} ${s.progress.error ?? ''}`));
      }
      this.localBox.append(localAct('DOWNLOAD & RUN LOCAL AI ENGINE', () => h.localInstall()));
      return;
    }

    /* installed */
    const dot = div('ai-dot');
    let label: string;
    if (s.running && s.textReady && s.imageReady) {
      dot.classList.add('ai-idle');
      label = 'LOCAL AI — ● RUNNING';
    } else if (s.running && (s.textReady || s.imageReady)) {
      dot.classList.add('ai-busy');
      label = 'LOCAL AI — ● PARTIAL';
    } else if (s.running) {
      dot.classList.add('ai-busy');
      label = 'LOCAL AI — STARTING...';
    } else {
      dot.classList.add('ai-off');
      label = 'LOCAL AI — STOPPED';
    }
    const line = div('ai-conn');
    line.append(dot, div('ai-local-line', label));
    this.localBox.append(line);
    if (s.running) {
      this.localBox.append(
        div('ai-hint', `Text: ${s.textReady ? 'READY' : 'UNAVAILABLE'} · Images: ${s.imageReady ? 'READY' : 'UNAVAILABLE'}`),
        div('ai-hint', `${s.device || ''}${s.port ? ` · port ${s.port}` : ''}`)
      );
    }

    const row = div('ai-row');
    if (s.running) {
      row.append(localAct('STOP', () => h.localStop()), localAct('RESTART', () => h.localRestart()));
    } else {
      row.append(localAct('START', () => h.localStart()));
    }
    row.append(localAct('OPEN FOLDER', () => h.localOpenFolder()));
    row.append(
      localAct(
        'REMOVE',
        async () => {
          const purge = window.confirm('Also delete the downloaded models (~3 GB)?\nOK = delete models too, Cancel = keep them for reinstall.');
          await h.localRemove(purge);
          this.lastLocal = null;
        },
        'ai-btn danger'
      )
    );
    this.localBox.append(row);
  }

  private renderConnection(): void {
    const h = this.hooks;
    if (!h) return;
    const st = h.status();
    clear(this.connLine);

    const dot = div('ai-dot');
    let text: string;
    if (!st.backendReachable) {
      dot.classList.add('ai-error');
      text = 'LOCAL AI SERVER NOT RUNNING';
    } else if (st.connected && st.verified) {
      dot.classList.add('ai-idle');
      text = 'API KEY: CONNECTED';
    } else if (st.connected) {
      dot.classList.add('ai-busy');
      text = 'API KEY: CONNECTED (UNTESTED)';
    } else {
      dot.classList.add('ai-off');
      text = 'DISCONNECTED';
    }
    this.connLine.append(dot, div('ai-conn-text', text));

    const s = h.getSettings();
    // "Needs setup" now means NO route can generate: neither an OpenAI key
    // nor a ready Local AI Engine (given the provider mode).
    const needsSetup = s.mode !== 'off' && !h.textAvailable();
    show(this.setupNotice, needsSetup);
    if (needsSetup) {
      clear(this.setupNotice);
      this.setupNotice.append(
        div(
          'ai-msg warn',
          (s.provider ?? 'auto') === 'local'
            ? 'AI content requires the Local AI Engine to be installed and running.'
            : 'AI content requires an OpenAI API connection or the Local AI Engine.'
        )
      );
      const row = div('ai-row');
      row.append(
        button(
          'USE LOCAL GENERATION',
          () => {
            h.setSettings({ ...h.getSettings(), mode: 'off' });
            this.render();
          },
          'ai-btn'
        )
      );
      this.setupNotice.append(row);
    }
  }

  /**
   * `ai-msg-main` distinguishes this line from the setup notice's own message,
   * which is also an `.ai-msg` and sits earlier in the DOM.
   */
  private say(text: string, tone: 'ok' | 'bad' | 'warn' | '' = ''): void {
    this.msgLine.className = `ai-msg ai-msg-main ${tone}`.trim();
    this.msgLine.textContent = text;
  }

  private async doConnect(): Promise<void> {
    const h = this.hooks;
    if (!h || this.busy) return;
    const raw = this.keyInput.value.trim();
    if (!raw) {
      this.say('Paste an OpenAI key first.', 'warn');
      return;
    }
    this.busy = true;
    this.say('Sending key to the local server...');
    let res: { ok: boolean; error: string };
    try {
      res = await h.connect(raw);
    } finally {
      // Clear the field on every path, success or failure, so a key is never
      // left sitting in the DOM.
      this.keyInput.value = '';
      this.setRevealed(false);
      this.busy = false;
    }
    if (res.ok) {
      this.say('Key accepted. Testing...', 'ok');
      await this.doTest();
    } else {
      this.say(res.error || 'Connection failed.', 'bad');
    }
    this.renderConnection();
  }

  private async doTest(): Promise<void> {
    const h = this.hooks;
    if (!h) return;
    this.say('Testing OpenAI connection...');
    const res = await h.test();
    if (res.ok) this.say(`OpenAI connected. (${res.latencyMs} ms)`, 'ok');
    else this.say(`Connection failed. ${res.error}`, 'bad');
    this.renderConnection();
  }

  private async doDisconnect(): Promise<void> {
    const h = this.hooks;
    if (!h) return;
    await h.disconnect();
    this.keyInput.value = '';
    this.setRevealed(false);
    this.say('Disconnected. Local generation in use.', '');
    this.render();
  }
}
