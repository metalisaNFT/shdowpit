/**
 * Deterministic recap copy. AI may rewrite later from this snapshot only.
 */

import type { WorldEvent, WorldEventType } from '../world/WorldEvent';
import type { Nemesis } from '../nemesis/Nemesis';
import { AREA_NAMES } from '../data/names';

export interface CopyLayers {
  headline: string;
  line: string;
  detail: string;
}

function pickVariant(seed: string, variants: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return variants[Math.abs(h) % variants.length]!;
}

const HEAD: Partial<Record<WorldEventType, string>> = {
  player_death: 'THEY TOOK YOU',
  player_kill: 'YOU CUT THEM DOWN',
  betrayal: 'THE KNIFE TURNED',
  promotion: 'SOMEONE ROSE',
  demotion: 'SOMEONE FELL',
  resurrection: 'THE GRAVE OPENED',
  weapon_theft: 'YOUR BLADE MOVED',
  territory: 'GROUND CHANGED HANDS',
  succession: 'THE SEAT CHANGED',
  overlord_slain: 'THE CROWN FELL',
  age_begins: 'A NEW AGE',
  vendetta: 'A MARK WAS SETTLED',
  extraction: 'YOU WALKED OUT',
  alliance: 'AN OATH WAS SWORN',
  revenge: 'A NAME WAS TAKEN AS ENEMY',
  assassination: 'SOMEONE DIED IN THE DARK',
  enemy_escape: 'THEY GOT AWAY',
  player_spared: 'YOU LEFT THEM ALIVE',
  death: 'SOMEONE DIED',
  injury: 'A SCAR WAS EARNED',
  duel: 'A DUEL WAS FOUGHT',
};

export function copyForEvent(ev: WorldEvent, names: Map<string, Nemesis>): CopyLayers {
  const who = ev.actors.map((id) => names.get(id)?.name ?? '').filter(Boolean);
  const a = who[0] ?? 'SOMEONE';
  const b = who[1];
  const area = ev.payload?.areaId ? AREA_NAMES[ev.payload.areaId] ?? ev.payload.areaId : '';
  let headline = HEAD[ev.type] ?? ev.type.replace(/_/g, ' ').toUpperCase();
  let line = ev.text;
  let detail = ev.witnessed ? 'You were there.' : 'This happened while you were gone.';
  if (!ev.known) detail = 'Rumor. Not confirmed.';

  switch (ev.type) {
    case 'player_death':
      headline = 'THEY TOOK YOU';
      line = b ? `${a} killed you.` : `${a} killed you.`;
      break;
    case 'player_kill':
      headline = 'YOU LEFT A BODY';
      line = `You killed ${a}.`;
      break;
    case 'player_spared':
      headline = 'YOU LEFT A RIVAL ALIVE';
      line = `${a} still walks, and remembers.`;
      break;
    case 'weapon_theft':
      headline = 'YOUR BLADE MOVED AGAIN';
      line = ev.payload?.recoveredFrom
        ? `You took ${ev.payload.itemName ?? 'your weapon'} back from ${ev.payload.recoveredFrom}.`
        : ev.payload?.itemName
          ? `${a} claimed ${ev.payload.itemName}${b ? ` from ${b}` : ''}.`
          : line;
      break;
    case 'territory':
      headline = area ? `${area} CHANGED HANDS` : 'THE GROUND CHANGED';
      line = pickVariant(ev.id ?? `${ev.turn}:${ev.type}`, [
        b ? `${a} drove ${b} off the ground.` : `${a} seized the ground.`,
        b ? `${a} took ${area || 'the ground'} from ${b}.` : `${a} claimed new ground.`,
        area ? `${area} answered to ${a} now.` : `${a} shifted the map.`,
      ]);
      break;
    case 'betrayal':
      headline = 'THE OATH BROKE';
      line = b ? `${a} turned on ${b}.` : line;
      break;
    case 'promotion':
      headline = ev.payload?.rankTo === 'overlord' ? 'A NEW OVERLORD' : 'THEY CLIMBED';
      line = ev.payload?.rankTo ? `${a} became ${ev.payload.rankTo}.` : line;
      break;
    case 'resurrection':
      headline = 'NOT AS DEAD AS YOU THOUGHT';
      line = `${a} walked out of the dark.`;
      break;
    case 'extraction':
      headline = 'YOU LEFT THE PIT';
      line = 'You extracted. The world kept turning without a corpse.';
      break;
    case 'overlord_slain':
      headline = 'YOU TOOK THE SEAT';
      line = `${a} is dead. The crown is loose.`;
      break;
    default:
      if (ev.type === 'duel') {
        line = pickVariant(ev.id ?? `${ev.turn}:${ev.type}`, [
          line,
          b ? `${a} and ${b} settled it in the open.` : `${a} fought and won.`,
          b ? `${a} left ${b} on the ground.` : `${a} walked away standing.`,
        ]);
      } else if (ev.type === 'death') {
        line = pickVariant(ev.id ?? `${ev.turn}:${ev.type}`, [line, `${a} did not get up.`, `${a} is gone.`]);
      }
      break;
  }

  return { headline: headline.toUpperCase(), line, detail };
}

export function groupHeadline(type: WorldEventType, count: number, sample: string): string {
  if (type === 'duel') return `${count} DUELS WERE FOUGHT`;
  if (type === 'territory') return `GROUND CHANGED HANDS ${count} TIMES`;
  if (type === 'injury') return `${count} SCARS WERE TAKEN`;
  return `${count} ${type.replace(/_/g, ' ').toUpperCase()} EVENTS — ${sample}`;
}
