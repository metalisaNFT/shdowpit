/**
 * Roguelite powers.
 *
 * Rule from the brief: mechanics, not percentages. Every power should change
 * a verb. A few carry a numeric tail, but each one has a behaviour attached.
 */

import type { PowerFamily } from '../abilities/Reactions';

export type PowerId =
  | 'blink'
  | 'reversal'
  | 'predator'
  | 'parasite'
  | 'blood_debt'
  | 'shockwave'
  | 'chain'
  | 'phantom'
  | 'ember'
  | 'glass'
  | 'vulture'
  | 'momentum'
  | 'riposte'
  | 'terror'
  | 'leech'
  | 'thorns'
  | 'second_wind'
  | 'hunters_mark'
  | 'stampede'
  | 'echo'
  /* ---- ranged / needle skills ---- */
  | 'crippling_bolt'
  | 'interruptor'
  | 'chain_shard'
  | 'piercing_shard'
  | 'toxic_shot'
  | 'return_fire'
  /* ---- stagger / posture / poison skills ---- */
  | 'toxic_edge'
  | 'execution_surge'
  | 'dash_strike'
  | 'posture_hunter'
  | 'toxic_detonation';

export type PowerTag = 'MOVEMENT' | 'OFFENCE' | 'DEFENCE' | 'EXECUTION' | 'RISK' | 'UTILITY' | 'RANGED' | 'STAT';

export interface PowerDef {
  id: PowerId;
  name: string;
  tag: PowerTag;
  family: PowerFamily;
  desc: string;
  /** how it reads in the HUD chip list */
  short: string;
  /** can be taken more than once */
  stackable: boolean;
  /** weight when rolling an offer */
  weight: number;
}

function p(
  id: PowerId,
  name: string,
  tag: PowerTag,
  family: PowerFamily,
  short: string,
  desc: string,
  stackable = false,
  weight = 1
): PowerDef {
  return { id, name, tag, family, short, desc, stackable, weight };
}

