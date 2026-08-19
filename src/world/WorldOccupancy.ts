/**
 * Snapshot of who holds each region, for geometry that has to wear a face.
 * Recomputed whenever the arena is rebuilt or a liberation lands mid-run.
 */

import { AREAS, type AreaDef } from '../data/areas';
import { paletteFor } from '../nemesis/NemesisAppearance';
import { WORLD } from '../data/palette';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { presentTerritory, type TerritoryRuleId } from './TerritoryRules';
import type { RunState } from '../run/RunState';

export interface AreaOccupancy {
  area: AreaDef;
  holderId: string | null;
  holderName: string;
  accent: number;
  liberated: boolean;
  ruleIds: TerritoryRuleId[];
}

export type OccupancyMap = Record<string, AreaOccupancy>;

export function snapshotOccupancy(mgr: NemesisManager, run: RunState | null): OccupancyMap {
  const out: OccupancyMap = {};
  const mods = run?.territoryMods ?? mgr.data.territoryMods ?? {};
  for (const area of AREAS) {
    const holder = mgr.territoryHolder(area.id);
    const live = holder && holder.alive ? holder : null;
    const pres = presentTerritory(area, live, mods, mgr.turn);
    out[area.id] = {
      area,
      holderId: pres.holderId,
      holderName: pres.holderName,
      accent: live ? paletteFor(live.appearanceSeed).accent : WORLD.metal,
      liberated: !!pres.liberation,
      ruleIds: pres.rules.map((r) => r.id),
    };
  }
  return out;
}
