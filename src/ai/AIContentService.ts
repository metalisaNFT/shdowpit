/**
 * The one place the game talks to the AI layer.
 *
 * Everything outside src/ai/ interacts through this object, and every method
 * on it is either synchronous-and-instant or fire-and-forget. There is no
 * method here that a caller can await into a frame stall — that is deliberate,
 * and it is the reason AI cannot freeze the game loop.
 *
 * Reading order:
 *   - the `xFor()` getters are what the UI calls. They always return something
 *     usable right now: cached AI content if it exists, local fallback if not.
 *   - `onMythEvent()` is what the simulation calls. It decides whether this
 *     moment is worth spending a request on, and queues work if so.
 *   - `validate*()` is the guard rail. A model that ignores the prompt's rule
 *     and invents a scar gets its answer thrown away here.
 */

import { rankIndex, type Nemesis, type Rank } from '../nemesis/Nemesis';
import {
  GOD_AI_KINDS,
  MYTH_PRIORITY,
  defaultAISettings,
  emptyAIContent,
  type AIImageProvider,
  type AIMode,
  type AIRequest,
  type AIRequestKind,
  type AISettings,
  type AITextProvider,
  type MythEventKind,
  type NemesisAIContent,
} from './AITypes';
import { AIBackend } from './AIBackend';
import { BackendTextProvider, NullTextProvider } from './AITextProvider';
import { BackendImageProvider, NullImageProvider } from './AIImageProvider';
import { AIPortraitStore, AITextCache, hashKey } from './AICache';
import { AIQueue } from './AIQueue';
import {
  buildFacts,
  chroniclePrompt,
  identityPrompt,
  portraitPrompt,
  tauntPrompt,
} from './AIPromptBuilder';
import { HarnessTextProvider, type AIHarnessConfig } from './AIHarness';
import {
  fallbackChronicle,
  fallbackTaunts,
  fallbackTitle,
  proceduralPortrait,
} from './AIFallbackGenerator';

export interface WorldContext {
  turn: number;
  age: number;
  ageName: string;
  /** Baked into cache keys so a new world never inherits another world's AI content. */
  worldSeed: number;
  nameOf(id: string | null): string;
}

export interface AIServiceEvents {
  /** any queue or connection change; drives the indicator and debug panel */
  onStatusChange?: () => void;
  /** a piece of content landed for this nemesis; UI should re-read it */
  onContentReady?: (nemesisId: string, kind: string) => void;
  /** the first successful generation of the session */
  onFirstGeneration?: () => void;
  /** something worth persisting changed */
  onDirty?: () => void;
}

export class AIContentService {
  readonly backend = new AIBackend();
  readonly queue = new AIQueue();
  readonly textCache = new AITextCache();
  readonly portraits = new AIPortraitStore();

  private text: AITextProvider;
  private image: AIImageProvider;
  private nullText = new NullTextProvider();
  private nullImage = new NullImageProvider();

  private settings: AISettings = defaultAISettings();
  private world: WorldContext = { turn: 1, age: 1, ageName: 'THE WASTES', worldSeed: 1, nameOf: () => '' };
  private events: AIServiceEvents = {};

  private hasGeneratedThisSession = false;
  /** Set when FULL is chosen with no connection, so the UI can prompt once. */
  needsSetupPrompt = false;

  /**
   * Generation scope. Bumped when a long-game run is begun, abandoned,
   * reset, or replaced so in-flight results cannot land on the wrong world.
   */
  private scope = 1;
  /** Presentation overlays (dossiers, beat voices, recaps). Never sim state. */
  private overlays = new Map<string, string>();
  private harness: AITextProvider | null = null;

  constructor() {
    this.text = new BackendTextProvider(this.backend);
    this.image = new BackendImageProvider(this.backend);
    this.backend.onChange = () => this.events.onStatusChange?.();
    this.queue.onChange = () => this.events.onStatusChange?.();
  }

