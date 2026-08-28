/**
 * In-process text provider for tests.
 *
 * The live backend mock is a canned HTTP fixture. This one sits on the
 * service itself so a harness can delay, fail, timeout, or return malformed
 * copy without standing up OpenAI — and without the game loop awaiting it.
 */

import type { AITextProvider, AITextResult } from './AITypes';

export interface AIHarnessConfig {
  delayMs?: number;
  /** when false, canText() short-circuits and nothing is queued */
  available?: boolean;
  /** available, but generate() fails — exercises the failure path */
  fail?: boolean;
  timeout?: boolean;
  malformed?: boolean;
  /** never resolves; used to prove abandon/reset drops work */
  hang?: boolean;
  textFor?: (system: string, user: string) => string;
}

export function defaultHarnessText(user: string): string {
  const name =
    user.match(/^NAME: ([^\n]+)/m)?.[1] ??
    user.match(/ACTOR ([A-Za-z][A-Za-z'’\-]+)/)?.[1] ??
    user.match(/Give ([^ ]+) a title/)?.[1] ??
    'THEY';

  if (/Give .+ a title/.test(user) || /earned epithets/.test(user)) {
    if (/RANK: overlord/.test(user)) return 'THE SEAT';
    if (/RANK: warlord/.test(user)) return 'THE HOST';
    if (/TIMES THEY RETURNED FROM DEATH: [1-9]/.test(user)) return 'THE RETURNED';
    if (/SCARS:.*BURN/.test(user)) return 'THE ASHEN';
    return 'THE NAMED';
  }
  if (/Write 3 things/.test(user)) {
    return 'Stand still.\nNothing worth remembering.\nThis ends quiet.';
  }
  if (/Summarise the history/.test(user)) {
    return `${name} is still in this world. You have been watching. Nothing else is claimed.`;
  }
  if (/character inspection dossier/.test(user)) {
    return `${name} is the person the facts describe. They want what the facts say they want.`;
  }
  if (/Voice this event/.test(user)) {
    return 'That is what the cycle actually produced.';
  }
  if (/Restate the crisis/.test(user)) {
    return 'The crisis is the one the world already named. It still has to be answered.';
  }
  if (/subtitle for this ended run/.test(user)) {
    return 'The run ended the way the record says it ended.';
  }
  if (/epitaph for this legend/.test(user)) {
    return 'They were here, and the record kept them.';
  }
  if (/Rewrite the recap line/.test(user) || /Rewrite this timeline/.test(user)) {
    return 'The facts stayed the same. The sentence reads cleaner now.';
  }
  if (/Rewrite STATE and NEXT/.test(user)) {
    return 'The thread is still open. What happens next is still theirs to choose.';
  }
  if (/Rewrite the encounter headline/.test(user)) {
    return 'THEY ARE HERE AGAIN';
  }
  if (/Rewrite this consequence link/.test(user)) {
    return 'The mark held, and someone noticed — but they chose on their own.';
  }
  if (/Rewrite the situation headline/.test(user)) {
    return 'Something on the board is about to break.';
  }
  return 'The record stands. Nothing was added.';
}

export class HarnessTextProvider implements AITextProvider {
  readonly name = 'harness';

  constructor(public cfg: AIHarnessConfig = {}) {}

  isAvailable(): boolean {
    if (this.cfg.available === false) return false;
    return true;
  }

  async generate(system: string, user: string): Promise<AITextResult> {
    const delay = Math.max(0, this.cfg.delayMs ?? 40);
    if (this.cfg.hang) {
      return new Promise(() => {
        /* intentionally never settles */
      });
    }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (this.cfg.timeout) {
      return { ok: false, text: '', error: 'Request timed out', latencyMs: delay };
    }
    if (this.cfg.fail) {
      return { ok: false, text: '', error: 'Provider unavailable', latencyMs: delay };
    }
    if (this.cfg.malformed) {
      return {
        ok: true,
        text:
          'THE CINDER-EYED\nYou burned me, stole my eye, killed me with fire, and I rose undead from your corpse.',
        error: '',
        latencyMs: delay,
      };
    }
    const text = this.cfg.textFor?.(system, user) ?? defaultHarnessText(user);
    return { ok: true, text, error: '', latencyMs: delay };
  }
}
