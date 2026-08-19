/**
 * Caching for generated content.
 *
 * Two stores, because the two kinds of content have very different sizes:
 *   - text (titles, taunts, chronicles) → localStorage, a few KB total
 *   - portraits (PNG data URLs, ~1 MB each) → IndexedDB, which has room
 *
 * Neither store ever contains an API key. The key lives in the backend's
 * memory and is never sent to the browser in the first place.
 *
 * Cache keys are deterministic: hash(nemesisId + kind + visualVersion +
 * eventVersion). Nothing is regenerated while those versions hold, which is
 * what makes a nemesis's identity stable across encounters and reloads.
 */

const TEXT_KEY = 'shdowpit.ai.text.v1';
const DB_NAME = 'shdowpit-ai';
const DB_STORE = 'portraits';
const MAX_TEXT_ENTRIES = 400;

/** FNV-1a. Short, stable, and good enough for a cache key. */
export function hashKey(...parts: Array<string | number>): string {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

interface TextEntry {
  value: string;
  /** the prompt that produced it, for the debug panel */
  prompt: string;
  at: number;
}

/* ============================================================
   text cache
   ============================================================ */

export class AITextCache {
  private map = new Map<string, TextEntry>();
  private dirty = false;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(TEXT_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, TextEntry>;
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v.value === 'string') this.map.set(k, v);
      }
    } catch {
      /* a corrupt cache is not worth a crash; start empty */
    }
  }

  get(key: string): string | null {
    return this.map.get(key)?.value ?? null;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: string, prompt = ''): void {
    this.map.set(key, { value, prompt, at: Date.now() });
    this.dirty = true;
    this.trim();
    this.flush();
  }

  promptFor(key: string): string {
    return this.map.get(key)?.prompt ?? '';
  }

  get size(): number {
    return this.map.size;
  }

  private trim(): void {
    if (this.map.size <= MAX_TEXT_ENTRIES) return;
    const sorted = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at);
    const drop = sorted.slice(0, this.map.size - MAX_TEXT_ENTRIES);
    for (const [k] of drop) this.map.delete(k);
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      localStorage.setItem(TEXT_KEY, JSON.stringify(Object.fromEntries(this.map)));
      this.dirty = false;
    } catch {
      // Out of quota: drop the oldest half and try once more.
      const sorted = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [k] of sorted.slice(0, Math.floor(sorted.length / 2))) this.map.delete(k);
      try {
        localStorage.setItem(TEXT_KEY, JSON.stringify(Object.fromEntries(this.map)));
        this.dirty = false;
      } catch {
        /* give up quietly — the game does not depend on this */
      }
    }
  }

  clear(): void {
    this.map.clear();
    try {
      localStorage.removeItem(TEXT_KEY);
    } catch {
      /* ignore */
    }
  }
}

/* ============================================================
   portrait store (IndexedDB)
   ============================================================ */

export class AIPortraitStore {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase | null> | null = null;
  /** Portraits already fetched this session, so the UI never waits twice. */
  private memory = new Map<string, string>();
  private known = new Set<string>();

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => resolve(null);
      // Private-browsing modes can hang here; do not block the game on it.
      setTimeout(() => resolve(this.db), 3000);
    });
    return this.opening;
  }

  /** Synchronous peek — only hits entries already loaded this session. */
  peek(key: string): string | null {
    return this.memory.get(key) ?? null;
  }

  async get(key: string): Promise<string | null> {
    const cached = this.memory.get(key);
    if (cached) return cached;
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => {
          const v = typeof req.result === 'string' ? req.result : null;
          if (v) {
            this.memory.set(key, v);
            this.known.add(key);
          }
          resolve(v);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async set(key: string, dataUrl: string): Promise<void> {
    this.memory.set(key, dataUrl);
    this.known.add(key);
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(dataUrl, key);
    } catch {
      /* the in-memory copy still serves this session */
    }
  }

  get count(): number {
    return this.known.size;
  }

  async clear(): Promise<void> {
    this.memory.clear();
    this.known.clear();
    const db = await this.open();
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).clear();
    } catch {
      /* ignore */
    }
  }
}
