/**
 * Shared effect dispatch with proc safeguards.
 * Combat owns the verbs; this only decides whether a hook may fire again.
 */

import type { EffectTrigger } from './Types';

const MAX_CHAIN = 3;

export interface TriggerOpts {
  scope?: string;
  cooldown?: number;
  onceKey?: string;
}

export class EffectBus {
  chain = 0;
  private last = new Map<string, number>();
  log: string[] = [];

  beginEvent(): void {
    this.chain = 0;
  }

  /**
   * Semantic combat trigger — cooldown guard keyed by trigger kind.
   * Returns false when the proc chain is saturated or still on cooldown.
   */
  trigger(kind: EffectTrigger, now: number, opts: TriggerOpts = {}): boolean {
    const scope = opts.scope ?? '';
    const key = scope ? `trigger:${kind}:${scope}` : `trigger:${kind}`;
    const onceKey = opts.onceKey ?? (scope ? `${kind}:${scope}` : undefined);
    if (!this.allow(key, now, opts.cooldown ?? 0.12, onceKey)) return false;
    this.note(`TRIGGER ${kind}${scope ? ' ' + scope : ''}`);
    return true;
  }

  /** Returns false if this proc is on cooldown, already used this hit, or too deep. */
  allow(key: string, now: number, cooldown = 0.12, onceKey?: string): boolean {
    if (this.chain >= MAX_CHAIN) {
      this.note(`BLOCK ${key} chain=${this.chain}`);
      return false;
    }
    if (onceKey) {
      const stamp = this.last.get(onceKey) ?? -1;
      if (stamp === now) return false;
      this.last.set(onceKey, now);
    }
    const prev = this.last.get(key) ?? -Infinity;
    if (now - prev < cooldown) return false;
    this.last.set(key, now);
    this.chain++;
    this.note(key);
    return true;
  }

  note(line: string): void {
    this.log.push(line);
    if (this.log.length > 40) this.log.shift();
  }

  dump(): string {
    return this.log.length ? this.log.join('\n') : '(no procs)';
  }
}
