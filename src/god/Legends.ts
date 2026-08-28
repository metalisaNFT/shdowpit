/**
 * The Book of Legends.
 *
 * A roguelite that resets the world every run has to decide what survives the
 * reset, and "a number that makes you 4% stronger" is not an answer anyone
 * remembers. What survives here is people: the three characters a run actually
 * produced, with their deeds, their scars, their kills and how they felt about
 * you at the end.
 *
 * And they do not just sit in a menu. Each legend leaves one thing behind in
 * the next world — a weapon with their name on it, a descendant, a rumour, an
 * inherited grudge, or a title someone else is now wearing. That is the proof
 * that history outlived the reset.
 */

import type { RNG } from '../core/RNG';
import { SCAR_NAMES } from '../nemesis/NemesisMemory';
import { traitName } from '../data/traits';
import { getPersonality } from '../data/personalities';
import { AREA_NAMES } from '../data/names';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { GodContext } from './Context';
import { factionFor } from './Factions';
import { simOf, type GodState, type LegacyEcho, type LegacyKind, type LegendRecord, type RunOutcome } from './GodTypes';

export const MAX_LEGENDS = 40;

/**
 * How memorable someone actually was. Note that being *hated* by the player
 * scores as highly as being loved — the character you spent nine cycles trying
 * to destroy is a legend whether or not they ever thanked you for it.
 */
export function legendScore(n: Nemesis): number {
  const s = simOf(n);
  let score = 0;
  score += s.reputation * 1.4;
  score += s.deeds.reduce((t, d) => t + d.weight * 6, 0);
  score += s.kills.length * 14;
  score += n.returns * 45;
  score += rankIndex(n.rank) * 18;
  score += n.scars.length * 7;
  score += Math.abs(n.playerRelationship) * 0.55;
  score += s.wins * 3 - s.losses * 1.2;
  score += (n.humiliations ?? 0) * 6;
  if (s.crisisBorn) score += 120;
  if (s.heretic) score += 70;
  score += n.stolen.length * 10;
  return score;
}

function legacyFor(n: Nemesis, rng: RNG): LegacyKind {
  const s = simOf(n);
  if (n.stolen.length) return 'relic';
  if (s.heretic || n.playerRelationship > 60) return 'grudge';
  if (n.returns > 0) return 'rumour';
  if (n.title) return rng.chance(0.5) ? 'title' : 'bloodline';
  return 'bloodline';
}

function epitaphFor(n: Nemesis, cause: string): string {
  const s = simOf(n);
  if (s.crisisBorn) return 'The world could not hold them, and then it did not have to.';
  if (s.heretic) return 'They were the only one who ever looked up.';
  if (n.returns > 1) return 'Killed more than once. It kept not taking.';
  if (n.playerRelationship < -40) return 'They never knew whose hand it was, and they were grateful to it anyway.';
  if (n.playerRelationship > 60) return 'They knew exactly whose fault all of it was.';
  if (s.kills.length >= 4) return `${s.kills.length} people did not outlive them.`;
  return cause || 'They were here, and then they were not.';
}

export function makeLegend(ctx: GodContext, n: Nemesis, run: number): LegendRecord {
  const s = simOf(n);
  const killer = ctx.mgr.byId(s.killedById);
  const cause = !n.alive
    ? killer
      ? `Killed by ${fullName(killer)}.`
      : 'Died with nobody to blame.'
    : 'Still standing when it ended.';
  const f = factionFor(ctx.god, n);
  return {
    id: `${run}:${n.id}`,
    name: n.name,
    title: n.title,
    run,
    age: ctx.mgr.age,
    faction: f ? f.name : 'UNSWORN',
    appearanceSeed: n.appearanceSeed,
    archetype: n.archetype,
    personality: getPersonality(n.personality).name,
    finalRank: n.rank.toUpperCase(),
    finalPower: n.power,
    traits: n.strengths.map((t) => traitName(t)),
    scars: n.scars.map((sc) => SCAR_NAMES[sc.id]),
    deeds: s.deeds
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)
      .map((d) => `Cycle ${d.cycle} — ${d.text}`),
    kills: s.kills.length,
    rivals: n.rivalries.map((id) => ctx.name(id)).slice(0, 4),
    causeOfDeath: cause,
    standing: Math.round(n.playerRelationship),
    legacy: legacyFor(n, ctx.rng),
    epitaph: epitaphFor(n, cause),
  };
}

