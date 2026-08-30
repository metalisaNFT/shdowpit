/**
 * Templated dialogue. No generative models, no voice acting — a scored rule
 * list over personality, memory and relationship. One good line at the right
 * moment does more than a paragraph.
 */

import { RNG } from '../core/RNG';
import type { Nemesis } from '../nemesis/Nemesis';
import { countMemory, hasMemory, hasScar } from '../nemesis/Nemesis';

export type LineContext =
  | 'arrival'
  | 'taunt'
  | 'flee'
  | 'kill'
  | 'spared'
  | 'return'
  | 'execute'
  | 'rival'
  | 'steal'
  | 'escaped'
  | 'promotion'
  | 'interrupt'
  | 'last_words';

interface Rule {
  ctx: LineContext;
  /** higher wins */
  priority: number;
  test: (n: Nemesis) => boolean;
  lines: string[];
}

const R: Rule[] = [
  /* ---------------- ARRIVAL ---------------- */
  {
    ctx: 'arrival',
    priority: 100,
    test: (n) => n.returns > 0,
    lines: [
      'You were certain.',
      'You buried me badly.',
      'I did not stay where you put me.',
      'Death was quieter than this.',
      'You should have waited to watch.',
    ],
  },
  {
    ctx: 'arrival',
    priority: 90,
    test: (n) => n.killsAgainstPlayer >= 2,
    lines: ['You came back. Again.', 'How many times will you do this?', 'I know how you end.', 'Twice was not enough for you.'],
  },
  {
    ctx: 'arrival',
    priority: 85,
    test: (n) => n.killsAgainstPlayer >= 1,
    lines: ['You came back.', 'I remember the weight of you.', 'You lasted longer last time.', 'I finished you once.'],
  },
  {
    ctx: 'arrival',
    priority: 80,
    test: (n) => hasScar(n, 'burn') || hasMemory(n, 'PLAYER_BURNED_ME'),
    lines: ['I remember the fire.', 'You made me ash. I kept walking.', 'I still smell it.', 'Bring the flame. I am used to it.'],
  },
  {
    ctx: 'arrival',
    priority: 78,
    test: (n) => n.stolen.length > 0,
    lines: ['Do you want it back?', 'It suits me better.', 'You dropped this.', 'It was yours. Briefly.'],
  },
  {
    ctx: 'arrival',
    priority: 74,
    test: (n) => hasMemory(n, 'PLAYER_SPARED_ME'),
    lines: ['You let me live. Mistake.', 'Mercy. I did not ask.', 'You will not do that twice.', 'I owed you nothing.'],
  },
  {
    ctx: 'arrival',
    priority: 72,
    test: (n) => hasMemory(n, 'PLAYER_HUMILIATED_ME'),
    lines: ['They laughed for weeks.', 'I have thought about this.', 'You made me small.', 'Say something now.'],
  },
  {
    ctx: 'arrival',
    priority: 70,
    test: (n) => n.escapedPlayer >= 2,
    lines: ['I keep leaving. You keep looking.', 'You are slow.', 'Not this time either.', 'I choose when it ends.'],
  },
  {
    ctx: 'arrival',
    priority: 68,
    test: (n) => hasMemory(n, 'PLAYER_KILLED_MY_ALLY'),
    lines: ['You took someone from me.', 'I am not here for rank.', 'This is for the one you left cold.', 'You have a debt.'],
  },
  {
    ctx: 'arrival',
    priority: 66,
    test: (n) => hasMemory(n, 'PLAYER_RAN_FROM_ME'),
    lines: ['Running again?', 'You ran. I waited.', 'There is nowhere further.', 'Legs will not help you.'],
  },
  {
    ctx: 'arrival',
    priority: 60,
    test: (n) => n.defeatsByPlayer >= 2,
    lines: ['I have learned you.', 'You do the same thing every time.', 'I studied the way you move.', 'Not the same as before.'],
  },
  {
    ctx: 'arrival',
    priority: 50,
    test: (n) => n.personality === 'obsessed',
    lines: ['I only came for you.', 'Nothing else matters.', 'I dream about this.', 'There is no one else here.'],
  },
  {
    ctx: 'arrival',
    priority: 48,
    test: (n) => n.personality === 'showoff',
    lines: ['Watch this.', 'They will talk about this one.', 'Look at what walked in.', 'Someone should be writing this down.'],
  },
  {
    ctx: 'arrival',
    priority: 48,
    test: (n) => n.personality === 'madman',
    lines: ['Yes. Yes. Good.', 'Cut deeper this time.', 'I want to feel it.', 'Hurt me properly.'],
  },
  {
    ctx: 'arrival',
    priority: 46,
    test: (n) => n.personality === 'coward',
    lines: ['This is not my fight.', 'I am only here because I was told.', 'Do not make this difficult.', 'I can leave. So can you.'],
  },
  {
    ctx: 'arrival',
    priority: 46,
    test: (n) => n.personality === 'ambitious' || n.personality === 'traitor',
    lines: ['Your head is a promotion.', 'Someone above me will hear about this.', 'You are a step.', 'This buys me a rank.'],
  },
  {
    ctx: 'arrival',
    priority: 44,
    test: (n) => n.personality === 'collector',
    lines: ['I like your weapon.', 'You will not need that.', 'I will take something.', 'Everything ends up mine.'],
  },
  {
    ctx: 'arrival',
    priority: 42,
    test: (n) => n.rank === 'overlord',
    lines: ['You climbed all this way.', 'I remember when I was you.', 'Kneel or do not. It is the same.', 'Nothing above me. Nothing after you.'],
  },
  {
    ctx: 'arrival',
    priority: 40,
    test: (n) => n.rank === 'warlord',
    lines: ['I hold this ground.', 'Small thing.', 'You are late.', 'Go back down.'],
  },
  {
    ctx: 'arrival',
    priority: 0,
    test: () => true,
    lines: ['You do not belong here.', 'Another one.', 'Get up. Or do not.', 'This will be quick.', 'Say your name. I will forget it.'],
  },

  /* ---------------- TAUNT (mid-fight) ---------------- */
  {
    ctx: 'taunt',
    priority: 60,
    test: (n) => countMemory(n, 'PLAYER_PARRIED_ME') >= 3,
    lines: ['Not that trick again.', 'I counted your timing.', 'Wait for it.'],
  },
  {
    ctx: 'taunt',
    priority: 50,
    test: (n) => n.personality === 'madman',
    lines: ['More.', 'Again!', 'I can still stand.'],
  },
  { ctx: 'taunt', priority: 0, test: () => true, lines: ['Still standing?', 'Slow.', 'Is that all of it?', 'Bleed.'] },

  /* ---------------- FLEEING ---------------- */
  {
    ctx: 'flee',
    priority: 60,
    test: (n) => n.personality === 'survivor' || n.personality === 'coward',
    lines: ['Not today.', 'I choose the day.', 'You get nothing.', 'I will be back for this.'],
  },
  { ctx: 'flee', priority: 0, test: () => true, lines: ['Enough.', 'This is not the end of it.', 'Remember my name.', 'Later, then.'] },

  /* ---------------- KILLED THE PLAYER ---------------- */
  {
    ctx: 'kill',
    priority: 60,
    test: (n) => n.killsAgainstPlayer >= 2,
    lines: ['Again. Predictable.', 'You never learn.', 'Stay down this time.'],
  },
  { ctx: 'kill', priority: 0, test: () => true, lines: ['Down.', 'That is all you were.', 'They will hear about this.', 'Mine.'] },

  /* ---------------- SPARED ---------------- */
  { ctx: 'spared', priority: 0, test: () => true, lines: ['Why?', 'You will regret this.', 'I did not ask.', 'That was stupid of you.'] },

  /* ---------------- RETURNED FROM DEATH ---------------- */
  {
    ctx: 'return',
    priority: 20,
    test: (n) => hasMemory(n, 'PLAYER_KILLED_ME') || hasMemory(n, 'PLAYER_EXECUTED_ME'),
    lines: ['You watched me die.', 'You were sure I was dead.', 'You saw me die.', 'That was not enough.'],
  },
  {
    ctx: 'return',
    priority: 0,
    test: () => true,
    lines: ['You were certain.', 'It did not take.', 'I came back for this.', 'Nothing holds me down.'],
  },

  /* ---------------- STOLE PLAYER GEAR ---------------- */
  {
    ctx: 'steal',
    priority: 0,
    test: (n) => n.stolen.length > 0,
    lines: ['Looking for this?', 'Recognize it?', 'It was yours. Briefly.', 'Do you want it back?'],
  },

  /* ---------------- RETURN AFTER ESCAPE ---------------- */
  {
    ctx: 'escaped',
    priority: 10,
    test: (n) => n.escapedPlayer >= 2,
    lines: ['You keep letting me live.', 'Almost. Again.', 'I choose when it ends.', 'You are slow.'],
  },
  {
    ctx: 'escaped',
    priority: 0,
    test: () => true,
    lines: ['Almost had me.', 'Still chasing me?', 'Almost.', 'Not finished.'],
  },

  /* ---------------- PROMOTION ---------------- */
  {
    ctx: 'promotion',
    priority: 20,
    test: (n) => n.killsAgainstPlayer >= 1,
    lines: ['Your death bought this.', 'This is what killing you is worth.', 'I climbed over you.'],
  },
  {
    ctx: 'promotion',
    priority: 0,
    test: () => true,
    lines: ['Look at me now.', 'I climbed.', 'This rank has a name now.'],
  },

  /* ---------------- INTERRUPTS A FIGHT ---------------- */
  {
    ctx: 'interrupt',
    priority: 0,
    test: () => true,
    lines: ['I found you.', 'This is mine.', 'Move.', 'I am not late.'],
  },

  /* ---------------- LAST WORDS (named death) ---------------- */
  {
    ctx: 'last_words',
    priority: 20,
    test: (n) => n.returns > 0 || n.killsAgainstPlayer >= 2,
    lines: ['Not... again.', 'You think this ends it?', "You'll remember me."],
  },
  {
    ctx: 'last_words',
    priority: 0,
    test: () => true,
    lines: ['Not yet.', 'Someone will take my place.', 'This changes nothing.', "You'll remember me."],
  },

  /* ---------------- ABOUT TO BE EXECUTED ---------------- */
  {
    ctx: 'execute',
    priority: 50,
    test: (n) => n.personality === 'coward',
    lines: ['Wait — wait —', 'I can be useful.', 'Do not.'],
  },
  { ctx: 'execute', priority: 0, test: () => true, lines: ['Do it.', 'This changes nothing.', 'I will see you again.', 'Finally.'] },

  /* ---------------- SPOTTING A RIVAL ---------------- */
  { ctx: 'rival', priority: 0, test: () => true, lines: ['You.', 'Not now. Not you.', 'I have waited for this.', 'Both of you, then.'] },
];