  /* ============================================================
     lifecycle
     ============================================================ */

  bind(events: AIServiceEvents): void {
    this.events = events;
  }

  setWorld(w: WorldContext): void {
    this.world = w;
  }

  /** Ask the backend whether it is already holding a key. Never blocks boot. */
  init(): void {
    void this.backend.refresh().then(() => {
      // A connection that appears later must not silently leave the mode off,
      // but we also never turn AI on for the player without them asking.
      this.events.onStatusChange?.();
    });
  }

  get aiSettings(): AISettings {
    return this.settings;
  }

  setSettings(s: AISettings): void {
    this.settings = s;
    // Provider routing applies to the very next request — no restart needed.
    this.backend.setProviderMode(s.provider ?? 'auto');
    if (s.mode !== 'off' && !this.backend.textAvailable) this.needsSetupPrompt = true;
    this.events.onStatusChange?.();
  }

  setMode(mode: AIMode): void {
    this.setSettings({ ...this.settings, mode });
  }

  get mode(): AIMode {
    return this.settings.mode;
  }

  /** Text generation is live in TEXT and FULL, when connected and enabled. */
  private canText(category: 'names' | 'dialogue' | 'chronicles'): boolean {
    if (this.settings.mode === 'off') return false;
    if (!this.settings[category]) return false;
    return this.provider().isAvailable();
  }

  /** Images are FULL only. */
  private canImage(): boolean {
    if (this.settings.mode !== 'full') return false;
    if (!this.settings.portraits) return false;
    return this.imageProvider().isAvailable();
  }

  private provider(): AITextProvider {
    if (this.settings.mode === 'off') return this.nullText;
    if (this.harness) return this.harness;
    return this.text;
  }

  private imageProvider(): AIImageProvider {
    return this.settings.mode === 'full' ? this.image : this.nullImage;
  }

  /* ============================================================
     the AI namespace on a nemesis
     ============================================================ */

  private ai(n: Nemesis): NemesisAIContent {
    if (!n.ai) n.ai = emptyAIContent();
    if (!n.ai.generatedAt) n.ai.generatedAt = {};
    return n.ai;
  }

  /** Appearance-relevant change: scars, rank, stolen gear, resurrection. */
  bumpVisual(n: Nemesis): void {
    const a = this.ai(n);
    a.visualVersion++;
    this.events.onDirty?.();
  }

  /** History-relevant change: any new memory worth re-summarising. */
  bumpEvents(n: Nemesis): void {
    const a = this.ai(n);
    a.eventVersion++;
    this.events.onDirty?.();
  }

  private key(n: Nemesis, kind: string): string {
    const a = this.ai(n);
    const version = kind === 'portrait' ? a.visualVersion : a.eventVersion;
    return hashKey(this.world.worldSeed, n.id, kind, version, kind === 'portrait' ? a.visualVersion : n.rank);
  }

  /* ============================================================
     synchronous getters — always instant, never null
     ============================================================ */

  /** The title to show. AI title if we have one, the earned local title if not. */
  titleFor(n: Nemesis): string {
    return n.ai?.title || n.title || fallbackTitle(n);
  }

  displayName(n: Nemesis): string {
    const t = this.titleFor(n);
    return t ? `${n.name} ${t}` : n.name;
  }

  tauntsFor(n: Nemesis): string[] {
    const ai = n.ai?.taunts;
    if (ai && ai.length) return ai;
    return fallbackTaunts(n);
  }

  tauntFor(n: Nemesis, salt = 0): string {
    const list = this.tauntsFor(n);
    return list[Math.abs(salt) % list.length] ?? '';
  }

  chronicleFor(n: Nemesis): string {
    return n.ai?.chronicle || fallbackChronicle(n);
  }

