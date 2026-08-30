/**
 * NPC quest ledger — utility-driven, not a player journal.
 */

import { biomeProfile } from '../data/areas';
import { AREA_NAMES } from '../data/names';
import { fullName, type Nemesis } from '../nemesis/Nemesis';
import type { GodContext } from './Context';
import { factionFor, livingFactions } from './Factions';
import { simOf, type GoalId, type NpcQuest, type NpcQuestKind } from './GodTypes';
import { getBiome, getSiteState } from '../world/BiomeState';

export type { NpcQuest, NpcQuestKind, NpcQuestStatus } from './GodTypes';

type QuestSaveData = {
  npcQuests?: NpcQuest[];
  nextQuestId?: number;
  biomes?: Record<string, import('../world/BiomeState').AreaBiomeState>;
};

let nextQuestId = 1;

export function resetQuestCounter(from = 1): void {
  nextQuestId = from;
}

export function ensureQuests(data: QuestSaveData): NpcQuest[] {
  if (!data.npcQuests) data.npcQuests = [];
  return data.npcQuests;
}

export function activeQuests(data: QuestSaveData): NpcQuest[] {
  return ensureQuests(data).filter((q) => q.status === 'active');
}

export function questForAssignee(data: QuestSaveData, assigneeId: string): NpcQuest | undefined {
  return activeQuests(data).find((q) => q.assigneeId === assigneeId);
}

function newQuestId(data: QuestSaveData): string {
  const id = 'q' + nextQuestId.toString(36);
  nextQuestId++;
  data.nextQuestId = Math.max(data.nextQuestId ?? 1, nextQuestId);
  return id;
}

const GOAL_FOR_KIND: Partial<Record<NpcQuestKind, GoalId>> = {
  gather: 'hoard',
  delve: 'climb',
  hunt_feral: 'conquer',
  deliver: 'serve',
  guard_site: 'protect',
  reclaim_cache: 'hoard',
};

export function assignQuests(ctx: GodContext): void {
  const data = ctx.mgr.data;
  const turn = ctx.mgr.turn;

  for (const f of livingFactions(ctx.god)) {
    const leader = ctx.mgr.byId(f.leaderId);
    if (!leader?.alive) continue;
    const treasuryTotal = Object.values(f.treasury ?? {}).reduce((a, b) => a + b, 0);

    if (treasuryTotal < 12) {
      const member = pickMember(ctx, f.memberIds, leader.id);
      if (member && !questForAssignee(data, member.id)) {
        const areaId = f.territories[0] ?? leader.territory;
        const profile = biomeProfile(areaId);
        issueQuest(ctx, {
          assignerId: leader.id,
          assigneeId: member.id,
          kind: treasuryTotal < 6 ? 'delve' : 'gather',
          targetAreaId: areaId,
          materialId: profile.resources[0],
          deadlineTurn: turn + 6,
        });
      }
    }
  }

  for (const area of Object.keys(data.biomes ?? {})) {
    const state = getBiome(data, area);
    if (state.faunaPressure > 0.7) {
      const holder = ctx.mgr.territoryHolder(area);
      if (!holder?.alive) continue;
      const f = factionFor(ctx.god, holder);
      const member = f ? pickMember(ctx, f.memberIds, holder.id) : holder;
      if (member && !questForAssignee(data, member.id)) {
        issueQuest(ctx, {
          assignerId: holder.id,
          assigneeId: member.id,
          kind: 'hunt_feral',
          targetAreaId: area,
          deadlineTurn: turn + 5,
        });
      }
    }

    const profile = biomeProfile(area);
    for (const siteDef of profile.dungeonSites) {
      const site = getSiteState(state, siteDef.id);
      if (site?.status === 'open' || site?.status === 'repopulating') {
        const holder = ctx.mgr.territoryHolder(area);
        if (!holder?.alive) continue;
        const f = factionFor(ctx.god, holder);
        const member = f ? pickMember(ctx, f.memberIds, holder.id) : null;
        if (member && !questForAssignee(data, member.id)) {
          issueQuest(ctx, {
            assignerId: holder.id,
            assigneeId: member.id,
            kind: site.status === 'repopulating' ? 'guard_site' : 'delve',
            targetAreaId: area,
            targetSiteId: siteDef.id,
            deadlineTurn: turn + 8,
          });
        }
      }
    }
  }

  const active = activeQuests(data);
  if (active.length > 24) {
    for (const q of active.slice(0, active.length - 24)) q.status = 'failed';
  }
}

