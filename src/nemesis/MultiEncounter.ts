/**
 * One dominant relationship rule when two or more named enemies share a fight.
 */

import type { Nemesis, PersonalityType } from './Nemesis';
import { fullName } from './Nemesis';

export type MultiRuleId =
  | 'rival_duel'
  | 'loyalist_guard'
  | 'betrayer_flip'
  | 'opportunist_winner'
  | 'coward_alarm'
  | 'avenger_rage'
  | 'challenge_master'
  | 'temp_cooperate';

export interface MultiRule {
  id: MultiRuleId;
  title: string;
  desc: string;
  actors: string[];
}

export function pickMultiRule(named: Nemesis[]): MultiRule | null {
  if (named.length < 2) return null;
  const a = named[0];
  const b = named[1];
  if (a.rivalries.includes(b.id) || b.rivalries.includes(a.id)) {
    return {
      id: 'rival_duel',
      title: 'OLD SCORE',
      desc: `${fullName(a)} and ${fullName(b)} will fight. The survivor takes something.`,
      actors: [a.id, b.id],
    };
  }
  const loyal = named.find((n) => n.personality === 'loyalist' && n.master && named.some((m) => m.id === n.master));
  if (loyal) {
    return {
      id: 'loyalist_guard',
      title: 'THE GUARD',
      desc: `${fullName(loyal)} will spend themselves for their master.`,
      actors: [loyal.id, loyal.master!],
    };
  }
  const traitor = named.find((n) => (n.personality === 'traitor' || n.personality === 'opportunist') && n.master && named.some((m) => m.id === n.master));
  if (traitor) {
    return {
      id: 'betrayer_flip',
      title: 'THE KNIFE',
      desc: `${fullName(traitor)} will change sides if their superior weakens.`,
      actors: [traitor.id, traitor.master!],
    };
  }
  const opp = named.find((n) => n.personality === 'opportunist');
  if (opp) {
    return {
      id: 'opportunist_winner',
      title: 'JACKAL',
      desc: `${fullName(opp)} waits, then strikes the apparent winner.`,
      actors: [opp.id],
    };
  }
  const cow = named.find((n) => n.personality === 'coward');
  if (cow) {
    return {
      id: 'coward_alarm',
      title: 'THE ALARM',
      desc: `${fullName(cow)} will try to call help and run.`,
      actors: [cow.id],
    };
  }
  const avg = named.find((n) => n.personality === 'avenger' && named.some((o) => o.id !== n.id && (n.allies.includes(o.id) || o.allies.includes(n.id))));
  if (avg) {
    return {
      id: 'avenger_rage',
      title: 'BLOOD PRICE',
      desc: `${fullName(avg)} enrages if their ally falls.`,
      actors: [avg.id],
    };
  }
  const sub = named.find((n) => n.master && named.some((m) => m.id === n.master) && (n.personality === 'ambitious' || n.personality === 'showoff'));
  if (sub) {
    return {
      id: 'challenge_master',
      title: 'THE CHALLENGE',
      desc: `${fullName(sub)} will turn on an injured master.`,
      actors: [sub.id, sub.master!],
    };
  }
  return {
    id: 'temp_cooperate',
    title: 'COMMON FOE',
    desc: 'They cooperate against you — until one of them smells weakness.',
    actors: named.slice(0, 2).map((n) => n.id),
  };
}

export function personalityHint(p: PersonalityType): string {
  return p.toUpperCase();
}
