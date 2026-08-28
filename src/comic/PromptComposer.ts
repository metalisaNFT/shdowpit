/**
 * Prompt composer — facts from EncounterStory only.
 * AI may illustrate; it must not invent combat outcomes.
 */

import type { ComicStyleProfile, StoryBeat } from './Types';

export function composePanelPrompt(beat: StoryBeat, style: ComicStyleProfile, extra = ''): string {
  const bits = [
    'SHDOWPIT arena combat comic panel',
    `named foe ${beat.nemesisName}`,
    beat.title ? `titled ${beat.title}` : '',
    `rank ${beat.rank}`,
    beat.weapon ? `wielding ${beat.weapon}` : '',
    beat.attackLabel ? `attack ${beat.attackLabel}` : '',
    beat.critical ? 'CRITICAL IMPACT' : '',
    beat.role === 'intro' ? 'dramatic introduction stance' : '',
    beat.role === 'attack' ? 'mid-swing aggression' : '',
    beat.role === 'impact' ? 'moment of impact, motion blur, debris' : '',
    beat.role === 'outcome'
      ? beat.outcome === 'player_dead'
        ? 'victor standing over fallen challenger'
        : beat.outcome === 'enemy_dead'
          ? 'foe defeated on the ground'
          : 'aftermath stillness'
      : '',
    `location ${beat.locationName}`,
    beat.relationshipNote,
    style.promptSuffix,
    extra,
  ];
  return bits.filter(Boolean).join(', ');
}
