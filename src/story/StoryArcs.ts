/**
 * Story arcs recognised from event sequences and current roster state.
 * "Next" is opportunity or risk, never a guaranteed outcome.
 */

import type { Nemesis } from '../nemesis/Nemesis';
import type { SaveData } from '../core/SaveSystem';
import type { WorldEvent } from '../world/WorldEvent';
import { AREA_NAMES } from '../data/names';
import { PLAYER_ID, type StoryArc } from './StoryTypes';

function lastOf(log: WorldEvent[], pred: (e: WorldEvent) => boolean): WorldEvent | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (pred(log[i])) return log[i];
  return undefined;
}

function texts(log: WorldEvent[], ids: string[], type?: string): string[] {
  const out: string[] = [];
  for (const ev of log) {
    if (type && ev.type !== type) continue;
    if (ev.actors.some((a) => ids.includes(a))) out.push(ev.text);
  }
  return out.slice(-4);
}

export function recogniseArcs(data: SaveData): StoryArc[] {
  const arcs: StoryArc[] = [];
  const log = data.eventLog;
  const byId = new Map(data.nemeses.map((n) => [n.id, n]));

  for (const n of data.nemeses) {
    if (!n.persistent) continue;
    stolenArc(arcs, data, n, log);
    revengeArc(arcs, n, log);
    rivalryArc(arcs, n, byId);
    riseFall(arcs, n, log);
    survivorArc(arcs, n);
    returnedArc(arcs, n, log);
    hunterArc(arcs, n);
    escapeArc(arcs, n);
    imprisonmentArc(arcs, n, byId);
    ransomArc(arcs, n);
    recruitmentArc(arcs, n, byId);
  }

  betrayalArcs(arcs, log, byId);
  brokenAlliance(arcs, log, byId);
  territoryWars(arcs, log, data);
  vendettaArcs(arcs, log, byId);
  successionArc(arcs, log, data);

  arcs.sort((a, b) => b.importance - a.importance);
  return arcs.slice(0, 24);
}

function stolenArc(arcs: StoryArc[], data: SaveData, n: Nemesis, log: WorldEvent[]): void {
  const held = n.stolen[0];
  const thefts = log.filter(
    (e) => e.type === 'weapon_theft' && (e.actors.includes(n.id) || (held && e.payload?.itemName === held.name))
  );
  if (!held && !thefts.length && !data.playerMeta.lostWeapons.length) return;
  if (!held && !thefts.length) return;
  const origin = thefts[0] ?? lastOf(log, (e) => e.type === 'player_death' && e.actors.includes(n.id));
  const unresolved = !!held;
  arcs.push({
    id: `stolen-${n.id}`,
    kind: 'stolen_weapon',
    title: held ? `THE STOLEN ${held.name.toUpperCase()}` : 'A STOLEN WEAPON',
    characters: [n.id, PLAYER_ID, ...thefts.flatMap((t) => t.actors)].filter((v, i, a) => a.indexOf(v) === i),
    originEventId: origin?.id,
    developments: [
      ...thefts.map((t) => t.text),
      held ? `${n.name} currently holds ${held.name}.` : 'The weapon moved on.',
    ].slice(-5),
    state: held ? `${n.name} holds it in ${AREA_NAMES[n.territory] ?? n.territory}.` : 'No longer on this body.',
    next: unresolved ? `Opportunity: kill ${n.name} and recover it.` : 'Resolved — the blade left this hand.',
    unresolved,
    importance: unresolved ? 70 : 20,
  });
}

function revengeArc(arcs: StoryArc[], n: Nemesis, log: WorldEvent[]): void {
  if (n.killsAgainstPlayer <= 0 && n.playerRelationship < 24) return;
  const origin = lastOf(log, (e) => e.type === 'player_death' && e.actors.includes(n.id));
  const unresolved = n.alive && (n.killsAgainstPlayer > 0 || n.revengeChance > 0.25);
  arcs.push({
    id: `revenge-${n.id}`,
    kind: 'revenge',
    title: n.alive ? `${n.name.toUpperCase()} HUNTS YOU` : `${n.name.toUpperCase()} DIED OWING YOU BLOOD`,
    characters: [n.id, PLAYER_ID],
    originEventId: origin?.id,
    developments: texts(log, [n.id], 'player_death').concat(texts(log, [n.id], 'player_kill')).slice(-4),
    state: n.alive ? `Grudge ${Math.round(n.playerRelationship)}. Killed you ${n.killsAgainstPlayer}.` : 'Buried, for now.',
    next: n.alive ? 'Risk: they may hunt you this run.' : n.revengeChance > 0.35 ? 'Risk: they may return.' : 'Quiet.',
    unresolved,
    importance: 40 + n.killsAgainstPlayer * 12 + (n.alive ? 10 : 0),
  });
}

