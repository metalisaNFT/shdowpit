/**
 * Shared combat outcome vocabulary for god duels and live pit fights.
 */

import type { NemesisManager } from '../nemesis/NemesisManager';
import { rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { simOf } from '../god/GodTypes';

export type CombatAftermath = 'killed' | 'escaped' | 'spared' | 'humiliated' | 'injured';

export interface CombatOutcomeInput {
  winner: Nemesis | null;
  loser: Nemesis;
  aftermath: CombatAftermath;
  /** optional god state for faction shake — omit in pit-only bridge */
  shakeFaction?: (factionId: string | null, delta: number) => void;
}

/** Apply sim-state deltas for a pit or god combat resolution. */
export function applyCombatOutcome(mgr: NemesisManager, input: CombatOutcomeInput): void {
  const { winner, loser, aftermath } = input;
  const ls = simOf(loser);

  switch (aftermath) {
    case 'killed':
      if (winner) {
        const ws = simOf(winner);
        ws.kills.push(loser.id);
        ws.reputation = Math.min(200, ws.reputation + 6 + rankIndex(loser.rank) * 4);
        ws.confidence = Math.min(100, ws.confidence + 8);
        ws.revengeTargets = ws.revengeTargets.filter((x) => x !== loser.id);
      }
      ls.killedById = winner?.id ?? null;
      break;
    case 'escaped':
      ls.flights++;
      if (winner && !ls.escapedFrom.includes(winner.id)) ls.escapedFrom.push(winner.id);
      ls.fear = Math.min(100, ls.fear + 12);
      ls.confidence = Math.max(0, ls.confidence - 6);
      if (winner) wantRevengeSim(loser, winner);
      break;
    case 'spared':
    case 'humiliated':
      ls.fear = Math.min(100, ls.fear + 8);
      ls.confidence = Math.max(0, ls.confidence - 10);
      if (winner) wantRevengeSim(loser, winner);
      break;
    case 'injured':
      ls.injury = Math.min(100, ls.injury + 18);
      ls.confidence = Math.max(0, ls.confidence - 4);
      if (winner) wantRevengeSim(loser, winner);
      break;
  }

  if (winner && aftermath !== 'killed') {
    const ws = simOf(winner);
    ws.confidence = Math.min(100, ws.confidence + 4);
    ws.wins++;
    ls.losses++;
  }

  if (aftermath === 'killed' && input.shakeFaction && ls.factionId) {
    input.shakeFaction(ls.factionId, -8 - rankIndex(loser.rank) * 4);
  }

  if (winner && aftermath === 'killed') {
    for (const aid of loser.allies) {
      const ally = mgr.byId(aid);
      if (ally?.alive) wantRevengeSim(ally, winner);
    }
  }
}

export function wantRevengeSim(actor: Nemesis, target: Nemesis): void {
  if (actor.id === target.id) return;
  const s = simOf(actor);
  if (!s.revengeTargets.includes(target.id)) s.revengeTargets.push(target.id);
  if (s.revengeTargets.length > 4) s.revengeTargets.shift();
  if (s.goal === 'revenge' && s.goalTargetId && s.goalTargetId !== target.id && s.goalAge < 6) return;
  s.goal = 'revenge';
  s.goalTargetId = target.id;
  s.goalAge = 0;
}

export function applyPitScar(n: Nemesis, severity: number): void {
  const s = simOf(n);
  s.injury = Math.min(100, s.injury + Math.max(8, severity * 14));
  s.confidence = Math.max(0, s.confidence - 4);
}

export function applyPitKill(mgr: NemesisManager, killer: Nemesis | null, victim: Nemesis, faked: boolean): void {
  if (faked) {
    simOf(victim).injury = Math.min(100, simOf(victim).injury + 22);
    simOf(victim).flights++;
    simOf(victim).fear = Math.min(100, simOf(victim).fear + 10);
    return;
  }
  applyCombatOutcome(mgr, { winner: killer, loser: victim, aftermath: 'killed' });
}

export function applyPlayerKilledBy(mgr: NemesisManager, killer: Nemesis): void {
  const ks = simOf(killer);
  ks.confidence = Math.min(100, ks.confidence + 14);
  ks.reputation = Math.min(200, ks.reputation + 10);
  if (!ks.deeds.some((d) => d.text.includes('killed you'))) {
    ks.deeds.push({ text: 'killed you in the pit', weight: 3, cycle: mgr.data.god?.cycle ?? 0 });
  }

  for (const n of mgr.living()) {
    if (n.id === killer.id) continue;
    if (n.defeatsByPlayer > 0 && !simOf(n).revengeTargets.includes(killer.id)) {
      wantRevengeSim(n, killer);
    }
  }
}