/**
 * Pick a line. `salt` should vary per encounter so the same enemy does not
 * repeat itself, but the choice remains reproducible within one encounter.
 */
export function pickLine(n: Nemesis, ctx: LineContext, salt = 0, priorityBoost = 0): string {
  let best: Rule | null = null;
  let bestScore = -1;
  for (const r of R) {
    if (r.ctx !== ctx) continue;
    if (!r.test(n)) continue;
    const score = r.priority + priorityBoost;
    if (!best || score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (!best) return '';
  const rng = new RNG((n.appearanceSeed ^ (salt * 2654435761)) >>> 0);
  return rng.pick(best.lines);
}

/** Fixed multi-turn exchanges — not free chat. AI may polish individual turns. */
export interface ExchangeTurn {
  speaker: 'nemesis' | 'player';
  fallback: string;
}

const EXCHANGES: Partial<Record<LineContext, ExchangeTurn[]>> = {
  execute: [
    { speaker: 'nemesis', fallback: 'Do it.' },
    { speaker: 'player', fallback: 'I will.' },
    { speaker: 'nemesis', fallback: 'Remember this.' },
  ],
  spared: [
    { speaker: 'player', fallback: 'Go.' },
    { speaker: 'nemesis', fallback: 'You will regret that.' },
    { speaker: 'player', fallback: 'We will see.' },
  ],
  taunt: [
    { speaker: 'nemesis', fallback: 'You came back.' },
    { speaker: 'player', fallback: 'So did you.' },
    { speaker: 'nemesis', fallback: 'Not the same.' },
  ],
};

export function exchangeFor(_n: Nemesis, ctx: LineContext, salt = 0): ExchangeTurn[] | null {
  const script = EXCHANGES[ctx];
  if (!script?.length) return null;
  void salt;
  return script.map((t) => ({
    speaker: t.speaker,
    fallback: t.fallback,
  }));
}

export function exchangeContextForEncounter(kind: string): LineContext | null {
  if (kind === 'NEMESIS_DEFEATED') return 'execute';
  if (kind === 'FIRST_MEETING' || kind === 'RETURNING_RIVAL') return 'taunt';
  return null;
}