  /**
   * The portrait to draw right now. Returns the generated image only if its
   * bytes are already in memory; otherwise the deterministic SVG, and it warms
   * the real one in the background. Callers never wait.
   */
  portraitFor(n: Nemesis): string {
    const p = n.ai?.portrait;
    if (p && !p.procedural) {
      const hit = this.portraits.peek(p.key);
      if (hit) return hit;
      void this.portraits.get(p.key).then((v) => {
        if (v) {
          this.events.onContentReady?.(n.id, 'portrait');
          return;
        }
        // IndexedDB miss — regenerate instead of showing a stale save reference forever.
        if (this.canImage() && !this.queue.has(p.key) && this.queue.canRetry(p.key)) {
          this.generateNemesisPortrait(n, null, 12);
        }
      });
    }
    return proceduralPortrait(n);
  }

  /** True when a generated portrait exists and is loaded. */
  hasGeneratedPortrait(n: Nemesis): boolean {
    const p = n.ai?.portrait;
    return Boolean(p && !p.procedural && this.portraits.peek(p.key));
  }

  portraitHistory(n: Nemesis): Array<{ title: string; turn: number; src: string }> {
    const hist = n.ai?.portraitHistory ?? [];
    for (const h of hist) {
      if (!this.portraits.peek(h.key)) void this.portraits.get(h.key);
    }
    return hist.map((h) => ({
      title: h.title,
      turn: h.turn,
      src: this.portraits.peek(h.key) ?? proceduralPortrait(n),
    }));
  }

  /* ============================================================
     the trigger surface
     ============================================================ */

  /**
   * The simulation calls this when something myth-worthy happens. Everything
   * downstream is optional: if AI is off, unreachable, or already has this
   * content cached, this is close to free.
   */
  onMythEvent(n: Nemesis, kind: MythEventKind): void {
    // Version bumps happen regardless of AI, so the fallback content and the
    // cache keys stay correct even in OFF mode.
    if (
      kind === 'major_scar' ||
      kind === 'stole_weapon' ||
      kind === 'returned_from_death' ||
      kind === 'promoted_captain' ||
      kind === 'promoted_warlord' ||
      kind === 'became_overlord'
    ) {
      this.bumpVisual(n);
    }
    this.bumpEvents(n);

    if (this.settings.mode === 'off') return;

    const priority = MYTH_PRIORITY[kind] ?? 10;
    this.generateNemesisIdentity(n, kind, priority);
    this.generateNemesisDialogue(n, kind, priority - 1);
    this.generateNemesisChronicle(n, kind, priority - 2);
    this.generateNemesisPortrait(n, kind, priority - 3);
  }

  /** Cheaper path for "the player is looking at this one right now". */
  ensureFor(n: Nemesis, priority = 95): void {
    if (this.settings.mode === 'off') return;
    this.generateNemesisIdentity(n, null, priority);
    this.generateNemesisDialogue(n, null, priority - 1);
    this.generateNemesisChronicle(n, null, priority - 2);
    this.generateNemesisPortrait(n, null, priority - 3);
  }

  /**
   * Background fill for a living hierarchy the player has not met yet.
   * Priority stays below myth events so a live encounter still jumps the queue.
   */
  ensureRoster(nemeses: Nemesis[], minRank: Rank = 'captain'): void {
    if (this.settings.mode === 'off') return;
    const floor = rankIndex(minRank);
    const list = nemeses
      .filter((n) => n.alive && rankIndex(n.rank) >= floor)
      .sort((a, b) => rankIndex(b.rank) - rankIndex(a.rank));
    for (const n of list) {
      this.ensureFor(n, 8 + rankIndex(n.rank) * 6);
    }
  }

  /* ============================================================
     generators
     ============================================================ */

