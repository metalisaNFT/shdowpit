/**
 * Quality profiles: Potato → Offline.
 * Potato never needs models; Offline opts into local AI when available.
 */

import type { ComicQualityProfile, ComicQualityProfileId } from './Types';

export const QUALITY_PROFILES: Record<ComicQualityProfileId, ComicQualityProfile> = {
  potato: {
    id: 'potato',
    label: 'Potato',
    captureWidth: 384,
    captureHeight: 288,
    captureDepth: false,
    tryAi: false,
    aiStepsHint: 0,
    maxConcurrent: 1,
    showDelayMs: 0,
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    captureWidth: 512,
    captureHeight: 384,
    captureDepth: true,
    tryAi: true,
    aiStepsHint: 2,
    maxConcurrent: 1,
    showDelayMs: 80,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    captureWidth: 768,
    captureHeight: 576,
    captureDepth: true,
    tryAi: true,
    aiStepsHint: 4,
    maxConcurrent: 1,
    showDelayMs: 120,
  },
  offline: {
    id: 'offline',
    label: 'Offline',
    captureWidth: 1024,
    captureHeight: 768,
    captureDepth: true,
    tryAi: true,
    aiStepsHint: 8,
    maxConcurrent: 1,
    showDelayMs: 200,
  },
};

export function qualityProfile(id: ComicQualityProfileId | undefined | null): ComicQualityProfile {
  return QUALITY_PROFILES[id ?? 'potato'] ?? QUALITY_PROFILES.potato;
}
