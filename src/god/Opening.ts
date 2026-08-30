/**
 * Curated opening for THE LONG GAME.
 *
 * Stages real sim facts (never fake outcomes), picks one memorable focus, and
 * seeds the Tower Commander campaign scenario so 3D descent has a board reason.
 */

import { RNG } from '../core/RNG';
import { ensureSignature } from '../data/signatures';
import { fullName, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { remember } from '../nemesis/NemesisMemory';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { addCondition } from './Conditions';
import { simOf, type DescentBrief, type GodState, type Situation } from './GodTypes';

export const TOWER_SITUATION_ID = 'scenario:tower';

/** Real starting conditions for the Tower Commander campaign beat. */
export function stageTowerCommander(mgr: NemesisManager, god: GodState, rng: RNG): Nemesis | null {
  if (god.scenarioFlags?.towerCommander) {
    const existing = mgr.living().find((n) => n.archetype === 'commander' && n.territory === 'tower');
    return existing ?? null;
  }

  let commander =
    mgr.living().find((n) => n.persistent && n.rank !== 'overlord' && n.archetype === 'commander') ??
    mgr.living().find((n) => n.persistent && n.rank !== 'overlord' && n.rank !== 'grunt') ??
    null;
  if (!commander) commander = mgr.recruit('captain', false);

  commander.archetype = 'commander';
  commander.personality = 'ambitious';
  commander.weapon = 'spear';
  if (commander.rank === 'grunt' || commander.rank === 'elite') commander.rank = 'captain';
  commander.territory = 'tower';
  commander.alive = true;
  commander.persistent = true;
  commander.signatureId = 'order_pulse';
  commander.signatureKnown = false;
  ensureSignature(commander);

  const s = simOf(commander);
  s.ambition = Math.max(s.ambition, 72 + rng.int(0, 12));
  s.confidence = Math.max(s.confidence, 64 + rng.int(0, 10));
  s.goal = 'conquer';
  s.goalAge = 1;

  let loyal =
    mgr.living().find((n) => n.id !== commander!.id && n.personality === 'loyalist' && n.rank !== 'overlord') ??
    null;
  if (!loyal) loyal = mgr.recruit('elite', false);
  loyal.personality = 'loyalist';
  if (loyal.archetype === 'commander') loyal.archetype = 'fighter';
  if (loyal.rank === 'overlord') loyal.rank = 'captain';
  loyal.territory = 'tower';
  loyal.alive = true;
  loyal.persistent = true;
  loyal.master = commander.id;
  if (!commander.allies.includes(loyal.id)) commander.allies.push(loyal.id);
  if (!loyal.allies.includes(commander.id)) loyal.allies.push(commander.id);
  ensureSignature(loyal);
  simOf(loyal).goal = 'serve';
  simOf(loyal).goalTargetId = commander.id;
  simOf(loyal).loyalty = Math.max(simOf(loyal).loyalty, 75);

  mgr.data.territories.tower = commander.id;

  // Stolen steel is a board fact when the player already lost a weapon; otherwise
  // they still command the Tower — the descend goal is breaking that hold.
  const lost = mgr.data.playerMeta.lostWeapons;
  if (lost.includes('spear') || rng.chance(0.55)) {
    if (!commander.stolen.some((x) => x.weaponId === 'spear')) {
      commander.stolen.push({ name: 'STOLEN SPEAR', kind: 'weapon', weaponId: 'spear' });
    }
    if (!lost.includes('spear')) lost.push('spear');
    remember(commander, 'I_STOLE_PLAYER_WEAPON', mgr.turn);
    commander.playerRelationship = Math.max(commander.playerRelationship, 40);
  }

  recomputePower(commander);
  recomputePower(loyal);

  addCondition(god, {
    kind: 'opportunity',
    targetKind: 'nemesis',
    targetId: commander.id,
    magnitude: 0.85,
    duration: 6,
    note: `${fullName(commander)} holds the Tower and answers for it`,
    source: 'world',
  });

  god.scenarioFlags = { ...(god.scenarioFlags ?? { towerCommander: false }), towerCommander: true };
  return commander;
}

/** Prefer Tower, then revenge/ascendant, then highest urgency. */
export function pickOpeningFocus(situations: Situation[]): Situation | null {
  if (!situations.length) return null;
  const tower = situations.find((s) => s.id === TOWER_SITUATION_ID || s.kind === 'territory');
  if (tower) return tower;
  const revenge = situations.find((s) => s.kind === 'revenge' || s.kind === 'grudge');
  if (revenge) return revenge;
  const climb = situations.find((s) => s.kind === 'ascendant' || s.kind === 'underdog');
  if (climb) return climb;
  return situations[0];
}

export function actIntention(actId: string): { title: string; body: string } {
  switch (actId) {
    case 'early':
      return {
        title: 'INTENTION — THE SMALL WARS',
        body: 'Raise or ruin someone who will matter when the Tower — and worse — comes due. You cannot win the crisis yourself.',
      };
    case 'rising':
      return {
        title: 'INTENTION — THE RISING',
        body: 'Names mean something now. Push a rival, a champion, or a house into the open before the late world hardens.',
      };
    case 'late':
      return {
        title: 'INTENTION — THE LATE WORLD',
        body: 'Whatever you set loose early is loose. Force a confrontation the simulation cannot ignore.',
      };
    case 'crisis':
      return {
        title: 'INTENTION — THE CRISIS',
        body: 'Something has grown past the world. Arrange who can answer it. You will not answer it yourself.',
      };
    default:
      return {
        title: 'INTENTION',
        body: 'Change a condition. Advance. Read what they chose.',
      };
  }
}

export function defaultDescentBrief(
  n: Nemesis,
  god: GodState,
  situation: Situation | null
): DescentBrief {
  const tower = god.scenarioFlags?.towerCommander && n.territory === 'tower' && n.archetype === 'commander';
  const spear = n.stolen.some((s) => s.weaponId === 'spear');
  if (tower) {
    return {
      nemesisId: n.id,
      reason: situation?.headline ?? `${fullName(n)} commands the Tower`,
      goal: spear
        ? `Enter the Tower. Take the spear from ${fullName(n)} — or break their command.`
        : `Enter the Tower. End ${fullName(n)}'s command, or leave it stronger.`,
      situationId: situation?.id ?? TOWER_SITUATION_ID,
      conditionNote: 'Exposure. They know something is coming in person.',
      cyclesWhileGone: 2,
      scenario: 'tower',
    };
  }
  return {
    nemesisId: n.id,
    reason: situation?.headline ?? `You chose ${fullName(n)}`,
    goal: `Find ${fullName(n)}. Kill, spare, or retreat — the board will remember which.`,
    situationId: situation?.id ?? null,
    conditionNote: 'Exposure. Hunters and allies will read this.',
    cyclesWhileGone: 2,
    scenario: 'hunt',
  };
}
