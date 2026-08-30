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

type CloudProvider = 'openai' | 'groq';

export interface AISettingsHooks {
  getSettings(): AISettings;
  setSettings(s: AISettings): void;
  status(): {
    connected: boolean;
    verified: boolean;
    error: string;
    backendReachable: boolean;
    cloud: { openai: { connected: boolean; verified: boolean }; groq: { connected: boolean; verified: boolean } };
    openaiConnected: boolean;
    openaiVerified: boolean;
    groqConnected: boolean;
    groqVerified: boolean;
  };
  connect(key: string, provider?: CloudProvider): Promise<{ ok: boolean; error: string }>;
  disconnect(provider?: CloudProvider): Promise<void>;
  test(provider?: CloudProvider): Promise<{ ok: boolean; error: string; latencyMs: number }>;
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

const PROVIDERS: AIProviderMode[] = ['openai', 'groq', 'local', 'auto'];
const PROVIDER_LABEL: Record<AIProviderMode, string> = {
  openai: 'OPENAI',
  groq: 'GROQ',
  local: 'LOCAL',
  auto: 'AUTO',
};

function hintLink(href: string, text: string): HTMLAnchorElement {
  const a = el('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

function appendHint(container: HTMLElement, parts: Array<string | Node>): void {
  for (const p of parts) {
    if (typeof p === 'string') container.append(p);
    else container.append(p);
  }
}

export class AISettingsPanel {
  readonly root = div('detail ai-settings');

  private hooks: AISettingsHooks | null = null;
  private keyInput = el('input');
  private revealBtn = el('button');
  private connLine = div('ai-conn');
  private msgLine = div('ai-msg ai-msg-main');
  private activityLine = div('ai-activity');
  private setupNotice = div('ai-setup hidden');
  private keySection = div('ai-key-section');
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
    this.keyInput.setAttribute('name', 'shdowpit-ephemeral');
  }

  mount(hooks: AISettingsHooks): void {
    this.hooks = hooks;
    this.render();
  }

  refresh(): void {
    if (!this.hooks) return;
    this.renderConnection();
    this.activityLine.textContent = this.hooks.activity();
    if (this.revealTimer > 0) {
      this.revealTimer -= 0.25;
      if (this.revealTimer <= 0) this.setRevealed(false);
    }
    this.localPollAccum += 0.25;
    const interval = this.lastLocal?.progress?.state === 'installing' ? 0.5 : 1.25;
    if (this.localPollAccum >= interval && !this.localPolling) {
      this.localPollAccum = 0;
      if (!this.hooks?.status().backendReachable) return;
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

  private cloudProviderFor(settings: AISettings, key = ''): CloudProvider {
    if (settings.provider === 'groq') return 'groq';
    if (settings.provider === 'openai') return 'openai';
    return /^gsk_/.test(key.trim()) ? 'groq' : 'openai';
  }

  private cloudLabel(provider: CloudProvider): string {
    return provider === 'groq' ? 'GROQ' : 'OPENAI';
  }

  private renderProviderHint(provider: AIProviderMode): void {
    const hint = div('ai-hint');
    if (provider === 'openai') {
      appendHint(hint, [
        'All text and images use OpenAI. ',
        hintLink('https://platform.openai.com/api-keys', 'Get API key'),
        ' · ',
        hintLink('https://platform.openai.com/docs', 'Docs'),
      ]);
    } else if (provider === 'groq') {
      appendHint(hint, [
        'Text via Groq; portraits use Local AI Engine when running, otherwise procedural. ',
        hintLink('https://console.groq.com/keys', 'Get API key'),
        ' · ',
        hintLink('https://console.groq.com/docs/quickstart', 'Docs'),
      ]);
    } else if (provider === 'local') {
      hint.textContent = 'Fully offline. No key. See local engine section.';
    } else {
      hint.textContent = 'Text: Local → Groq → OpenAI. Images: Local → OpenAI.';
    }
    this.root.append(hint);
  }

  private renderSetupExplainer(cloud: CloudProvider): void {
    const box = div('ai-hint');
    if (cloud === 'groq') {
      box.textContent =
        '1. Sign in at console.groq.com\n2. Create an API key (starts with gsk_)\n3. Paste it here and click CONNECT\nKeys are held in memory by the local server only.';
    } else {
      box.textContent =
        '1. Sign in at platform.openai.com\n2. Create an API key (starts with sk-)\n3. Paste it here and click CONNECT\nKeys are held in memory by the local server only.';
    }
    box.style.whiteSpace = 'pre-line';
    this.keySection.append(box);
  }

  private render(): void {
    const h = this.hooks;
    if (!h) return;
    clear(this.root);
    const s = h.getSettings();
    const prov = s.provider ?? 'auto';

    this.root.append(div('ai-h', 'AI CONTENT'));
    const modeRow = div('ai-row');
    for (const m of MODES) {
      const b = button(
        MODE_LABEL[m],
        () => {
          h.setSettings({ ...h.getSettings(), mode: m });
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

    this.root.append(div('ai-h', 'PROVIDER'));
    const provRow = div('ai-row');
    for (const p of PROVIDERS) {
      const b = button(
        PROVIDER_LABEL[p],
        () => {
          h.setSettings({ ...h.getSettings(), provider: p });
          this.render();
        },
        `ai-prov${prov === p ? ' on' : ''}`
      );
      provRow.append(b);
    }
    this.root.append(provRow);
    this.renderProviderHint(prov);

    this.root.append(div('ai-h', 'LOCAL AI'));
    this.root.append(this.localBox);
    this.renderLocal();

    this.root.append(this.setupNotice);

    if (prov !== 'local') {
      const cloud = this.cloudProviderFor(s);
      this.keyInput.placeholder = cloud === 'groq' ? 'gsk_...' : 'sk-...';
      clear(this.keySection);
      this.root.append(this.keySection);
      this.keySection.append(div('ai-h', this.cloudLabel(cloud)));
      this.keySection.append(this.connLine);

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
      this.keySection.append(div('ai-sub', 'API KEY'), keyRow);
      this.keySection.append(
        div('ai-hint', 'Held in memory by the local server only. Never saved, never logged, never in your save file.')
      );
      this.renderSetupExplainer(cloud);

      const btnRow = div('ai-row');
      btnRow.append(
        button('CONNECT', () => void this.doConnect(), 'ai-btn'),
        button('TEST CONNECTION', () => void this.doTest(), 'ai-btn'),
        button('DISCONNECT', () => void this.doDisconnect(), 'ai-btn danger')
      );
      this.keySection.append(btnRow);
      this.keySection.append(this.msgLine);
    }

    this.root.append(div('ai-h', 'GENERATED CONTENT'));
    const cats: Array<[keyof AISettings, string]> = [
      ['names', 'NAMES & TITLES'],
      ['dialogue', 'DIALOGUE'],
      ['chronicles', 'STORY & CHRONICLES'],
      ['portraits', 'PORTRAITS'],
    ];
    for (const [k, label] of cats) {
      const on = Boolean(s[k]);
      const disabled = s.mode === 'off' || (k === 'portraits' && s.mode !== 'full');
      const b = button(
        `${label}: ${on ? 'ON' : 'OFF'}`,
        () => {
          h.setSettings({ ...h.getSettings(), [k]: !on } as AISettings);
          this.render();
        },
        `ai-toggle${disabled ? ' off' : ''}`
      );
      this.root.append(b);
    }

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
            this.localPollAccum = 99;
          });
        },
        cls
      );

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
          'Runs a small text model and a fast image model on this machine. No account, no key, works offline. Downloads ~3 GB once.'
        )
      );
      if (s?.progress?.state === 'failed') {
        this.localBox.append(div('ai-msg bad', `Install failed: ${s.progress.errorCode ?? ''} ${s.progress.error ?? ''}`));
      }
      this.localBox.append(localAct('DOWNLOAD & RUN LOCAL AI ENGINE', () => h.localInstall()));
      return;
    }

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
    const s = h.getSettings();
    const prov = s.provider ?? 'auto';
    if (prov === 'local') {
      show(this.setupNotice, s.mode !== 'off' && !h.textAvailable());
      if (s.mode !== 'off' && !h.textAvailable()) {
        clear(this.setupNotice);
        this.setupNotice.append(div('ai-msg warn', 'AI content requires the Local AI Engine to be installed and running.'));
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
      return;
    }

    clear(this.connLine);
    const cloud = this.cloudProviderFor(s);
    const cloudSt = st.cloud[cloud];

    const dot = div('ai-dot');
    let text: string;
    if (!st.backendReachable) {
      dot.classList.add('ai-error');
      text = 'LOCAL AI SERVER NOT RUNNING';
    } else if (cloudSt.connected && cloudSt.verified) {
      dot.classList.add('ai-idle');
      text = `API KEY: CONNECTED (${this.cloudLabel(cloud)})`;
    } else if (cloudSt.connected) {
      dot.classList.add('ai-busy');
      text = `API KEY: CONNECTED (${this.cloudLabel(cloud)}, UNTESTED)`;
    } else {
      dot.classList.add('ai-off');
      text = 'DISCONNECTED';
    }
    this.connLine.append(dot, div('ai-conn-text', text));

    const needsSetup = s.mode !== 'off' && !h.textAvailable();
    show(this.setupNotice, needsSetup);
    if (needsSetup) {
      clear(this.setupNotice);
      let msg: string;
      if (prov === 'groq') {
        msg = 'AI content requires a Groq API connection or the Local AI Engine.';
      } else if (prov === 'openai') {
        msg = 'AI content requires an OpenAI API connection or the Local AI Engine.';
      } else {
        msg = 'AI content requires an OpenAI or Groq API connection, or the Local AI Engine.';
      }
      this.setupNotice.append(div('ai-msg warn', msg));
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

  private say(text: string, tone: 'ok' | 'bad' | 'warn' | '' = ''): void {
    this.msgLine.className = `ai-msg ai-msg-main ${tone}`.trim();
    this.msgLine.textContent = text;
  }

  private async doConnect(): Promise<void> {
    const h = this.hooks;
    if (!h || this.busy) return;
    const s = h.getSettings();
    const raw = this.keyInput.value.trim();
    const cloud = this.cloudProviderFor(s, raw);
    const label = this.cloudLabel(cloud);
    if (!raw) {
      this.say(`Paste a ${label} key first.`, 'warn');
      return;
    }
    this.busy = true;
    this.say('Sending key to the local server...');
    let res: { ok: boolean; error: string };
    try {
      res = await h.connect(raw, cloud);
    } finally {
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
    const cloud = this.cloudProviderFor(h.getSettings());
    const label = this.cloudLabel(cloud);
    this.say(`Testing ${label} connection...`);
    const res = await h.test(cloud);
    if (res.ok) this.say(`${label} connected. (${res.latencyMs} ms)`, 'ok');
    else this.say(`Connection failed. ${res.error}`, 'bad');
    this.renderConnection();
  }

  private async doDisconnect(): Promise<void> {
    const h = this.hooks;
    if (!h) return;
    const cloud = this.cloudProviderFor(h.getSettings());
    await h.disconnect(cloud);
    this.keyInput.value = '';
    this.setRevealed(false);
    this.say('Disconnected. Local generation in use.', '');
    this.render();
  }
}
