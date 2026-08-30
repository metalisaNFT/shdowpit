/**
 * The OBSERVE board.
 *
 * A simulation this size produces far more state than anyone can read, and
 * dumping it is the fastest way to make an emergent game feel like a
 * spreadsheet. This file does the opposite job: it looks at the whole world
 * and returns only the handful of things that are *about to matter* — a grudge
 * that has been held long enough to act on, a house one bad cycle from coming
 * apart, someone climbing faster than they should be able to.
 *
 * Each one names the interventions that would plausibly bite. That is a hint
 * about the lever, never about the outcome.
 */

import { AREA_NAMES } from '../data/names';
import { AREAS } from '../data/areas';
import { getPersonality } from '../data/personalities';
import { fullName, rankIndex } from '../nemesis/Nemesis';
import type { GodContext } from './Context';
import { factionOf, livingFactions } from './Factions';
import { bestHope, crisisLabel } from './Crisis';
import { CONDITION_LABEL } from './Conditions';
import { simOf, type Situation } from './GodTypes';
import { aggregateStock, getBiome, biomeSentence } from '../world/BiomeState';
import { houseNeedAreas, activeQuests } from './NpcQuests';
import { TOWER_SITUATION_ID } from './Opening';

const MAX_SITUATIONS = 9;
const EARLY_MAX = 4;

