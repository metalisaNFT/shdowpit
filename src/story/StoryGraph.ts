/**
 * Relationship graph from live roster + event history. Never invents bonds.
 */

import type { SaveData } from '../core/SaveSystem';
import type { WorldEvent } from '../world/WorldEvent';
import { AREA_NAMES } from '../data/names';
import { SCAR_NAMES } from '../nemesis/NemesisMemory';
import { PLAYER_ID, type StoryEdge, type StoryNode } from './StoryTypes';
import { scoreEdge, scoreNode, scorePlayerNode } from './StoryImportance';

export interface GraphBuild {
  nodes: StoryNode[];
  edges: StoryEdge[];
  nodeScores: Record<string, ReturnType<typeof scoreNode> | ReturnType<typeof scorePlayerNode>>;
}

function lastEventBetween(log: WorldEvent[], a: string, b: string, types?: Set<string>): WorldEvent | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i];
    if (types && !types.has(ev.type)) continue;
    if (ev.actors.includes(a) && ev.actors.includes(b)) return ev;
  }
  return undefined;
}

function lastEventOf(log: WorldEvent[], id: string, type: string): WorldEvent | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i];
    if (ev.type === type && ev.actors[0] === id) return ev;
  }
  return undefined;
}

export function buildStoryGraph(data: SaveData, opts?: { revealUnknown?: boolean }): GraphBuild {
  const reveal = opts?.revealUnknown ?? false;
  const roster = new Map(data.nemeses.map((n) => [n.id, n]));
  const log = data.eventLog;
  const nodes: StoryNode[] = [];
  const nodeScores: GraphBuild['nodeScores'] = {};

  for (const arch of data.chronicleArchives ?? []) {
    nodes.push({
      id: `arch-${arch.age}-${arch.fromTurn}`,
      kind: 'nemesis',
      name: `AGE ${arch.age}`,
      title: 'ARCHIVED HISTORY',
      rank: 'captain',
      alive: false,
      territory: 'pit',
      weapon: '',
      unresolved: arch.deaths.length > 0,
      importance: 40 + arch.keyEventIds.length,
      playerRel: 0,
      killsYou: 0,
      youKilled: 0,
      knowledge: 'known',
    });
  }

  const pScore = scorePlayerNode(data.playerMeta);
  nodeScores[PLAYER_ID] = pScore;
  nodes.push({
    id: PLAYER_ID,
    kind: 'player',
    name: 'YOU',
    title: 'THE INTRUDER',
    rank: 'player',
    alive: true,
    territory: 'pit',
    weapon: data.playerMeta.equipped,
    unresolved: data.playerMeta.lostWeapons.length > 0,
    importance: pScore.total,
    playerRel: 0,
    killsYou: 0,
    youKilled: 0,
    knowledge: 'known',
  });

  const ov = data.nemeses.find((n) => n.alive && n.rank === 'overlord');
  for (const n of data.nemeses) {
    if (!n.persistent && n.killsAgainstPlayer === 0 && n.defeatsByPlayer === 0) continue;
    const sc = scoreNode(n, data.worldTurn, ov?.id === n.id);
    nodeScores[n.id] = sc;
    const known = reveal || n.killsAgainstPlayer + n.defeatsByPlayer + n.escapedPlayer > 0 || n.rank !== 'grunt';
    nodes.push({
      id: n.id,
      kind: 'nemesis',
      name: n.name,
      title: n.title,
      rank: n.rank,
      alive: n.alive,
      territory: n.territory,
      weapon: n.stolen[0]?.name ?? n.weapon,
      scar: n.scars.length ? SCAR_NAMES[n.scars[n.scars.length - 1].id] : undefined,
      stolen: n.stolen[0]?.name,
      unresolved: !!(n.stolen.length || (n.alive && n.killsAgainstPlayer > 0) || (!n.alive && n.revengeChance > 0.35)),
      importance: sc.total,
      playerRel: n.playerRelationship,
      killsYou: n.killsAgainstPlayer,
      youKilled: n.defeatsByPlayer,
      knowledge: known ? 'known' : 'rumored',
    });
  }

  const edges: StoryEdge[] = [];
  const seen = new Set<string>();
  const push = (e: StoryEdge) => {
    const key = [e.kind, e.from, e.to].join(':');
    const rev = [e.kind, e.to, e.from].join(':');
    if (seen.has(key) || (!e.directed && seen.has(rev))) return;
    seen.add(key);
    edges.push(e);
  };

  for (const arch of data.chronicleArchives ?? []) {
    for (const id of arch.deaths) {
      if (!roster.has(id)) continue;
      push({
        id: `arch-death-${arch.age}-${id}`,
        from: id,
        to: PLAYER_ID,
        kind: 'revenge',
        directed: true,
        importance: 24,
        spectral: true,
        label: 'ARCHIVED DEATH',
        why: arch.summary,
        eventId: arch.keyEventIds[0],
        eventText: arch.summary,
      });
    }
  }

  const livingIds = new Set(data.nemeses.filter((n) => n.alive).map((n) => n.id));

  for (const n of data.nemeses) {
    if (!roster.has(n.id)) continue;
    // Player bonds
    if (n.killsAgainstPlayer > 0 || n.stolen.length || n.playerRelationship >= 18) {
      const revenge = n.alive && (n.killsAgainstPlayer > 0 || n.stolen.length > 0);
      const ev =
        lastEventOf(log, n.id, 'player_death') ??
        lastEventOf(log, n.id, 'weapon_theft') ??
        lastEventOf(log, n.id, 'player_kill');
      push({
        id: `p-${n.id}`,
        from: n.id,
        to: PLAYER_ID,
        kind: revenge ? 'revenge' : n.playerRelationship > 0 ? 'rival' : 'rival',
        directed: true,
        importance: scoreEdge('revenge', n, null, true) + n.killsAgainstPlayer * 8,
        spectral: !n.alive,
        label: n.stolen.length ? 'HOLDS YOUR WEAPON' : n.killsAgainstPlayer ? 'KILLED YOU' : 'RIVAL',
        why: n.stolen.length
          ? `${n.name} carries ${n.stolen[0].name}.`
          : n.killsAgainstPlayer
            ? `${n.name} has killed you ${n.killsAgainstPlayer} time${n.killsAgainstPlayer > 1 ? 's' : ''}.`
            : `${n.name} has unfinished business with you.`,
        eventId: ev?.id,
        eventText: ev?.text,
      });
    }
    if (n.stolen.length) {
      push({
        id: `steal-${n.id}`,
        from: n.id,
        to: PLAYER_ID,
        kind: 'stolen_weapon',
        directed: true,
        importance: scoreEdge('stolen_weapon', n, null, true),
        spectral: !n.alive,
        label: n.stolen[0].name,
        why: `${n.name} still holds ${n.stolen[0].name}.`,
        eventId: lastEventOf(log, n.id, 'weapon_theft')?.id ?? lastEventOf(log, n.id, 'player_death')?.id,
        eventText: lastEventOf(log, n.id, 'weapon_theft')?.text,
      });
    }

    for (const rid of n.rivalries) {
      const other = roster.get(rid);
      if (!other) continue;
      const ev = lastEventBetween(log, n.id, rid, new Set(['revenge', 'duel', 'betrayal', 'territory']));
      push({
        id: `rival-${n.id}-${rid}`,
        from: n.id,
        to: rid,
        kind: 'rival',
        directed: false,
        importance: scoreEdge('rival', n, other, false),
        spectral: !n.alive || !other.alive,
        label: 'RIVAL',
        why: `${n.name} and ${other.name} are rivals.`,
        eventId: ev?.id,
        eventText: ev?.text,
      });
    }

    for (const aid of n.allies) {
      const other = roster.get(aid);
      if (!other) continue;
      const ev = lastEventBetween(log, n.id, aid, new Set(['alliance', 'recruitment']));
      push({
        id: `ally-${n.id}-${aid}`,
        from: n.id,
        to: aid,
        kind: 'ally',
        directed: false,
        importance: scoreEdge('ally', n, other, false),
        spectral: !n.alive || !other.alive,
        label: 'ALLY',
        why: `${n.name} and ${other.name} are allied.`,
        eventId: ev?.id,
        eventText: ev?.text,
      });
    }

    if (n.master) {
      const m = roster.get(n.master);
      if (m) {
        const ev = lastEventBetween(log, n.id, m.id, new Set(['alliance', 'promotion', 'recruitment']));
        push({
          id: `master-${n.id}`,
          from: n.id,
          to: n.master,
          kind: 'master',
          directed: true,
          importance: scoreEdge('master', n, m, false),
          spectral: !n.alive || !m.alive,
          label: 'SERVES',
          why: `${n.name} serves ${m.name}.`,
          eventId: ev?.id,
          eventText: ev?.text,
        });
      }
    }
  }

  // Former alliances and betrayals from the log
  const alliedAt = new Map<string, number>();
  for (const ev of log) {
    if (ev.type === 'alliance' && ev.actors[0] && ev.actors[1]) {
      alliedAt.set([ev.actors[0], ev.actors[1]].sort().join('|'), ev.turn);
    }
    if (ev.type === 'betrayal' && ev.actors[0] && ev.actors[1]) {
      const a = roster.get(ev.actors[0]);
      const b = roster.get(ev.actors[1]);
      push({
        id: `betray-${ev.id ?? ev.turn}-${ev.actors[0]}`,
        from: ev.actors[0],
        to: ev.actors[1],
        kind: 'betrayal',
        directed: true,
        importance: scoreEdge('betrayal', a ?? null, b ?? null, false),
        spectral: !(livingIds.has(ev.actors[0]) && livingIds.has(ev.actors[1])),
        label: 'BETRAYED',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
      const key = [ev.actors[0], ev.actors[1]].sort().join('|');
      if (alliedAt.has(key)) {
        push({
          id: `former-${key}`,
          from: ev.actors[0],
          to: ev.actors[1],
          kind: 'former_ally',
          directed: false,
          importance: scoreEdge('former_ally', a ?? null, b ?? null, false),
          spectral: true,
          label: 'BROKEN OATH',
          why: 'They were allied, then one turned.',
          eventId: ev.id,
          eventText: ev.text,
        });
      }
    }
    if (ev.type === 'territory' && ev.actors.length >= 2) {
      const a = roster.get(ev.actors[0]);
      const b = roster.get(ev.actors[1]);
      push({
        id: `terr-${ev.id ?? ev.turn}`,
        from: ev.actors[0],
        to: ev.actors[1],
        kind: 'territory_war',
        directed: true,
        importance: scoreEdge('territory_war', a ?? null, b ?? null, false),
        spectral: false,
        label: ev.payload?.areaId ? AREA_NAMES[ev.payload.areaId] ?? ev.payload.areaId : 'GROUND',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
    }
    if (
      (ev.type === 'dungeon_cleared' || ev.type === 'dungeon_delved' || ev.type === 'dungeon_reopened') &&
      ev.actors[0]
    ) {
      push({
        id: `dungeon-${ev.id ?? ev.turn}`,
        from: ev.actors[0],
        to: PLAYER_ID,
        kind: 'territory_war',
        directed: true,
        importance: ev.type === 'dungeon_cleared' ? 30 : 20,
        spectral: !livingIds.has(ev.actors[0]),
        label: ev.type === 'dungeon_cleared' ? 'DUNGEON CLEARED' : ev.type === 'dungeon_reopened' ? 'DUNGEON REOPENED' : 'DUNGEON DELVED',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
    }
    if (ev.type === 'quest_complete' && ev.actors[0]) {
      push({
        id: `quest-${ev.id ?? ev.turn}`,
        from: ev.actors[0],
        to: PLAYER_ID,
        kind: 'territory_war',
        directed: true,
        importance: 22,
        spectral: !livingIds.has(ev.actors[0]),
        label: 'QUEST DONE',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
    }
    if (ev.type === 'biome_gather' && ev.actors[0]) {
      push({
        id: `gather-${ev.id ?? ev.turn}`,
        from: ev.actors[0],
        to: PLAYER_ID,
        kind: 'territory_war',
        directed: true,
        importance: 16,
        spectral: !livingIds.has(ev.actors[0]),
        label: 'GATHERED',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
    }
    if (ev.type === 'feral_incident' && ev.actors[0]) {
      push({
        id: `feral-${ev.id ?? ev.turn}`,
        from: ev.actors[0],
        to: PLAYER_ID,
        kind: 'territory_war',
        directed: true,
        importance: 18,
        spectral: !livingIds.has(ev.actors[0]),
        label: 'FERAL INCIDENT',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
    }
    if (ev.type === 'weapon_theft' && ev.actors[0] && ev.actors[1]) {
      const thief = roster.get(ev.actors[0]);
      const victim = roster.get(ev.actors[1]);
      push({
        id: `wep-${ev.id ?? ev.turn}`,
        from: ev.actors[0],
        to: ev.actors[1],
        kind: 'stolen_weapon',
        directed: true,
        importance: scoreEdge('stolen_weapon', thief ?? null, victim ?? null, ev.actors.includes(PLAYER_ID)),
        spectral: !thief?.alive,
        label: ev.payload?.itemName ?? 'STOLEN',
        why: ev.text,
        eventId: ev.id,
        eventText: ev.text,
      });
    }
  }

  return { nodes, edges, nodeScores };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
