/**
 * Smarter power / stat offers: synergy, wildcard, recovery. Never capped stats.
 */

import type { RNG } from '../core/RNG';
import type { PowerDef, PowerSet, PowerId } from '../data/abilities';
import { RUN_STATS, type RunStatId } from '../data/stats';
import { familyOf, potentialReactions, type PowerFamily } from './Reactions';

export interface OfferContext {
  owned: PowerSet;
  weaponId: string;
  statAtCap: (id: RunStatId) => boolean;
}

function pickWeighted<T>(rng: RNG, items: T[], weight: (t: T) => number): T | null {
  if (!items.length) return null;
  let total = 0;
  const ws = items.map((it) => Math.max(0.01, weight(it)));
  for (const w of ws) total += w;
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function familyCounts(owned: PowerSet): Map<PowerFamily, number> {
  const m = new Map<PowerFamily, number>();
  for (const id of owned.ids()) {
    const f = familyOf(id);
    m.set(f, (m.get(f) ?? 0) + 1);
  }
  return m;
}

function dominantFamily(owned: PowerSet): PowerFamily | null {
  const m = familyCounts(owned);
  let best: PowerFamily | null = null;
  let n = 0;
  for (const [f, c] of m) {
    if (c > n) {
      n = c;
      best = f;
    }
  }
  return n >= 2 ? best : null;
}

export function rollPowerOffers(rng: RNG, ctx: OfferContext, powerCount: number): PowerDef[] {
  const pool = ctx.owned.offerable().slice();
  const taken = new Set<string>();
  const out: PowerDef[] = [];

  const potential = potentialReactions(ctx.owned);
  const synIds = new Set<PowerId>();
  for (const r of potential) {
    for (const id of r.requires) if (!ctx.owned.has(id)) synIds.add(id);
  }
  const fam = dominantFamily(ctx.owned);
  const synPool = pool.filter((p) => synIds.has(p.id) || (fam && familyOf(p.id) === fam));
  const syn = pickWeighted(rng, synPool.length ? synPool : pool, (p) => p.weight);
  if (syn) {
    out.push(syn);
    taken.add(syn.id);
  }

  const rest = pool.filter((p) => !taken.has(p.id));
  const wild = pickWeighted(rng, rest, (p) => p.weight * (fam && familyOf(p.id) === fam ? 0.55 : 1));
  if (wild && out.length < powerCount) {
    out.push(wild);
    taken.add(wild.id);
  }

  const defPool = pool.filter((p) => !taken.has(p.id) && (p.tag === 'DEFENCE' || p.id === 'second_wind' || p.id === 'leech' || p.id === 'vulture'));
  const def = pickWeighted(rng, defPool.length ? defPool : pool.filter((p) => !taken.has(p.id)), (p) => p.weight);
  if (def && out.length < powerCount) {
    out.push(def);
    taken.add(def.id);
  }

  while (out.length < powerCount) {
    const more = pool.filter((p) => !taken.has(p.id));
    const n = pickWeighted(rng, more, (p) => p.weight);
    if (!n) break;
    out.push(n);
    taken.add(n.id);
  }
  return out;
}

export function rollUncappedStats(rng: RNG, ctx: OfferContext, count: number, exclude: Set<RunStatId> = new Set()): RunStatId[] {
  const pool = RUN_STATS.filter((s) => !ctx.statAtCap(s.id) && !exclude.has(s.id));
  const out: RunStatId[] = [];
  const left = pool.slice();
  for (let i = 0; i < count && left.length; i++) {
    const pick = pickWeighted(rng, left, (s) => {
      let w = s.weight;
      if (ctx.weaponId === 'spear' && (s.id === 'rangedDamage' || s.id === 'pierce')) w *= 1.2;
      if (ctx.weaponId === 'hammer' && (s.id === 'postureDamage' || s.id === 'meleeDamage')) w *= 1.25;
      if (ctx.weaponId === 'greatsword' && (s.id === 'postureDamage' || s.id === 'meleeDamage')) w *= 1.25;
      if (ctx.weaponId === 'sword' && s.id === 'parryWindow') w *= 1.15;
      return w;
    });
    if (!pick) break;
    out.push(pick.id);
    const idx = left.findIndex((x) => x.id === pick.id);
    if (idx >= 0) left.splice(idx, 1);
  }
  return out;
}

export const RECOVERY_STATS: RunStatId[] = ['maxHp', 'hpRegen', 'lifesteal', 'dodgeCooldown', 'parryWindow'];