  generateNemesisIdentity(n: Nemesis, trigger: MythEventKind | null, priority = 50): void {
    if (!this.canText('names')) return;
    const a = this.ai(n);
    const key = this.key(n, 'identity');
    if (a.generatedAt?.identity === key) return;

    const cached = this.textCache.get(key);
    if (cached) {
      a.title = cached;
      a.generatedAt!.identity = key;
      this.queue.noteCacheHit('identity', n.id, n.name, key);
      this.events.onContentReady?.(n.id, 'identity');
      this.events.onDirty?.();
      return;
    }
    if (this.queue.has(key) || !this.queue.canRetry(key)) return;

    const facts = buildFacts(n, this.world, this.world.nameOf, trigger);
    const { system, user } = identityPrompt(facts);

    const scope = this.scope;
    this.queue.enqueue({
      kind: 'identity',
      nemesisId: n.id,
      label: n.name.toUpperCase(),
      priority,
      cacheKey: key,
      run: async () => {
        const res = await this.provider().generate(system, user, { maxTokens: 24 });
        if (!res.ok) throw new Error(res.error);
        if (scope !== this.scope) return;
        if (this.key(n, 'identity') !== key) return;
        const title = this.validateTitle(res.text, n);
        if (!title) throw new Error('rejected');
        this.textCache.set(key, title, user);
        a.title = title;
        a.generatedAt!.identity = key;
        this.noteFirst();
        this.events.onContentReady?.(n.id, 'identity');
        this.events.onDirty?.();
      },
    });
  }

  generateNemesisDialogue(n: Nemesis, trigger: MythEventKind | null, priority = 45): void {
    if (!this.canText('dialogue')) return;
    const a = this.ai(n);
    const key = this.key(n, 'taunt');
    if (a.generatedAt?.taunt === key) return;

    const cached = this.textCache.get(key);
    if (cached) {
      a.taunts = cached.split('\n').filter(Boolean);
      a.generatedAt!.taunt = key;
      this.queue.noteCacheHit('taunt', n.id, n.name, key);
      this.events.onContentReady?.(n.id, 'taunt');
      this.events.onDirty?.();
      return;
    }
    if (this.queue.has(key) || !this.queue.canRetry(key)) return;

    const facts = buildFacts(n, this.world, this.world.nameOf, trigger);
    const { system, user } = tauntPrompt(facts);

    const scope = this.scope;
    this.queue.enqueue({
      kind: 'taunt',
      nemesisId: n.id,
      label: n.name.toUpperCase(),
      priority,
      cacheKey: key,
      run: async () => {
        const res = await this.provider().generate(system, user, { maxTokens: 120 });
        if (!res.ok) throw new Error(res.error);
        if (scope !== this.scope) return;
        if (this.key(n, 'taunt') !== key) return;
        const lines = this.validateTaunts(res.text, n);
        if (!lines.length) throw new Error('rejected');
        this.textCache.set(key, lines.join('\n'), user);
        a.taunts = lines;
        a.generatedAt!.taunt = key;
        this.noteFirst();
        this.events.onContentReady?.(n.id, 'taunt');
        this.events.onDirty?.();
      },
    });
  }

  generateNemesisChronicle(n: Nemesis, trigger: MythEventKind | null, priority = 20): void {
    if (!this.canText('chronicles')) return;
    const a = this.ai(n);
    const key = this.key(n, 'chronicle');
    if (a.generatedAt?.chronicle === key) return;

    const cached = this.textCache.get(key);
    if (cached) {
      a.chronicle = cached;
      a.generatedAt!.chronicle = key;
      this.queue.noteCacheHit('chronicle', n.id, n.name, key);
      this.events.onContentReady?.(n.id, 'chronicle');
      this.events.onDirty?.();
      return;
    }
    if (this.queue.has(key) || !this.queue.canRetry(key)) return;

    const facts = buildFacts(n, this.world, this.world.nameOf, trigger);
    const { system, user } = chroniclePrompt(facts);

    const scope = this.scope;
    this.queue.enqueue({
      kind: 'chronicle',
      nemesisId: n.id,
      label: n.name.toUpperCase(),
      priority,
      cacheKey: key,
      run: async () => {
        const res = await this.provider().generate(system, user, { maxTokens: 220 });
        if (!res.ok) throw new Error(res.error);
        if (scope !== this.scope) return;
        if (this.key(n, 'chronicle') !== key) return;
        const summary = this.validateChronicle(res.text, n);
        if (!summary) throw new Error('rejected');
        this.textCache.set(key, summary, user);
        a.chronicle = summary;
        a.generatedAt!.chronicle = key;
        this.noteFirst();
        this.events.onContentReady?.(n.id, 'chronicle');
        this.events.onDirty?.();
      },
    });
  }

