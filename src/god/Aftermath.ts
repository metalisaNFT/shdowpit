/**
 * Load-bearing consequence chain after ADVANCE.
 * Honest uncertainty — never claims the player forced an outcome.
 */

import { fullName } from '../nemesis/Nemesis';
import { getPersonality } from '../data/personalities';
import { CONDITION_LABEL } from './Conditions';
import type { GodContext } from './Context';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { AftermathReport, Beat, CausalLink, ConditionKind, Decision, GodState } from './GodTypes';

export type AftermathVoiceFn = (cycle: number, label: string, text: string) => string;
import { simOf } from './GodTypes';

const CONDITION_VOICE: Partial<Record<ConditionKind, string>> = {
  bounty: 'A price sharpened on their head',
  ward: 'Your protection still held',
  rumour: 'A rumour took root',
  mark: 'They were marked for what comes next',
  blessing: 'Your blessing still sat on them',
  curse: 'Your curse still gnawed',
  opportunity: 'An opening you wrote was noticed',
  exposure: 'They could not hide anymore',
  omen: 'The omen you left still hung in the air',
  unrest: 'Unrest you seeded kept spreading',
};

const QUIET_LOW = [
  'Quiet cycle. Fear moved before anyone swung.',
  'Nothing loud. Grudges still sharpened in the dark.',
  'The board barely shifted — but it shifted.',
];

const QUIET_MID = [
  'Quiet cycle. Ambition and fear still drifted.',
  'No headline fight. Everyone still repositioned.',
  'A slow turn. The hungry did not sleep.',
];

const QUIET_HIGH = [
  'Chaos thrummed even in the silence.',
  'Quiet on the surface. Too many knives still drawn.',
  'Nothing settled. The world felt ready to break.',
];

/** Who weighed a god mark and passed — from opportunity scores in decisions. */
export function describeQuietDecline(
  mgr: NemesisManager,
  god: GodState,
  decisions: Decision[],
  focusActorIds: string[]
): string | null {
  const focus = new Set(focusActorIds.filter(Boolean));
  const markedIds = new Set(
    god.conditions.filter((c) => c.source === 'god' && (focus.size === 0 || focus.has(c.targetId))).map((c) => c.targetId)
  );
  if (!markedIds.size) return null;

  let best: {
    actorName: string;
    actionName: string;
    targetName: string;
    opp: number;
    choseInstead: string;
  } | null = null;

  for (const d of decisions) {
    for (const opt of d.considered) {
      if (!opt.targetId || !markedIds.has(opt.targetId)) continue;
      const opp = opt.parts.opportunity ?? 0;
      if (opp < 0.35) continue;
      const tookIt =
        d.chosen?.targetId === opt.targetId &&
        d.chosen.actionId === opt.actionId &&
        (d.chosen.parts.opportunity ?? 0) >= opp * 0.85;
      if (tookIt) continue;
      const choseInstead = d.chosen
        ? `${d.chosen.actionName}${d.chosen.targetName ? ` on ${d.chosen.targetName}` : ''}`
        : 'something else';
      if (!best || opp > best.opp) {
        best = {
          actorName: d.actorName,
          actionName: opt.actionName,
          targetName: opt.targetName,
          opp,
          choseInstead,
        };
      }
    }
  }

  if (best) {
    const actorId = decisions.find((d) => d.actorName === best!.actorName)?.actorId ?? '';
    const who = mgr.byId(actorId);
    const name = who ? fullName(who) : best.actorName;
    return `${name} noticed your mark on ${best.targetName} — ${best.actionName} looked worth doing — but chose ${best.choseInstead} instead.`;
  }

  const watchers = decisions.filter((d) =>
    d.considered.some((c) => c.targetId && markedIds.has(c.targetId) && (c.parts.opportunity ?? 0) > 0)
  );
  if (watchers.length) {
    const d = watchers[0];
    const markName = d.considered.find((c) => c.targetId && markedIds.has(c.targetId))?.targetName ?? 'your mark';
    return `${d.actorName} weighed ${markName} and decided it was not worth acting on this cycle.`;
  }

  return null;
}

function quietLine(
  god: GodState,
  ctx: GodContext,
  decisions: Decision[],
  focusActorIds: string[]
): string {
  const decline = describeQuietDecline(ctx.mgr, god, decisions, focusActorIds);
  if (decline) return decline;
  const pool = god.chaos >= 55 ? QUIET_HIGH : god.chaos >= 28 ? QUIET_MID : QUIET_LOW;
  const dom =
    ctx.mgr.roster
      .filter((n) => n.alive)
      .sort((a, b) => simOf(b).ambition - simOf(a).ambition)[0]?.personality ?? 'survivor';
  const idx = (god.cycle + getPersonality(dom).ambition * 10) % pool.length;
  return pool[idx]!;
}

function conditionLinkText(
  ctx: GodContext,
  c: { kind: ConditionKind; targetId: string; note: string }
): string {
  const who = ctx.mgr.byId(c.targetId);
  const name = who ? fullName(who) : c.targetId;
  const voice = CONDITION_VOICE[c.kind] ?? CONDITION_LABEL[c.kind] ?? c.kind.toUpperCase();
  return `${voice} — ${name}. ${c.note}`;
}

