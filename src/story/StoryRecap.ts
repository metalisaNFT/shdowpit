/**
 * Run recap and world-turn recap composers. Simulation is already done;
 * this only selects and orders presentation beats.
 */

import type { SaveData } from '../core/SaveSystem';
import type { WorldEvent } from '../world/WorldEvent';
import type { RecapBeat, RecapVfx } from './StoryTypes';
import { scoreEvent } from './StoryImportance';
import { copyForEvent } from './StoryCopy';
import { recogniseArcs } from './StoryArcs';
import { STORY_BUDGET } from './StoryTypes';

const VFX: Partial<Record<WorldEvent['type'], RecapVfx>> = {
  betrayal: 'betrayal',
  promotion: 'promotion',
  death: 'death',
  player_death: 'death',
  player_kill: 'death',
  assassination: 'death',
  resurrection: 'resurrection',
  weapon_theft: 'theft',
  territory: 'territory',
  revenge: 'revenge',
  succession: 'succession',
  overlord_slain: 'succession',
  age_begins: 'age',
};

function vfxFor(ev: WorldEvent): RecapVfx {
  if (ev.type === 'promotion' && ev.payload?.rankTo === 'overlord') return 'succession';
  return VFX[ev.type] ?? 'none';
}

function actFor(ev: WorldEvent, i: number, n: number): RecapBeat['act'] {
  if (ev.type === 'player_death' || ev.type === 'extraction' || ev.type === 'overlord_slain') return 'end';
  if (ev.type === 'age_begins' || ev.type === 'succession' || ev.type === 'territory' || ev.type === 'promotion') {
    return 'consequence';
  }
  if (ev.type === 'betrayal' || ev.type === 'weapon_theft' || ev.type === 'resurrection' || ev.type === 'vendetta') {
    return 'turn';
  }
  if (i === 0) return 'opening';
  if (i >= n - 1) return 'end';
  return 'rising';
}

export function composeWorldTurnRecap(data: SaveData, events: WorldEvent[], killerId?: string): RecapBeat[] {
  const roster = new Map(data.nemeses.map((n) => [n.id, n]));
  const long = events.some(
    (e) =>
      e.type === 'overlord_slain' ||
      e.type === 'succession' ||
      e.type === 'age_begins' ||
      (e.type === 'resurrection' && e.important) ||
      (e.type === 'betrayal' && e.important) ||
      (e.type === 'weapon_theft' && e.payload?.itemKind === 'relic')
  );
  const cap = long ? STORY_BUDGET.recapBeatsLong : STORY_BUDGET.recapBeats;
  const scored = events
    .filter((e) => e.type !== 'heat')
    .map((e) => ({ e, s: scoreEvent(e, data.worldTurn, roster) }))
    .sort((a, b) => b.s.total - a.s.total);

  if (!scored.length && (data.chronicleArchives?.length ?? 0) > 0) {
    const arch = data.chronicleArchives![data.chronicleArchives!.length - 1];
    return [
      {
        act: 'consequence' as const,
        headline: `AGE ${arch.age} — ARCHIVED`,
        line: arch.summary,
        detail: arch.summary,
        actors: [...arch.deaths, ...arch.promotions],
        eventIds: arch.keyEventIds,
        importance: 40,
        vfx: 'age' as const,
      },
    ];
  }

  const picked: typeof scored = [];
  const used = new Set<string>();
  const take = (pred: (x: (typeof scored)[0]) => boolean) => {
    for (const x of scored) {
      const id = x.e.id ?? x.e.text;
      if (used.has(id)) continue;
      if (!pred(x)) continue;
      used.add(id);
      picked.push(x);
      if (picked.length >= cap) break;
    }
  };

  if (killerId) take((x) => x.e.actors.includes(killerId) && x.e.type === 'player_death');
  take((x) => x.e.type === 'betrayal' || x.e.type === 'succession' || x.e.type === 'overlord_slain');
  take((x) => x.e.type === 'weapon_theft' || x.e.type === 'resurrection');
  take((x) => x.e.type === 'territory' || (x.e.type === 'promotion' && x.s.total >= 30));
  take((x) => x.s.total >= 28);
  take(() => picked.length < Math.min(4, cap));

  picked.sort((a, b) => a.e.turn - b.e.turn || a.s.total - b.s.total);

  const beats = picked.slice(0, cap).map((x, i, arr) => {
    const copy = copyForEvent(x.e, roster);
    return {
      act: actFor(x.e, i, arr.length),
      headline: copy.headline,
      line: copy.line,
      detail: copy.detail,
      actors: x.e.actors,
      eventIds: [x.e.id ?? ''],
      importance: x.s.total,
      vfx: vfxFor(x.e),
    } satisfies RecapBeat;
  });

  const arcs = recogniseArcs(data).filter((a) => a.unresolved).slice(0, 1);
  for (const a of arcs) {
    beats.push({
      act: 'consequence',
      headline: a.title,
      line: a.state,
      detail: a.next,
      actors: a.characters,
      eventIds: a.originEventId ? [a.originEventId] : [],
      importance: a.importance,
      vfx: a.kind === 'stolen_weapon' ? 'theft' : a.kind === 'revenge' ? 'revenge' : 'none',
    });
  }
  return beats.slice(0, cap + 1);
}

export function composeRunRecap(data: SaveData, opts: { extracted?: boolean; killerId?: string }): RecapBeat[] {
  const run = data.playerMeta.runs;
  const events = data.eventLog.filter((e) => e.runId === run || (e.witnessed && e.turn === data.worldTurn));
  const pool = events.length ? events : data.eventLog.filter((e) => e.witnessed).slice(-12);
  const beats = composeWorldTurnRecap(data, pool, opts.killerId);
  if (opts.extracted) {
    beats.unshift({
      act: 'end',
      headline: 'YOU LEFT THE PIT',
      line: 'Extraction. The world did not get a corpse.',
      actors: [],
      eventIds: pool.filter((e) => e.type === 'extraction').map((e) => e.id ?? ''),
      importance: 40,
      vfx: 'none',
    });
  }
  const meta = data.playerMeta;
  beats.push({
    act: 'opening',
    headline: 'THE DESCENT',
    line: `Run ${meta.runs}. Weapon ${meta.equipped.toUpperCase()}.`,
    detail: meta.lostWeapons.length ? `Still missing: ${meta.lostWeapons.join(', ')}.` : undefined,
    actors: [],
    eventIds: [],
    importance: 12,
    vfx: 'none',
  });
  const order: RecapBeat['act'][] = ['opening', 'rising', 'turn', 'end', 'consequence'];
  beats.sort((a, b) => order.indexOf(a.act) - order.indexOf(b.act) || b.importance - a.importance);
  return beats.slice(0, 5);
}

export function recapPlainText(beats: RecapBeat[]): string {
  return beats.map((b) => `${b.headline}. ${b.line}${b.detail ? ' ' + b.detail : ''}`).join('\n');
}
