/**
 * A small priority queue for AI requests.
 *
 * Two properties matter, and both are about not breaking the game:
 *
 *  1. Nothing here ever blocks a frame. `enqueue` returns immediately; the
 *     caller gets a promise it is free to ignore. The game loop never awaits.
 *  2. A task that throws is caught here and turned into a failed request, so
 *     an AI outage can never surface as an unhandled rejection.
 *
 * Priority ordering follows the design brief: the nemesis you are currently
 * fighting outranks an introduction, which outranks your killer, which
 * outranks the Overlord, and background history comes last.
 */

import type { AIRequest, AIRequestKind, AIRequestState } from './AITypes';

export interface QueueTask {
  kind: AIRequestKind;
  nemesisId: string;
  label: string;
  priority: number;
  cacheKey: string;
  run: () => Promise<void>;
}

export class AIQueue {
  private pending: Array<{ task: QueueTask; req: AIRequest }> = [];
  private active = 0;
  private nextId = 1;
  /** Bounded history for the debug panel. */
  private log: AIRequest[] = [];
  /** Cache keys currently queued or running, so we never ask twice. */
  private inFlight = new Set<string>();

  maxConcurrent = 2;

  onChange: (() => void) | null = null;

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.pending.length;
  }

  get busy(): boolean {
    return this.active > 0 || this.pending.length > 0;
  }

  /** Requests currently queued or generating, highest priority first. */
  get live(): AIRequest[] {
    return this.log.filter((r) => r.state === 'queued' || r.state === 'generating');
  }

  get history(): AIRequest[] {
    return this.log;
  }

  get last(): AIRequest | null {
    return this.log.length ? this.log[this.log.length - 1] : null;
  }

  has(cacheKey: string): boolean {
    return this.inFlight.has(cacheKey);
  }

  /**
   * Drop queued (not yet generating) work. In-flight tasks keep running; the
   * caller is expected to reject their results via a generation scope check.
   * Marks dropped requests failed so the status notices can expire.
   */
  dropPending(pred?: (task: QueueTask) => boolean): number {
    let n = 0;
    const keep: typeof this.pending = [];
    for (const p of this.pending) {
      if (!pred || pred(p.task)) {
        this.inFlight.delete(p.task.cacheKey);
        p.req.state = 'failed';
        p.req.error = 'dropped';
        p.req.finishedAt = Date.now();
        n++;
      } else {
        keep.push(p);
      }
    }
    this.pending = keep;
    if (n) this.notify();
    return n;
  }

  /**
   * Queue a task. Returns the request record so callers can watch its state;
   * the returned object is mutated in place as the request progresses.
   */
  enqueue(task: QueueTask): AIRequest {
    const req: AIRequest = {
      id: this.nextId++,
      kind: task.kind,
      nemesisId: task.nemesisId,
      label: task.label,
      priority: task.priority,
      state: 'queued',
      startedAt: 0,
      finishedAt: 0,
      latencyMs: 0,
      error: '',
      cacheKey: task.cacheKey,
    };
    this.inFlight.add(task.cacheKey);
    this.pending.push({ task, req });
    this.pending.sort((a, b) => b.req.priority - a.req.priority);
    this.push(req);
    this.notify();
    // Deliberately not awaited: the caller must never be able to stall a frame.
    void this.drain();
    return req;
  }

  /** Record a cache hit so it shows up in the status UI as CACHED. */
  noteCacheHit(kind: AIRequestKind, nemesisId: string, label: string, cacheKey: string): AIRequest {
    const req: AIRequest = {
      id: this.nextId++,
      kind,
      nemesisId,
      label,
      priority: 0,
      state: 'cached',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      latencyMs: 0,
      error: '',
      cacheKey,
    };
    this.push(req);
    this.notify();
    return req;
  }

  private push(req: AIRequest): void {
    this.log.push(req);
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  private setState(req: AIRequest, state: AIRequestState): void {
    req.state = state;
    this.notify();
  }

  private notify(): void {
    try {
      this.onChange?.();
    } catch {
      /* a broken listener must not take the queue down */
    }
  }

  private async drain(): Promise<void> {
    while (this.active < this.maxConcurrent && this.pending.length) {
      const next = this.pending.shift();
      if (!next) break;
      this.active++;
      const { task, req } = next;
      req.startedAt = Date.now();
      this.setState(req, 'generating');

      // Fire and forget, with every failure path contained.
      void (async () => {
        try {
          await task.run();
          req.state = 'complete';
        } catch (err) {
          req.state = 'failed';
          req.error = String((err as Error)?.message ?? err).slice(0, 120);
        } finally {
          req.finishedAt = Date.now();
          req.latencyMs = req.finishedAt - req.startedAt;
          this.active--;
          this.inFlight.delete(req.cacheKey);
          this.notify();
          void this.drain();
        }
      })();
    }
  }

  clear(): void {
    for (const p of this.pending) this.inFlight.delete(p.req.cacheKey);
    this.pending = [];
    this.notify();
  }
}
