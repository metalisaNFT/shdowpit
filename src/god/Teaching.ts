/**
 * How THE LONG GAME teaches itself.
 *
 * The hard thing to learn here is not the buttons. It is a habit of mind: that
 * you are not issuing orders, you are changing prices, and that the gap
 * between what you paid for and what happened is the game rather than a bug in
 * it. So the teaching is built in three layers, and only the first is a
 * tutorial in the usual sense:
 *
 *   1. THE GUIDED FIRST CYCLE — six steps, each waiting on something the
 *      player actually does rather than on a timer. It ends by deliberately
 *      NOT promising that the intervention worked.
 *   2. LESSONS — one short card, at most one per cycle, fired the first time a
 *      concept becomes real in this particular world. Nothing is front-loaded;
 *      you learn what chaos does the cycle it starts doing it.
 *   3. WHY — see Explain.ts. Permanent, and the only one that scales.
 *
 * Nothing in here is allowed to lie about the simulation, and nothing in here
 * may change it. Teaching is a reader.
 */

import type { NemesisManager } from '../nemesis/NemesisManager';
import { chaosTier, CHAOS } from './Influence';
import { simOf, type Beat, type GodState, type RunOutcome } from './GodTypes';

/* ============================================================
   the guided first cycle
   ============================================================ */

export type StepId = 'select' | 'spend' | 'run' | 'open' | 'why' | 'cost' | 'done';

export const STEP_ORDER: StepId[] = ['select', 'spend', 'run', 'open', 'why', 'cost', 'done'];

/** Steps the player is walked through, excluding the terminal one. */
export const STEP_COUNT = STEP_ORDER.length - 1;

export interface GuideStep {
  id: StepId;
  title: string;
  body: string[];
  /** the single thing to do next */
  hint: string;
}

export const GUIDE: Record<StepId, GuideStep> = {
  select: {
    id: 'select',
    title: 'YOU ARE NOT IN THIS WORLD',
    body: [
      'Nobody here is yours. The NOW card shows one situation about to matter — who is in it and what you could nudge. The map on the left is their ground.',
    ],
    hint: 'READ THE NOW CARD · CLICK THE MAP TO FOCUS',
  },
  spend: {
    id: 'spend',
    title: 'YOU CANNOT MAKE ANYONE DO ANYTHING',
    body: [
      'You can only change what it costs them. A price on a head does not kill anyone — it makes killing them worth doing, to the sort of person who was already inclined that way.',
      'Spend some Influence. It does not much matter which one you pick.',
    ],
    hint: 'PRESS INTERFERE ▸ · PICK A MARK YOU CAN AFFORD',
  },
  run: {
    id: 'run',
    title: 'THAT IS ALL YOU DID',
    body: [
      'Nobody has agreed to anything. You have left a condition lying in the world, and it will sit there until somebody decides to pick it up — or until it expires and nobody ever does.',
      'The clock waits. Everyone alive will weigh everything they could do, and do the one thing that wins.',
    ],
    hint: 'PRESS ADVANCE ▸ IN THE STRIP',
  },
  open: {
    id: 'open',
    title: 'WHAT CAME OF IT',
    body: [
      'Aftermath lands on the NOW card — one link at a time. Major beats pause the clock until you dismiss them.',
      'The full timeline lives in OPEN FEED, at four levels of loudness. Most of what happened is MINOR and you are meant to ignore it.',
    ],
    hint: 'PRESS CONTINUE ON THE NOW CARD · OR OPEN FEED',
  },
  why: {
    id: 'why',
    title: 'ASK IT WHY',
    body: [
      'Every consequence can account for itself. WHY opens the actual reasoning the character used — their nature, what they remember, what it would have cost them, and what you had left lying around.',
      'This is the part worth learning. It is how you stop guessing.',
    ],
    hint: 'OPEN FEED OR A PAUSED BEAT · PRESS WHY',
  },
  cost: {
    id: 'cost',
    title: 'AND WHAT IT COST YOU',
    body: [
      'Every intervention raises Chaos, and Chaos is not a penalty you pay to yourself. It is paid out of how predictable this world is.',
      'A high-chaos world moves faster, finishes harder, produces things nobody made, and eventually works out that it is being handled.',
      'That is the whole tension. You can interfere as hard as you like. You will not enjoy what you get back.',
    ],
    hint: 'THAT IS THE LOOP. THE REST YOU WILL PICK UP AS IT HAPPENS.',
  },
  done: { id: 'done', title: '', body: [], hint: '' },
};

export type GuideEvent =
  | 'boardShown'
  | 'situationSelected'
  | 'intervened'
  | 'cycleAdvanced'
  | 'beatOpened'
  | 'whyOpened';

