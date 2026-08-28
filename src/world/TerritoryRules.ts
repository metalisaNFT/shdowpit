/**
 * Local territory conditions derived from the current holder. Never stored as
 * identity — recompute whenever ownership changes. Liberation is a timed mod.
 */

import type { Nemesis, PersonalityType, Archetype } from '../nemesis/Nemesis';
import { fullName } from '../nemesis/Nemesis';
import type { AreaDef } from '../data/areas';

export type TerritoryRuleId =
  | 'elevated_archers'
  | 'alarms_escapes'
  | 'poisoned_shrines'
  | 'loyalist_call'
  | 'locked_shortcuts'
  | 'guarded_caches'
  | 'tracking_patrols'
  | 'armored_gate'
  | 'ambitious_tithe'
  | 'show_duels'
  | 'command_posts'
  | 'void_quiet';

export interface TerritoryRule {
  id: TerritoryRuleId;
  title: string;
  desc: string;
  counterplay: string;
}

export interface TerritoryMod {
  kind: string;
  untilTurn: number;
}

export interface TerritoryPresentation {
  areaId: string;
  holderId: string | null;
  holderName: string;
  rules: TerritoryRule[];
  liberation: TerritoryMod | null;
}

const RULES: Record<TerritoryRuleId, Omit<TerritoryRule, 'id'>> = {
  elevated_archers: {
    title: 'ELEVATED SQUADS',
    desc: 'Archer patrols hold the high ground and fire first.',
    counterplay: 'Close fast, interrupt windups, or use cover and Void Needle.',
  },
  alarms_escapes: {
    title: 'ALARMS',
    desc: 'Cowards wired this ground. Combat raises Heat faster; runners find exits.',
    counterplay: 'Sabotage the alarm posts or finish fights quickly.',
  },
  poisoned_shrines: {
    title: 'TAINTED SHRINES',
    desc: 'Recovery sites drip poison. Using one hurts before it helps.',
    counterplay: 'Skip the shrine, or spend a Remnant to cleanse it.',
  },
  loyalist_call: {
    title: 'THE CALL',
    desc: 'Loyalists will summon their master if a fight drags.',
    counterplay: 'End the fight, or hunt the loyalist first.',
  },
  locked_shortcuts: {
    title: 'LOCKED PATHS',
    desc: 'Paranoid scouts seal the fast routes until they fall.',
    counterplay: 'Kill the scouts marked on the plate, or pay Heat to force a door.',
  },
  guarded_caches: {
    title: 'GUARDED CACHES',
    desc: 'Collectors stash relics behind elite gatekeepers.',
    counterplay: 'Defeat the gatekeeper or bait them away with Heat.',
  },
  tracking_patrols: {
    title: 'TRACKERS',
    desc: 'Hunters leave pursuit marks. Dwelling here builds Heat.',
    counterplay: 'Keep moving, or use a hidden route to shed the trail.',
  },
  armored_gate: {
    title: 'ARMOURED GATE',
    desc: 'Heavies hold the thresholds. Entering costs posture pressure.',
    counterplay: 'Break the gatekeeper posture or enter from a flank.',
  },
  ambitious_tithe: {
    title: 'TITHE',
    desc: 'The ambitious take a cut. Shrine offers cost extra Heat.',
    counterplay: 'Liberate the territory or skip shrines.',
  },
  show_duels: {
    title: 'THE RING',
    desc: 'Showoffs stage named interruptions. Expect a second arrival.',
    counterplay: 'Finish the first fight before the audience arrives.',
  },
  void_quiet: {
    title: 'STILL GROUND',
    desc: 'No special law. Patrols are ordinary.',
    counterplay: 'None needed.',
  },
  command_posts: {
    title: 'THE WATCH',
    desc: 'Patrols keep formation around their commander. Isolated, the commander is weaker.',
    counterplay: 'Split the ring. Interrupt the order. Do not fight the whole post at once.',
  },
};