function rivalryArc(arcs: StoryArc[], n: Nemesis, byId: Map<string, Nemesis>): void {
  if (!n.rivalries.length) return;
  const names = n.rivalries.map((id) => byId.get(id)?.name).filter(Boolean);
  if (!names.length) return;
  arcs.push({
    id: `rivalry-${n.id}`,
    kind: 'rivalry',
    title: `${n.name.toUpperCase()}'S RIVALS`,
    characters: [n.id, ...n.rivalries],
    developments: names.map((nm) => `Rival of ${nm}.`),
    state: `${names.length} living rivalry${names.length > 1 ? 'ies' : ''}.`.replace('1 living rivalries', '1 living rivalry'),
    next: 'Risk: they may duel while you are gone.',
    unresolved: n.alive,
    importance: 18 + names.length * 6,
  });
}

function riseFall(arcs: StoryArc[], n: Nemesis, log: WorldEvent[]): void {
  const promo = log.filter((e) => e.type === 'promotion' && e.actors[0] === n.id);
  const demo = log.filter((e) => e.type === 'demotion' && e.actors[0] === n.id);
  if (promo.length >= 2) {
    arcs.push({
      id: `rise-${n.id}`,
      kind: 'rise',
      title: `THE RISE OF ${n.name.toUpperCase()}`,
      characters: [n.id],
      originEventId: promo[0].id,
      developments: promo.map((p) => p.text).slice(-4),
      state: `Now ${n.rank}.`,
      next: n.rank === 'overlord' ? 'They hold the seat.' : 'Opportunity: they may climb further — or be cut down.',
      unresolved: n.alive && n.rank !== 'overlord',
      importance: 22 + promo.length * 8,
    });
  }
  if (demo.length) {
    arcs.push({
      id: `fall-${n.id}`,
      kind: 'fall',
      title: `THE FALL OF ${n.name.toUpperCase()}`,
      characters: [n.id],
      originEventId: demo[0].id,
      developments: demo.map((p) => p.text).slice(-4),
      state: `Now ${n.rank}.`,
      next: n.alive ? 'Risk: the humiliated often betray.' : 'Ended in the dirt.',
      unresolved: n.alive,
      importance: 20 + demo.length * 7,
    });
  }
}

function survivorArc(arcs: StoryArc[], n: Nemesis): void {
  if (n.escapedPlayer + n.returns < 2 && n.personality !== 'survivor') return;
  if (n.escapedPlayer < 1 && n.returns < 1) return;
  arcs.push({
    id: `surv-${n.id}`,
    kind: 'survivor',
    title: `${n.name.toUpperCase()} WILL NOT STAY DOWN`,
    characters: [n.id, PLAYER_ID],
    developments: [
      n.escapedPlayer ? `Escaped you ${n.escapedPlayer} time(s).` : '',
      n.returns ? `Returned from death ${n.returns} time(s).` : '',
    ].filter(Boolean),
    state: n.alive ? 'Still walking.' : 'Down. Maybe not finished.',
    next: 'Risk: they know how you fight.',
    unresolved: n.alive || n.revengeChance > 0.3,
    importance: 24 + n.escapedPlayer * 6 + n.returns * 10,
  });
}

function returnedArc(arcs: StoryArc[], n: Nemesis, log: WorldEvent[]): void {
  if (!n.returns) return;
  const origin = lastOf(log, (e) => e.type === 'resurrection' && e.actors.includes(n.id));
  arcs.push({
    id: `ret-${n.id}`,
    kind: 'returned',
    title: `${n.name.toUpperCase()} RETURNED`,
    characters: [n.id],
    originEventId: origin?.id,
    developments: log.filter((e) => e.type === 'resurrection' && e.actors.includes(n.id)).map((e) => e.text),
    state: n.alive ? 'Walking again.' : 'Died after returning.',
    next: n.alive ? 'They remember the grave.' : 'The door may open once more.',
    unresolved: n.alive,
    importance: 36 + n.returns * 8,
  });
}

function hunterArc(arcs: StoryArc[], n: Nemesis): void {
  if (!(n.killsAgainstPlayer > 0 && n.defeatsByPlayer > 0)) return;
  arcs.push({
    id: `hp-${n.id}`,
    kind: 'hunter_prey',
    title: `HUNTER AND PREY — ${n.name.toUpperCase()}`,
    characters: [n.id, PLAYER_ID],
    developments: [`They killed you ${n.killsAgainstPlayer}. You killed them ${n.defeatsByPlayer}.`],
    state: 'The score is not settled.',
    next: 'Opportunity: the next meeting writes the next number.',
    unresolved: true,
    importance: 44,
  });
}

