import { describe, expect, it } from 'vitest';
import type { Nemesis } from '../../src/nemesis/Nemesis';
import type { NemesisManager } from '../../src/nemesis/NemesisManager';
import { simOf } from '../../src/god/GodTypes';
import {
  applyCombatOutcome,
  applyPitKill,
  applyPitScar,
  wantRevengeSim,
} from '../../src/sim/CombatOutcome';

function nem(partial: Partial<Nemesis> & Pick<Nemesis, 'id' | 'name'>): Nemesis {
  return {
    title: '',
    rank: 'captain',
    level: 5,
    archetype: 'fighter',
    personality: 'avenger',
    appearanceSeed: 1,
    weapon: 'sword',
    strengths: [],
    weaknesses: [],
    scars: [],
    playerRelationship: 10,
    rivalries: [],
    allies: [],
    master: null,
    killsAgainstPlayer: 0,
    defeatsByPlayer: 0,
    escapedPlayer: 0,
    memory: [],
    alive: true,
    diedOnTurn: null,
    revengeChance: 0.2,
    power: 20,
    territory: 'ruins',
    persistent: true,
    adaptations: [],
    stolen: [],
    bornTurn: 1,
    returns: 0,
    ...partial,
  };
}

function mgr(roster: Nemesis[]): NemesisManager {
  return {
    data: { god: null, nemeses: roster },
    byId: (id) => roster.find((n) => n.id === id) ?? null,
    living: () => roster.filter((n) => n.alive),
  } as NemesisManager;
}

describe('CombatOutcome', () => {
  it('records a kill on the winner and victim', () => {
    const winner = nem({ id: 'w', name: 'Winner', rank: 'warlord' });
    const loser = nem({ id: 'l', name: 'Loser', rank: 'elite' });
    applyCombatOutcome(mgr([winner, loser]), { winner, loser, aftermath: 'killed' });

    expect(simOf(winner).kills).toContain('l');
    expect(simOf(loser).killedById).toBe('w');
    expect(simOf(winner).reputation).toBe(6 + 4); // elite rank bonus
  });

  it('marks escape and revenge intent', () => {
    const winner = nem({ id: 'w', name: 'Winner' });
    const loser = nem({ id: 'l', name: 'Loser' });
    applyCombatOutcome(mgr([winner, loser]), { winner, loser, aftermath: 'escaped' });

    expect(simOf(loser).flights).toBe(1);
    expect(simOf(loser).escapedFrom).toContain('w');
    expect(simOf(loser).goal).toBe('revenge');
    expect(simOf(loser).goalTargetId).toBe('w');
  });

  it('wantRevengeSim caps revenge target list', () => {
    const actor = nem({ id: 'a', name: 'Actor' });
    for (let i = 0; i < 6; i++) {
      wantRevengeSim(actor, nem({ id: `t${i}`, name: `Target${i}` }));
    }
    expect(simOf(actor).revengeTargets.length).toBeLessThanOrEqual(4);
  });

  it('applyPitScar raises injury', () => {
    const n = nem({ id: 'n', name: 'Scarred' });
    applyPitScar(n, 2);
    expect(simOf(n).injury).toBeGreaterThanOrEqual(28);
  });

  it('applyPitKill faked death injures instead of killing', () => {
    const killer = nem({ id: 'k', name: 'Killer' });
    const victim = nem({ id: 'v', name: 'Victim' });
    applyPitKill(mgr([killer, victim]), killer, victim, true);
    expect(simOf(victim).killedById).toBeNull();
    expect(simOf(victim).injury).toBeGreaterThan(0);
    expect(simOf(victim).flights).toBe(1);
  });
});
