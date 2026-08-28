/**
 * Comic Director — importance scoring + panel selection.
 * Named nemesis attack slice → exactly 4 panels (intro/attack/impact/outcome).
 */

import type { ComicPanelRole, EncounterStory, StoryBeat } from './Types';

export const SLICE_ROLES: ComicPanelRole[] = ['intro', 'attack', 'impact', 'outcome'];

export function scoreBeatImportance(beat: StoryBeat): number {
  let s = beat.importance;
  if (beat.critical) s += 25;
  if (beat.role === 'intro') s += 10;
  if (beat.role === 'impact') s += 15;
  if (beat.outcome === 'player_dead' || beat.outcome === 'enemy_dead') s += 30;
  if (beat.damage >= 40) s += 8;
  if (beat.rank === 'overlord' || beat.rank === 'warlord') s += 12;
  else if (beat.rank === 'captain') s += 6;
  return s;
}

/**
 * Pick up to `limit` beats covering preferred roles (slice default 4).
 * Fills missing roles from the highest-scoring remaining beats.
 */
export function selectPanels(story: EncounterStory, roles: ComicPanelRole[] = SLICE_ROLES): StoryBeat[] {
  const wanted = [...roles];
  const picked: StoryBeat[] = [];
  const used = new Set<string>();

  for (const role of wanted) {
    const candidates = story.beats
      .filter((b) => b.role === role && !used.has(b.id))
      .map((b) => ({ b, s: scoreBeatImportance(b) }))
      .sort((a, c) => c.s - a.s);
    if (candidates[0]) {
      picked.push(candidates[0].b);
      used.add(candidates[0].b.id);
    }
  }

  // If a role was missing, promote next-best unused beat
  if (picked.length < wanted.length) {
    const rest = story.beats
      .filter((b) => !used.has(b.id))
      .map((b) => ({ b, s: scoreBeatImportance(b) }))
      .sort((a, c) => c.s - a.s);
    for (const r of rest) {
      if (picked.length >= wanted.length) break;
      picked.push(r.b);
      used.add(r.b.id);
    }
  }

  // Stable role order for the viewer
  const order = new Map(wanted.map((r, i) => [r, i]));
  picked.sort((a, b) => (order.get(a.role) ?? 99) - (order.get(b.role) ?? 99) || a.atMs - b.atMs);
  return picked;
}

export function shouldOpenViewer(story: EncounterStory, panelsReady: number): boolean {
  return panelsReady >= Math.min(4, story.selectedRoles.length || 4);
}
