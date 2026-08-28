/**
 * Swappable comic style profiles. AI prompt suffixes + potato post knobs.
 */

import type { ComicStyleProfile } from './Types';

export const STYLE_INK_PIT: ComicStyleProfile = {
  id: 'ink_pit',
  label: 'Ink Pit',
  promptSuffix:
    'brutalist comic panel, bold ink outlines, high contrast chiaroscuro, limited palette charcoal and blood red, graphic novel frame, no speech balloons, no text, no watermark',
  negativePrompt: 'photorealistic, blurry, watermark, text, speech bubble, logo, extra limbs',
  contrast: 1.35,
  inkStrength: 0.55,
  grain: 0.12,
  halftone: 0.22,
  borderPx: 6,
  inkColor: '#0a0a0a',
  paperTint: '#e8e0d4',
};

export const STYLE_PROFILES: Record<string, ComicStyleProfile> = {
  ink_pit: STYLE_INK_PIT,
};

export function styleProfile(id: string | undefined | null): ComicStyleProfile {
  return STYLE_PROFILES[id ?? ''] ?? STYLE_INK_PIT;
}
