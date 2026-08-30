/**
 * Pattern matchers over simulation facts — motifs emerge from evidence, never invention.
 */

import type { Nemesis } from '../../nemesis/Nemesis';
import { SCAR_NAMES } from '../../nemesis/NemesisMemory';
import type { NemesisManager } from '../../nemesis/NemesisManager';
import { simOf, type Condition, type GodState } from '../../god/GodTypes';
import type { WorldEvent } from '../../world/WorldEvent';
import type { EvidenceRef, MotifInstance, MotifKind } from './RunStoryTypes';

const REFRAIN: Record<MotifKind, string> = {
  fire: 'Ash keeps finding the same names.',
  debt: 'What was taken still has owners.',
  throne: 'The seat never stays empty.',
  mask: 'Faces change; the grudge does not.',
  knife: 'Trust breaks before bone does.',
  chain: 'Someone always holds the key.',
  crowd: 'Many voices, one outcome.',
  heretic: 'Someone looked up and blamed the sky.',
};

function evRef(ev: WorldEvent): EvidenceRef {
  return { kind: 'event', id: ev.id ?? `t${ev.turn}`, summary: ev.text };
}

function memRef(n: Nemesis, type: string, turn: number, subject?: string): EvidenceRef {
  return {
    kind: 'memory',
    id: `${n.id}:${type}:${turn}`,
    summary: subject ? `${n.name}: ${type} (${subject})` : `${n.name}: ${type}`,
  };
}

function condRef(c: Condition): EvidenceRef {
  return { kind: 'condition', id: c.id, summary: `${c.kind} on ${c.targetId} — ${c.note}` };
}

function scarRef(n: Nemesis, scarId: string): EvidenceRef {
  return { kind: 'scar', id: `${n.id}:${scarId}`, summary: `${n.name}: ${SCAR_NAMES[scarId as keyof typeof SCAR_NAMES] ?? scarId}` };
}

function simRef(n: Nemesis, field: string, value: string | number): EvidenceRef {
  return { kind: 'sim', id: `${n.id}:${field}`, summary: `${n.name}: ${field}=${value}` };
}

function pushMotif(
  map: Map<MotifKind, MotifInstance>,
  kind: MotifKind,
  carrier: string,
  weight: number,
  ref: EvidenceRef
): void {
  const cur = map.get(kind) ?? {
    kind,
    strength: 0,
    carriers: [],
    refrain: REFRAIN[kind],
    evidence: [],
  };
  cur.strength += weight;
  if (carrier && !cur.carriers.includes(carrier)) cur.carriers.push(carrier);
  if (!cur.evidence.some((e) => e.id === ref.id)) cur.evidence.push(ref);
  map.set(kind, cur);
}

export function detectMotifs(mgr: NemesisManager, god: GodState, events?: WorldEvent[]): MotifInstance[] {
  const map = new Map<MotifKind, MotifInstance>();
  const log = events ?? mgr.data.eventLog;

  for (const ev of log) {
    const primary = ev.actors[0];
    if (ev.type === 'betrayal' || ev.type === 'assassination') {
      pushMotif(map, 'knife', primary ?? '', 12, evRef(ev));
    }
    if (ev.type === 'succession' || ev.type === 'overlord_slain' || (ev.type === 'promotion' && ev.payload?.rankTo === 'overlord')) {
      pushMotif(map, 'throne', primary ?? '', 14, evRef(ev));
    }
    if (ev.type === 'weapon_theft' || ev.type === 'bargain') {
      pushMotif(map, 'debt', primary ?? '', 10, evRef(ev));
    }
    if (ev.type === 'territory' || (ev.actors.length >= 3 && ev.important)) {
      for (const id of ev.actors) pushMotif(map, 'crowd', id, 4, evRef(ev));
    }
    if (/fire|burn|ash|flame/i.test(ev.text)) {
      for (const id of ev.actors) pushMotif(map, 'fire', id, 8, evRef(ev));
    }
  }

  for (const n of mgr.roster) {
    for (const s of n.scars) {
      if (s.id === 'burn') pushMotif(map, 'fire', n.id, 10, scarRef(n, s.id));
      if (s.id === 'broken_mask') pushMotif(map, 'mask', n.id, 9, scarRef(n, s.id));
    }
    for (const m of n.memory) {
      if (m.type === 'PLAYER_BURNED_ME') pushMotif(map, 'fire', n.id, 11, memRef(n, m.type, m.turn, m.subject ?? undefined));
      if (m.type === 'I_WAS_ROBBED_BY' || m.type === 'I_STOLE_PLAYER_WEAPON') pushMotif(map, 'debt', n.id, 9, memRef(n, m.type, m.turn, m.subject ?? undefined));
      if (m.type === 'I_WAS_CAGED_BY') pushMotif(map, 'chain', n.id, 10, memRef(n, m.type, m.turn, m.subject ?? undefined));
      if (m.type === 'I_BETRAYED_ALLY' || m.type === 'I_WAS_BETRAYED') pushMotif(map, 'knife', n.id, 8, memRef(n, m.type, m.turn, m.subject ?? undefined));
      if (m.type === 'I_WAS_PROMOTED' && n.rank === 'overlord') pushMotif(map, 'throne', n.id, 7, memRef(n, m.type, m.turn));
    }
    if (n.master) pushMotif(map, 'chain', n.id, 5, simRef(n, 'master', n.master));
    const s = simOf(n);
    if (s.heretic) pushMotif(map, 'heretic', n.id, 14, simRef(n, 'heretic', 1));
    if (s.crisisBorn) pushMotif(map, 'throne', n.id, 6, simRef(n, 'crisisBorn', 1));
  }

  for (const c of god.conditions) {
    if (c.kind === 'omen' || c.kind === 'rumour') {
      pushMotif(map, 'mask', c.targetId, 5, condRef(c));
    }
    if (c.kind === 'bounty' || c.kind === 'curse') {
      pushMotif(map, 'debt', c.targetId, 6, condRef(c));
    }
  }

  if (god.crisis?.kind === 'heresy') {
    pushMotif(map, 'heretic', god.crisis.bodyId ?? 'world', 12, {
      kind: 'sim',
      id: `crisis:heresy`,
      summary: god.crisis.description,
    });
  }

  return [...map.values()].sort((a, b) => b.strength - a.strength);
}

export function dominantMotif(motifs: MotifInstance[]): MotifInstance | null {
  return motifs[0] ?? null;
}
