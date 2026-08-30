/**
 * Territory-aware heat modifiers — extracted from World heat tick path.
 */

import type { RunState } from '../../run/RunState';
import type { TerritoryPresentation } from '../TerritoryRules';
import { tickHeatEconomy } from '../Heat';

export interface HeatTickContext {
  run: RunState;
  dt: number;
  inCombat: boolean;
  insideArea: boolean;
  carryingRelic: boolean;
  presentation: TerritoryPresentation;
}

/** Apply territory law multipliers then delegate to canonical heat economy. */
export function tickTerritoryHeat(ctx: HeatTickContext): void {
  const { presentation: pres } = ctx;
  const dampen =
    pres.liberation?.kind === 'heat_dampen' ||
    (!!pres.liberation && pres.rules.some((r) => r.id === 'void_quiet'));
  const tracking = pres.rules.some((r) => r.id === 'tracking_patrols');
  const alarms = pres.rules.some((r) => r.id === 'alarms_escapes');

  let dwellMul = 1;
  if (dampen) dwellMul = 0.4;
  else if (tracking) dwellMul = 1.5;

  tickHeatEconomy(ctx.run, ctx.dt, ctx.inCombat, ctx.insideArea, ctx.carryingRelic, dwellMul);

  if (alarms && ctx.inCombat) {
    ctx.run.loudCombatTimer += ctx.dt * 0.15;
  }
}
