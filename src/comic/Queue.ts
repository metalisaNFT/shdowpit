/**
 * Async comic panel queue — never blocks the combat frame loop.
 * Callers enqueue; panels become ready via callbacks.
 */

export type QueueJob = () => Promise<void>;

export class ComicQueue {
  private pending: QueueJob[] = [];
  private active = 0;
  maxConcurrent = 1;
  onChange: (() => void) | null = null;

  get busy(): boolean {
    return this.active > 0 || this.pending.length > 0;
  }

  get queued(): number {
    return this.pending.length;
  }

  get running(): number {
    return this.active;
  }

  enqueue(job: QueueJob): void {
    this.pending.push(job);
    this.notify();
    queueMicrotask(() => void this.drain());
  }

  clear(): void {
    this.pending.length = 0;
    this.notify();
  }

  private async drain(): Promise<void> {
    while (this.active < this.maxConcurrent && this.pending.length) {
      const job = this.pending.shift()!;
      this.active++;
      this.notify();
      try {
        await job();
      } catch {
        /* jobs must not reject into the game loop */
      } finally {
        this.active--;
        this.notify();
      }
    }
  }

  private notify(): void {
    try {
      this.onChange?.();
    } catch {
      /* ignore */
    }
  }
}