  generateNemesisPortrait(n: Nemesis, trigger: MythEventKind | null, priority = 15): void {
    if (!this.canImage()) return;
    const a = this.ai(n);
    const key = this.key(n, 'portrait');
    if (a.portrait && a.portrait.key === key && !a.portrait.procedural && this.portraits.peek(key)) return;
    if (this.queue.has(key) || !this.queue.canRetry(key)) return;

    const title = this.titleFor(n);

    // Already on disk from a previous session?
    void this.portraits.get(key).then((hit) => {
      if (hit) {
        this.adoptPortrait(n, key, '', title, true);
        this.queue.noteCacheHit('portrait', n.id, n.name, key);
        return;
      }
      if (this.queue.has(key) || !this.canImage()) return;

      const facts = buildFacts(n, this.world, this.world.nameOf, trigger);
      const prompt = portraitPrompt(facts);

      const scope = this.scope;
      this.queue.enqueue({
        kind: 'portrait',
        nemesisId: n.id,
        label: n.name.toUpperCase(),
        priority,
        cacheKey: key,
        run: async () => {
          const res = await this.imageProvider().generate(prompt);
          if (!res.ok || !res.dataUrl) throw new Error(res.error || 'no image');
          if (scope !== this.scope) return;
          if (this.key(n, 'portrait') !== key) return;
          await this.portraits.set(key, res.dataUrl);
          this.adoptPortrait(n, key, prompt, this.titleFor(n), false);
          this.noteFirst();
        },
      });
    });
  }

  /** Record a new portrait and push the previous one into the history. */
  private adoptPortrait(n: Nemesis, key: string, prompt: string, title: string, fromCache: boolean): void {
    const a = this.ai(n);
    const entry = { key, prompt, title, turn: this.world.turn, procedural: false };
    if (a.portrait && a.portrait.key !== key) {
      a.portraitHistory = a.portraitHistory ?? [];
      if (!a.portraitHistory.some((h) => h.key === a.portrait!.key)) {
        // Drop the prompt on the way into history: it is ~600 bytes and the
        // save holds one of these per portrait per nemesis.
        a.portraitHistory.push({ ...a.portrait, prompt: '' });
      }
      if (a.portraitHistory.length > 8) {
        const dropped = a.portraitHistory.splice(0, a.portraitHistory.length - 8);
        for (const h of dropped) void this.portraits.delete(h.key);
      }
    }
    a.portrait = entry;
    void fromCache;
    this.events.onContentReady?.(n.id, 'portrait');
    this.events.onDirty?.();
  }

  private noteFirst(): void {
    if (this.hasGeneratedThisSession) return;
    this.hasGeneratedThisSession = true;
    this.events.onFirstGeneration?.();
  }

  /* ============================================================
     long-game expression — same queue, same cache, never sim state
     ============================================================ */

  get generationScope(): number {
    return this.scope;
  }

  /**
   * Call when a long-game run begins, is abandoned, or is replaced.
   * Pending god-layer jobs are dropped; in-flight results are discarded on
   * arrival because their captured scope no longer matches.
   */
  invalidateGodWork(): void {
    this.scope++;
    this.queue.dropPending((t) => GOD_AI_KINDS.has(t.kind));
  }

  /** Wipe every pending request (save reset / world wipe). */
  invalidateAllWork(): void {
    this.scope++;
    this.queue.dropPending();
    this.overlays.clear();
  }

