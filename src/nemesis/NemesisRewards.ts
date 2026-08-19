/**
 * One context-sensitive reward after a meaningful named victory.
 * Never reads Nemesis.ai.
 */

import type { Nemesis } from './Nemesis';
import { fullName } from './Nemesis';
import type { RNG } from '../core/RNG';

export interface RewardOption {
  id: string;
  title: string;
  desc: string;
  kind:
    | 'steal_strength'
    | 'steal_adapt'
    | 'scar_power'
    | 'technique'
    | 'tribute'
    | 'intel'
    | 'destabilise'
    | 'permanence';
  trait?: string;
  gated?: boolean;
}

export function nemesisRewardChoices(
  n: Nemesis,
  rng: RNG,
  opts: { vendetta: boolean; executed: boolean; farms: number }
): RewardOption[] {
  const pool: RewardOption[] = [];
  const name = fullName(n).toUpperCase();
  if (n.strengths[0]) {
    pool.push({
      id: 'steal_strength',
      title: 'STEAL A STRENGTH',
      desc: `Take a weakened echo of ${n.strengths[0].replace(/_/g, ' ')}. Weaker than theirs.`,
      kind: 'steal_strength',
      trait: n.strengths[0],
    });
  }
  if (n.adaptations[0]) {
    pool.push({
      id: 'steal_adapt',
      title: 'STRIP THE LESSON',
      desc: `Destroy or steal ${n.adaptations[0].replace(/_/g, ' ')}.`,
      kind: 'steal_adapt',
      trait: n.adaptations[0],
      gated: true,
    });
  }
  if (n.scars[0]) {
    pool.push({
      id: 'scar_power',
      title: 'WEAR THE SCAR',
      desc: `Turn ${n.scars[0].id.replace(/_/g, ' ')} into a temporary run power.`,
      kind: 'scar_power',
    });
  }
  pool.push({
    id: 'tribute',
    title: 'TAKE TRIBUTE',
    desc: `Strip Essence from ${name}. Safer, smaller.`,
    kind: 'tribute',
  });
  pool.push({
    id: 'intel',
    title: 'LEARN THE WEB',
    desc: 'Reveal their master, rivals, and home law.',
    kind: 'intel',
  });
  pool.push({
    id: 'destabilise',
    title: 'BREAK THE CLAIM',
    desc: 'Their territory is liberated for a time.',
    kind: 'destabilise',
  });
  pool.push({
    id: 'permanence',
    title: 'MAKE IT STICK',
    desc: 'This death is far more likely to be final.',
    kind: 'permanence',
    gated: true,
  });
  pool.push({
    id: 'technique',
    title: 'STUDY THE BLOW',
    desc: 'Learn a weapon technique from how they fought.',
    kind: 'technique',
  });

  const farms = opts.farms;
  const filtered = pool.filter((o) => {
    if (farms >= 2 && (o.kind === 'steal_strength' || o.kind === 'steal_adapt')) return false;
    if (o.gated && !opts.vendetta && !opts.executed) return false;
    return true;
  });
  if (!filtered.length) return [pool[3]];
  const a = rng.pick(filtered);
  let b = filtered.find((x) => x.id !== a.id) ?? a;
  if (farms >= 1 && a.kind !== 'tribute') {
    b = filtered.find((x) => x.kind === 'tribute') ?? b;
  }
  const unique = a.id === b.id ? [a] : [a, b];
  return unique.slice(0, 1);
}

export function weakenedTraitLabel(trait: string): string {
  return `ECHO OF ${trait.replace(/_/g, ' ').toUpperCase()} — weaker, conditional`;
}
