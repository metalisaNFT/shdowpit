/**
 * Conditions are the only thing the player is allowed to write.
 *
 * An intervention never says "kill him" or "promote her". It leaves a
 * condition lying in the world — a price on a head, a rumour, a blessing, an
 * open door — and then the autonomous layer reads it as one input among many
 * and decides for itself. A bounty on a warlord makes ambitious, greedy
 * characters more likely to go looking; it does not make anyone go, and it
 * certainly does not make them win.
 *
 * Everything decays. A rumour nobody acts on is forgotten.
 */

import type { Condition, ConditionKind, ConditionTargetKind, GodState } from './GodTypes';
import { neutralTilt, type CombatTilt } from './Combatant';

export interface ConditionSpec {
  kind: ConditionKind;
  targetKind: ConditionTargetKind;
  targetId: string;
  otherId?: string;
  magnitude: number;
  /** cycles it lasts */
  duration: number;
  note: string;
  source?: 'god' | 'world';
}

export function addCondition(god: GodState, spec: ConditionSpec): Condition {
  const c: Condition = {
    id: 'c' + god.nextConditionId.toString(36),
    kind: spec.kind,
    targetKind: spec.targetKind,
    targetId: spec.targetId,
    magnitude: spec.magnitude,
    createdCycle: god.cycle,
    expiresCycle: god.cycle + Math.max(1, Math.round(spec.duration)),
    source: spec.source ?? 'god',
    note: spec.note,
  };
  if (spec.otherId) c.otherId = spec.otherId;
  god.nextConditionId++;

  // The same kind on the same target does not stack into absurdity; it
  // refreshes and deepens, which is what "keep protecting him" should feel like.
  const existing = god.conditions.find(
    (x) => x.kind === c.kind && x.targetId === c.targetId && x.otherId === c.otherId
  );
  if (existing) {
    existing.magnitude = Math.min(2.5, existing.magnitude + c.magnitude * 0.7);
    existing.expiresCycle = Math.max(existing.expiresCycle, c.expiresCycle);
    existing.note = c.note;
    return existing;
  }
  god.conditions.push(c);
  return c;
}

export function expireConditions(god: GodState): Condition[] {
  const gone: Condition[] = [];
  god.conditions = god.conditions.filter((c) => {
    if (c.expiresCycle <= god.cycle) {
      gone.push(c);
      return false;
    }
    return true;
  });
  return gone;
}

export function removeConditions(god: GodState, targetId: string, kind?: ConditionKind): number {
  const before = god.conditions.length;
  god.conditions = god.conditions.filter((c) => !(c.targetId === targetId && (!kind || c.kind === kind)));
  return before - god.conditions.length;
}

/* ============================================================
   query index — rebuilt once per cycle, read thousands of times
   ============================================================ */

export class ConditionIndex {
  private byTarget = new Map<string, Condition[]>();
  private all: Condition[] = [];

  constructor(god: GodState) {
    this.all = god.conditions;
    for (const c of god.conditions) {
      let list = this.byTarget.get(c.targetId);
      if (!list) {
        list = [];
        this.byTarget.set(c.targetId, list);
      }
      list.push(c);
      if (c.otherId) {
        let other = this.byTarget.get(c.otherId);
        if (!other) {
          other = [];
          this.byTarget.set(c.otherId, other);
        }
        other.push(c);
      }
    }
  }

  on(targetId: string): Condition[] {
    return this.byTarget.get(targetId) ?? [];
  }

  /** Summed magnitude of one kind sitting on a target. 0 when there is none. */
  weight(targetId: string, kind: ConditionKind): number {
    let w = 0;
    for (const c of this.on(targetId)) if (c.kind === kind && c.targetId === targetId) w += c.magnitude;
    return w;
  }

  /** A rumour or provocation specifically about these two. */
  between(a: string, b: string, kind: ConditionKind): number {
    let w = 0;
    for (const c of this.on(a)) {
      if (c.kind !== kind) continue;
      if ((c.targetId === a && c.otherId === b) || (c.targetId === b && c.otherId === a)) w += c.magnitude;
    }
    return w;
  }

  worldWeight(kind: ConditionKind): number {
    let w = 0;
    for (const c of this.all) if (c.targetKind === 'world' && c.kind === kind) w += c.magnitude;
    return w;
  }

  ofKind(kind: ConditionKind): Condition[] {
    return this.all.filter((c) => c.kind === kind);
  }

  /**
   * How a character's conditions lean a fight. A blessing is a thumb on the
   * scale, never a hand.
   */
  tiltFor(id: string): CombatTilt {
    const t = neutralTilt();
    const bless = this.weight(id, 'blessing');
    const curse = this.weight(id, 'curse');
    const ward = this.weight(id, 'ward');
    const exposure = this.weight(id, 'exposure');
    if (bless) {
      t.damage *= 1 + Math.min(0.45, bless * 0.22);
      t.health *= 1 + Math.min(0.4, bless * 0.2);
      t.resolve += Math.min(0.14, bless * 0.07);
    }
    if (curse) {
      t.damage *= Math.max(0.55, 1 - curse * 0.2);
      t.armour *= 1 + Math.min(0.5, curse * 0.24);
      t.resolve -= Math.min(0.12, curse * 0.06);
    }
    if (ward) t.armour *= Math.max(0.55, 1 - ward * 0.2);
    // Being exposed means someone arrives knowing where you are and you do not.
    if (exposure) t.edge -= Math.min(1.2, exposure * 0.6);
    return t;
  }
}

export const CONDITION_LABEL: Record<ConditionKind, string> = {
  blessing: 'BLESSED',
  curse: 'CURSED',
  bounty: 'PRICE ON THEIR HEAD',
  rumour: 'RUMOUR',
  mark: 'MARKED',
  ward: 'WARDED',
  opportunity: 'AN OPEN DOOR',
  exposure: 'EXPOSED',
  omen: 'OMEN',
  unrest: 'UNREST',
};