function escapeArc(arcs: StoryArc[], n: Nemesis): void {
  if (n.escapedPlayer < 2) return;
  arcs.push({
    id: `esc-${n.id}`,
    kind: 'repeated_escape',
    title: `${n.name.toUpperCase()} KEEPS RUNNING`,
    characters: [n.id, PLAYER_ID],
    developments: [`Escaped you ${n.escapedPlayer} times.`],
    state: n.alive ? 'Still at large.' : 'Caught, eventually.',
    next: n.alive ? 'Opportunity: pin them before they flee.' : 'Closed.',
    unresolved: n.alive,
    importance: 20 + n.escapedPlayer * 8,
  });
}

function betrayalArcs(arcs: StoryArc[], log: WorldEvent[], byId: Map<string, Nemesis>): void {
  for (const ev of log) {
    if (ev.type !== 'betrayal' || !ev.actors[0] || !ev.actors[1]) continue;
    const a = byId.get(ev.actors[0]);
    const b = byId.get(ev.actors[1]);
    const stillRivals = !!(a && b && a.rivalries.includes(b.id));
    arcs.push({
      id: `bet-${ev.id ?? ev.turn}`,
      kind: 'betrayal',
      title: 'THE KNIFE',
      characters: ev.actors,
      originEventId: ev.id,
      developments: [ev.text],
      state: stillRivals ? 'The wound is open.' : 'The world moved on.',
      next: stillRivals ? 'Risk: they will meet again.' : 'Resolved enough.',
      unresolved: stillRivals,
      importance: stillRivals ? 48 : 16,
    });
  }
}

function brokenAlliance(arcs: StoryArc[], log: WorldEvent[], byId: Map<string, Nemesis>): void {
  const allies = new Map<string, WorldEvent>();
  for (const ev of log) {
    if (ev.type === 'alliance' && ev.actors[0] && ev.actors[1]) {
      allies.set([ev.actors[0], ev.actors[1]].sort().join('|'), ev);
    }
  }
  for (const ev of log) {
    if (ev.type !== 'betrayal' || !ev.actors[0] || !ev.actors[1]) continue;
    const key = [ev.actors[0], ev.actors[1]].sort().join('|');
    const oath = allies.get(key);
    if (!oath) continue;
    const a = byId.get(ev.actors[0]);
    const b = byId.get(ev.actors[1]);
    const stillAllied = !!(a && b && a.allies.includes(b.id) && b.allies.includes(a.id));
    const open = !stillAllied;
    arcs.push({
      id: `oath-${key}`,
      kind: 'broken_alliance',
      title: 'THE BROKEN OATH',
      characters: ev.actors,
      originEventId: oath.id,
      developments: [oath.text, ev.text],
      state: open ? 'No trust remains.' : 'They found a new shape.',
      next: open ? 'Risk: a challenge, or a hunt.' : 'Quiet.',
      unresolved: open,
      importance: 40,
    });
  }
}

function territoryWars(arcs: StoryArc[], log: WorldEvent[], data: SaveData): void {
  const byArea = new Map<string, WorldEvent[]>();
  for (const ev of log) {
    if (ev.type !== 'territory') continue;
    const area = ev.payload?.areaId ?? 'unknown';
    (byArea.get(area) ?? byArea.set(area, []).get(area)!).push(ev);
  }
  for (const [area, evs] of byArea) {
    if (area === 'unknown' || evs.length < 2) continue;
    const holder = data.territories[area];
    arcs.push({
      id: `tw-${area}`,
      kind: 'territory_war',
      title: `WAR FOR ${AREA_NAMES[area] ?? area.toUpperCase()}`,
      characters: [...new Set(evs.flatMap((e) => e.actors))],
      originEventId: evs[0].id,
      developments: evs.map((e) => e.text).slice(-5),
      state: holder ? `Held by ${byName(data, holder)}.` : 'Unclaimed.',
      next: 'Opportunity: the ground still changes hands.',
      unresolved: true,
      importance: 16 + evs.length * 6,
    });
  }
}

