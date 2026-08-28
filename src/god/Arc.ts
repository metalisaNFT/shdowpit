/**
 * The shape of a run.
 *
 * A simulation with no beginning or end is a screensaver. The act table is the
 * only thing in the god layer that is authored rather than emergent, and it
 * authors pressure, not events: how fast the world moves, how willing people
 * are to finish each other, and how hard everyone is pushed to climb. What
 * actually happens is still decided by the characters.
 */

import type { ActDef, ActId, GodState } from './GodTypes';
import { ACT_ORDER } from './GodTypes';

export const ACTS: ActDef[] = [
  {
    id: 'early',
    name: 'THE SMALL WARS',
    from: 1,
    tempo: 0.85,
    lethality: 0.65,
    pressure: 0.8,
    blurb: 'Nobody is important yet. That is the opportunity.',
  },
  {
    id: 'rising',
    name: 'THE RISING',
    from: 8,
    tempo: 1.0,
    lethality: 1.0,
    pressure: 1.2,
    blurb: 'Names are starting to mean something. So are grudges.',
  },
  {
    id: 'late',
    name: 'THE LATE WORLD',
    from: 16,
    tempo: 1.15,
    lethality: 1.3,
    pressure: 1.5,
    blurb: 'The powerful are powerful now. Whatever you did early is loose in the world.',
  },
  {
    id: 'crisis',
    name: 'THE CRISIS',
    from: 23,
    tempo: 1.3,
    lethality: 1.55,
    pressure: 1.8,
    blurb: 'Something has grown past the world it grew in.',
  },
];

const ACT_MAP = new Map<ActId, ActDef>(ACTS.map((a) => [a.id, a]));

/** The cycle the world falls if the crisis is never answered. */
export const RUN_DEADLINE = 32;

export function actForCycle(cycle: number): ActDef {
  let out = ACTS[0];
  for (const a of ACTS) if (cycle >= a.from) out = a;
  return out;
}

export function getAct(id: ActId): ActDef {
  return ACT_MAP.get(id) ?? ACTS[0];
}

export function actIndex(id: ActId): number {
  return ACT_ORDER.indexOf(id);
}

/**
 * Advance the act clock. Returns the act if it just changed, so the caller can
 * announce it — the only scheduled beat in the whole layer.
 */
export function advanceAct(god: GodState): ActDef | null {
  const next = actForCycle(god.cycle);
  if (next.id === god.act) return null;
  god.act = next.id;
  return next;
}

/** Chaos above the act's tolerance drags the world along faster than planned. */
export function effectiveAct(god: GodState): ActDef {
  const base = getAct(god.act);
  const overload = Math.max(0, god.chaos - 50) / 100;
  if (overload <= 0) return base;
  return {
    ...base,
    tempo: base.tempo * (1 + overload * 0.4),
    lethality: base.lethality * (1 + overload * 0.5),
    pressure: base.pressure * (1 + overload * 0.45),
  };
}
