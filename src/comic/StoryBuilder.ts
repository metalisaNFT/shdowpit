/**
 * Build EncounterStory + beats from simulation facts.
 */

import type { ComicOutcomeKind, ComicPanelRole, EncounterStory, StoryBeat } from './Types';

export interface StorySeed {
  nemesisId: string;
  nemesisName: string;
  title: string;
  rank: string;
  weapon: string;
  locationName: string;
  relationshipNote: string;
}

let beatSeq = 1;
let storySeq = 1;

function beatId(): string {
  return `beat_${beatSeq++}`;
}

export function createStory(seed: StorySeed): EncounterStory {
  return {
    id: `story_${storySeq++}`,
    startedAt: Date.now(),
    nemesisId: seed.nemesisId,
    nemesisName: seed.nemesisName,
    title: seed.title,
    rank: seed.rank,
    weapon: seed.weapon,
    locationName: seed.locationName,
    relationshipNote: seed.relationshipNote,
    beats: [],
    selectedRoles: ['intro', 'attack', 'impact', 'outcome'],
  };
}

function baseBeat(story: EncounterStory, role: ComicPanelRole, partial: Partial<StoryBeat>): StoryBeat {
  return {
    id: beatId(),
    role,
    importance: 50,
    atMs: Date.now() - story.startedAt,
    nemesisId: story.nemesisId,
    nemesisName: story.nemesisName,
    title: story.title,
    rank: story.rank,
    weapon: story.weapon,
    attackId: '',
    attackLabel: '',
    critical: false,
    damage: 0,
    playerHpFrac: 1,
    enemyHpFrac: 1,
    outcome: null,
    locationName: story.locationName,
    relationshipNote: story.relationshipNote,
    narration: '',
    speech: '',
    sfx: '',
    preferredShot: role === 'intro' ? 'low_hero' : role === 'attack' ? 'over_shoulder' : role === 'impact' ? 'dutch_impact' : 'wide',
    ...partial,
  };
}

export function addIntroBeat(story: EncounterStory, speech = '', narration = ''): StoryBeat {
  const b = baseBeat(story, 'intro', {
    importance: 70,
    speech: speech || `${story.nemesisName.toUpperCase()} ENTERS`,
    narration: narration || `A named foe steps into ${story.locationName}.`,
    sfx: 'ARRIVAL',
  });
  story.beats.push(b);
  return b;
}

export function addAttackBeat(
  story: EncounterStory,
  opts: { attackId: string; attackLabel: string; damage: number; playerHpFrac: number; enemyHpFrac: number; speech?: string }
): StoryBeat {
  const b = baseBeat(story, 'attack', {
    importance: 60 + Math.min(20, opts.damage / 3),
    attackId: opts.attackId,
    attackLabel: opts.attackLabel,
    damage: opts.damage,
    playerHpFrac: opts.playerHpFrac,
    enemyHpFrac: opts.enemyHpFrac,
    speech: opts.speech || '',
    narration: `${story.nemesisName} strikes with ${opts.attackLabel || story.weapon}.`,
    sfx: 'SWING',
  });
  story.beats.push(b);
  return b;
}

export function addImpactBeat(
  story: EncounterStory,
  opts: { critical: boolean; damage: number; playerHpFrac: number; enemyHpFrac: number; attackLabel?: string }
): StoryBeat {
  const b = baseBeat(story, 'impact', {
    importance: opts.critical ? 95 : 75,
    critical: opts.critical,
    damage: opts.damage,
    playerHpFrac: opts.playerHpFrac,
    enemyHpFrac: opts.enemyHpFrac,
    attackLabel: opts.attackLabel || '',
    narration: opts.critical ? 'CRITICAL HIT' : 'THE BLOW LANDS',
    sfx: opts.critical ? 'CRIT!' : 'HIT',
    preferredShot: 'dutch_impact',
  });
  story.beats.push(b);
  return b;
}

/** Player landed a meaningful hit on a named foe. */
export function addPlayerImpactBeat(
  story: EncounterStory,
  opts: { damage: number; critical: boolean; playerHpFrac: number; enemyHpFrac: number; attackLabel?: string; narration?: string }
): StoryBeat {
  const b = baseBeat(story, 'impact', {
    importance: opts.critical ? 88 : 68,
    critical: opts.critical,
    damage: opts.damage,
    playerHpFrac: opts.playerHpFrac,
    enemyHpFrac: opts.enemyHpFrac,
    attackLabel: opts.attackLabel || '',
    narration: opts.narration || (opts.critical ? 'YOUR BLADE BREAKS THEIR GUARD' : 'YOU FIND AN OPENING'),
    sfx: opts.critical ? 'CRIT!' : 'CLANG',
    preferredShot: 'over_shoulder',
  });
  story.beats.push(b);
  return b;
}

export function addOutcomeBeat(
  story: EncounterStory,
  outcome: ComicOutcomeKind,
  opts: { playerHpFrac: number; enemyHpFrac: number; speech?: string; narration?: string }
): StoryBeat {
  const lines: Record<ComicOutcomeKind, { narration: string; sfx: string; speech: string }> = {
    player_hurt: { narration: 'You still stand.', sfx: 'CLANG', speech: opts.speech || '' },
    player_dead: { narration: `${story.nemesisName} ends the run.`, sfx: 'DEAD', speech: opts.speech || 'FALL.' },
    enemy_dead: { narration: `${story.nemesisName} is finished.`, sfx: 'SLAY', speech: opts.speech || '' },
    enemy_escaped: { narration: `${story.nemesisName} slips away.`, sfx: 'ESCAPE', speech: opts.speech || '' },
    stalemate: { narration: 'The pit waits.', sfx: '…', speech: opts.speech || '' },
  };
  const L = lines[outcome];
  const b = baseBeat(story, 'outcome', {
    importance: 90,
    outcome,
    playerHpFrac: opts.playerHpFrac,
    enemyHpFrac: opts.enemyHpFrac,
    narration: opts.narration || L.narration,
    speech: L.speech,
    sfx: L.sfx,
    preferredShot: 'wide',
  });
  story.beats.push(b);
  return b;
}

/**
 * Force a complete 4-beat named-attack story for the vertical slice / F1.
 */
export function buildForceSliceStory(seed: StorySeed, opts?: { critical?: boolean; outcome?: ComicOutcomeKind }): EncounterStory {
  const story = createStory(seed);
  addIntroBeat(story, `"${seed.nemesisName.toUpperCase()}"`, `${seed.title || seed.rank} enters the frame.`);
  addAttackBeat(story, {
    attackId: 'force_strike',
    attackLabel: seed.weapon || 'blade',
    damage: 28,
    playerHpFrac: 0.72,
    enemyHpFrac: 0.9,
    speech: 'FOR THE PIT',
  });
  addImpactBeat(story, {
    critical: opts?.critical !== false,
    damage: 48,
    playerHpFrac: 0.4,
    enemyHpFrac: 0.88,
    attackLabel: seed.weapon || 'blade',
  });
  addOutcomeBeat(story, opts?.outcome ?? 'player_hurt', {
    playerHpFrac: 0.4,
    enemyHpFrac: 0.88,
    narration: 'The blow lands. The story continues.',
  });
  return story;
}
