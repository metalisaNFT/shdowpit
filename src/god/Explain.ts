/**
 * Turning the maths back into English.
 *
 * This is the part of the tutorial that never stops running. A scripted intro
 * can teach the buttons; it cannot teach a simulation, because the interesting
 * question is never "what does BLESS do" but "why did he go for HIM and not
 * the other one". Every beat carries the reasoning that produced it, and this
 * file renders that reasoning as sentences a person can read.
 *
 * Two rules, and they matter:
 *
 *   1. It never invents. Every line here is generated from a number the
 *      simulation actually used. If the memory term was small, the explanation
 *      does not mention memory.
 *   2. It never promises. The closing note always says the same true thing —
 *      that these are the weights, not a rule, and the same board can produce
 *      a different answer tomorrow.
 */

import type { BeatWhy, ScoreParts } from './GodTypes';

export interface Explanation {
  /** who did what, in one line */
  headline: string;
  /** the reasons that actually moved the number, largest first */
  reasons: string[];
  /** what the player themselves had left lying there, called out separately */
  yours: string[];
  /** what they nearly did instead */
  alternatives: string[];
  /** the honest caveat */
  note: string;
}

/** A component, its signed contribution, and how to say it out loud. */
interface Term {
  weight: number;
  text: string;
}

/**
 * The god's marks are named explicitly, because "you did this" is the single
 * most useful sentence a tutorial can produce. They sit on the TARGET, which
 * is why a blessing reads as a deterrent and a curse reads as an invitation.
 */
const MARK_TEXT: Record<string, string> = {
  bounty: 'You had put a price on their head.',
  mark: 'You had marked them out.',
  exposure: 'You had shown the world exactly where they were.',
  rumour: 'You had put a story about them in the wrong ear.',
  opportunity: 'You had left a door open around them.',
  blessing: 'Your blessing was on them — and it did not put them off.',
  ward: 'Something of yours was standing over them.',
  curse: 'Your curse was on them, and they looked like a cheap problem.',
  omen: 'Your omen was hanging over the whole region.',
  unrest: 'You had left the ground under them unsettled.',
};