/** The characters this run actually produced. Three at most, or it means nothing. */
export function harvestLegends(ctx: GodContext, outcome: RunOutcome, run: number): LegendRecord[] {
  const pool = ctx.mgr.roster.slice().sort((a, b) => legendScore(b) - legendScore(a));
  const out: LegendRecord[] = [];
  const floor = outcome.ending === 'abandoned' ? 150 : 90;
  for (const n of pool) {
    if (out.length >= 3) break;
    if (legendScore(n) < floor) continue;
    out.push(makeLegend(ctx, n, run));
  }
  // A run that produced a crisis always remembers it, whatever it scored.
  const crisisBody = ctx.mgr.byId(ctx.god.crisis?.bodyId);
  if (crisisBody && !out.some((l) => l.id.endsWith(':' + crisisBody.id))) {
    out.unshift(makeLegend(ctx, crisisBody, run));
    out.splice(3);
  }
  return out;
}

export function recordLegends(store: LegendRecord[], made: LegendRecord[]): LegendRecord[] {
  const out = [...store, ...made];
  if (out.length > MAX_LEGENDS) out.splice(0, out.length - MAX_LEGENDS);
  return out;
}

/* ============================================================
   the reach forward
   ============================================================ */

/**
 * Seed a fresh world with what the last runs left in it. Called once, at the
 * start of a run, after the roster exists.
 */
export function applyLegacies(
  mgr: NemesisManager,
  god: GodState,
  legends: readonly LegendRecord[],
  rng: RNG
): LegacyEcho[] {
  const echoes: LegacyEcho[] = [];
  const recent = legends.slice(-3);
  const used = new Set<string>();

  for (const l of recent) {
    const pool = mgr.living().filter((n) => !used.has(n.id));
    if (!pool.length) break;
    const who = pool[rng.int(0, pool.length - 1)];

    switch (l.legacy) {
      case 'relic': {
        who.stolen.push({ name: `${l.name.toUpperCase()}'S ${rng.pick(['EDGE', 'TOOTH', 'BRAND', 'DEBT'])}`, kind: 'weapon' });
        recomputePower(who);
        used.add(who.id);
        echoes.push({
          legendId: l.id,
          kind: 'relic',
          headline: `${fullName(who)} IS CARRYING SOMETHING THAT USED TO BE ${l.name.toUpperCase()}'S.`,
          detail: `${l.name} ${l.title} died in run ${l.run}. The steel did not.`,
          actorId: who.id,
        });
        break;
      }
      case 'bloodline': {
        if (mgr.takenNames().has(l.name.toLowerCase())) break;
        const heir = mgr.recruit('elite', false);
        heir.name = l.name;
        heir.title = 'THE YOUNGER';
        heir.appearanceSeed = l.appearanceSeed;
        heir.territory = who.territory;
        if (l.traits.length) {
          const s = simOf(heir);
          s.ambition = 80;
          s.reputation = 15;
        }
        recomputePower(heir);
        used.add(heir.id);
        echoes.push({
          legendId: l.id,
          kind: 'bloodline',
          headline: `SOMEONE CALLING THEMSELVES ${l.name.toUpperCase()} IS HERE AGAIN.`,
          detail: `${l.name} ${l.title} was a legend of run ${l.run}. This one intends to be one too.`,
          actorId: heir.id,
        });
        break;
      }
      case 'rumour': {
        god.conditions.push({
          id: 'c' + god.nextConditionId.toString(36),
          kind: 'omen',
          targetKind: 'world',
          targetId: 'world',
          magnitude: 0.6,
          createdCycle: 0,
          expiresCycle: 6,
          source: 'world',
          note: `they still tell the story of ${l.name}`,
        });
        god.nextConditionId++;
        echoes.push({
          legendId: l.id,
          kind: 'rumour',
          headline: `THEY STILL TELL THE STORY OF ${l.name.toUpperCase()}.`,
          detail: l.epitaph,
          actorId: null,
        });
        break;
      }
      case 'grudge': {
        who.playerRelationship = Math.max(who.playerRelationship, Math.min(120, Math.abs(l.standing)));
        const s = simOf(who);
        s.ambition = Math.min(100, s.ambition + 20);
        used.add(who.id);
        echoes.push({
          legendId: l.id,
          kind: 'grudge',
          headline: `${fullName(who)} INHERITED SOMEBODY ELSE'S OPINION OF YOU.`,
          detail: `${l.name} ${l.title} worked out what you were, in run ${l.run}. That did not die with them.`,
          actorId: who.id,
        });
        break;
      }
      case 'title': {
        if (!l.title) break;
        who.title = l.title;
        used.add(who.id);
        echoes.push({
          legendId: l.id,
          kind: 'title',
          headline: `${who.name.toUpperCase()} IS CALLING THEMSELVES ${l.title}.`,
          detail: `That was ${l.name}'s name in run ${l.run}. They have not earned it yet.`,
          actorId: who.id,
        });
        break;
      }
    }
  }
  return echoes;
}

