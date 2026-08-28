/**
 * Interruptible in-world staging from MultiEncounter rules.
 * Combat with the player cancels ambient posing. If the player ignores the
 * beat, it still resolves on a timer and writes relationships.
 */

import type { Enemy } from '../enemy/Enemy';
import type { Player } from '../player/Player';
import type { MultiRule } from './MultiEncounter';
import { fullName } from './Nemesis';
import { remember } from './NemesisMemory';
import { makeEvent, type WorldEvent } from '../world/WorldEvent';

export const STAGING_IGNORE_S = 16;

export function actorEnemies(enemies: Enemy[], rule: MultiRule | null): Enemy[] {
  if (!rule) return [];
  const ids = new Set(rule.actors);
  return enemies.filter((e) => e.alive && e.named && ids.has(e.nemesis.id));
}

export function applyStagingPose(enemies: Enemy[], rule: MultiRule | null, player: Player, inCombat: boolean): void {
  for (const e of enemies) e.stagePose = 'none';
  if (!rule || inCombat) return;

  const byId = new Map(enemies.filter((e) => e.alive).map((e) => [e.nemesis.id, e]));
  const a = byId.get(rule.actors[0]);
  const b = rule.actors[1] ? byId.get(rule.actors[1]) : undefined;

  if (rule.id === 'loyalist_guard' && a && b) {
    a.protectTarget = b;
    a.stagePose = 'guard';
    b.stagePose = 'guard';
  }
  if (rule.id === 'rival_duel' && a && b) {
    a.rivalTarget = b;
    b.rivalTarget = a;
    a.stagePose = 'patrol';
    b.stagePose = 'patrol';
  }
  if (rule.id === 'betrayer_flip' && a && b) {
    a.stagePose = 'loot';
    if (b.hp / b.maxHp < 0.5) {
      a.rivalTarget = b;
      a.stagePose = 'none';
    }
  }
  if (rule.id === 'coward_alarm' && a) {
    a.stagePose = 'patrol';
  }
  if (rule.id === 'opportunist_winner' && a) a.stagePose = 'loot';
  if (rule.id === 'challenge_master' && a && b) {
    a.stagePose = 'kneel';
    if (b.hp / b.maxHp < 0.55) a.rivalTarget = b;
  }
  if (rule.id === 'temp_cooperate' && a && b) {
    a.protectTarget = b;
    b.protectTarget = a;
    a.stagePose = 'guard';
    b.stagePose = 'guard';
  }
  if (rule.id === 'avenger_rage' && a) a.stagePose = 'guard';

  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.nemesis.stolen.some((s) => s.kind === 'weapon')) e.stagePose = 'loot';
    const holder = enemies.find(
      (o) => o.alive && o.named && o.nemesis.territory && o.nemesis.rank !== 'grunt' && o !== e
    );
    if (!e.named && holder && dist(e, holder) < 8 && dist(e, player) > 14) e.stagePose = 'kneel';
  }
}

function dist(a: Enemy, b: { position: { x: number; z: number } }): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

export function resolveIgnoredStaging(
  rule: MultiRule,
  enemies: Enemy[],
  turn: number,
  age: number
): { events: WorldEvent[]; toast: string } | null {
  const byId = new Map(enemies.filter((e) => e.alive && e.named).map((e) => [e.nemesis.id, e]));
  const a = byId.get(rule.actors[0]);
  const b = rule.actors[1] ? byId.get(rule.actors[1]) : undefined;
  if (!a) return null;

  if (rule.id === 'rival_duel' && b) {
    remember(a.nemesis, 'PLAYER_RAN_FROM_ME', turn, b.nemesis.id);
    remember(b.nemesis, 'PLAYER_RAN_FROM_ME', turn, a.nemesis.id);
    return {
      toast: `${fullName(a.nemesis)} AND ${fullName(b.nemesis)} SETTLED IT WITHOUT YOU`,
      events: [
        makeEvent(turn, age, 'duel', `${fullName(a.nemesis)} dueled ${fullName(b.nemesis)} while you ignored them.`, [a.nemesis.id, b.nemesis.id], true, 'gold', {
          witnessed: false,
        }),
      ],
    };
  }
  if (rule.id === 'loyalist_guard' && b) {
    remember(a.nemesis, 'PLAYER_RAN_FROM_ME', turn, b.nemesis.id);
    return {
      toast: `${fullName(a.nemesis)} KEPT THE POST`,
      events: [
        makeEvent(turn, age, 'alliance', `${fullName(a.nemesis)} held the line for ${fullName(b.nemesis)}.`, [a.nemesis.id, b.nemesis.id], false, 'neutral', {
          witnessed: false,
        }),
      ],
    };
  }
  if (rule.id === 'betrayer_flip' && b) {
    remember(a.nemesis, 'PLAYER_RAN_FROM_ME', turn, b.nemesis.id);
    return {
      toast: `${fullName(a.nemesis)} KEPT THE KNIFE SHEATHED — FOR NOW`,
      events: [
        makeEvent(turn, age, 'betrayal', `${fullName(a.nemesis)} waited for a better cut on ${fullName(b.nemesis)}.`, [a.nemesis.id, b.nemesis.id], true, 'bad', {
          witnessed: false,
        }),
      ],
    };
  }
  if (rule.id === 'coward_alarm') {
    remember(a.nemesis, 'I_ESCAPED_PLAYER', turn);
    return {
      toast: `${fullName(a.nemesis)} CALLED THE WATCH`,
      events: [
        makeEvent(turn, age, 'recruitment', `${fullName(a.nemesis)} raised the alarm.`, [a.nemesis.id], false, 'bad', {
          witnessed: false,
        }),
      ],
    };
  }
  return {
    toast: rule.title + ' PASSED WITHOUT YOU',
    events: [
      makeEvent(turn, age, 'alliance', rule.desc, rule.actors, false, 'neutral', { witnessed: false }),
    ],
  };
}
