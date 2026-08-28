/**
 * One primary signature behavior per named encounter, derived from simulation
 * facts only. Combat reads these IDs; AI presentation does not.
 */

import type { Nemesis } from '../nemesis/Nemesis';
import { hasMemory, hasScar, rankIndex } from '../nemesis/Nemesis';

export type SignatureId =
  | 'order_pulse'
  | 'feint_storm'
  | 'stolen_technique'
  | 'ash_zone'
  | 'alarm_retreat'
  | 'avenger_pact'
  | 'escape_cut'
  | 'return_burst'
  | 'delayed_rhythm'
  | 'none';

export interface SignatureDef {
  id: SignatureId;
  name: string;
  telegraph: string;
  counterplay: string;
  desc: string;
}

export const SIGNATURE_DEFS: Record<Exclude<SignatureId, 'none'>, SignatureDef> = {
  order_pulse: {
    id: 'order_pulse',
    name: 'THE ORDER',
    telegraph: 'A raised arm. Nearby allies tighten formation.',
    counterplay: 'Isolate them. Interrupt the command. Cut the loyalist first.',
    desc: 'Directs nearby allies into a commit. Weaker when standing alone.',
  },
  feint_storm: {
    id: 'feint_storm',
    name: 'FALSE EDGE',
    telegraph: 'The swing starts, then dies. The real cut is a beat later.',
    counterplay: 'Do not panic-swing. Wait for the second commit.',
    desc: 'Feints often, then punishes careless attack spam.',
  },
  stolen_technique: {
    id: 'stolen_technique',
    name: 'YOUR STEEL',
    telegraph: 'They chamber the weapon they took from you.',
    counterplay: 'Recognize your own timing. Parry the familiar beat.',
    desc: 'A stolen weapon performs a technique that used to be yours.',
  },
  ash_zone: {
    id: 'ash_zone',
    name: 'ASHEN GROUND',
    telegraph: 'Cinders pool at their feet before the slam.',
    counterplay: 'Do not stand in the ash. Force them off the zone.',
    desc: 'Fire-scarred foes leave a short defensive burn field.',
  },
  alarm_retreat: {
    id: 'alarm_retreat',
    name: 'THE HORN',
    telegraph: 'They break and raise a signal instead of swinging.',
    counterplay: 'Finish them before the call. Cut the escape lane.',
    desc: 'A coward sounds an alarm while retreating.',
  },
  avenger_pact: {
    id: 'avenger_pact',
    name: 'BLOOD PRICE',
    telegraph: 'When an ally falls, their stance changes immediately.',
    counterplay: 'Separate them, or drop the avenger first.',
    desc: 'Becomes more dangerous if a bonded ally dies in sight.',
  },
  escape_cut: {
    id: 'escape_cut',
    name: 'CUT AND RUN',
    telegraph: 'A wide slash that opens a path behind them.',
    counterplay: 'Stay on their exit. Do not overcommit the chase.',
    desc: 'A survivor creates an escape opening when wounded.',
  },
  return_burst: {
    id: 'return_burst',
    name: 'UNBURIED',
    telegraph: 'A pulse of the colour they died in.',
    counterplay: 'The burst is readable. Dodge out, then punish recovery.',
    desc: 'A returned Nemesis opens with a resurrection-themed shock.',
  },
  delayed_rhythm: {
    id: 'delayed_rhythm',
    name: 'HELD BEAT',
    telegraph: 'The windup finishes. Nothing happens. Then it falls.',
    counterplay: 'Late dodge. Do not spend i-frames on the fake.',
    desc: 'Learned delayed strikes; the rhythm is no longer honest.',
  },
};

export function signatureDef(id: SignatureId | undefined): SignatureDef | null {
  if (!id || id === 'none') return null;
  return SIGNATURE_DEFS[id] ?? null;
}

/** Deterministic pick from facts already on the record. */
export function deriveSignature(n: Nemesis): SignatureId {
  if (n.archetype === 'commander') return 'order_pulse';
  if (n.archetype === 'duelist') return 'feint_storm';
  if (n.stolen.some((s) => s.kind === 'weapon')) return 'stolen_technique';
  if (n.returns > 0 || hasMemory(n, 'I_RETURNED_FROM_DEATH')) return 'return_burst';
  if (hasScar(n, 'burn') || n.adaptations.includes('fire_hardened')) return 'ash_zone';
  if (n.personality === 'coward') return 'alarm_retreat';
  if (n.personality === 'avenger') return 'avenger_pact';
  if (n.personality === 'survivor') return 'escape_cut';
  if (n.adaptations.includes('delayed_strike') || n.adaptations.some((a) => a.includes('delay'))) {
    return 'delayed_rhythm';
  }
  if (rankIndex(n.rank) >= 3 && n.archetype === 'heavy') return 'ash_zone';
  return n.archetype === 'archer' ? 'alarm_retreat' : 'delayed_rhythm';
}

export function ensureSignature(n: Nemesis): SignatureId {
  if (!n.signatureId || n.signatureId === 'none') n.signatureId = deriveSignature(n);
  n.signatureKnown = n.signatureKnown ?? false;
  return n.signatureId;
}

/**
 * True when this attack is the named foe's signature tell — used for combat
 * feedback (toast / telegraph / known flag). Keeps presentation tied to facts
 * already on the record.
 */
export function isSignatureAttack(n: Nemesis, attackId: string): boolean {
  const sid = ensureSignature(n);
  if (sid === 'none') return false;
  if (sid === attackId) return true;
  switch (sid) {
    case 'feint_storm':
      return attackId === 'feint_lunge';
    case 'order_pulse':
      return attackId === 'order_pulse';
    case 'ash_zone':
      return attackId === 'ground_slam' || attackId === 'heavy_overhead' || attackId === 'delayed_smash';
    case 'delayed_rhythm':
      return attackId === 'delayed_overhead' || attackId === 'delayed_smash';
    case 'stolen_technique':
      return (
        n.stolen.some((s) => s.kind === 'weapon') &&
        (attackId === 'riposte_cut' ||
          attackId === 'commit_thrust' ||
          attackId === 'thrust' ||
          attackId === 'punish_whiff' ||
          attackId === 'overhead')
      );
    case 'escape_cut':
      return attackId === 'wide_sweep' || attackId === 'sidestep_cut';
    case 'alarm_retreat':
      // Cowards telegraph the horn on dart / light cuts while breaking off.
      return attackId === 'dart_slash' || attackId === 'quick_slash' || attackId === 'sidestep_cut';
    case 'return_burst':
      return attackId === 'shoulder_charge' || attackId === 'ground_slam' || attackId === 'shove';
    case 'avenger_pact':
      return false; // announced when a bonded ally falls, not on a swing
    default:
      return false;
  }
}

/** Event kinds that are not attack defs but still own a signature tell. */
export type SignatureEvent =
  | 'attack'
  | 'feint'
  | 'flee'
  | 'resurrection'
  | 'ally_fallen';

export function signatureEventMatches(n: Nemesis, event: SignatureEvent): boolean {
  const sid = ensureSignature(n);
  if (sid === 'none') return false;
  switch (event) {
    case 'feint':
      return sid === 'feint_storm';
    case 'flee':
      return sid === 'alarm_retreat' || sid === 'escape_cut';
    case 'resurrection':
      return sid === 'return_burst';
    case 'ally_fallen':
      return sid === 'avenger_pact';
    default:
      return false;
  }
}