/** Reconstruct a legacy echo from roster state when echoes were not persisted. */
export function inferLegacyEcho(n: Nemesis, legends: readonly LegendRecord[]): LegacyEcho | null {
  for (const l of legends.slice(-3)) {
    switch (l.legacy) {
      case 'relic': {
        const steel = n.stolen.some((s) => s.kind === 'weapon' && s.name.includes(l.name.toUpperCase()));
        if (!steel) break;
        return {
          legendId: l.id,
          kind: 'relic',
          headline: `${n.name.toUpperCase()} IS CARRYING SOMETHING THAT USED TO BE ${l.name.toUpperCase()}'S.`,
          detail: `${l.name} ${l.title} died in run ${l.run}. The steel did not.`,
          actorId: n.id,
        };
      }
      case 'bloodline':
        if (n.name === l.name && n.title === 'THE YOUNGER') {
          return {
            legendId: l.id,
            kind: 'bloodline',
            headline: `SOMEONE CALLING THEMSELVES ${l.name.toUpperCase()} IS HERE AGAIN.`,
            detail: `${l.name} ${l.title} was a legend of run ${l.run}. This one intends to be one too.`,
            actorId: n.id,
          };
        }
        break;
      case 'title':
        if (l.title && n.title === l.title && n.name !== l.name) {
          return {
            legendId: l.id,
            kind: 'title',
            headline: `${n.name.toUpperCase()} IS CALLING THEMSELVES ${l.title}.`,
            detail: `That was ${l.name}'s name in run ${l.run}. They have not earned it yet.`,
            actorId: n.id,
          };
        }
        break;
      case 'grudge': {
        const floor = Math.min(120, Math.abs(l.standing));
        if (n.playerRelationship < floor - 2) break;
        return {
          legendId: l.id,
          kind: 'grudge',
          headline: `${n.name.toUpperCase()} INHERITED SOMEBODY ELSE'S OPINION OF YOU.`,
          detail: `${l.name} ${l.title} worked out what you were, in run ${l.run}. That did not die with them.`,
          actorId: n.id,
        };
      }
    }
  }
  return null;
}

export function describeLegend(l: LegendRecord): string[] {
  const lines: string[] = [];
  lines.push(`${l.finalRank} · ${l.archetype.toUpperCase()} · ${l.personality} · ${l.faction}`);
  if (l.traits.length) lines.push(l.traits.join(', '));
  if (l.scars.length) lines.push(l.scars.join(', '));
  lines.push(`${l.kills} kills · final power ${l.finalPower}`);
  if (l.rivals.length) lines.push(`Rivals: ${l.rivals.join(', ')}`);
  lines.push(l.causeOfDeath);
  lines.push(
    l.standing > 40
      ? 'They hated you by the end.'
      : l.standing < -40
        ? 'They owed you, and they knew it.'
        : 'They never worked out what you were.'
  );
  lines.push(l.epitaph);
  return lines;
}

export function legendHome(l: LegendRecord): string {
  return AREA_NAMES[l.faction] ?? l.faction;
}