/** Which player action moves each step along. */
const ADVANCES_ON: Partial<Record<StepId, GuideEvent>> = {
  select: 'situationSelected',
  spend: 'intervened',
  run: 'cycleAdvanced',
  open: 'beatOpened',
  why: 'whyOpened',
  cost: 'cycleAdvanced',
};

export class Guide {
  step: StepId = 'select';
  /** Set when the player opens WHY — required before auto-dismiss. */
  whyOpened = false;

  load(saved: string): void {
    this.step = (STEP_ORDER as string[]).includes(saved) ? (saved as StepId) : 'select';
    if (this.step === 'done' || STEP_ORDER.indexOf(this.step) > STEP_ORDER.indexOf('why')) {
      this.whyOpened = true;
    }
  }

  get active(): boolean {
    return this.step !== 'done';
  }

  get current(): GuideStep | null {
    return this.active ? GUIDE[this.step] : null;
  }

  /**
   * Returns true when the step changed.
   *
   * A player who does things out of order — selects a name from the inspector
   * instead of the board, opens WHY before reading a beat — must not be able
   * to strand the walkthrough on a step they have already moved past. Any
   * event that belongs to the current step *or a later one* carries it
   * forward to just after that step.
   */
  notify(ev: GuideEvent): boolean {
    if (!this.active) return false;
    if (ev === 'whyOpened') this.whyOpened = true;
    const here = STEP_ORDER.indexOf(this.step);
    let matched = -1;
    for (let i = here; i < STEP_ORDER.length; i++) {
      if (ADVANCES_ON[STEP_ORDER[i]] === ev) {
        matched = i;
        break;
      }
    }
    if (matched < 0) return false;
    this.step = STEP_ORDER[Math.min(matched + 1, STEP_ORDER.length - 1)];
    return true;
  }

  /** The player asked to be left alone. */
  finish(): void {
    this.step = 'done';
  }

  restart(): void {
    this.step = 'select';
    this.whyOpened = false;
  }

  /** Do not hold the rail hostage past the opening — but only after WHY landed. */
  maybeGiveUp(cycle: number): boolean {
    if (!this.active || cycle < 5) return false;
    if (!this.whyOpened && STEP_ORDER.indexOf(this.step) <= STEP_ORDER.indexOf('why')) return false;
    this.finish();
    return true;
  }

  /** Board unlock waits on finishing the walkthrough, not a cycle count. */
  get boardReady(): boolean {
    return this.step === 'done';
  }
}

/* ============================================================
   lessons
   ============================================================ */

export interface TeachingWorld {
  god: GodState;
  mgr: NemesisManager;
  /** beats produced by the cycle that just resolved */
  cycleBeats: readonly Beat[];
  outcome: RunOutcome | null;
  /** cycles since the player last spent anything */
  idleCycles: number;
  /** characters the player was propping up who lost anyway this cycle */
  blessedLosers: readonly string[];
  /** run index, so second-run lessons can wait for one */
  runIndex: number;
}

export interface Lesson {
  id: string;
  title: string;
  body: string[];
  footnote?: string;
  /** higher wins when several are eligible in the same cycle */
  priority: number;
  when(w: TeachingWorld): boolean;
}

const beatKinds = (w: TeachingWorld): Set<string> => new Set(w.cycleBeats.map((b) => b.kind));

