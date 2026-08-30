/**
 * Canonical time axes for ShadowPit's unified simulation.
 *
 * - `worldTurn` — global beat counter shared by pit offscreen beats and god cycles
 * - `god.cycle` — run-scoped act clock (1..32) for THE LONG GAME only
 * - `worldAge` — meta epoch; increments on Overlord kill / reseedWorld()
 *
 * After unification: one god cycle = one world beat (both advance `worldTurn` once).
 */

/** Shared global beat counter on SaveData.worldTurn */
export type WorldTurn = number;

/** Meta epoch on SaveData.worldAge */
export type WorldAge = number;

/** Run-scoped cycle on GodState.cycle (1..32) */
export type GodCycle = number;

/** Ratio after Phase 2 unification: 1 god cycle ≡ 1 world beat. */
export const CYCLE_BEAT_RATIO = 1;
