/**
 * Per-kind presentation clocks. Seconds from sequence start.
 * Intros stay under ~2.5s. Nothing here writes combat state.
 */

import type { EncounterKind } from './EncounterKind';

export type BeatAction =
  | 'audio_duck'
  | 'audio_sting'
  | 'focus'
  | 'camera'
  | 'pose'
  | 'vfx'
  | 'show_name'
  | 'show_line'
  | 'show_portrait'
  | 'show_chip'
  | 'callout'
  | 'celebrate'
  | 'last_words'
  | 'slowmo'
  | 'shake'
  | 'resume';

export interface EncounterBeat {
  t: number;
  action: BeatAction;
}

export function beatsFor(kind: EncounterKind, shortened: boolean): EncounterBeat[] {
  if (shortened && isCardIntro(kind)) {
    return [
      { t: 0.0, action: 'audio_sting' },
      { t: 0.05, action: 'show_name' },
      { t: 0.2, action: 'show_line' },
      { t: 0.9, action: 'resume' },
    ];
  }

  switch (kind) {
    case 'FIRST_MEETING':
      return [
        { t: 0.0, action: 'audio_duck' },
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.08, action: 'vfx' },
        { t: 0.16, action: 'pose' },
        { t: 0.32, action: 'show_name' },
        { t: 0.7, action: 'show_line' },
        { t: 0.95, action: 'show_portrait' },
        { t: 1.55, action: 'resume' },
      ];
    case 'RETURNING_RIVAL':
      return [
        { t: 0.0, action: 'audio_duck' },
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.08, action: 'vfx' },
        { t: 0.16, action: 'pose' },
        { t: 0.32, action: 'show_name' },
        { t: 0.4, action: 'show_chip' },
        { t: 0.65, action: 'show_line' },
        { t: 0.9, action: 'show_portrait' },
        { t: 1.55, action: 'resume' },
      ];
    case 'REVENGE_ENCOUNTER':
      return [
        { t: 0.0, action: 'audio_duck' },
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.04, action: 'shake' },
        { t: 0.1, action: 'vfx' },
        { t: 0.18, action: 'pose' },
        { t: 0.32, action: 'show_name' },
        { t: 0.4, action: 'show_chip' },
        { t: 0.65, action: 'show_line' },
        { t: 0.9, action: 'show_portrait' },
        { t: 1.55, action: 'resume' },
      ];
    case 'AMBUSH':
      return [
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.18, action: 'pose' },
        { t: 0.38, action: 'show_name' },
        { t: 0.58, action: 'show_line' },
        { t: 1.2, action: 'resume' },
      ];
    case 'INTERRUPTION':
      return [
        { t: 0.0, action: 'audio_sting' },
        { t: 0.08, action: 'callout' },
        { t: 0.2, action: 'vfx' },
        { t: 0.35, action: 'pose' },
        { t: 0.7, action: 'show_line' },
        { t: 1.2, action: 'resume' },
      ];
    case 'PROMOTION_REVEAL':
      return [
        { t: 0.0, action: 'audio_duck' },
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.1, action: 'vfx' },
        { t: 0.18, action: 'pose' },
        { t: 0.34, action: 'show_name' },
        { t: 0.42, action: 'show_chip' },
        { t: 0.7, action: 'show_line' },
        { t: 0.95, action: 'show_portrait' },
        { t: 1.65, action: 'resume' },
      ];
    case 'OVERLORD_ENCOUNTER':
      return [
        { t: 0.0, action: 'audio_duck' },
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.08, action: 'shake' },
        { t: 0.12, action: 'vfx' },
        { t: 0.22, action: 'pose' },
        { t: 0.4, action: 'show_name' },
        { t: 0.75, action: 'show_line' },
        { t: 1.0, action: 'show_portrait' },
        { t: 1.9, action: 'resume' },
      ];
    case 'RESURRECTION_RETURN':
      return [
        { t: 0.0, action: 'audio_duck' },
        { t: 0.0, action: 'audio_sting' },
        { t: 0.0, action: 'focus' },
        { t: 0.08, action: 'vfx' },
        { t: 0.2, action: 'pose' },
        { t: 0.4, action: 'show_portrait' },
        { t: 0.55, action: 'show_name' },
        { t: 0.85, action: 'show_line' },
        { t: 2.05, action: 'resume' },
      ];
    case 'ESCAPE':
      return [
        { t: 0.0, action: 'audio_sting' },
        { t: 0.05, action: 'callout' },
        { t: 0.1, action: 'vfx' },
        { t: 0.2, action: 'show_line' },
        { t: 1.2, action: 'resume' },
      ];
    case 'PLAYER_DEFEATED':
      return [
        { t: 0.0, action: 'focus' },
        { t: 0.0, action: 'shake' },
        { t: 0.05, action: 'slowmo' },
        { t: 0.15, action: 'celebrate' },
        { t: 0.35, action: 'show_portrait' },
        { t: 0.45, action: 'show_name' },
        { t: 0.7, action: 'show_line' },
        { t: 0.9, action: 'show_chip' },
        { t: 2.4, action: 'resume' },
      ];
    case 'NEMESIS_DEFEATED':
      return [
        { t: 0.0, action: 'shake' },
        { t: 0.05, action: 'slowmo' },
        { t: 0.1, action: 'vfx' },
        { t: 0.2, action: 'last_words' },
        { t: 0.35, action: 'show_name' },
        { t: 0.55, action: 'show_portrait' },
        { t: 1.6, action: 'resume' },
      ];
    case 'FAKE_DEATH':
      return [
        { t: 0.0, action: 'audio_sting' },
        { t: 0.08, action: 'callout' },
        { t: 0.15, action: 'vfx' },
        { t: 0.3, action: 'show_line' },
        { t: 1.3, action: 'resume' },
      ];
  }
}

export function sequenceDuration(kind: EncounterKind, shortened: boolean): number {
  const beats = beatsFor(kind, shortened);
  let max = 0;
  for (const b of beats) if (b.t > max) max = b.t;
  return max + 0.05;
}

export function isCalloutKind(kind: EncounterKind): boolean {
  return kind === 'ESCAPE' || kind === 'FAKE_DEATH' || kind === 'INTERRUPTION';
}

/** Full arrivals that take the camera. Ambush snaps without slow-mo. */
export function isFocusKind(kind: EncounterKind): boolean {
  return (
    kind === 'FIRST_MEETING' ||
    kind === 'RETURNING_RIVAL' ||
    kind === 'REVENGE_ENCOUNTER' ||
    kind === 'AMBUSH' ||
    kind === 'PROMOTION_REVEAL' ||
    kind === 'OVERLORD_ENCOUNTER' ||
    kind === 'RESURRECTION_RETURN' ||
    kind === 'PLAYER_DEFEATED'
  );
}

function isCardIntro(kind: EncounterKind): boolean {
  return (
    kind === 'FIRST_MEETING' ||
    kind === 'RETURNING_RIVAL' ||
    kind === 'REVENGE_ENCOUNTER' ||
    kind === 'AMBUSH' ||
    kind === 'PROMOTION_REVEAL' ||
    kind === 'OVERLORD_ENCOUNTER' ||
    kind === 'RESURRECTION_RETURN'
  );
}
