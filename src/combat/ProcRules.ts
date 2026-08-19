/**
 * Proc ownership. Secondary hits, DoT, afterimages, reflects and
 * enemy-versus-enemy blows must not freely retrigger kill resets, remnant
 * drops or power reactions unless a rule says they can.
 */

import type { DamageInfo } from './Types';

export type ProcKind =
  | 'chainDodge'
  | 'lifesteal'
  | 'leech'
  | 'momentum'
  | 'reaction'
  | 'remnant'
  | 'vendetta'
  | 'killCredit'
  | 'cooldownRefund'
  | 'surge';

const TABLE: Record<NonNullable<DamageInfo['channel']>, Record<ProcKind, boolean>> = {
  primary: {
    chainDodge: true,
    lifesteal: true,
    leech: true,
    momentum: true,
    reaction: true,
    remnant: true,
    vendetta: true,
    killCredit: true,
    cooldownRefund: true,
    surge: true,
  },
  secondary: {
    chainDodge: false,
    lifesteal: false,
    leech: false,
    momentum: false,
    reaction: true,
    remnant: false,
    vendetta: true,
    killCredit: true,
    cooldownRefund: false,
    surge: false,
  },
  afterimage: {
    chainDodge: false,
    lifesteal: false,
    leech: false,
    momentum: false,
    reaction: false,
    remnant: false,
    vendetta: false,
    killCredit: true,
    cooldownRefund: false,
    surge: false,
  },
  reflect: {
    chainDodge: false,
    lifesteal: false,
    leech: false,
    momentum: false,
    reaction: true,
    remnant: false,
    vendetta: true,
    killCredit: true,
    cooldownRefund: false,
    surge: false,
  },
  dot: {
    chainDodge: false,
    lifesteal: false,
    leech: false,
    momentum: false,
    reaction: false,
    remnant: false,
    vendetta: false,
    killCredit: true,
    cooldownRefund: false,
    surge: false,
  },
  eve: {
    chainDodge: false,
    lifesteal: false,
    leech: false,
    momentum: false,
    reaction: false,
    remnant: false,
    vendetta: false,
    killCredit: false,
    cooldownRefund: false,
    surge: false,
  },
  area: {
    chainDodge: false,
    lifesteal: false,
    leech: false,
    momentum: false,
    reaction: true,
    remnant: false,
    vendetta: true,
    killCredit: true,
    cooldownRefund: false,
    surge: false,
  },
};

export function defaultChannel(): NonNullable<DamageInfo['channel']> {
  return 'primary';
}

export function canProc(info: DamageInfo | undefined, kind: ProcKind): boolean {
  const ch = info?.channel ?? 'primary';
  if (kind === 'killCredit' && info?.grantsPlayerKill === false) return false;
  if (kind === 'killCredit' && info?.grantsPlayerKill === true) return TABLE[ch].killCredit;
  return TABLE[ch][kind];
}

export function withChannel(
  info: DamageInfo,
  channel: NonNullable<DamageInfo['channel']>,
  grantsPlayerKill?: boolean
): DamageInfo {
  info.channel = channel;
  if (grantsPlayerKill !== undefined) info.grantsPlayerKill = grantsPlayerKill;
  else if (info.grantsPlayerKill === undefined) info.grantsPlayerKill = channel !== 'eve';
  return info;
}