export const LESSONS: Lesson[] = [
  {
    id: 'chaos_what',
    title: 'CHAOS',
    priority: 5,
    body: [
      'You have started paying for this. Chaos rises with every intervention and falls slowly on its own, so a spike is survivable and a habit is not.',
      'It does not hurt you directly. It widens every decision every character makes, which means the world stops doing what its people would obviously have done.',
    ],
    footnote: 'THE METER AT THE TOP. WATCH WHERE IT SITS, NOT WHAT IT COST.',
    when: (w) => w.god.chaos > 0,
  },
  {
    id: 'fights_are_real',
    title: 'THEY ACTUALLY FIGHT',
    priority: 4,
    body: [
      'That was not a coin flip between two power numbers. It was an exchange, blow by blow, using the same weapons, attack tables and traits the third-person game uses.',
      'Which is why a heavy with a club and a duelist with a spear can be worth the same on paper and still not be a fair fight.',
    ],
    footnote: 'OPEN FEED · EXPAND THE LINE TO SEE HOW IT WENT',
    when: (w) => beatKinds(w).has('duel'),
  },
  {
    id: 'what_happens_after',
    title: 'WINNING IS NOT THE DECISION',
    priority: 6,
    body: [
      'The fight only settled who was standing. What happens to the one on the ground is a separate choice, and it is where most of this world\'s stories come from.',
      'Killing, sparing, humiliating and robbing all mean something different to the person it happens to — and they will remember which one they got.',
    ],
    when: (w) => w.cycleBeats.some((b) => /LEFT THEM BREATHING|LET THEM LIVE|WALKED OFF WITH/.test(b.headline)),
  },
  {
    id: 'death_spreads',
    title: 'A DEATH IS NOT AN ENDING',
    priority: 6,
    body: [
      'Whoever cared about them takes it personally, and some of them will spend the rest of the run doing something about it.',
      'This is how a single killing turns into a chain you did not plan and cannot easily stop.',
    ],
    when: (w) => beatKinds(w).has('grudge') && w.cycleBeats.some((b) => /SWORE TO ANSWER/.test(b.headline)),
  },
  {
    id: 'grudges_hold',
    title: 'THEY DO NOT LET GO',
    priority: 5,
    body: [
      'Somebody now wants somebody else. That is not a flag — it is a goal they hold across cycles, and the longer they hold it the more it outweighs everything else they could be doing.',
      'A grudge held for ten cycles will make a character do something stupid. That is usually the good part.',
    ],
    footnote: 'CLICK A NAME TO SEE WHAT THEY WANT AND HOW LONG THEY HAVE WANTED IT',
    when: (w) => w.mgr.living().some((n) => simOf(n).goal === 'revenge' && simOf(n).goalAge >= 2),
  },
  {
    id: 'it_did_not_work',
    title: 'IT DID NOT WORK',
    priority: 9,
    body: [
      'Somebody you put your weight behind lost anyway. This is working as intended and it is worth sitting with.',
      'A blessing is a thumb on the scale, not a hand. You bought them better odds against an opponent who had their own reasons to be dangerous — and odds are the only thing that was ever for sale.',
    ],
    when: (w) => w.blessedLosers.length > 0,
  },
  {
    id: 'backfire',
    title: 'THAT WAS YOURS',
    priority: 10,
    body: [
      'Something you paid for has just been used against something else you paid for. Nobody in here knows they are your project.',
      'The most reliable way to make a monster in this game is to keep helping someone.',
    ],
    when: (w) => {
      const mine = new Set(w.god.conditions.filter((c) => c.source === 'god').map((c) => c.targetId));
      if (mine.size < 2) return false;
      return w.cycleBeats.some((b) => b.actors.length > 1 && mine.has(b.actors[0]) && mine.has(b.actors[1]));
    },
  },
  {
    id: 'returns',
    title: 'DEAD IS NOT ALWAYS DEAD',
    priority: 7,
    body: [
      'Someone came back. Returns are rare, they always cost something — a scar, a mutation — and they always come with a reason to be angry.',
      'Whoever put them in the ground is now carrying a problem they thought they had solved.',
    ],
    when: (w) => beatKinds(w).has('return'),
  },
  {
    id: 'betrayal',
    title: 'A BOND IS A LIABILITY',
    priority: 7,
    body: [
      'That was not random. Betrayal needs a treacherous nature, an actual bond to break, and a reason — and the reason is the part you can supply.',
      'WHISPER is cheap for exactly this. It does not cause a betrayal; it hands one to someone who was already halfway there.',
    ],
    when: (w) => beatKinds(w).has('betrayal'),
  },
  {
    id: 'idle',
    title: 'YOU ARE HOLDING TOO MUCH',
    priority: 3,
    body: [
      'Influence has been sitting full while the world got on with things. It does not accumulate past the ceiling, so a cycle you do not spend is a cycle you threw away.',
      'Interfering is not the risky choice. Interfering carelessly is.',
    ],
    when: (w) => w.idleCycles >= 2 && w.god.influence >= w.god.influenceMax - 0.5,
  },
  {
    id: 'chaos_bites',
    title: 'THE WORLD IS GETTING LOUD',
    priority: 8,
    body: [
      'Chaos has crossed into a tier that changes how this place behaves — faster, more lethal, stranger, and harder to read.',
      'BE STILL exists for this, if you have found it. So does simply keeping your hands off it for a few cycles.',
    ],
    when: (w) => w.god.chaos >= 40,
  },
  {
    id: 'heresy',
    title: 'SOMEBODY LOOKED UP',
    priority: 11,
    body: [
      'One of them has worked out that something has been arranging their world. You bought this with Chaos, above forty-five, and it does not go away when the meter falls.',
      'They will spend their cycles tearing up whatever you put down. You cannot reason with it, and you cannot touch them directly.',
    ],
    when: (w) => w.mgr.living().some((n) => simOf(n).heretic),
  },
  {
    id: 'crisis',
    title: 'YOU CANNOT FIGHT THIS',
    priority: 12,
    body: [
      'Something has grown past the world that produced it. It was not spawned for you — it is whatever had already become the most dangerous fact in here, and it is usually something you helped make.',
      'You have no intervention that touches it. What you can do is find whoever is closest to being able, and spend the rest of the run making them able.',
    ],
    footnote: 'THE BOARD NAMES THE CLOSEST THING TO AN ANSWER. IT IS RARELY THE STRONGEST ONE.',
    when: (w) => !!w.god.crisis && w.god.crisis.resolved === 'none',
  },
  {
    id: 'act',
    title: 'THE WORLD HAS MOVED ON',
    priority: 6,
    body: [
      'A new act. Nothing was scripted to happen — what changed is the pressure everyone is under: how fast they move, how willing they are to finish each other, how hard they push upward.',
      'Whatever you set going early is loose in the world now.',
    ],
    when: (w) => beatKinds(w).has('act'),
  },
];

