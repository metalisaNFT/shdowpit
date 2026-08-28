/**
 * Authoritative skill runtime: validation, cooldowns, charges, UI snapshot.
 * Individual skills do not own cooldown clocks.
 */

import {
  cooldownFloor,
  DEFAULT_LOADOUT,
  getSkill,
  isUltimateSkill,
  STARTING_SKILLS,
  type SkillDef,
  type SkillId,
  type SkillSlot,
} from '../data/skills';
import { SKILLS, ULTIMATE } from '../data/balance';
import type { PlayerCombat } from '../player/PlayerCombat';
import type { PlayerStats } from '../player/PlayerStats';

export type FailReason =
  | 'ok'
  | 'busy'
  | 'cooldown'
  | 'surge'
  | 'locked'
  | 'dead'
  | 'stagger'
  | 'execute'
  | 'windup'
  | 'empty_slot'
  | 'already_active';

export interface AbilityEvent {
  t: number;
  kind:
    | 'accept'
    | 'reject'
    | 'spend'
    | 'cooldown_start'
    | 'cooldown_ready'
    | 'refund'
    | 'interrupt'
    | 'hit'
    | 'proc_reject'
    | 'ultimate_end';
  skill?: SkillId;
  detail?: string;
}

export interface SkillHudState {
  slot: SkillSlot;
  id: SkillId | null;
  name: string;
  bind: string;
  cooldown: number;
  cooldownMax: number;
  ready: boolean;
  flash: number;
  failed: number;
  empowered: boolean;
  surgeNeed: number;
}

export class AbilityRuntime {
  loadout: [SkillId, SkillId] = [...DEFAULT_LOADOUT];
  ultimate: SkillId = 'pit_eruption';
  unlocked: SkillId[] = [...STARTING_SKILLS];
  freeze = false;
  speed = 1;
  infinite = false;

  /** remaining cooldown seconds, keyed by skill id */
  private cd = new Map<SkillId, number>();
  private cdMax = new Map<SkillId, number>();
  private becameReady: SkillId[] = [];
  nextEmpowered = false;
  lastFail: FailReason = 'ok';
  lastFailAt = 0;
  lastFailSlot: SkillSlot | null = null;
  clock = 0;
  events: AbilityEvent[] = [];
  hudFail: Record<SkillSlot, number> = { skill1: 0, skill2: 0, ultimate: 0 };
  hudFlash: Record<SkillSlot, number> = { skill1: 0, skill2: 0, ultimate: 0 };
  private refundedThisCast = new Set<SkillId>();

  reset(): void {
    this.cd.clear();
    this.cdMax.clear();
    this.becameReady.length = 0;
    this.nextEmpowered = false;
    this.lastFail = 'ok';
    this.clock = 0;
    this.events.length = 0;
    this.refundedThisCast.clear();
    this.hudFail = { skill1: 0, skill2: 0, ultimate: 0 };
    this.hudFlash = { skill1: 0, skill2: 0, ultimate: 0 };
  }

  equip(a: SkillId, b: SkillId): void {
    const first = this.unlocked.includes(a) ? a : DEFAULT_LOADOUT[0];
    let second = this.unlocked.includes(b) ? b : DEFAULT_LOADOUT[1];
    if (second === first) {
      second = this.unlocked.find((id) => id !== first && !isUltimateSkill(id)) ?? DEFAULT_LOADOUT[1];
    }
    this.loadout = [first, second];
  }

  equipUltimate(id: SkillId): void {
    if (isUltimateSkill(id) && (this.unlocked.includes(id) || id === 'pit_eruption')) this.ultimate = id;
  }

  unlock(id: SkillId): boolean {
    if (this.unlocked.includes(id)) return false;
    this.unlocked.push(id);
    this.log('accept', id, 'unlock');
    return true;
  }

  skillIn(slot: SkillSlot): SkillId | null {
    if (slot === 'ultimate') return this.ultimate;
    return slot === 'skill1' ? this.loadout[0] : this.loadout[1];
  }

  remaining(id: SkillId): number {
    if (this.infinite) return 0;
    return this.cd.get(id) ?? 0;
  }

  ready(id: SkillId): boolean {
    return this.remaining(id) <= 0;
  }

  takeReadyPulses(): SkillId[] {
    const out = this.becameReady.slice();
    this.becameReady.length = 0;
    return out;
  }

  update(dt: number): void {
    if (this.freeze) return;
    const step = dt * this.speed;
    this.clock += step;
    for (const k of [...this.cd.keys()]) {
      const left = (this.cd.get(k) ?? 0) - step;
      if (left <= 0) {
        this.cd.delete(k);
        this.becameReady.push(k);
        this.log('cooldown_ready', k);
        const slot = this.slotOf(k);
        if (slot) this.hudFlash[slot] = 0.35;
      } else {
        this.cd.set(k, left);
      }
    }
    for (const s of ['skill1', 'skill2', 'ultimate'] as SkillSlot[]) {
      if (this.hudFail[s] > 0) this.hudFail[s] -= step;
      if (this.hudFlash[s] > 0) this.hudFlash[s] -= step;
    }
  }

