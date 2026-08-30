/**
 * Project conditions and BeatWhy into subtle echoes — never "the god cursed you".
 */

import { actForCycle } from '../../god/Arc';
import type { Beat, BeatWhy, Condition, GodState } from '../../god/GodTypes';
import type { BeatWhySlice, EvidenceRef, GodEcho } from './RunStoryTypes';

const TEXTURE: Record<Condition['kind'], string[]> = {
  blessing: ['Luck that should not hold.', 'A door left open.', 'Favour without a face.'],
  curse: ['Weight in the bones.', 'Something follows their name.', 'The ground remembers.'],
  bounty: ['Every knife knows the price.', 'Hunters smell coin.', 'The mark is on them.'],
  rumour: ['Whispers outrun truth.', 'A story walks ahead of them.', 'Words sharpen before steel.'],
  mark: ['Named without consent.', 'Counted among the watched.', 'A sign only insiders read.'],
  ward: ['Harm slides off wrong.', 'Protected by something unseen.', 'Blows land elsewhere.'],
  opportunity: ['A gap where there was none.', 'Timing bends their way.', 'Chance leans in.'],
  exposure: ['Nowhere left to hide.', 'Eyes find what was buried.', 'The map has their face.'],
  omen: ['Birds go quiet.', 'The old signs align.', 'Someone dreamed this already.'],
  unrest: ['Crowds boil without a speaker.', 'Order frays at the edges.', 'Patience runs out.'],
};

function condRef(c: Condition): EvidenceRef {
  return { kind: 'condition', id: c.id, summary: `${c.kind}: ${c.note}` };
}

function beatRef(b: Beat): EvidenceRef {
  return { kind: 'beat', id: b.id, summary: b.headline };
}

function whyRef(b: Beat): EvidenceRef {
  const w = b.why!;
  return {
    kind: 'beat',
    id: `${b.id}:why`,
    summary: `${w.actorName} chose ${w.actionName} on ${w.targetName}`,
  };
}

function pickTexture(kind: Condition['kind'], cycle: number): string {
  const pool = TEXTURE[kind];
  return pool[cycle % pool.length] ?? pool[0];
}

function subtleRationed(why: BeatWhy): string | null {
  if (!why.rationed) return null;
  return `Almost ${why.rationed.actionName.toLowerCase()} — something else took the hour.`;
}

function subtleAlternative(why: BeatWhy): string | null {
  const alt = why.alternatives[0];
  if (!alt || alt.total >= why.total) return null;
  return `Nearly ${alt.actionName.toLowerCase()} instead — the numbers were close.`;
}

function subtleMarks(why: BeatWhy): string | null {
  if (!why.marks.length) return null;
  if (why.marks.some((m: string) => /bounty|price|mark/i.test(m))) return 'The price was already on the table.';
  if (why.marks.some((m: string) => /bless|ward|favour/i.test(m))) return 'Something had been leaning their way.';
  if (why.marks.some((m: string) => /curse|rumour|omen/i.test(m))) return 'The air had been wrong for days.';
  return null;
}

export function projectGodEchoes(god: GodState, beats: readonly Beat[]): GodEcho[] {
  const out: GodEcho[] = [];
  const seen = new Set<string>();

  for (const c of god.conditions) {
    if (c.source !== 'god') continue;
    const key = `cond:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const act = actForCycle(c.createdCycle).id;
    out.push({
      cycle: c.createdCycle,
      act,
      line: c.note || pickTexture(c.kind, c.createdCycle),
      texture: pickTexture(c.kind, c.createdCycle),
      conditionKind: c.kind,
      evidence: [condRef(c)],
    });
  }

  for (const b of beats) {
    if (!b.why) continue;
    const w = b.why;
    const hints = [subtleRationed(w), subtleAlternative(w), subtleMarks(w)].filter(Boolean) as string[];
    for (const line of hints) {
      const key = `why:${b.id}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        cycle: b.cycle,
        act: actForCycle(b.cycle).id,
        line,
        texture: line,
        evidence: [beatRef(b), whyRef(b)],
      });
    }
  }

  return out.sort((a, b) => a.cycle - b.cycle || a.line.localeCompare(b.line));
}

export function latestWhisperEcho(god: GodState, beats: readonly Beat[]): GodEcho | null {
  const echoes = projectGodEchoes(god, beats);
  if (!echoes.length) return null;
  const recent = echoes.filter((e) => e.cycle >= god.cycle - 2);
  return (recent.length ? recent : echoes).at(-1) ?? null;
}

export function sliceBeatWhy(beats: readonly Beat[]): BeatWhySlice[] {
  return beats
    .filter((b): b is Beat & { why: NonNullable<Beat['why']> } => !!b.why)
    .map((b) => ({
      beatId: b.id,
      cycle: b.cycle,
      act: actForCycle(b.cycle).id,
      why: b.why,
    }));
}
