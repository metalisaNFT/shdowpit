/**
 * Text providers.
 *
 * The game only ever sees the `AITextProvider` interface, so swapping OpenAI
 * for something else means adding a class here and changing one line in
 * AIContentService. Nothing in ui/, combat/, world/ or nemesis/ names a vendor.
 */

import type { AITextProvider, AITextResult } from './AITypes';
import type { AIBackend } from './AIBackend';

/** Used when AI is off or unreachable. Always unavailable, never called. */
export class NullTextProvider implements AITextProvider {
  readonly name = 'local';

  isAvailable(): boolean {
    return false;
  }

  async generate(): Promise<AITextResult> {
    return { ok: false, text: '', error: 'AI disabled', latencyMs: 0 };
  }
}

/**
 * Talks to the game's backend, which routes to OpenAI or the LOCAL AI ENGINE
 * per the provider setting. Available when EITHER route can serve.
 */
export class BackendTextProvider implements AITextProvider {
  readonly name = 'openai';

  constructor(private backend: AIBackend) {}

  isAvailable(): boolean {
    return this.backend.textAvailable;
  }

  async generate(
    system: string,
    user: string,
    opts: { maxTokens?: number; json?: boolean } = {}
  ): Promise<AITextResult> {
    if (!this.isAvailable()) {
      return { ok: false, text: '', error: 'Not connected', latencyMs: 0 };
    }
    const res = await this.backend.text(system, user, {
      maxTokens: opts.maxTokens ?? 260,
      json: opts.json,
      temperature: 0.95,
    });
    return { ok: res.ok, text: res.text, error: res.error, latencyMs: res.latencyMs };
  }
}