function vendettaArcs(arcs: StoryArc[], log: WorldEvent[], byId: Map<string, Nemesis>): void {
  const byTarget = new Map<string, WorldEvent[]>();
  for (const ev of log) {
    if (ev.type !== 'vendetta' || !ev.actors[0]) continue;
    (byTarget.get(ev.actors[0]) ?? byTarget.set(ev.actors[0], []).get(ev.actors[0])!).push(ev);
  }
  for (const [id, evs] of byTarget) {
    const last = evs[evs.length - 1];
    const done = /complete/i.test(last.text);
    const failed = /failed/i.test(last.text);
    const n = byId.get(id);
    arcs.push({
      id: `ven-${id}`,
      kind: 'vendetta',
      title: `VENDETTA — ${(n?.name ?? id).toUpperCase()}`,
      characters: [id, PLAYER_ID],
      originEventId: evs[0].id,
      developments: evs.map((e) => e.text),
      state: done ? 'Complete.' : failed ? 'Failed.' : 'Open.',
      next: done || failed ? 'The mark is closed.' : 'Opportunity: finish it this run.',
      unresolved: !done && !failed,
      importance: done ? 18 : 50,
    });
  }
}

function successionArc(arcs: StoryArc[], log: WorldEvent[], data: SaveData): void {
  const evs = log.filter((e) => e.type === 'succession' || e.type === 'overlord_slain' || e.type === 'age_begins');
  if (!evs.length) return;
  const ov = data.nemeses.find((n) => n.alive && n.rank === 'overlord');
  arcs.push({
    id: 'succ-world',
    kind: 'succession',
    title: 'THE SEAT',
    characters: ov ? [ov.id] : [],
    originEventId: evs[0].id,
    developments: evs.map((e) => e.text).slice(-5),
    state: ov ? `${ov.name} sits.` : 'No Overlord.',
    next: 'Risk: the crown always draws knives.',
    unresolved: true,
    importance: 34,
  });
}

function byName(data: SaveData, id: string): string {
  return data.nemeses.find((n) => n.id === id)?.name ?? id;
}

function imprisonmentArc(arcs: StoryArc[], n: Nemesis, byId: Map<string, Nemesis>): void {
  const cage = n.memory.find((m) => m.type === 'I_WAS_CAGED_BY');
  if (!cage?.subject) return;
  const jailer = byId.get(cage.subject);
  if (!jailer) return;
  arcs.push({
    id: `cage-${n.id}`,
    kind: 'imprisonment',
    title: `${n.name.toUpperCase()} IN CHAINS`,
    characters: [n.id, cage.subject],
    developments: [`${jailer.name} caged ${n.name}.`],
    state: n.alive ? `${n.name} still lives under ${jailer.name}'s shadow.` : `${n.name} is dead, but the cage is remembered.`,
    next: n.alive ? `Break ${jailer.name} and ${n.name} may crawl free.` : `Watch whether ${jailer.name} keeps the leverage.`,
    unresolved: n.alive,
    importance: 38,
  });
}

function ransomArc(arcs: StoryArc[], n: Nemesis): void {
  const held = n.stolen[0];
  const robbed = n.memory.some((m) => m.type === 'I_WAS_ROBBED_BY');
  if (!held || !robbed) return;
  const thief = n.memory.find((m) => m.type === 'I_WAS_ROBBED_BY')?.subject;
  arcs.push({
    id: `ransom-${n.id}`,
    kind: 'ransom',
    title: held ? `${held.name.toUpperCase()} HELD OVER ${n.name.toUpperCase()}` : 'A DEBT UNPAID',
    characters: [n.id, thief ?? PLAYER_ID].filter((v, i, a) => a.indexOf(v) === i),
    developments: [`${n.name} still carries the grudge of what was taken.`],
    state: `${n.name} wants ${held.name} back.`,
    next: `Force the holder's hand — or let the leverage rot.`,
    unresolved: n.alive && !!held,
    importance: 44,
  });
}

function recruitmentArc(arcs: StoryArc[], n: Nemesis, byId: Map<string, Nemesis>): void {
  const oath = n.memory.find((m) => m.type === 'I_SWORE_TO');
  if (!oath?.subject || !n.master) return;
  const master = byId.get(n.master);
  if (!master) return;
  arcs.push({
    id: `recruit-${n.id}`,
    kind: 'recruitment',
    title: `${n.name.toUpperCase()} SWORE TO ${master.name.toUpperCase()}`,
    characters: [n.id, master.id],
    developments: [`${n.name} bent the knee.`],
    state: `${n.name} serves ${master.name}.`,
    next: `Kill ${master.name} and the oath breaks.`,
    unresolved: n.alive && master.alive,
    importance: 36,
  });
}

export function reopenReturnedArcs(arcs: StoryArc[], n: Nemesis): StoryArc[] {
  return arcs.map((a) => {
    if (!a.characters.includes(n.id)) return a;
    if (a.kind === 'revenge' || a.kind === 'stolen_weapon' || a.kind === 'returned') {
      return { ...a, unresolved: n.alive || a.unresolved, next: n.alive ? a.next : a.next };
    }
    return a;
  });
}
