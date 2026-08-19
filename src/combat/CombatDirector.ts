/**
 * The combat director.
 *
 * Crowd fights were unreadable because nothing stopped every enemy in range
 * from swinging at the same moment — the QA pass measured four simultaneous
 * attackers. A player cannot parse four overlapping telegraphs, so a crowd
 * stopped being a tactical problem and became a coin flip.
 *
 * The director hands out a small number of attack permits. Whoever holds one
 * commits; everyone else circles, repositions and threatens, which reads as
 * intent rather than as passivity. Melee and ranged permits are counted
 * separately so an archer can never use up a melee slot and leave the player
 * standing unopposed.
 *
 * This is deliberately not a scheduler. It says "not yet" and nothing else —
 * the enemies still choose their own attacks and their own moments.
 */

import { DIRECTOR } from '../data/balance';

interface Slot {
  uid: number;
  ranged: boolean;
  /** director clock time at which the permit lapses */
  expires: number;
}

export class CombatDirector {
  private slots: Slot[] = [];
  private clock = 0;
  private lastGrant = -999;

  /** Raised for tougher encounters; see DIRECTOR in data/balance.ts. */
  maxAttackers: number = DIRECTOR.maxAttackers;
  maxRanged: number = DIRECTOR.maxRangedAttackers;

  /** QA/debug readout */
  get meleeCount(): number {
    return this.slots.filter((s) => !s.ranged).length;
  }
  get rangedCount(): number {
    return this.slots.filter((s) => s.ranged).length;
  }
  get held(): number[] {
    return this.slots.map((s) => s.uid);
  }

  reset(): void {
    this.slots.length = 0;
    this.lastGrant = -999;
  }

  /**
   * @param liveAttackers uids that are genuinely still mid-attack. Permits for
   *   anyone else are released immediately, so a staggered or dead enemy never
   *   holds a slot hostage.
   */
  update(dt: number, liveAttackers: Set<number>): void {
    this.clock += dt;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (this.clock > s.expires || !liveAttackers.has(s.uid)) this.slots.splice(i, 1);
    }
  }

  holds(uid: number): boolean {
    return this.slots.some((s) => s.uid === uid);
  }

  /**
   * Ask for permission to start an attack. Returns false when the floor is
   * full or when another enemy started too recently — a short gap between
   * commitments is what turns two attackers into a rhythm instead of a wall.
   */
  claim(uid: number, ranged: boolean): boolean {
    if (this.holds(uid)) return true;
    if (this.clock - this.lastGrant < DIRECTOR.staggerBetweenAttacks) return false;
    const cap = ranged ? this.maxRanged : this.maxAttackers;
    const used = ranged ? this.rangedCount : this.meleeCount;
    if (used >= cap) return false;
    this.slots.push({ uid, ranged, expires: this.clock + DIRECTOR.slotTimeout });
    this.lastGrant = this.clock;
    return true;
  }

  release(uid: number): void {
    const i = this.slots.findIndex((s) => s.uid === uid);
    if (i >= 0) this.slots.splice(i, 1);
  }

  /**
   * Would a claim succeed right now? Read-only — the AI uses this to decide
   * whether to press in (PRESSURE) or hold the outer band (CIRCLE / WAIT)
   * without burning a permit it is not ready to use.
   */
  couldClaim(uid: number, ranged: boolean): boolean {
    if (this.holds(uid)) return true;
    const cap = ranged ? this.maxRanged : this.maxAttackers;
    const used = ranged ? this.rangedCount : this.meleeCount;
    return used < cap;
  }

  /** Scale pressure with how dangerous the encounter should feel. */
  setPressure(level: 'normal' | 'high' | 'extreme'): void {
    this.maxAttackers =
      level === 'extreme'
        ? DIRECTOR.maxAttackersExtreme
        : level === 'high'
          ? DIRECTOR.maxAttackersHigh
          : DIRECTOR.maxAttackers;
  }
}