export function explainBeat(why: BeatWhy): Explanation {
  const p = why.parts;
  const target = why.targetName ? why.targetName : '';
  const place = why.targetKind === 'place';
  const terms: Term[] = [];

  /* ---- who they are ---- */
  if (p.personality > 1.5 && why.personality) {
    terms.push({
      weight: p.personality,
      text: `Being ${article(why.personality)} ${why.personality} is most of it. That is what this kind of person does.`,
    });
  } else if (p.personality > 0.4 && why.personality) {
    terms.push({ weight: p.personality, text: `Their nature — ${why.personality} — leant that way a little.` });
  }

  /* ---- what they are to each other ---- */
  if (p.relationship > 1.5) {
    terms.push({
      weight: p.relationship,
      text: place
        ? `Whoever was holding ${target} was no friend of theirs.`
        : `There was already bad blood between them${target ? ` and ${target}` : ''}.`,
    });
  } else if (p.relationship < -1.5) {
    terms.push({
      weight: -p.relationship,
      text: place
        ? `${target} was held by their own side, which made this harder to choose, not easier.`
        : `They were on the same side${target ? ` as ${target}` : ''}, which made this harder to choose, not easier.`,
    });
  }

  /* ---- what they remember ---- */
  if (p.memory > 3) {
    terms.push({
      weight: p.memory,
      text: place
        ? `They have lost ground before and have not forgotten it. That is doing a lot of the work.`
        : `They have not forgotten what happened${target ? ` between them and ${target}` : ''}. That is doing a lot of the work.`,
    });
  } else if (p.memory > 0.8) {
    terms.push({ weight: p.memory, text: 'Something in their memory pointed this way.' });
  }

  /* ---- what they lack ---- */
  if (p.need > 2) {
    terms.push({ weight: p.need, text: 'They are hurt or frightened enough that this was what they had left.' });
  } else if (p.need < -2) {
    terms.push({ weight: -p.need, text: 'They are in poor shape, which argued against it — and they did it anyway.' });
  }

  /* ---- what it might cost ---- */
  if (p.danger > 4) {
    terms.push({ weight: p.danger, text: 'The risk was substantial. They very nearly did not.' });
  } else if (p.danger < -1) {
    terms.push({
      weight: -p.danger,
      text: place ? `${target} looked cheap to take.` : `${target || 'The target'} looked like a cheap problem to solve.`,
    });
  }

  /* ---- what the world had left lying around ---- */
  const yours = why.marks.map((m) => MARK_TEXT[m]).filter(Boolean);
  if (p.opportunity > 1) {
    if (!yours.length) {
      terms.push({ weight: p.opportunity, text: 'The world had left them an opening.' });
    }
  } else if (p.opportunity < -1) {
    terms.push({ weight: -p.opportunity, text: 'Something was dragging on them while they decided.' });
  }

  /* ---- how hard they are pushing ---- */
  if (p.ambition > 2.5) {
    terms.push({ weight: p.ambition, text: 'They are climbing, and they are in a hurry about it.' });
  } else if (p.ambition > 0.8) {
    terms.push({ weight: p.ambition, text: 'Ambition counted for something.' });
  }

  terms.sort((a, b) => b.weight - a.weight);
  const reasons = terms.slice(0, 4).map((t) => t.text);

  /* ---- the day they were having ---- */
  const biggest = terms.length ? terms[0].weight : 0;
  if (Math.abs(p.noise) > Math.max(3, biggest * 0.7)) {
    reasons.push(
      p.noise > 0
        ? 'And a good part of it was simply the mood they were in. A louder world makes more of these.'
        : 'They nearly talked themselves out of it. A louder world makes more of these, too.'
    );
  }

  if (!reasons.length) {
    reasons.push('Nothing weighed very heavily. It was the least bad thing available to them.');
  }

  // The cycle rations how much violence it will carry, so the highest-scoring
  // option is not always the one taken. Saying so is better than showing a
  // bigger number under "they nearly did this instead" and leaving the player
  // to conclude the maths is broken.
  if (why.rationed) {
    reasons.unshift(
      `What they actually wanted was ${why.rationed.actionName}${why.rationed.targetName ? ' on ' + why.rationed.targetName : ''} (${why.rationed.total}). ` +
        'Too much had already happened this cycle for another fight, so they did the next thing on their list. It will still be there next cycle.'
    );
  }

  const alternatives = why.alternatives.map(
    (a) => `${a.actionName}${a.targetName ? ' → ' + a.targetName : ''}  (${a.total})`
  );

  return {
    headline: `${why.actorName} chose ${why.actionName}${target ? ` on ${target}` : ''} — it scored ${why.total}.`,
    reasons,
    yours,
    alternatives,
    note: 'These are weights, not a rule. The same board tomorrow can produce a different answer.',
  };
}

function article(word: string): string {
  return /^[AEIOU]/i.test(word) ? 'an' : 'a';
}

/** The raw numbers, for the developer panel and anyone who wants them. */
export function partsLine(p: ScoreParts): string {
  return (
    `base ${n(p.base)} · nature ${n(p.personality)} · ties ${n(p.relationship)} · memory ${n(p.memory)} · ` +
    `need ${n(p.need)} · risk -${n(p.danger)} · opening ${n(p.opportunity)} · ambition ${n(p.ambition)} · mood ${n(p.noise)}`
  );
}

function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * Trim the reasoning off old beats before the run is written to disk. The
 * newest stretch stays answerable; ancient background chatter does not need
 * to carry nine floats each.
 */
export function trimWhy<T extends { why?: unknown }>(feed: T[], keep = 80): void {
  for (let i = 0; i < feed.length - keep; i++) delete feed[i].why;
}
