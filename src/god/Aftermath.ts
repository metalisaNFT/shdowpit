/**
 * Load-bearing consequence chain after ADVANCE.
 * Honest uncertainty — never claims the player forced an outcome.
 */

import { fullName } from '../nemesis/Nemesis';
import { getPersonality } from '../data/personalities';
import { CONDITION_LABEL } from './Conditions';
import type { GodContext } from './Context';
import type { AftermathReport, Beat, CausalLink, ConditionKind, Decision, GodState } from './GodTypes';
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

function quietLine(god: GodState, ctx: GodContext): string {
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
}): AftermathReport {
  const { ctx, god, beats, decisions, intention, focusActorIds, spendTargetIds = [], finishedCycle } = args;
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
      text: quietLine(god, ctx),
    });
  }

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
  };
}

function scoreOpportunity(d: Decision): number {
  return d.chosen?.parts.opportunity ?? 0;
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