export const LESSON_MAP = new Map(LESSONS.map((l) => [l.id, l]));

/**
 * At most one lesson per cycle, highest priority first, each shown once ever.
 * Returns null when there is nothing worth saying, which is most cycles.
 */
export function pickLesson(w: TeachingWorld, seen: Record<string, boolean>): Lesson | null {
  let best: Lesson | null = null;
  for (const l of LESSONS) {
    if (seen[l.id]) continue;
    let ok = false;
    try {
      ok = l.when(w);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    if (!best || l.priority > best.priority) best = l;
  }
  return best;
}

/* ============================================================
   the primer — for people who would rather read than be led
   ============================================================ */

export interface PrimerSection {
  title: string;
  lines: string[];
}

export function primer(god: GodState | null): PrimerSection[] {
  const tier = god ? chaosTier(god.chaos) : chaosTier(0);
  return [
    {
      title: 'THE ONE RULE',
      lines: [
        'You do not control anybody. You change what things cost them.',
        'Every intervention leaves a condition in the world. Autonomous characters read it as one input among many and decide for themselves. The distance between "I put a price on his head" and "he died" is the entire game.',
      ],
    },
    {
      title: 'A CYCLE',
      lines: [
        'OBSERVE — the NOW card shows one load-bearing situation; the map and drawers hold the rest.',
        'INTERFERE — spend Influence from the strip. The clock waits until you advance. You may spend none.',
        'SIMULATE — everyone alive weighs every option they have and takes the best one.',
        'CONSEQUENCES — aftermath on the NOW card; OPEN FEED holds the full timeline at four levels of loudness.',
        'Then the act clock advances, chaos bleeds off a little, and influence comes back.',
      ],
    },
    {
      title: 'HOW THEY DECIDE',
      lines: [
        'Each character scores every option out of the same eight things: their nature, what they are to the target, what they remember, what they need, what it would cost them to be wrong, what openings exist, how hard they are being pushed, and the mood they are in.',
        'There is no story director. If a coward hides, it is because hiding scored highest for a coward — not because cowards hide.',
        'Any decision beat will show you its own arithmetic. Expand it in OPEN FEED or on a paused NOW card, then press WHY.',
      ],
    },
    {
      title: 'THE TWO RESOURCES',
      lines: [
        'INFLUENCE is what you spend. It refills every cycle and does not stack past its ceiling, so hoarding it is waste.',
        `CHAOS is what spending it costs. Currently ${god ? Math.round(god.chaos) : 0} — ${tier.name}. ${tier.blurb}`,
        `Above ${CHAOS_HERESY_AT}, characters can begin to work out that they are being handled, and act on it.`,
      ],
    },
    {
      title: 'HOW A RUN ENDS',
      lines: [
        'By the last act something in the world has grown past it. You cannot touch it. You have to arrange for somebody who can.',
        'Win or lose, up to three characters go into the Book of Legends with their deeds and what they thought of you — and each leaves one thing behind in the next world.',
        'Unlocks are new things to try, never bigger numbers.',
      ],
    },
    {
      title: 'IF YOU WANT TO GET GOOD AT IT',
      lines: [
        'Read WHY on anything that surprises you. It is the only way to learn a simulation.',
        'Spend early, when characters are small and cheap to change. Nothing you do in the last five cycles matters much.',
        'Watch who you keep helping. That is usually what ends the run.',
      ],
    },
  ];
}

/** Chaos ceiling, exported so the primer and the UI agree on the number. */
export const CHAOS_HERESY_AT = CHAOS.heresyFrom;
