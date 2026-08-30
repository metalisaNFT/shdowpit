/**
 * Turning simulation into something a person can read.
 *
 * The rule the brief set is the right one:
 *   bad        NPC 14 +12 power
 *   good       Rakk defeated Vorg in an ambush and stole his axe
 *   excellent  ...and gained confidence, and Vorg now holds a blood grudge
 *
 * The systems already write the good version, because every beat is composed
 * at the moment the thing happened, with the names and the reasons in scope.
 * This file is the other half: deciding how much of it to show, and when to
 * shut up. A cycle produces roughly a dozen beats and most of them are
 * background — the feed's job is to make the two that matter findable.
 */

import { BEAT_RANK, type Beat, type BeatPriority } from './GodTypes';

export const PRIORITY_LABEL: Record<BeatPriority, string> = {
  background: 'MINOR',
  notable: 'NOTABLE',
  major: 'MAJOR',
  legendary: 'LEGENDARY',
};

/** What the feed shows at each verbosity setting. */
export const FEED_LEVELS: BeatPriority[] = ['background', 'notable', 'major', 'legendary'];

export function atLeast(b: Beat, floor: BeatPriority): boolean {
  return BEAT_RANK[b.priority] >= BEAT_RANK[floor];
}

export function filterFeed(feed: readonly Beat[], floor: BeatPriority, actorId?: string | null): Beat[] {
  return feed.filter((b) => atLeast(b, floor) && (!actorId || b.actors.includes(actorId)));
}

export interface CycleGroup {
  cycle: number;
  beats: Beat[];
  /** the one line that would go in a headline if you only had room for one */
  lead: Beat | null;
}

/** Newest cycle first, because that is what the player is looking for. */
export function groupByCycle(feed: readonly Beat[], floor: BeatPriority = 'notable'): CycleGroup[] {
  const map = new Map<number, Beat[]>();
  for (const b of feed) {
    if (!atLeast(b, floor)) continue;
    const list = map.get(b.cycle);
    if (list) list.push(b);
    else map.set(b.cycle, [b]);
  }
  const out: CycleGroup[] = [];
  for (const [cycle, beats] of map) {
    out.push({ cycle, beats, lead: leadOf(beats) });
  }
  out.sort((a, b) => b.cycle - a.cycle);
  return out;
}

/** Story beats win cycle summaries over background skirmish noise. */
const STORY_LEAD_KINDS = new Set(['betrayal', 'return', 'revenge', 'grudge', 'duel', 'crisis', 'promotion', 'faction', 'quest', 'dungeon', 'deliver']);

function storyLeadScore(b: Beat): number {
  const biomeBoost = b.kind === 'quest' || b.kind === 'dungeon' || b.kind === 'deliver' ? 15 : 0;
  return (STORY_LEAD_KINDS.has(b.kind) ? 100 : 0) + BEAT_RANK[b.priority] * 10 + biomeBoost;
}

export function leadOf(beats: readonly Beat[]): Beat | null {
  let best: Beat | null = null;
  for (const b of beats) {
    if (!best || storyLeadScore(b) > storyLeadScore(best)) best = b;
  }
  return best;
}

/**
 * A one-line summary of a whole cycle, for the acceleration readout where
 * printing every beat would be useless.
 */
export function summariseCycle(cycle: number, beats: readonly Beat[]): string {
  const lead = leadOf(beats);
  const counts = new Map<string, number>();
  for (const b of beats) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  const tail = [...counts.entries()]
    .filter(([k]) => k !== lead?.kind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  if (!lead) return `CYCLE ${cycle} — nothing worth reporting.`;
  return `CYCLE ${cycle} — ${lead.headline}${tail ? `  (${tail})` : ''}`;
}

/** Everything about one character, for the inspector. */
export function threadFor(feed: readonly Beat[], actorId: string): Beat[] {
  return feed.filter((b) => b.actors.includes(actorId));
}

export function beatToneClass(b: Beat): string {
  return `beat-${b.tone}`;
}