  /** Test-only: swap the text provider. Pass null to restore the real one. */
  installHarness(cfg: AIHarnessConfig | null): void {
    this.harness = cfg ? new HarnessTextProvider(cfg) : null;
    this.events.onStatusChange?.();
  }

  peekOverlay(key: string): string | null {
    return this.overlays.get(key) ?? this.textCache.get(key);
  }

  overlayCount(): number {
    return this.overlays.size;
  }

  /**
   * Fire-and-forget text for a long-game presentation slot. Always returns
   * immediately. Cached hits are adopted without a request. Callers must
   * supply a validator that returns '' to reject.
   */
  expressText(opts: {
    kind: AIRequestKind;
    subjectId: string;
    label: string;
    cacheKey: string;
    priority: number;
    system: string;
    user: string;
    maxTokens: number;
    validate: (raw: string) => string;
  }): void {
    if (!this.canText('chronicles')) return;
    if (this.overlays.has(opts.cacheKey)) return;

    const cached = this.textCache.get(opts.cacheKey);
    if (cached) {
      this.overlays.set(opts.cacheKey, cached);
      this.queue.noteCacheHit(opts.kind, opts.subjectId, opts.label, opts.cacheKey);
      this.events.onContentReady?.(opts.subjectId, opts.kind);
      return;
    }
    if (this.queue.has(opts.cacheKey) || !this.queue.canRetry(opts.cacheKey)) return;
    if (opts.priority < 70 && this.queue.queuedCount >= 8) return;

    const scope = this.scope;
    const key = opts.cacheKey;
    this.queue.enqueue({
      kind: opts.kind,
      nemesisId: opts.subjectId,
      label: opts.label,
      priority: opts.priority,
      cacheKey: key,
      run: async () => {
        const res = await this.provider().generate(opts.system, opts.user, { maxTokens: opts.maxTokens });
        if (!res.ok) throw new Error(res.error);
        if (scope !== this.scope) return;
        const text = opts.validate(res.text);
        if (!text) throw new Error('rejected');
        this.textCache.set(key, text, opts.user);
        this.overlays.set(key, text);
        this.noteFirst();
        this.events.onContentReady?.(opts.subjectId, opts.kind);
        this.events.onDirty?.();
      },
    });
  }

  /* ============================================================
     validation — the anti-invention guard
     ============================================================ */

