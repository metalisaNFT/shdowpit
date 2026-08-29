/**
 * Tiny typed pub/sub. Systems talk through this instead of importing each
 * other, which keeps the dependency graph acyclic.
 */

export type Handler<T> = (payload: T) => void;

export class EventBus<Events> {
  private map = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(key: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(key);
    if (!set) {
      set = new Set();
      this.map.set(key, set);
    }
    set.add(fn as Handler<never>);
    return () => {
      set!.delete(fn as Handler<never>);
    };
  }

  once<K extends keyof Events>(key: K, fn: Handler<Events[K]>): () => void {
    const off = this.on(key, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends keyof Events>(key: K, payload: Events[K]): void {
    const set = this.map.get(key);
    if (!set) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const fn of Array.from(set)) {
      try {
        (fn as unknown as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${String(key)}" threw`, err);
      }
    }
  }

  hasListeners(key: keyof Events): boolean {
    return (this.map.get(key)?.size ?? 0) > 0;
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.map.values()) n += set.size;
    return n;
  }

  clear(): void {
    this.map.clear();
  }
}