function rippleFromBeat(ctx: GodContext, beat: Beat): string | null {
  if (beat.priority !== 'legendary' && beat.priority !== 'major') return null;
  const actor = beat.actors.map((id) => ctx.mgr.byId(id)).find(Boolean);
  if (!actor) return null;
  const s = simOf(actor);
  if (/PROMOT|ROSE|CAPTAIN|WARLORD|OVERLORD/.test(beat.headline)) {
    return `${fullName(actor)} climbed — the ladder moved under everyone's feet.`;
  }
  if (/KILL|DIED|DEAD|EXECUTE/.test(beat.headline)) {
    return `Someone important fell. Allies and rivals are recalculating.`;
  }
  if (/TOOK|TERRITORY|SEIZED|GROUND/.test(beat.headline)) {
    return `Ground changed hands. Houses felt the shift.`;
  }
  if (s.revengeTargets.length) {
    return `${fullName(actor)} added another name to settle.`;
  }
  return `${fullName(actor)} did something the board will answer.`;
}

/** Someone the player propped up lost anyway — measured in Context.blessedLosers. */
export function describeBlessedFailure(
  mgr: NemesisManager,
  loserIds: readonly string[],
  beats: readonly Beat[]
): string {
  const loser = mgr.byId(loserIds[0] ?? '');
  if (!loser) {
    return 'Someone you backed lost anyway. You bought odds — not a command. The board answered anyway.';
  }
  const name = fullName(loser);
  const duel = beats.find((b) => b.kind === 'duel' && b.actors.includes(loser.id));
  if (duel) {
    const winnerId = duel.actors.find((id) => id !== loser.id);
    const winner = winnerId ? mgr.byId(winnerId) : null;
    if (winner) {
      return `${name} lost to ${fullName(winner)} anyway. Your blessing was a thumb on the scale — not a hand.`;
    }
  }
  return `${name} lost anyway. You bought better odds against someone who had their own reasons to be dangerous.`;
}

export function buildAftermath(args: {
  ctx: GodContext;
  god: GodState;
  beats: Beat[];
  decisions: Decision[];
  intention: string;
  focusActorIds: string[];
  /** targets from spends waiting to resolve this advance */
  spendTargetIds?: string[];
  /** Cycle that just finished simulating (before god.cycle increments). */
  finishedCycle?: number;
  /** characters the player blessed or warded who lost a fight this cycle */
  blessedLosers?: readonly string[];
}): AftermathReport {
  const { ctx, god, beats, decisions, intention, focusActorIds, spendTargetIds = [], finishedCycle, blessedLosers = [] } = args;
  const links: CausalLink[] = [];
  const focus = new Set(focusActorIds.filter(Boolean));
  const spendFocus = new Set(spendTargetIds.filter(Boolean));

  const marks = god.conditions
    .filter((c) => {
      if (c.source !== 'god') return false;
      if (spendFocus.size) return spendFocus.has(c.targetId) || (c.otherId ? spendFocus.has(c.otherId) : false);
      return focus.size === 0 || focus.has(c.targetId);
    })
    .sort((a, b) => b.createdCycle - a.createdCycle || b.id.localeCompare(a.id));
  if (blessedLosers.length) {
    links.push({
      label: 'IT DID NOT WORK',
      text: describeBlessedFailure(ctx.mgr, blessedLosers, beats),
    });
  }

  if (marks.length) {
    const c = marks[0];
    links.push({
      label: 'CONDITION',
      text: conditionLinkText(ctx, c),
    });
  } else if (/wait|nothing|did not interfere/i.test(intention)) {
    links.push({
      label: 'CONDITION',
      text: 'No new mark. The world moved on what was already true.',
    });
  }

  const relatedDecisions = decisions.filter(
    (d) =>
      focus.has(d.actorId) ||
      (d.chosen?.targetId && focus.has(d.chosen.targetId)) ||
      marks.some((c) => c.targetId === d.actorId || c.otherId === d.actorId)
  );
  const noticed =
    relatedDecisions.find((d) => d.chosen && scoreOpportunity(d) > 0) ??
    relatedDecisions.find((d) => d.chosen) ??
    decisions.find((d) => d.chosen && focus.has(d.actorId));

  if (noticed?.chosen) {
    links.push({
      label: 'WHO NOTICED',
      text: `${noticed.actorName} weighed ${noticed.chosen.actionName}${
        noticed.chosen.targetName ? ` → ${noticed.chosen.targetName}` : ''
      }`,
    });
    links.push({
      label: 'THEY CHOSE',
      text: `${noticed.actorName} acted: ${noticed.chosen.actionName}${
        noticed.chosen.targetName ? ` on ${noticed.chosen.targetName}` : ''
      }. That was their call — not yours.`,
    });
  } else {
    links.push({
      label: 'WHO NOTICED',
      text: 'Nobody important moved on your mark this cycle. Marks still decay.',
    });
  }

  const storyBeats = beats.filter(
    (b) =>
      b.kind !== 'intervention' &&
      b.kind !== 'influence' &&
      (focus.size === 0 || b.actors.some((id) => focus.has(id)) || relatedDecisions.some((d) => b.actors.includes(d.actorId)))
  );
  const happened =
    storyBeats.find((b) => b.priority === 'legendary' || b.priority === 'major') ??
    storyBeats.find((b) => b.priority === 'notable') ??
    storyBeats[0];
  if (happened) {
    links.push({ label: 'WHAT HAPPENED', text: happened.headline });
    const ripple = rippleFromBeat(ctx, happened);
    if (ripple) links.push({ label: 'RIPPLE', text: ripple });
  } else {
    links.push({
      label: 'WHAT HAPPENED',
      text: quietLine(god, ctx, decisions, focusActorIds),
    });
  }

  const explainBeat =
    storyBeats.find((b) => b.why) ??
    beats.find(
      (b) =>
        b.why &&
        (focus.size === 0 || b.actors.some((id) => focus.has(id)) || relatedDecisions.some((d) => b.actors.includes(d.actorId)))
    ) ??
    (noticed ? beatFromDecision(ctx, noticed, finishedCycle ?? god.cycle) : null) ??
    // Nothing touched the player's focus this cycle. Somebody still decided
    // something, and WHY has to have a door to open.
    beats.find((b) => b.why) ??
    (decisions.find((d) => d.chosen) ? beatFromDecision(ctx, decisions.find((d) => d.chosen)!, finishedCycle ?? god.cycle) : null) ??
    null;

  const next = god.situations[0];
  const nextProblem = next
    ? `${next.headline} — ${next.detail.slice(0, 120)}${next.detail.length > 120 ? '…' : ''}`
    : 'The board is quiet. That will not last.';

  links.push({ label: 'NOW', text: nextProblem });

  return {
    cycle: finishedCycle ?? god.cycle,
    intention,
    links,
    nextProblem,
    uncertainty:
      'You write conditions. They choose. Outcomes are never guaranteed — only made more or less likely.',
    explainBeat,
  };
}