  private clean(s: string): string {
    return s
      .replace(/^["'`\s]+|["'`\s]+$/g, '')
      .replace(/^[-*\d.)\s]+/, '')
      .replace(/\*\*/g, '')
      .trim();
  }

  /**
   * A title must be short, must be an epithet, and must not smuggle in the
   * nemesis's name or a claim we cannot check. Anything else is discarded and
   * the local title stands.
   */
  private validateTitle(raw: string, n: Nemesis): string {
    let t = this.clean(raw).split('\n')[0];
    t = this.clean(t).toUpperCase();
    if (!t) return '';
    if (!t.startsWith('THE ')) t = 'THE ' + t;
    if (t.length > 34 || t.length < 6) return '';
    if (!/^THE [A-Z'’\- ]{2,28}$/.test(t)) return '';
    if (t.includes(n.name.toUpperCase())) return '';
    if (this.assertsUnknownFact(t, n)) return '';
    return t;
  }

  private validateTaunts(raw: string, n: Nemesis): string[] {
    const out: string[] = [];
    for (const line of raw.split('\n')) {
      const t = this.clean(line);
      if (!t) continue;
      if (t.split(/\s+/).length > 12) continue;
      if (t.length > 90) continue;
      if (this.assertsUnknownFact(t, n)) continue;
      out.push(t);
      if (out.length === 3) break;
    }
    return out;
  }

  private validateChronicle(raw: string, n: Nemesis): string {
    const t = this.clean(raw).replace(/\s+/g, ' ');
    if (t.length < 20 || t.length > 700) return '';
    if (this.assertsUnknownFact(t, n)) return '';
    return t;
  }

  /**
   * A targeted check for the failure mode the brief calls out: the model
   * claiming a mechanical fact the simulation never produced. We only test
   * claims we can actually adjudicate — fire, the lost eye, theft, coming back
   * from the dead, and having killed the player. A false negative here is
   * harmless flavour; a false positive just means we keep the local text.
   */
  private scrubFactTokens(text: string, n: Nemesis): string {
    let t = text;
    const strip: string[] = [n.name, this.world.ageName];
    for (const id of n.rivalries ?? []) strip.push(this.world.nameOf(id));
    if (n.master) strip.push(this.world.nameOf(n.master));
    for (const id of n.allies ?? []) strip.push(this.world.nameOf(id));
    for (const item of n.stolen) strip.push(item.name);
    for (const raw of strip.filter(Boolean).sort((a, b) => b.length - a.length)) {
      if (raw.length < 2) continue;
      t = t.replace(new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
    }
    return t;
  }

  private assertsUnknownFact(text: string, n: Nemesis): boolean {
    const t = this.scrubFactTokens(text, n).toLowerCase();

    const burned =
      n.scars.some((s) => s.id === 'burn') ||
      n.strengths.includes('fire_resist') ||
      n.memory.some((m) => m.type === 'PLAYER_BURNED_ME');
    if (/\b(fire|burn|burnt|burned|flame|cinder|ember|scorch)\w*/.test(t) && !burned) return true;
    if (/\bash\b/.test(t) && !burned) return true;

    const lostEye = n.scars.some((s) => s.id === 'missing_eye');
    if (/\b(eye|eyeless|blind|socket)\w*/.test(t) && !lostEye) return true;

    if (/\b(stole|stolen|took your|your spear|your blade|your sword)\b/.test(t) && !n.stolen.length) {
      return true;
    }

    if (/\b(returned from|came back from|rose from|undead|resurrect)\w*/.test(t) && n.returns === 0) {
      return true;
    }

    if (/\b(killed you|murdered you|slew you|your corpse|your body)\b/.test(t) && n.killsAgainstPlayer === 0) {
      return true;
    }

    return false;
  }

  /* ============================================================
     status, for the indicator and the debug panel
     ============================================================ */

  status(): {
    provider: string;
    connected: boolean;
    verified: boolean;
    mode: AIMode;
    queued: number;
    active: number;
    cachedText: number;
    cachedPortraits: number;
    last: AIRequest | null;
    error: string;
    backendReachable: boolean;
  } {
    const s = this.backend.status;
    const harnessOn = Boolean(this.harness);
    return {
      provider: harnessOn ? this.harness!.name : s.provider,
      connected: harnessOn ? this.harness!.isAvailable() : s.connected,
      verified: harnessOn ? this.harness!.isAvailable() : s.verified,
      mode: this.settings.mode,
      queued: this.queue.queuedCount,
      active: this.queue.activeCount,
      cachedText: this.textCache.size,
      cachedPortraits: this.portraits.count,
      last: this.queue.last,
      error: harnessOn ? '' : s.error,
      backendReachable: harnessOn ? true : this.backend.reachable,
    };
  }

  /** Indicator colour state. */
  indicator(): 'off' | 'idle' | 'busy' | 'error' {
    if (this.settings.mode === 'off') return 'off';
    if (this.harness) {
      if (!this.harness.isAvailable()) return 'error';
      if (this.queue.busy) return 'busy';
      return 'idle';
    }
    const textOk = this.backend.textAvailable;
    if ((this.settings.mode === 'text' || this.settings.mode === 'full') && !textOk) return 'error';
    if (this.queue.busy) return 'busy';
    if (this.backend.status.error && !textOk) return 'error';
    return 'idle';
  }

  clearCaches(): void {
    this.textCache.clear();
    this.overlays.clear();
    void this.portraits.clear();
    this.events.onStatusChange?.();
  }
}
