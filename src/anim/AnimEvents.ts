/**
 * Reusable animation-event data.
 *
 * A combat animation is not "hitbox on because the clip started": every
 * attack owns an explicit timeline of events derived from the SAME timing
 * numbers the combat state machine runs on (windup/hold/active/recover).
 * Combat stays the authority for damage windows; the timeline gives the
 * presentation layer (trails, whooshes, impacts, camera, telegraphs) and the
 * QA harness one shared, inspectable schedule. tools/animtest.mjs asserts
 * that HITBOX_ON/OFF here land on the exact frames combat opens/closes the
 * window — if the two ever drift, the build fails, not the game feel.
 */

export type AnimEventKind =
  | 'TELEGRAPH_START'
  | 'TELEGRAPH_END'
  | 'WHOOSH' // the swing sound, just before impact
  | 'TRAIL_ON'
  | 'TRAIL_OFF'
  | 'HITBOX_ON'
  | 'HITBOX_OFF'
  | 'PROJECTILE_SPAWN'
  | 'CAMERA_IMPULSE'
  | 'COMBO_WINDOW_OPEN'
  | 'COMBO_WINDOW_CLOSE'
  | 'FOOTSTEP'
  | 'SFX'
  | 'VFX';

export interface AnimEvent {
  t: number;
  kind: AnimEventKind;
  /** free payload: sfx name, vfx id, impulse strength... */
  arg?: string | number;
}

export interface AttackTimings {
  windup: number;
  hold?: number;
  active: number;
  recover: number;
}

/**
 * Build the standard melee timeline for a set of combat timings.
 * All times are absolute seconds from the start of the attack.
 */
export function buildAttackTimeline(
  t: AttackTimings,
  opts: { ranged?: boolean; area?: boolean; comboWindow?: number; heavy?: boolean } = {}
): AnimEvent[] {
  const hold = t.hold ?? 0;
  const strike = t.windup + hold;
  const ev: AnimEvent[] = [
    { t: 0, kind: 'TELEGRAPH_START' },
    { t: Math.max(0, strike - 0.09), kind: 'WHOOSH', arg: opts.heavy ? 0.7 : 1.15 },
    { t: strike, kind: 'TELEGRAPH_END' },
  ];
  if (opts.ranged) {
    ev.push({ t: strike, kind: 'PROJECTILE_SPAWN' });
  } else {
    ev.push(
      { t: strike, kind: 'TRAIL_ON' },
      { t: strike, kind: 'HITBOX_ON' },
      { t: strike + t.active, kind: 'HITBOX_OFF' },
      { t: Math.min(strike + t.active + 0.09, strike + t.active + t.recover), kind: 'TRAIL_OFF' }
    );
  }
  if (opts.area) ev.push({ t: strike, kind: 'CAMERA_IMPULSE', arg: 0.55 });
  if (opts.comboWindow) {
    ev.push(
      { t: strike + t.active, kind: 'COMBO_WINDOW_OPEN' },
      { t: strike + t.active + opts.comboWindow, kind: 'COMBO_WINDOW_CLOSE' }
    );
  }
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

/** Walk a timeline as time advances, firing each event exactly once. */
export class TimelineCursor {
  private events: AnimEvent[] = [];
  private next = 0;
  private t = 0;

  start(events: AnimEvent[]): void {
    this.events = events;
    this.next = 0;
    this.t = 0;
  }

  get active(): boolean {
    return this.next < this.events.length;
  }

  /** Advance to absolute time `t`, invoking cb for every crossed event. */
  advance(t: number, cb: (e: AnimEvent) => void): void {
    if (t < this.t) this.t = t; // restarted
    this.t = t;
    while (this.next < this.events.length && this.events[this.next].t <= t + 1e-6) {
      cb(this.events[this.next]);
      this.next++;
    }
  }

  cancel(): void {
    this.next = this.events.length;
  }
}

/**
 * Footstep phases for the shared gait cycle (see Animator.locoPhase):
 * planted feet at ~24% and ~74% of the cycle.
 */
export const FOOTSTEP_PHASES: readonly number[] = [0.24, 0.74];

/** Detect gait-phase crossings for footstep events (handles wrap). */
export function crossedFootstep(prevPhase: number, phase: number): boolean {
  for (const p of FOOTSTEP_PHASES) {
    if (prevPhase <= phase) {
      if (prevPhase < p && phase >= p) return true;
    } else if (prevPhase < p || phase >= p) {
      return true; // wrapped past 1.0
    }
  }
  return false;
}
