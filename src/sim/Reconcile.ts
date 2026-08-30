import type { WorldEvent } from '../world/WorldEvent';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { recomputePower } from '../nemesis/NemesisGenerator';
import type { GodContext } from '../god/Context';
import { reconcileBiomes } from '../world/BiomeState';

/**
 * Single post-beat pass: hierarchy, territories, roster hygiene, power.
 * Called once per world beat from every simulation entry point.
 */
export function reconcileWorld(mgr: NemesisManager, ctx?: GodContext, events?: WorldEvent[]): WorldEvent[] {
  const out = events ?? [];
  for (const ev of mgr.fillRanks()) {
    out.push(ev);
    if (ctx && ev.type === 'promotion') {
      ctx.emit('promotion', 'notable', ev.text, ['The order closed up around a gap.'], ev.actors, 'gold');
    } else if (ctx && ev.type === 'demotion' && ev.important) {
      ctx.emit('succession', 'notable', ev.text, ['A successor was pushed aside.'], ev.actors, 'bad');
    }
  }
  mgr.pruneDead();
  mgr.assignTerritories();
  reconcileBiomes(mgr, ctx);
  for (const nem of mgr.roster) recomputePower(nem);
  return out;
}