  tryActivate(
    slot: SkillSlot,
    combat: PlayerCombat,
    stats: PlayerStats
  ): { ok: boolean; reason: FailReason; def: SkillDef | null } {
    const id = this.skillIn(slot);
    if (!id) return this.fail(slot, 'empty_slot', null);
    const def = getSkill(id);
    if (combat.action === 'dead') return this.fail(slot, 'dead', def);
    if (combat.action === 'stagger') return this.fail(slot, 'stagger', def);
    if (combat.action === 'execute') return this.fail(slot, 'execute', def);
    if (combat.action === 'skill' || combat.action === 'ultimate') return this.fail(slot, 'already_active', def);

    const committed =
      (combat.action === 'attack' && combat.phase === 'windup') ||
      (combat.action === 'dodge' && combat.t < 0.22);
    const committedSkill =
      def.id === 'ground_rupture' ||
      def.id === 'pit_eruption' ||
      def.id === 'void_grasp' ||
      def.id === 'shadow_snare' ||
      def.id === 'hunters_brand' ||
      def.id === 'living_weapon' ||
      def.id === 'last_defiance';
    if (committedSkill) {
      if (combat.action === 'attack' && combat.phase === 'windup') return this.fail(slot, 'windup', def);
      if (combat.action === 'dodge') return this.fail(slot, 'busy', def);
    }
    if ((def.id === 'shadow_step' || def.id === 'spectral_guard') && combat.action === 'attack' && combat.phase === 'windup') {
      return this.fail(slot, 'windup', def);
    }
    if (committed && def.id !== 'shadow_step' && def.id !== 'spectral_guard') return this.fail(slot, 'busy', def);

    if (!this.ready(id)) return this.fail(slot, 'cooldown', def);

    if (def.surgeCost > 0) {
      if (this.infinite) {
        /* spend is skipped */
      } else if (stats.surge < def.surgeCost - 0.01) {
        return this.fail(slot, 'surge', def);
      } else if (!stats.spendSurge(def.surgeCost)) {
        return this.fail(slot, 'surge', def);
      } else {
        this.log('spend', id, `surge ${def.surgeCost}`);
      }
    }

    const started = combat.trySkill(isUltimateSkill(def.id) ? 'ultimate' : 'skill', def.id);
    if (!started) return this.fail(slot, 'busy', def);

    this.startCooldown(id);
    this.log('accept', id);
    return { ok: true, reason: 'ok', def };
  }

  startCooldown(id: SkillId): void {
    if (this.infinite) return;
    const def = getSkill(id);
    if (def.cooldown <= 0) return;
    const cd = Math.max(cooldownFloor(def.cooldown), def.cooldown);
    this.cd.set(id, cd);
    this.cdMax.set(id, cd);
    this.refundedThisCast.delete(id);
    this.log('cooldown_start', id, cd.toFixed(2));
  }

  /** Partial refund. Never a full reset. Secondary kills must not call this. */
  refund(id: SkillId, frac: number, why: string): void {
    if (frac <= 0 || this.refundedThisCast.has(id)) return;
    const left = this.cd.get(id);
    if (left === undefined) return;
    this.refundedThisCast.add(id);
    const next = Math.max(cooldownFloor(getSkill(id).cooldown), left * (1 - Math.min(0.35, frac)));
    this.cd.set(id, next);
    this.log('refund', id, `${why} -> ${next.toFixed(2)}`);
  }

  namedExecuteRefund(): void {
    for (const id of this.loadout) this.refund(id, SKILLS.namedExecuteRefund, 'named execute');
  }

  interrupt(id: SkillId | null): void {
    if (id) this.log('interrupt', id);
  }

  snapshot(binds: Record<SkillSlot, string>): SkillHudState[] {
    const slots: SkillSlot[] = ['skill1', 'skill2', 'ultimate'];
    return slots.map((slot) => {
      const id = this.skillIn(slot);
      const def = id ? getSkill(id) : null;
      const cd = id ? this.remaining(id) : 0;
      const max = id ? (this.cdMax.get(id) ?? def?.cooldown ?? 1) : 1;
      return {
        slot,
        id,
        name: def?.name ?? '—',
        bind: binds[slot],
        cooldown: cd,
        cooldownMax: Math.max(0.001, max),
        ready: !!id && cd <= 0 && (slot !== 'ultimate' || true),
        flash: this.hudFlash[slot],
        failed: this.hudFail[slot],
        empowered: this.nextEmpowered && slot !== 'ultimate',
        surgeNeed: def?.surgeCost ?? 0,
      };
    });
  }

  logHit(id: SkillId, detail: string): void {
    this.log('hit', id, detail);
  }

  private slotOf(id: SkillId): SkillSlot | null {
    if (isUltimateSkill(id) && this.ultimate === id) return 'ultimate';
    if (this.loadout[0] === id) return 'skill1';
    if (this.loadout[1] === id) return 'skill2';
    return null;
  }

  private fail(slot: SkillSlot, reason: FailReason, def: SkillDef | null): { ok: boolean; reason: FailReason; def: SkillDef | null } {
    this.lastFail = reason;
    this.lastFailAt = this.clock;
    this.lastFailSlot = slot;
    this.hudFail[slot] = 0.28;
    this.log('reject', def?.id, reason);
    return { ok: false, reason, def };
  }

  private log(kind: AbilityEvent['kind'], skill?: SkillId, detail?: string): void {
    this.events.push({ t: this.clock, kind, skill, detail });
    if (this.events.length > 80) this.events.shift();
  }
}

export const ULTIMATE_COST = ULTIMATE.surgeCost;