function ruleFromHolder(n: Nemesis): TerritoryRuleId {
  if (n.archetype === 'commander') return 'command_posts';
  if (n.archetype === 'duelist') return 'show_duels';
  if (n.archetype === 'archer') return 'elevated_archers';
  if (n.archetype === 'heavy') return 'armored_gate';
  if (n.personality === 'coward') return 'alarms_escapes';
  if (n.personality === 'loyalist') return 'loyalist_call';
  if (n.personality === 'hunter') return 'tracking_patrols';
  if (n.personality === 'collector') return 'guarded_caches';
  if (n.personality === 'showoff') return 'show_duels';
  if (n.personality === 'ambitious') return 'ambitious_tithe';
  if (n.weaknesses.includes('flammable') || n.weaknesses.includes('fears_fire')) return 'poisoned_shrines';
  if (n.personality === 'obsessed' || n.personality === 'survivor') return 'locked_shortcuts';
  return 'void_quiet';
}

function secondFortressRule(n: Nemesis, first: TerritoryRuleId): TerritoryRuleId {
  const alt: TerritoryRuleId[] = [];
  if (n.personality === 'loyalist' && first !== 'loyalist_call') alt.push('loyalist_call');
  if (n.archetype === 'archer' && first !== 'elevated_archers') alt.push('elevated_archers');
  if (n.rank === 'overlord' && first !== 'armored_gate') alt.push('armored_gate');
  if (n.personality === 'hunter' && first !== 'tracking_patrols') alt.push('tracking_patrols');
  return alt[0] ?? 'show_duels';
}

export function rulesForHolder(n: Nemesis | null, area: AreaDef): TerritoryRule[] {
  if (!n) return [{ id: 'void_quiet', ...RULES.void_quiet }];
  const first = ruleFromHolder(n);
  const ids: TerritoryRuleId[] = [first];
  if (area.id === 'fortress') {
    const second = secondFortressRule(n, first);
    if (second !== first) ids.push(second);
  }
  return ids.map((id) => ({ id, ...RULES[id] }));
}

export function presentTerritory(
  area: AreaDef,
  holder: Nemesis | null,
  mods: Record<string, TerritoryMod>,
  turn: number
): TerritoryPresentation {
  const liberation = mods[area.id] && mods[area.id].untilTurn > turn ? mods[area.id] : null;
  return {
    areaId: area.id,
    holderId: holder?.id ?? null,
    holderName: holder ? fullName(holder) : 'UNCLAIMED',
    rules: liberation ? [{ id: 'void_quiet', title: 'LIBERATED', desc: liberationLabel(liberation.kind), counterplay: 'The old law returns when the Age turns.' }] : rulesForHolder(holder, area),
    liberation,
  };
}

function liberationLabel(kind: string): string {
  switch (kind) {
    case 'heal_site':
      return 'A healing site stands open.';
    case 'shortcut':
      return 'A safe shortcut is cut.';
    case 'fewer_patrols':
      return 'Patrols are thin.';
    case 'shrine_odds':
      return 'Shrines favour you.';
    case 'forge':
      return 'A temporary forge.';
    case 'intel':
      return 'Scouts named the nearby enemies.';
    case 'heat_dampen':
      return 'Heat rises slowly here.';
    case 'extract':
      return 'An extraction gate is live.';
    case 'destabilised':
      return 'The claim is shaken.';
    default:
      return 'The old rule is broken — for now.';
  }
}

export function liberationRewardFor(personality: PersonalityType, archetype: Archetype): TerritoryMod['kind'] {
  if (personality === 'coward') return 'shortcut';
  if (personality === 'hunter') return 'heat_dampen';
  if (personality === 'collector') return 'forge';
  if (archetype === 'archer') return 'intel';
  if (personality === 'loyalist') return 'fewer_patrols';
  return 'heal_site';
}

export function ruleIds(p: TerritoryPresentation): TerritoryRuleId[] {
  return p.rules.map((r) => r.id);
}