function scoreOpportunity(d: Decision): number {
  return d.chosen?.parts.opportunity ?? 0;
}

function beatFromDecision(ctx: GodContext, d: Decision, cycle: number): Beat | null {
  if (!d.chosen) return null;
  const n = ctx.mgr.byId(d.actorId);
  if (!n) return null;
  const c = d.chosen;
  const alts = d.considered
    .filter((x) => x.total < c.total)
    .sort((a, b) => b.total - a.total)
    .slice(0, 2)
    .map((x) => ({ actionName: x.actionName, targetName: x.targetName, total: x.total }));
  return {
    id: `decision:${d.actorId}:${cycle}`,
    cycle,
    priority: 'notable',
    headline: `${d.actorName} — ${c.actionName}${c.targetName ? ` on ${c.targetName}` : ''}`,
    detail: [],
    actors: [d.actorId, c.targetId].filter((id): id is string => !!id),
    tone: 'neutral',
    kind: 'sim',
    why: {
      actorId: d.actorId,
      actorName: d.actorName,
      personality: n.personality,
      actionName: c.actionName,
      targetName: c.targetName,
      targetKind: c.targetKind,
      total: c.total,
      parts: c.parts,
      marks: c.marks ?? [],
      alternatives: alts,
      rationed: d.rationed,
    },
  };
}

export interface CycleSpend {
  name: string;
  targetNames: string[];
  targetIds: string[];
}

/** One-line intent for the aftermath header. Spends win over a quiet-advance flag. */
export function intentionFromLastMove(spends: CycleSpend[], advancedWithoutInterfere: boolean): string {
  if (spends.length) {
    const parts = spends.map((s) => {
      const who = s.targetNames.filter(Boolean).join(' / ');
      return who ? `${s.name} on ${who}` : s.name;
    });
    return parts.length === 1
      ? `You spent Influence: ${parts[0]}.`
      : `You spent Influence: ${parts.join('; ')}.`;
  }
  if (advancedWithoutInterfere) return 'You did nothing and advanced. Autonomy ran.';
  return 'You advanced the world.';
}

export function describeActorState(ctx: GodContext, id: string): string {
  const n = ctx.mgr.byId(id);
  if (!n) return '—';
  const s = simOf(n);
  return `${fullName(n)} · ${n.alive ? 'alive' : 'dead'} · ambition ${Math.round(s.ambition)} · injury ${Math.round(s.injury)}`;
}

/** Cause/effect line for duel replay when aftermath is shown after the fight. */
export function spectacleCauseCaption(report: AftermathReport, voice?: AftermathVoiceFn): string {
  const link =
    report.links.find((l) => l.label === 'CONDITION') ??
    report.links.find((l) => l.label === 'WHAT HAPPENED') ??
    report.links[0];
  if (!link) return `${report.intention} Watch what follows.`;
  const text = voice?.(report.cycle, link.label, link.text) ?? link.text;
  const lower = text.replace(/^[A-Z]/, (c) => c.toLowerCase());
  if (/^you spent influence/i.test(report.intention)) {
    return `Because ${lower} — watch what the board did next.`;
  }
  return `Because ${lower} — this is what followed.`;
}
