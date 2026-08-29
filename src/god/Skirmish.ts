/**
 * The war never stops.
 *
 * Most cycles are rabble killing rabble. Sometimes a nobody kills somebody,
 * and the world has to learn their name.
 */

import { mixSeed } from '../core/RNG';
import { AREAS, getArea } from '../data/areas';
import { generateGrunt } from '../nemesis/NemesisGenerator';
import { displayName, fullName, isNamed, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { livingFactions } from './Factions';
import type { GodContext } from './Context';
import { fightSpectacle } from './Context';
import { simOf } from './GodTypes';

function areaPressure(ctx: GodContext, areaId: string): number {
  let p = 1;
  for (const f of livingFactions(ctx.god)) {
    if (!f.territories.includes(areaId)) continue;
    if (f.warWith.length) p += 0.55;
    p += (100 - f.stability) / 220;
  }
  if (ctx.cond.on(areaId).some((c) => c.kind === 'unrest')) p += 0.35;
  p *= ctx.act.tempo;
  return p;
}

function makeGrunt(ctx: GodContext, areaId: string, salt: number): Nemesis {
  const area = getArea(areaId);
    const seed = mixSeed(mixSeed(mixSeed(ctx.mgr.data.worldSeed, ctx.god.cycle), areaId.charCodeAt(0)), salt) >>> 0;
  const level = Math.max(1, area.danger + ctx.rng.int(0, 2));
  return generateGrunt(seed, level, ctx.mgr.mods, areaId);
}

function namedInArea(ctx: GodContext, areaId: string): Nemesis[] {
  const holderId = ctx.mgr.data.territories[areaId];
  return ctx.mgr.namedLiving().filter((n) => n.territory === areaId || n.id === holderId);
}

/** Background and foreground fights that keep the map at war. */
export function simulateSkirmishes(ctx: GodContext): number {
  let fights = 0;
  let salt = 0;

  for (const area of AREAS) {
    const pressure = areaPressure(ctx, area.id);
    const count = Math.max(2, Math.round((area.population / 2.8) * pressure));
    const locals = namedInArea(ctx, area.id);

    for (let i = 0; i < count; i++) {
      const roll = ctx.rng.next();
      if (roll < 0.74 || !locals.length) {
        rabbleVsRabble(ctx, area.id, salt++);
        fights++;
      } else if (roll < 0.93) {
        rabbleVsNamed(ctx, area.id, ctx.rng.pick(locals), salt++);
        fights++;
      }
    }
  }

  return fights;
}

function rabbleVsRabble(ctx: GodContext, areaId: string, salt: number): void {
  const a = makeGrunt(ctx, areaId, salt * 2 + 1);
  const b = makeGrunt(ctx, areaId, salt * 2 + 2);
  ctx.skirmishMode = true;
  const res = ctx.fight(a, b, 'war');
  ctx.skirmishMode = false;

  const priority = res.aftermath === 'killed' ? 'notable' : 'background';
  const beat = ctx.emit(
    'skirmish',
    priority,
    res.headline,
    res.detail,
    [],
    res.aftermath === 'killed' ? 'bad' : 'neutral'
  );

  if (res.aftermath === 'killed' && ctx.rng.chance(0.38)) {
    beat.spectacle = fightSpectacle(res.winner, res.loser, 'war', res.duel);
  }
}

function rabbleVsNamed(ctx: GodContext, areaId: string, named: Nemesis, salt: number): void {
  const rabble = makeGrunt(ctx, areaId, salt + 900);
  rabble.level = Math.max(rabble.level, Math.round(named.level * ctx.rng.range(0.72, 1.05)));

  ctx.skirmishMode = true;
  const res = ctx.fight(rabble, named, 'war');
  ctx.skirmishMode = false;

  if (res.aftermath === 'killed' && res.loser === named) {
    const killerId = simOf(named).killedById;
    const elevated = killerId ? ctx.mgr.byId(killerId) : null;
    if (elevated && isNamed(elevated)) {
      const beat = ctx.emitFight(
        'skirmish',
        rankIndex(named.rank) >= 3 ? 'legendary' : 'major',
        res,
        elevated,
        named,
        'war',
        [elevated.id, named.id],
        'bad',
        `${displayName(elevated).toUpperCase()} KILLED ${fullName(named).toUpperCase()} AND TOOK THEIR PLACE.`,
        [`The rabble had no name. Now it is ${fullName(elevated).toUpperCase()}.`]
      );
      beat.spectacle = fightSpectacle(elevated, named, 'war', res.duel);
      return;
    }
  }

  const w = displayName(res.winner);
  const l = displayName(res.loser);
  const beat = ctx.emit(
    'skirmish',
    res.aftermath === 'killed' && res.loser === named ? 'major' : 'background',
    res.aftermath === 'killed' ? `${w.toUpperCase()} KILLED ${l.toUpperCase()}.` : res.headline,
    res.detail,
    res.loser === named || res.winner === named ? [named.id] : [],
    res.aftermath === 'killed' ? 'bad' : 'neutral'
  );

  if (ctx.rng.chance(res.aftermath === 'killed' ? 0.55 : 0.18)) {
    beat.spectacle = fightSpectacle(res.winner, res.loser, 'war', res.duel);
  }
}