export function buildSituations(ctx: GodContext): Situation[] {
  const out: Situation[] = [];
  const living = ctx.living();
  const seenPairs = new Set<string>();

  /* ---- campaign: Tower Commander ---- */
  if (ctx.god.scenarioFlags?.towerCommander) {
    const commander = living.find((n) => n.archetype === 'commander' && n.territory === 'tower' && n.alive);
    if (commander) {
      const spear = commander.stolen.some((s) => s.weaponId === 'spear');
      const loyal = living.find((n) => n.master === commander.id && n.alive);
      out.push({
        id: TOWER_SITUATION_ID,
        kind: 'territory',
        headline: `${fullName(commander)} COMMANDS THE TOWER`,
        detail: spear
          ? `${fullName(commander)} holds the Tower and stolen steel.${loyal ? ` ${fullName(loyal)} stands with them.` : ''} Bless, curse, or price their head — then descend into the configuration you made.`
          : `${fullName(commander)} holds the Tower.${loyal ? ` ${fullName(loyal)} stands with them.` : ''} Change their conditions, then enter the Tower yourself if you want a physical answer.`,
        actors: loyal ? [commander.id, loyal.id] : [commander.id],
        urgency: 0.92,
        suggest: ['bless', 'bounty', 'curse', 'descend'],
      });
    }
  }

  /* ---- the crisis owns the top of the board ---- */
  const crisis = ctx.god.crisis;
  if (crisis && crisis.resolved === 'none') {
    const body = ctx.mgr.byId(crisis.bodyId);
    const hope = bestHope(ctx);
    out.push({
      id: 'crisis',
      kind: 'crisis',
      headline: `${crisis.title} — ${crisisLabel(ctx, crisis)}`,
      detail:
        crisis.description +
        (hope ? ` The closest thing to an answer is ${fullName(hope)}.` : ' Nobody left could try.'),
      actors: body ? [body.id] : [],
      urgency: 1,
      suggest: hope ? ['bless', 'gift', 'mend', 'crown'] : ['raise', 'calamity'],
    });
  }

  for (const n of living) {
    const s = simOf(n);
    const p = getPersonality(n.personality);

    /* ---- someone is climbing ---- */
    if (s.ambition > 70 && s.confidence > 60 && rankIndex(n.rank) < 4) {
      out.push({
        id: 'asc:' + n.id,
        kind: 'ascendant',
        headline: `${fullName(n)} IS CLIMBING`,
        detail: `${s.wins} wins, ambition ${Math.round(s.ambition)}, confidence ${Math.round(s.confidence)}. They are looking upward and they are not wrong to.`,
        actors: [n.id],
        urgency: 0.5 + s.ambition / 260 + rankIndex(n.rank) * 0.04,
        suggest: ['bless', 'gift', 'crown', 'bounty'],
      });
    }

    /* ---- someone is bleeding ---- */
    if (s.injury > 52) {
      out.push({
        id: 'wnd:' + n.id,
        kind: 'wounded',
        headline: `${fullName(n)} IS BADLY HURT`,
        detail: `Wounds at ${Math.round(s.injury)}. They will read every fight as more dangerous than it is, and anyone who wants them knows.`,
        actors: [n.id],
        urgency: 0.35 + s.injury / 220,
        suggest: ['mend', 'bounty', 'reveal'],
      });
    }

    /* ---- a grudge that has had time to set ---- */
    const grudgeTargets = new Set(s.revengeTargets);
    if (s.goal === 'revenge' && s.goalTargetId) grudgeTargets.add(s.goalTargetId);
    for (const id of grudgeTargets) {
      const t = ctx.mgr.byId(id);
      if (!t || !t.alive) continue;
      const key = [n.id, t.id].sort().join('>');
      if (seenPairs.has('rev' + key)) continue;
      seenPairs.add('rev' + key);
      const held = s.goalTargetId === id ? s.goalAge : 0;
      const kind = held >= 6 ? 'grudge' : 'revenge';
      out.push({
        id: 'rev:' + n.id + ':' + id,
        kind,
        headline: `${fullName(n)} WANTS ${fullName(t)}`,
        detail:
          (s.escapedFrom.includes(id)
            ? `${fullName(n)} ran from them once. `
            : (n.humiliations ?? 0) > 0
              ? `${fullName(n)} has been made small in front of people. `
              : '') +
          `Held for ${held} cycles. ${t.power > n.power ? `${fullName(t)} is the stronger, which has not stopped anyone yet.` : `${fullName(n)} could probably do it.`}`,
        actors: [n.id, t.id],
        urgency: 0.45 + Math.min(0.35, held * 0.05) + (t.power > n.power ? 0.08 : 0),
        suggest: ['bless', 'reveal', 'gift', 'provoke'],
      });
    }

    /* ---- someone is one whisper from turning ---- */
    if (n.master && s.loyalty < 45 && p.betray > 0.8) {
      const m = ctx.mgr.byId(n.master);
      if (m && m.alive) {
        out.push({
          id: 'bet:' + n.id,
          kind: 'betrayal_risk',
          headline: `${fullName(n)} IS NOT LOYAL TO ${fullName(m)}`,
          detail: `Loyalty ${Math.round(s.loyalty)}. ${getPersonality(n.personality).name}. They are already most of the way to the decision.`,
          actors: [n.id, m.id],
          urgency: 0.5 + (60 - s.loyalty) / 200,
          suggest: ['whisper', 'provoke', 'gift'],
        });
      }
    }

    /* ---- someone has stopped believing in you ---- */
    if (s.heretic) {
      out.push({
        id: 'her:' + n.id,
        kind: 'heresy',
        headline: `${fullName(n)} KNOWS SOMETHING IS ARRANGING THIS`,
        detail: 'They will spend their cycles tearing up whatever you put down. Chaos is what let them see it.',
        actors: [n.id],
        urgency: 0.8,
        suggest: ['bounty', 'curse', 'reveal'],
      });
    }

    /* ---- the underdog ---- */
    if (rankIndex(n.rank) <= 1 && s.confidence > 65 && s.wins > s.losses) {
      out.push({
        id: 'und:' + n.id,
        kind: 'underdog',
        headline: `${fullName(n)} IS PUNCHING ABOVE THEMSELVES`,
        detail: `${s.wins} wins to ${s.losses} losses, from the bottom of the order. Nobody important has noticed yet.`,
        actors: [n.id],
        urgency: 0.34 + s.confidence / 400,
        suggest: ['gift', 'bless', 'crown'],
      });
    }
  }

  /* ---- rivalries between people who both matter ---- */
  for (const a of living) {
    for (const bid of a.rivalries) {
      const b = ctx.mgr.byId(bid);
      if (!b || !b.alive) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      if (rankIndex(a.rank) < 2 && rankIndex(b.rank) < 2) continue;
      out.push({
        id: 'riv:' + key,
        kind: 'rivalry',
        headline: `${fullName(a)} AND ${fullName(b)} ARE NOT DONE`,
        detail: `${a.rank.toUpperCase()} against ${b.rank.toUpperCase()}. Power ${a.power} to ${b.power}.`,
        actors: [a.id, b.id],
        urgency: 0.3 + Math.min(0.3, (a.power + b.power) / 1400),
        suggest: ['provoke', 'whisper', 'bounty'],
      });
    }
  }

  /* ---- houses ---- */
  for (const f of livingFactions(ctx.god)) {
    if (f.warWith.length) {
      const other = factionOf(ctx.god, f.warWith[0]);
      if (other && f.id < other.id) {
        out.push({
          id: 'war:' + f.id + other.id,
          kind: 'faction_war',
          headline: `${f.name} IS AT WAR WITH ${other.name}`,
          detail: `Strength ${Math.round(f.strength)} against ${Math.round(other.strength)}. Stability ${Math.round(f.stability)} and ${Math.round(other.stability)}.`,
          actors: [f.leaderId ?? '', other.leaderId ?? ''].filter(Boolean),
          urgency: 0.62,
          suggest: ['whisper', 'bounty', 'bless'],
        });
      }
    }
    if (f.stability < 35) {
      out.push({
        id: 'frac:' + f.id,
        kind: 'power_vacuum',
        headline: `${f.name} IS COMING APART`,
        detail: `Stability ${Math.round(f.stability)}. One more bad cycle and it stops existing, and everyone sworn to it becomes someone else's problem.`,
        actors: [f.leaderId ?? ''].filter(Boolean),
        urgency: 0.58 + (35 - f.stability) / 120,
        suggest: ['whisper', 'mend', 'bless'],
      });
    }
  }

  /* ---- ground ---- */
  for (const area of AREAS) {
    const holder = ctx.mgr.territoryHolder(area.id);
    const unrest = ctx.cond.weight(area.id, 'unrest');
    if (!holder) {
      out.push({
        id: 'ter:' + area.id,
        kind: 'power_vacuum',
        headline: `${AREA_NAMES[area.id] ?? area.name} HAS NO HOLDER`,
        detail: 'Open ground. The first person with the nerve to walk onto it owns it.',
        actors: [],
        urgency: 0.4,
        suggest: ['reveal', 'crown', 'bless'],
      });
    } else if (unrest > 0.4) {
      out.push({
        id: 'unr:' + area.id,
        kind: 'territory',
        headline: `${AREA_NAMES[area.id] ?? area.name} IS SLIPPING FROM ${fullName(holder)}`,
        detail: 'Whoever holds it is not holding it well. Somebody is going to test that.',
        actors: [holder.id],
        urgency: 0.42 + unrest * 0.2,
        suggest: ['bounty', 'provoke', 'bless'],
      });
    }
  }

  /* ---- biome pressure on the board ---- */
  for (const area of AREAS) {
    if (area.id === 'pit') continue;
    const biome = getBiome(ctx.mgr.data, area.id);
    const label = AREA_NAMES[area.id] ?? area.name;
    if (biome.faunaPressure > 0.72) {
      out.push({
        id: 'bio:feral:' + area.id,
        kind: 'feral_surge',
        headline: `${label} — FERAL SURGE`,
        detail: biomeSentence(area.id, biome) + '. Hunters will be sent.',
        actors: [],
        urgency: 0.45 + biome.faunaPressure * 0.35,
        suggest: ['bounty', 'bless'],
      });
    }
    if (aggregateStock(biome) < 8) {
      out.push({
        id: 'bio:scarce:' + area.id,
        kind: 'resource_scarce',
        headline: `${label} — RESOURCES SCARCE`,
        detail: 'Houses will send gatherers or start feuds over what is left.',
        actors: [],
        urgency: 0.4 + (1 - aggregateStock(biome) / 8) * 0.3,
        suggest: ['gift', 'opportunity'],
      });
    }
    if (aggregateStock(biome) > 28) {
      out.push({
        id: 'bio:growth:' + area.id,
        kind: 'abundant_growth',
        headline: `${label} — ABUNDANT GROWTH`,
        detail: 'Stock is high; collectors and hoarders will notice.',
        actors: [],
        urgency: 0.35,
        suggest: ['bless'],
      });
    }
    for (const site of biome.activeSites) {
      if (site.status === 'open' || site.status === 'repopulating') {
        out.push({
          id: 'bio:dungeon:' + area.id + ':' + site.siteId,
          kind: 'dungeon_ready',
          headline: `${label} — DUNGEON READY`,
          detail: `Something under ${label} is ${site.status === 'repopulating' ? 'stirring again' : 'open'}.`,
          actors: [],
          urgency: 0.42,
          suggest: ['bounty', 'curse'],
        });
        break;
      }
    }
  }

  for (const areaId of houseNeedAreas(ctx)) {
    out.push({
      id: 'house:need:' + areaId,
      kind: 'house_need',
      headline: `${AREA_NAMES[areaId] ?? areaId} — HOUSE NEED`,
      detail: 'A house treasury is low; errands will be issued.',
      actors: [],
      urgency: 0.5,
      suggest: ['gift', 'bless'],
    });
  }

  for (const q of activeQuests(ctx.mgr.data)) {
    if (q.deadlineTurn != null && q.deadlineTurn - ctx.mgr.turn <= 2) {
      const assignee = ctx.mgr.byId(q.assigneeId);
      out.push({
        id: 'quest:' + q.id,
        kind: 'quest_urgent',
        headline: assignee ? `${fullName(assignee)} IS OUT OF TIME` : 'QUEST URGENT',
        detail: `Errand in ${AREA_NAMES[q.targetAreaId] ?? q.targetAreaId} expires soon.`,
        actors: assignee ? [assignee.id] : [],
        urgency: 0.62,
        suggest: ['bless', 'bounty'],
      });
    }
  }

  /* ---- your conditions still on the board ---- */
  for (const c of ctx.god.conditions) {
    if (c.source !== 'god') continue;
    const left = c.expiresCycle - ctx.god.cycle;
    if (left <= 0) continue;
    const n = ctx.mgr.byId(c.targetId);
    const label = CONDITION_LABEL[c.kind] ?? c.kind.toUpperCase();
    const who = n ? fullName(n) : c.targetId.toUpperCase();
    out.push({
      id: 'cond:' + c.id,
      kind: 'condition',
      headline: `${who.toUpperCase()} — ${label}`,
      detail: `${c.note} · ${left} cycle${left === 1 ? '' : 's'} left. The world is already reading this.`,
      actors: n ? [n.id] : [],
      urgency: 0.55 + Math.min(0.25, c.magnitude * 0.12),
      suggest: suggestForCondition(c.kind),
    });
  }

  out.sort((a, b) => b.urgency - a.urgency);
  const capped = dedupeActors(out).slice(0, MAX_SITUATIONS);
  // Early progressive disclosure soft-caps count; focus ordering is UI-only
  // (GodScreen / GodNowCard) so harnesses see a strict urgency sort.
  if (!ctx.god.boardUnlocked && !ctx.god.openingDone) {
    return capped.slice(0, EARLY_MAX);
  }
  return capped;
}

function suggestForCondition(kind: string): string[] {
  switch (kind) {
    case 'bounty':
      return ['reveal', 'gift', 'bless'];
    case 'blessing':
    case 'ward':
    case 'opportunity':
      return ['gift', 'reveal', 'crown'];
    case 'rumour':
    case 'exposure':
      return ['whisper', 'provoke', 'bounty'];
    case 'curse':
    case 'mark':
      return ['bounty', 'provoke', 'mend'];
    default:
      return ['bless', 'bounty', 'reveal'];
  }
}

/**
 * Two situations about the same person are usually the same story told twice.
 * Keep the more urgent one unless the second brings a different lens.
 */
function dedupeActors(list: Situation[]): Situation[] {
  const count = new Map<string, number>();
  const out: Situation[] = [];
  for (const s of list) {
    const primary = s.actors[0] ?? s.id;
    const c = count.get(primary) ?? 0;
    if (c >= 2) continue;
    count.set(primary, c + 1);
    out.push(s);
  }
  return out;
}
