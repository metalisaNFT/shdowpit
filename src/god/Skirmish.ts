/**
 * The war on the ground.
 *
 * RECONSTRUCTION: this used to run ten to fifteen rabble duels per cycle
 * through the full fight pipeline, printed them all as NOTABLE, let rabble
 * kill named characters and inherit their names, and counted every rabble
 * fight as a named character's "win". It was the single largest source of
 * churn in the game — nine new names a run, 90-win characters — and none of
 * it was anything a player could plan around.
 *
 * Now it is weather. Ground held by a house at war, or sitting on unrest, is
 * expensive to stand on: whoever holds it bleeds a little each cycle, and the
 * house that owns it frays. Nobody is named by it. New names enter the world
 * through RECRUIT (a captain pulling someone up) or, when the cast has thinned
 * badly, one deliberate rise from the rabble that the feed actually reports.
 */

import { AREAS } from '../data/areas';
import { AREA_NAMES } from '../data/names';
import { getPersonality } from '../data/personalities';
import { fullName } from '../nemesis/Nemesis';
import { CAST_FLOOR } from './Actions';
import type { GodContext } from './Context';
import { factionFor, livingFactions, shakeFaction } from './Factions';
import { simOf } from './GodTypes';

function areaPressure(ctx: GodContext, areaId: string): number {
  let p = 0;
  for (const f of livingFactions(ctx.god)) {
    if (!f.territories.includes(areaId)) continue;
    if (f.warWith.length) p += 0.6;
    p += Math.max(0, 40 - f.stability) / 120;
  }
  p += ctx.cond.weight(areaId, 'unrest') * 0.5;
  return p * ctx.act.tempo;
}

/** Attrition on contested ground. Returns how many areas were under pressure. */
export function simulateSkirmishes(ctx: GodContext): number {
  let contested = 0;
  for (const area of AREAS) {
    const pressure = areaPressure(ctx, area.id);
    if (pressure < 0.3) continue;
    contested++;
    const holder = ctx.mgr.territoryHolder(area.id);
    if (!holder || !holder.alive) continue;
    const s = simOf(holder);
    const wound = Math.round(pressure * ctx.rng.range(3, 9));
    s.injury = Math.min(100, s.injury + wound);
    s.fear = Math.min(100, s.fear + Math.round(pressure * 2));
    shakeFaction(ctx.god, s.factionId, -Math.round(pressure * 2));
    if (wound >= 6 && !ctx.silent) {
      ctx.emit(
        'skirmish',
        'background',
        `${AREA_NAMES[area.id] ?? area.name} IS BLEEDING ${fullName(holder)}.`,
        [`Holding contested ground costs. Wounds +${wound}.`],
        [holder.id]
      );
    }
  }
  riseFromRabble(ctx);
  return contested;
}

/**
 * When the world has emptied out, somebody nobody had heard of steps into the
 * gap. At most one per cycle, only while the cast is thin, and always with a
 * beat the player can read — a name that arrives unannounced is a name that
 * never becomes anyone.
 */
function riseFromRabble(ctx: GodContext): void {
  const named = ctx.mgr.namedLiving();
  if (named.length >= CAST_FLOOR) return;
  if (!ctx.rng.chance(0.35)) return;
  const open = AREAS.filter((a) => a.id !== 'fortress' && !ctx.mgr.territoryHolder(a.id));
  const area = open.length ? ctx.rng.pick(open) : ctx.rng.pick(AREAS.filter((a) => a.id !== 'fortress'));
  const n = ctx.mgr.recruit('elite', false);
  n.territory = area.id;
  const s = simOf(n);
  s.ambition = 65 + ctx.rng.int(0, 25);
  s.confidence = 55 + ctx.rng.int(0, 20);
  const strongest = named.slice().sort((a, b) => b.power - a.power)[0];
  const f = strongest ? factionFor(ctx.god, strongest) : null;
  if (f && ctx.rng.chance(0.5)) {
    s.factionId = f.id;
    f.memberIds.push(n.id);
  }
  if (!ctx.mgr.territoryHolder(area.id)) ctx.mgr.data.territories[area.id] = n.id;
  ctx.deed(n, `came up out of the rabble in ${AREA_NAMES[area.id] ?? area.name}`, 2);
  ctx.emit(
    'rise',
    'major',
    `${fullName(n)} CAME UP OUT OF THE RABBLE.`,
    [
      `${getPersonality(n.personality).name}. ${AREA_NAMES[area.id] ?? area.name} was empty enough for someone to fill it.`,
      f && s.factionId ? `They have fallen in with ${f.name}.` : 'They answer to nobody yet.',
    ],
    [n.id],
    'gold'
  );
  ctx.chronicle('recruitment', `${fullName(n)} rose out of the rabble in ${area.name}.`, [n.id], true, 'gold');
}