function pickMember(ctx: GodContext, memberIds: string[], excludeId: string): Nemesis | null {
  const pool = memberIds
    .map((id) => ctx.mgr.byId(id))
    .filter((n): n is Nemesis => !!n && n.alive && n.id !== excludeId);
  if (!pool.length) return null;
  return ctx.rng.pick(pool);
}

function issueQuest(ctx: GodContext, partial: Omit<NpcQuest, 'id' | 'status'>): NpcQuest {
  const data = ctx.mgr.data;
  const q: NpcQuest = { ...partial, id: newQuestId(data), status: 'active' };
  ensureQuests(data).push(q);
  const assignee = ctx.mgr.byId(q.assigneeId);
  if (assignee) {
    const s = simOf(assignee);
    const goal = GOAL_FOR_KIND[q.kind];
    if (goal) {
      s.goal = goal;
      s.goalTargetId = q.assignerId;
      s.goalAge = 0;
    }
    s.dungeonTarget = q.targetSiteId ?? null;
  }
  return q;
}

export function expireQuests(ctx: GodContext): void {
  const turn = ctx.mgr.turn;
  for (const q of activeQuests(ctx.mgr.data)) {
    if (q.deadlineTurn != null && turn > q.deadlineTurn) {
      q.status = 'failed';
      const state = getBiome(ctx.mgr.data, q.targetAreaId);
      state.unrest = Math.min(1, state.unrest + 0.06);
      const assignee = ctx.mgr.byId(q.assigneeId);
      const f = assignee ? factionFor(ctx.god, assignee) : null;
      if (f) f.stability = Math.max(0, f.stability - 4);
      if (!ctx.silent) {
        ctx.emit(
          'quest',
          'notable',
          `${assignee ? fullName(assignee) : 'SOMEONE'} FAILED A HOUSE ERRAND.`,
          [`The deadline passed in ${AREA_NAMES[q.targetAreaId] ?? q.targetAreaId}.`],
          assignee ? [assignee.id] : [],
          'bad'
        );
      }
    }
  }
}

export function tryCompleteQuest(
  ctx: GodContext,
  actor: Nemesis,
  actionId: string,
  areaId?: string,
  siteId?: string,
  materialId?: string
): boolean {
  const q = questForAssignee(ctx.mgr.data, actor.id);
  if (!q) return false;

  const matches =
    (q.kind === 'gather' && actionId === 'gather' && q.targetAreaId === areaId) ||
    (q.kind === 'hunt_feral' && actionId === 'hunt_feral' && q.targetAreaId === areaId) ||
    (q.kind === 'delve' && actionId === 'delve' && q.targetAreaId === areaId && (!q.targetSiteId || q.targetSiteId === siteId)) ||
    (q.kind === 'deliver' && actionId === 'deliver') ||
    (q.kind === 'guard_site' && actionId === 'guard_site' && q.targetAreaId === areaId) ||
    (q.kind === 'reclaim_cache' && actionId === 'gather' && q.targetAreaId === areaId);

  if (!matches) return false;

  q.status = 'done';
  const f = factionFor(ctx.god, actor);
  if (f && q.kind !== 'deliver') {
    const mat = materialId ?? q.materialId;
    if (mat) {
      f.treasury = f.treasury ?? {};
      f.treasury[mat] = (f.treasury[mat] ?? 0) + 2;
    }
    f.stability = Math.min(100, f.stability + 3);
  }

  if (!ctx.silent) {
    ctx.emit(
      'quest',
      'major',
      `${fullName(actor)} FINISHED WHAT THEY WERE SENT TO DO.`,
      [`House business in ${AREA_NAMES[q.targetAreaId] ?? q.targetAreaId}.`],
      [actor.id],
      'good'
    );
    ctx.chronicle('quest_complete', `${fullName(actor)} completed a house errand.`, [actor.id], false, 'gold');
  }

  const s = simOf(actor);
  if (s.goal !== 'revenge') {
    s.goal = 'survive';
    s.goalTargetId = null;
    s.goalAge = 0;
  }
  s.dungeonTarget = null;
  return true;
}

export function treasuryNeed(f: { treasury?: Record<string, number> }): number {
  const total = Object.values(f.treasury ?? {}).reduce((a, b) => a + b, 0);
  return Math.max(0, 20 - total);
}

export function houseNeedAreas(ctx: GodContext | { god: GodContext['god']; mgr: GodContext['mgr'] }): string[] {
  const god = ctx.god;
  const out: string[] = [];
  for (const f of livingFactions(god)) {
    if (treasuryNeed(f) < 8) continue;
    for (const areaId of f.territories) {
      if (!out.includes(areaId)) out.push(areaId);
    }
  }
  return out;
}
