/**
 * Named-enemy encounter outcomes beyond a kill. Personality and rank gate
 * what they will accept.
 */

import type { Nemesis, PersonalityType, Rank } from './Nemesis';
import { rankIndex } from './Nemesis';
import { getPersonality } from '../data/personalities';

export type OutcomeId =
  | 'execute'
  | 'spare'
  | 'tribute'
  | 'take_weapon'
  | 'abandon_territory'
  | 'informant'
  | 'betrayal'
  | 'humiliate'
  | 'message';

export interface OutcomeOption {
  id: OutcomeId;
  title: string;
  desc: string;
  accepted: boolean;
  refuseText?: string;
}

export function outcomeOptions(n: Nemesis, ctx: { allyPresent: boolean; heat: number }): OutcomeOption[] {
  const p = n.personality;
  const rank = n.rank;
  const all: OutcomeOption[] = [
    {
      id: 'execute',
      title: 'EXECUTE',
      desc: 'Finality and power. They may still fake death — rarely.',
      accepted: true,
    },
    {
      id: 'spare',
      title: 'SPARE',
      desc: 'Leverage later. They will remember. They may hunt you.',
      accepted: true,
    },
    {
      id: 'tribute',
      title: 'DEMAND TRIBUTE',
      desc: 'Essence now. They walk away richer in grudge.',
      accepted: willAccept(p, rank, 'tribute'),
      refuseText: 'They would rather die than pay.',
    },
    {
      id: 'take_weapon',
      title: 'TAKE THEIR WEAPON',
      desc: 'A sidegrade playstyle. They are diminished.',
      accepted: willAccept(p, rank, 'take_weapon') || !!n.stolen.length,
      refuseText: 'They will not yield the blade.',
    },
    {
      id: 'abandon_territory',
      title: 'FORCE THEM OUT',
      desc: 'They abandon this ground. Someone else will take it.',
      accepted: willAccept(p, rank, 'abandon_territory'),
      refuseText: 'This is their seat. They will not leave it.',
    },
    {
      id: 'informant',
      title: 'MAKE THEM TALK',
      desc: 'An informant. Intel and Heat relief — if they live.',
      accepted: willAccept(p, rank, 'informant'),
      refuseText: 'They will not talk.',
    },
    {
      id: 'betrayal',
      title: 'DEMAND BETRAYAL',
      desc: 'Turn them on their master or rival. Needs a real bond.',
      accepted: !!(n.master || n.allies.length) && willAccept(p, rank, 'betrayal'),
      refuseText: p === 'loyalist' ? 'A loyalist does not betray.' : 'No one to betray.',
    },
    {
      id: 'humiliate',
      title: 'BRAND THEM',
      desc: 'Revenge spikes. Possible demotion. They will not forget.',
      accepted: true,
    },
    {
      id: 'message',
      title: 'A MESSAGE',
      desc: 'Release them with a word for their master.',
      accepted: !!n.master,
      refuseText: 'They serve no one.',
    },
  ];
  void ctx;
  return all.filter((o) => o.accepted || o.id === 'execute' || o.id === 'spare' || o.id === 'humiliate');
}

function willAccept(p: PersonalityType, rank: Rank, kind: OutcomeId): boolean {
  const ri = rankIndex(rank);
  const def = getPersonality(p);
  switch (kind) {
    case 'tribute':
      if (p === 'showoff' || p === 'ambitious') return ri < 4;
      if (p === 'coward' || p === 'survivor') return true;
      if (p === 'collector') return false;
      return ri < 3;
    case 'take_weapon':
      if (p === 'collector') return false;
      if (p === 'coward') return true;
      return ri < 3;
    case 'abandon_territory':
      if (p === 'ambitious' || rank === 'overlord') return false;
      if (p === 'coward' || p === 'survivor') return true;
      return ri <= 2;
    case 'informant':
      if (p === 'loyalist') return false;
      if (p === 'traitor' || p === 'opportunist' || p === 'coward') return true;
      return def.betray > 0.8;
    case 'betrayal':
      if (p === 'loyalist') return false;
      if (p === 'traitor' || p === 'opportunist') return true;
      return def.betray > 1;
    default:
      return true;
  }
}
