/**
 * The browser's client for the local AI backend.
 *
 * The browser never holds the API key. It posts the key once, to
 * `/api/ai/connect`, and from then on only ever asks the backend whether a
 * connection exists. Nothing in this file stores, echoes, or logs a key:
 *   - the key is a local in a single function call
 *   - it is never written to localStorage, the save, or the console
 *   - `status()` returns a boolean, not a key, prefix, or length
 *
 * Every method resolves rather than rejects. A dead backend is an expected
 * condition — the game runs happily without one.
 */

import type { AIProviderMode, ConnectionStatus, LocalAIStatus } from './AITypes';

const TIMEOUT_MS = 60_000;
/** Local image generation on CPU can be slow; the backend enforces real limits. */
const LOCAL_IMAGE_TIMEOUT_MS = 320_000;

async function post<T>(path: string, body: unknown, timeout = TIMEOUT_MS): Promise<T | null> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Network error, abort, or no backend at all. All the same to the caller.
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export class AIBackend {
  private state: ConnectionStatus = {
    provider: 'openai',
    connected: false,
    verified: false,
    error: '',
  };

  /** True when we have ever reached the backend at all. */
  private backendReachable = false;

  /**
   * Provider routing. The mode is chosen in settings and sent with every
   * generation request; the game server does the actual switching, so
   * changing provider never needs a restart of anything.
   */
  private providerMode: AIProviderMode = 'auto';
  /** local engine readiness, from the last /api/ai/status refresh */
  private localTextReady = false;
  private localImageReady = false;
  localInstalled = false;
  localRunning = false;

  onChange: (() => void) | null = null;

  get status(): ConnectionStatus {
    return { ...this.state };
  }

  get connected(): boolean {
    return this.state.connected;
  }

  get reachable(): boolean {
    return this.backendReachable;
  }

  get provider(): AIProviderMode {
    return this.providerMode;
  }

  setProviderMode(mode: AIProviderMode): void {
    if (this.providerMode === mode) return;
    this.providerMode = mode;
    this.update({});
  }

  /**
   * Can a text/image request succeed right now, given the provider mode?
   * This is what gates generation — an OpenAI key OR a ready local engine
   * counts, depending on routing.
   */
  get textAvailable(): boolean {
    if (this.providerMode === 'openai') return this.state.connected;
    if (this.providerMode === 'local') return this.localTextReady;
    return this.state.connected || this.localTextReady;
  }

  get imageAvailable(): boolean {
    if (this.providerMode === 'openai') return this.state.connected;
    if (this.providerMode === 'local') return this.localImageReady;
    return this.state.connected || this.localImageReady;
  }

  private update(patch: Partial<ConnectionStatus>): void {
    this.state = { ...this.state, ...patch };
    try {
      this.onChange?.();
    } catch {
      /* ignore */
    }
  }

  /** Ask the backend whether it is already holding a key (e.g. from env). */
  async refresh(): Promise<ConnectionStatus> {
    try {
      const res = await fetch('/api/ai/status', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status');
      const json = (await res.json()) as {
        connected?: boolean;
        verified?: boolean;
        provider?: string;
        local?: { installed?: boolean; running?: boolean; textReady?: boolean; imageReady?: boolean };
      };
      this.backendReachable = true;
      this.localInstalled = Boolean(json.local?.installed);
      this.localRunning = Boolean(json.local?.running);
      this.localTextReady = Boolean(json.local?.textReady);
      this.localImageReady = Boolean(json.local?.imageReady);
      this.update({
        connected: Boolean(json.connected),
        verified: Boolean(json.verified),
        provider: json.provider ?? 'openai',
        error: '',
      });
    } catch {
      this.backendReachable = false;
      this.localRunning = false;
      this.localTextReady = false;
      this.localImageReady = false;
      this.update({ connected: false, verified: false, error: '' });
    }
    return this.status;
  }

  /* ============================================================
     LOCAL AI ENGINE — status + one-button management
     ============================================================ */

  async localStatus(): Promise<LocalAIStatus | null> {
    try {
      const res = await fetch('/api/ai/local/status', { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const json = (await res.json()) as LocalAIStatus & { ok?: boolean };
      this.localInstalled = Boolean(json.installed);
      this.localRunning = Boolean(json.running);
      const changed = this.localTextReady !== Boolean(json.textReady) || this.localImageReady !== Boolean(json.imageReady);
      this.localTextReady = Boolean(json.textReady);
      this.localImageReady = Boolean(json.imageReady);
      if (changed) this.update({});
      return json;
    } catch {
      return null;
    }
  }

  localHeartbeat(): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/heartbeat', {}, 4_000);
  }

  /** Tab is going away. Refresh can cancel the delayed engine shutdown. */
  localGoodbye(): void {
    try {
      const blob = new Blob(['{}'], { type: 'application/json' });
      if (navigator.sendBeacon('/api/ai/local/goodbye', blob)) return;
    } catch {
      /* fall through */
    }
    void fetch('/api/ai/local/goodbye', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch(() => {});
  }

  localInstall(): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/install', {}, 15_000);
  }

  localStart(): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/start', {}, 15_000);
  }

  localStop(): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/stop', {}, 30_000);
  }

  localRestart(): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/restart', {}, 30_000);
  }

  localRemove(purgeModels: boolean): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/remove', { purgeModels }, 90_000);
  }

  localOpenFolder(): Promise<{ ok: boolean } | null> {
    return post('/api/ai/local/open-folder', {}, 10_000);
  }

  /**
   * Hand the key to the backend. `key` is not retained here in any form after
   * this call returns.
   */
  async connect(key: string): Promise<{ ok: boolean; error: string }> {
    const res = await post<{ ok: boolean; connected: boolean; error?: string }>(
      '/api/ai/connect',
      { key },
      15_000
    );
    if (!res) {
      this.backendReachable = false;
      const error = 'Local AI server not running';
      this.update({ connected: false, verified: false, error });
      return { ok: false, error };
    }
    this.backendReachable = true;
    if (!res.ok) {
      const error = res.error ?? 'Connection failed';
      this.update({ connected: false, verified: false, error });
      return { ok: false, error };
    }
    this.update({ connected: true, verified: false, error: '' });
    return { ok: true, error: '' };
  }

  async disconnect(): Promise<void> {
    await post('/api/ai/disconnect', {}, 10_000);
    this.update({ connected: false, verified: false, error: '' });
  }

  /** Round-trips a cheap real call so "CONNECTED" means something. */
  async test(): Promise<{ ok: boolean; error: string; latencyMs: number }> {
    const res = await post<{ ok: boolean; error?: string; latencyMs?: number }>(
      '/api/ai/test',
      {},
      30_000
    );
    if (!res) {
      this.backendReachable = false;
      const error = 'Local AI server not running';
      this.update({ verified: false, error });
      return { ok: false, error, latencyMs: 0 };
    }
    this.backendReachable = true;
    if (!res.ok) {
      const error = res.error ?? 'Connection failed';
      this.update({ verified: false, error });
      return { ok: false, error, latencyMs: 0 };
    }
    this.update({ connected: true, verified: true, error: '' });
    return { ok: true, error: '', latencyMs: res.latencyMs ?? 0 };
  }

  async text(
    system: string,
    user: string,
    opts: { maxTokens?: number; json?: boolean; temperature?: number } = {}
  ): Promise<{ ok: boolean; text: string; error: string; latencyMs: number }> {
    const res = await post<{ ok: boolean; text?: string; error?: string; latencyMs?: number }>(
      '/api/ai/text',
      { system, user, ...opts, provider: this.providerMode }
    );
    if (!res) return { ok: false, text: '', error: 'Network unavailable', latencyMs: 0 };
    if (!res.ok) {
      if (res.error === 'Invalid API key') this.update({ verified: false, error: res.error });
      return { ok: false, text: '', error: res.error ?? 'API unavailable', latencyMs: 0 };
    }
    return { ok: true, text: res.text ?? '', error: '', latencyMs: res.latencyMs ?? 0 };
  }

  async image(prompt: string): Promise<{ ok: boolean; dataUrl: string; error: string; latencyMs: number }> {
    const local = this.providerMode !== 'openai' && this.localImageReady;
    const res = await post<{
      ok: boolean;
      dataUrl?: string;
      url?: string;
      error?: string;
      latencyMs?: number;
    }>(
      '/api/ai/image',
      // The local engine renders 512x512 by default (its native size); the
      // OpenAI path keeps its existing 1024. The server clamps either way.
      { prompt, size: local ? '512x512' : '1024x1024', provider: this.providerMode },
      local ? LOCAL_IMAGE_TIMEOUT_MS : 120_000
    );
    if (!res) return { ok: false, dataUrl: '', error: 'Network unavailable', latencyMs: 0 };
    if (!res.ok) {
      if (res.error === 'Invalid API key') this.update({ verified: false, error: res.error });
      return { ok: false, dataUrl: '', error: res.error ?? 'API unavailable', latencyMs: 0 };
    }
    return {
      ok: true,
      dataUrl: res.dataUrl ?? res.url ?? '',
      error: '',
      latencyMs: res.latencyMs ?? 0,
    };
  }
}
