/**
 * Compact character story beats reconstructed from memories, scars, and events.
 */

import type { Nemesis } from '../nemesis/Nemesis';
import type { SaveData } from '../core/SaveSystem';
import { AREA_NAMES } from '../data/names';
import { SCAR_NAMES } from '../nemesis/NemesisMemory';
import { rankName } from '../nemesis/NemesisManager';
import { MEMORY_TEXT } from '../nemesis/NemesisMemory';

export interface CharacterBeat {
  turn: number;
  text: string;
  eventId?: string;
  related: string[];
}

export function characterBeats(n: Nemesis, data: SaveData): CharacterBeat[] {
  const beats: CharacterBeat[] = [];
  beats.push({
    turn: n.bornTurn,
    text: n.bornTurn <= 1 ? `Already held rank when you arrived.` : `First appeared on turn ${n.bornTurn}.`,
    related: [],
  });

  const firstMeet = n.memory.find((m) => m.type === 'I_KILLED_PLAYER' || m.type === 'PLAYER_KILLED_ME' || m.type === 'I_ESCAPED_PLAYER');
  if (firstMeet) {
    beats.push({
      turn: firstMeet.turn,
      text: `First met in ${AREA_NAMES[n.territory] ?? n.territory}.`,
      related: firstMeet.subject ? [firstMeet.subject] : [],
    });
  }

  for (const m of n.memory) {
    const other = m.subject ? data.nemeses.find((x) => x.id === m.subject) : undefined;
    let text = MEMORY_TEXT[m.type];
    if (m.type === 'I_STOLE_PLAYER_WEAPON' && n.stolen[0]) text = `Killed you and took ${n.stolen[0].name}.`;
    if (m.type === 'I_WAS_PROMOTED') text = `Promoted — now ${rankName(n.rank)}.`;
    if (m.type === 'I_RETURNED_FROM_DEATH') {
      const scar = n.scars.find((s) => s.turn === m.turn);
      text = scar ? `Returned bearing ${SCAR_NAMES[scar.id].toLowerCase()}.` : 'Returned from death.';
    }
    if (other) text = `${text} (${other.name})`;
    const ev = data.eventLog.find((e) => e.turn === m.turn && e.actors.includes(n.id));
    beats.push({ turn: m.turn, text, eventId: ev?.id, related: m.subject ? [m.subject] : [] });
  }

  for (const s of n.scars) {
    beats.push({
      turn: s.turn,
      text: `${SCAR_NAMES[s.id]}${s.cause ? ` — ${s.cause}` : ''}.`,
      related: [],
    });
  }

  if (n.stolen.length) {
    beats.push({
      turn: data.worldTurn,
      text: `Now carries ${n.stolen.map((s) => s.name).join(', ')}.`,
      related: [],
    });
  }

  const holder = Object.entries(data.territories).find(([, id]) => id === n.id);
  if (holder) {
    beats.push({
      turn: data.worldTurn,
      text: `Now controls ${AREA_NAMES[holder[0]] ?? holder[0]}.`,
      related: [],
    });
  }

  beats.sort((a, b) => a.turn - b.turn);
  const seen = new Set<string>();
  return beats.filter((b) => {
    const k = `${b.turn}:${b.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
