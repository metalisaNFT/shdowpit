/**
 * Archive compact summaries before raw chronicle trim.
 */

import type { SaveData, ChronicleArchive } from '../core/SaveSystem';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { rankIndex } from '../nemesis/Nemesis';
import { scoreEvent } from '../story/StoryImportance';
import type { WorldEvent } from '../world/WorldEvent';

export const MAX_LOG = 600;
export const QUOTA_TRIM = 400;

const PLAYER_TYPES = new Set([
  'player_death',
  'player_kill',
  'player_escape',
  'player_spared',
  'extraction',
  'vendetta',
  'overlord_slain',
]);

function isKeepEvent(ev: WorldEvent, roster: Map<string, import('../nemesis/Nemesis').Nemesis>): boolean {
  if (PLAYER_TYPES.has(ev.type) || ev.witnessed || ev.important) return true;
  return scoreEvent(ev, ev.turn, roster).total >= 28;
}

function summarizeSlice(events: WorldEvent[], age: number, fromTurn: number, toTurn: number): string {
  const deaths = events.filter((e) => e.type === 'death' || e.type === 'player_kill' || e.type === 'assassination').length;
  const promotions = events.filter((e) => e.type === 'promotion').length;
  const betrayals = events.filter((e) => e.type === 'betrayal').length;
  const player = events.filter((e) => PLAYER_TYPES.has(e.type)).length;
  const parts: string[] = [];
  if (player) parts.push(`${player} moment${player === 1 ? '' : 's'} you touched the world`);
  if (betrayals) parts.push(`${betrayals} betrayal${betrayals === 1 ? '' : 's'}`);
  if (promotions) parts.push(`${promotions} rise${promotions === 1 ? '' : 's'}`);
  if (deaths) parts.push(`${deaths} death${deaths === 1 ? '' : 's'}`);
  const body = parts.length ? parts.join(', ') + '.' : 'Quiet turns passed.';
  return `Age ${age}, turns ${fromTurn}–${toTurn}: ${body}`;
}

/** Build and store a compact archive slice from events about to be dropped. */
export function archiveAgeSlice(mgr: NemesisManager, eventsToDrop: WorldEvent[]): ChronicleArchive | null {
  if (!eventsToDrop.length) return null;
  const roster = new Map(mgr.roster.map((n) => [n.id, n]));
  const keep = eventsToDrop.filter((e) => isKeepEvent(e, roster));
  if (!keep.length) return null;

  const fromTurn = eventsToDrop[0].turn;
  const toTurn = eventsToDrop[eventsToDrop.length - 1].turn;
  const deaths: string[] = [];
  const promotions: string[] = [];
  for (const ev of keep) {
    if (ev.type === 'death' || ev.type === 'player_kill' || ev.type === 'assassination') {
      for (const id of ev.actors) if (!deaths.includes(id)) deaths.push(id);
    }
    if (ev.type === 'promotion') {
      for (const id of ev.actors) {
        const n = roster.get(id);
        if (n && rankIndex(n.rank) >= 2 && !promotions.includes(id)) promotions.push(id);
      }
    }
  }

  const archive: ChronicleArchive = {
    age: eventsToDrop[0].age,
    fromTurn,
    toTurn,
    summary: summarizeSlice(keep, eventsToDrop[0].age, fromTurn, toTurn),
    keyEventIds: keep.map((e) => e.id!).filter(Boolean),
    deaths,
    promotions,
  };

  mgr.data.chronicleArchives ??= [];
  mgr.data.chronicleArchives.push(archive);
  return archive;
}

/** Trim event log, archiving first when over cap. Returns events removed. */
export function trimEventLog(mgr: NemesisManager, max = MAX_LOG): WorldEvent[] {
  const log = mgr.data.eventLog;
  if (log.length <= max) return [];
  const dropCount = log.length - max;
  const toDrop = log.splice(0, dropCount);
  archiveAgeSlice(mgr, toDrop);
  return toDrop;
}

/** On save quota failure: archive then trim harder. */
export function trimForQuota(data: SaveData): void {
  const stub = { data, roster: data.nemeses } as NemesisManager;
  if (data.eventLog.length > QUOTA_TRIM) {
    const drop = data.eventLog.length - QUOTA_TRIM;
    archiveAgeSlice(stub, data.eventLog.splice(0, drop));
  }
}

/** Archive boundary when world age advances. */
export function archiveSyntheticAgeBoundary(data: SaveData, age: number, turn: number): void {
  data.chronicleArchives ??= [];
  const recent = data.eventLog.filter((e) => e.age === age && e.turn <= turn);
  if (!recent.length) return;
  const summary = `Age ${age} closed at turn ${turn}. ${recent.filter((e) => e.important || e.witnessed).length} notable beats recorded.`;
  data.chronicleArchives.push({
    age,
    fromTurn: recent[0].turn,
    toTurn: turn,
    summary,
    keyEventIds: recent.filter((e) => e.important || e.witnessed).map((e) => e.id!).filter(Boolean),
    deaths: recent.filter((e) => e.type === 'death').flatMap((e) => e.actors),
    promotions: recent.filter((e) => e.type === 'promotion').flatMap((e) => e.actors),
  });
}