export const POWERS: PowerDef[] = [
  p('blink', 'BLINK', 'MOVEMENT', 'Movement', 'DODGE TELEPORTS', 'Your dodge becomes a short teleport with a longer invulnerable window.'),
  p('reversal', 'REVERSAL', 'DEFENCE', 'PerfectDefense', 'PARRY REFLECTS', 'A perfect parry sends the blow back. Hard hitters punish themselves.'),
  p('predator', 'PREDATOR', 'EXECUTION', 'Execution', 'EXECUTE = SPEED', 'Executions grant six seconds of greatly increased movement speed.'),
  p('parasite', 'PARASITE', 'EXECUTION', 'Execution', 'STEAL A TRAIT', 'Executing a named enemy steals one of their strengths for the rest of the run.'),
  p('blood_debt', 'BLOOD DEBT', 'OFFENCE', 'Revenge', 'REVENGE DAMAGE', 'Enemies who have killed you before take vastly more damage from you.'),
  p('shockwave', 'SHOCKWAVE', 'OFFENCE', 'Momentum', 'HEAVY = BLAST', 'Heavy attacks release a radial blast. Ground Rupture is the cooldown slam; this rides the heavy.'),
  p('chain', 'CHAIN', 'MOVEMENT', 'Movement', 'KILL RESETS DODGE', 'Killing an enemy instantly refreshes your dodge. Secondary hits do not.'),
  p('phantom', 'PHANTOM', 'MOVEMENT', 'Movement', 'DODGE AFTERIMAGE', 'Dodging leaves behind an afterimage that strikes whatever comes close.'),
  p('ember', 'EMBER', 'OFFENCE', 'Fire', 'LIGHT BURNS', 'Light attacks set enemies alight. Shadow Step also ignites crossed foes.'),
  p('glass', 'GLASS', 'RISK', 'Utility', '+DAMAGE +FRAGILE', 'You deal far more damage and take noticeably more.', false, 0.7),
  p('vulture', 'VULTURE', 'EXECUTION', 'Execution', 'EXECUTE HEALS', 'Executions restore a meaningful chunk of health. Grunt executes share one payload.'),
  p('momentum', 'MOMENTUM', 'OFFENCE', 'Momentum', 'UNHIT = STRONGER', 'Every hit you land without being hit increases your damage. Skill reach grows slightly while the streak holds.'),
  p('riposte', 'RIPOSTE', 'DEFENCE', 'PerfectDefense', 'PARRY COUNTERS', 'A successful parry immediately answers with a free strike.'),
  p('terror', 'TERROR', 'EXECUTION', 'Execution', 'EXECUTE = FEAR', 'Executions make nearby enemies break and run.'),
  p('leech', 'LEECH', 'DEFENCE', 'Utility', 'LIGHT HEALS', 'Light attacks return a small amount of health.', true),
  p('thorns', 'THORNS', 'DEFENCE', 'PerfectDefense', 'RETALIATE', 'Anything that strikes you takes damage in return.'),
  p('second_wind', 'SECOND WIND', 'DEFENCE', 'Utility', 'SURVIVE ONCE', 'Once per run, a fatal blow leaves you standing at a sliver of health.', false, 0.8),
  p('hunters_mark', "HUNTER'S MARK", 'UTILITY', 'Revenge', 'TRACK NAMED', 'You always know where the nearest named enemy is, and they take more damage.'),
  p('stampede', 'STAMPEDE', 'MOVEMENT', 'Movement', 'SPRINT KNOCKS DOWN', 'Sprinting into an enemy knocks them flat.'),
  p('echo', 'ECHO', 'OFFENCE', 'Posture', 'HEAVY HITS TWICE', 'Heavy attacks land a second, delayed strike.'),

  /* ---- Void Needle skills ---- */
  p('crippling_bolt', 'CRIPPLING BOLT', 'RANGED', 'Projectile', 'NEEDLE SLOWS HARD', 'Void Needles slow enemies by far more, for longer. Nothing outruns you.'),
  p('interruptor', 'INTERRUPTOR', 'RANGED', 'Posture', 'NEEDLE BREAKS WINDUPS', 'A Needle that lands during an attack anticipation deals huge posture damage and can cancel it outright.'),
  p('chain_shard', 'CHAIN SHARD', 'RANGED', 'Projectile', 'NEEDLE JUMPS ONCE', 'Void Needles jump to one nearby enemy after hitting.', true),
  p('piercing_shard', 'PIERCING SHARD', 'RANGED', 'Projectile', 'NEEDLE PIERCES', 'Void Needles pass through one additional enemy.', true),
  p('toxic_shot', 'TOXIC SHOT', 'RANGED', 'Poison', 'NEEDLE POISONS', 'Void Needles add heavy poison buildup.'),
  p('return_fire', 'RETURN FIRE', 'DEFENCE', 'PerfectDefense', 'PARRY REFLECTS SHOTS', 'Parrying a projectile sends it back at whoever fired it.'),

  /* ---- stagger / posture / poison ---- */
  p('toxic_edge', 'TOXIC EDGE', 'OFFENCE', 'Poison', 'MELEE POISONS', 'Repeated melee hits build poison. Ground Rupture leaves a toxic zone.'),
  p('execution_surge', 'EXECUTION SURGE', 'EXECUTION', 'Execution', 'EXECUTE = SURGE', 'Executions restore a large amount of Surge.'),
  p('dash_strike', 'DASH STRIKE', 'MOVEMENT', 'Movement', 'DODGE INTO LUNGE', 'Attacking immediately after a dodge performs a long lunging strike.'),
  p('posture_hunter', 'POSTURE HUNTER', 'OFFENCE', 'Posture', 'FLINCH = MORE POSTURE', 'Staggered enemies take 60% more posture damage. Void Grasp can interrupt a windup.'),
  p('toxic_detonation', 'TOXIC DETONATION', 'EXECUTION', 'Poison', 'POISON EXPLODES', 'Executing a poisoned enemy detonates the poison, contaminating everything nearby.'),
];

const MAP = new Map<PowerId, PowerDef>(POWERS.map((x) => [x.id, x]));

export function getPower(id: PowerId): PowerDef {
  return MAP.get(id) ?? POWERS[0];
}

/** Live power state for the current run. */
export class PowerSet {
  private counts = new Map<PowerId, number>();

  has(id: PowerId): boolean {
    return (this.counts.get(id) ?? 0) > 0;
  }

  count(id: PowerId): number {
    return this.counts.get(id) ?? 0;
  }

  add(id: PowerId): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  clear(): void {
    this.counts.clear();
  }

  list(): Array<{ def: PowerDef; count: number }> {
    const out: Array<{ def: PowerDef; count: number }> = [];
    for (const [id, c] of this.counts) {
      const def = MAP.get(id);
      if (def) out.push({ def, count: c });
    }
    return out;
  }

  ids(): PowerId[] {
    return Array.from(this.counts.keys());
  }

  /** Which powers can still be offered? */
  offerable(): PowerDef[] {
    return POWERS.filter((d) => d.stackable || !this.has(d.id));
  }
}
