/**
 * Image providers.
 *
 * Same shape as the text providers: the game asks for a portrait and gets a
 * data URL or a failure. It never learns which service drew it.
 */

import type { AIImageProvider, AIImageResult } from './AITypes';
import type { AIBackend } from './AIBackend';

/** Used when portraits are off; the procedural SVG stands in. */
export class NullImageProvider implements AIImageProvider {
  readonly name = 'procedural';

  isAvailable(): boolean {
    return false;
  }

  async generate(): Promise<AIImageResult> {
    return { ok: false, dataUrl: '', error: 'Image AI disabled', latencyMs: 0 };
  }
}

export class BackendImageProvider implements AIImageProvider {
  readonly name = 'openai';

  constructor(private backend: AIBackend) {}

  isAvailable(): boolean {
    return this.backend.imageAvailable;
  }

  async generate(prompt: string): Promise<AIImageResult> {
    if (!this.isAvailable()) {
      return { ok: false, dataUrl: '', error: 'Not connected', latencyMs: 0 };
    }
    const res = await this.backend.image(prompt);
    return { ok: res.ok, dataUrl: res.dataUrl, error: res.error, latencyMs: res.latencyMs };
  }
}
