/**
 * What the player can actually do.
 *
 * THE RULE, and it is the whole design: an intervention writes a CONDITION and
 * nudges a character's inner state. It never sets an outcome. Nothing in this
 * file may change `alive`, `rank`, `power`, who holds ground, or who fights
 * whom. `raise` is the one place a life is touched, and it costs ten chaos for
 * exactly that reason.
 *
 * The distance between "I put a price on his head" and "he died" is the whole
 * game. Everything in between is decided by people who are not you.
 */

import type { RNG } from '../core/RNG';
import { AREA_NAMES } from '../data/names';
import { AREAS } from '../data/areas';
import { getPersonality } from '../data/personalities';
import { traitsOfKind } from '../data/traits';
import { fullName, rankIndex, type Nemesis, type StolenItem } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { remember } from '../nemesis/NemesisMemory';
import { addCondition } from './Conditions';
import type { GodContext } from './Context';
import { addChaos } from './Influence';
import { simOf, type BeatPriority, type GodState } from './GodTypes';

export type InterventionTargeting = 'none' | 'nemesis' | 'pair' | 'area' | 'dead';

export interface InterventionDef {
  id: string;
  name: string;
  /** what it says on the card */
  desc: string;
  /** the promise, phrased as a condition rather than a result */
  promise: string;
  cost: number;
  chaos: number;
  targeting: InterventionTargeting;
  /** meta-unlock id required to see it at all */
  requires?: string;
  /** returns a reason it cannot be used, or null */
  check(ctx: GodContext, a: Nemesis | null, b: Nemesis | null, areaId: string | null): string | null;
  apply(ctx: GodContext, a: Nemesis | null, b: Nemesis | null, areaId: string | null): InterventionEffect;
}

export interface InterventionEffect {
  headline: string;
  detail: string[];
  actors: string[];
  priority?: BeatPriority;
  tone?: 'neutral' | 'bad' | 'good' | 'gold';
}

/* ============================================================
   gifts
   ============================================================ */

const GIFT_PREFIX = ['GOD', 'ASH', 'NIGHT', 'GRAVE', 'OATH', 'SILENT', 'FIRST'];
const GIFT_NOUN = ['STEEL', 'EDGE', 'TOOTH', 'BRAND', 'SPLINTER', 'ANSWER', 'DEBT'];

function makeGift(rng: RNG, n: Nemesis): StolenItem {
  return {
    name: `${rng.pick(GIFT_PREFIX)}${rng.pick(GIFT_NOUN)}`,
    kind: 'weapon',
    weaponId: n.weapon,
  };
}

/* ============================================================
   the catalogue
   ============================================================ */

export const INTERVENTIONS: InterventionDef[] = [
  /* ---------------------------------------------------------- BLESS */
  {
    id: 'bless',
    name: 'BLESS',
    desc: 'Put your weight behind someone.',
    promise: 'They fight better and hold longer. What they do with that is theirs.',
    cost: 3,
    chaos: 3,
    targeting: 'nemesis',
    check: (_c, a) => (a && a.alive ? null : 'They are not alive to bless.'),
    apply(ctx, a) {
      const n = a!;
      addCondition(ctx.god, {
        kind: 'blessing',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1,
        duration: 3,
        note: 'something is holding them up',
      });
      const s = simOf(n);
      s.confidence = Math.min(100, s.confidence + 18);
      s.fear = Math.max(0, s.fear - 12);
      remember(n, 'GOD_BLESSED_ME', ctx.mgr.turn);
      return {
        headline: `${fullName(n)} FEELS SOMETHING BEHIND THEM.`,
        detail: [
          'They hit harder and break later for the next three cycles.',
          'They will probably use it to do what they already wanted to do.',
        ],
        actors: [n.id],
        tone: 'good',
      };
    },
  },

  /* ---------------------------------------------------------- CURSE */
  {
    id: 'curse',
    name: 'CURSE',
    desc: 'Take something out of someone.',
    promise: 'They weaken and they know it. They will remember who did it.',
    cost: 3,
    chaos: 4,
    targeting: 'nemesis',
    check: (_c, a) => (a && a.alive ? null : 'They are already beyond cursing.'),
    apply(ctx, a) {
      const n = a!;
      addCondition(ctx.god, {
        kind: 'curse',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1,
        duration: 3,
        note: 'something is dragging on them',
      });
      const s = simOf(n);
      s.confidence = Math.max(0, s.confidence - 20);
      s.fear = Math.min(100, s.fear + 16);
      remember(n, 'GOD_CURSED_ME', ctx.mgr.turn);
      return {
        headline: `SOMETHING WENT OUT OF ${fullName(n)}.`,
        detail: [
          'Weaker, and easier to hurt, for the next three cycles.',
          'They do not know what you are. They know they have been touched.',
        ],
        actors: [n.id],
        tone: 'bad',
      };
    },
  },

  /* ---------------------------------------------------------- GIFT */
  {
    id: 'gift',
    name: 'PUT STEEL IN THEIR HAND',
    desc: 'Give someone a weapon worth having.',
    promise: 'They get stronger — and everyone who wants it knows where it is.',
    cost: 4,
    chaos: 3,
    targeting: 'nemesis',
    check: (_c, a) => (a && a.alive ? (a.stolen.length >= 3 ? 'They are already carrying too much.' : null) : 'They cannot hold anything.'),
    apply(ctx, a) {
      const n = a!;
      const item = makeGift(ctx.rng, n);
      n.stolen.push(item);
      recomputePower(n);
      const s = simOf(n);
      s.confidence = Math.min(100, s.confidence + 12);
      s.ambition = Math.min(100, s.ambition + 8);
      remember(n, 'GOD_GIFTED_ME', ctx.mgr.turn);
      // A gift is also a target painted on its owner.
      addCondition(ctx.god, {
        kind: 'opportunity',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 0.5,
        duration: 4,
        note: `carrying ${item.name}`,
        source: 'world',
      });
      ctx.deed(n, `was handed ${item.name} by something that was not there`, 3);
      return {
        headline: `${fullName(n)} IS CARRYING ${item.name}.`,
        detail: [
          'Stronger in every fight while they hold it.',
          'Thieves and rivals can see it from across the region.',
          'If they die, whoever kills them keeps it.',
        ],
        actors: [n.id],
        tone: 'gold',
      };
    },
  },

  /* ---------------------------------------------------------- WHISPER */
  {
    id: 'whisper',
    name: 'WHISPER',
    desc: 'Put a story about one of them in the other one\'s ear.',
    promise: 'Suspicion, nothing more. What suspicion becomes is up to them.',
    cost: 2,
    chaos: 1,
    targeting: 'pair',
    check: (_c, a, b) => {
      if (!a || !b) return 'A rumour needs two people.';
      if (a.id === b.id) return 'They already know what they think of themselves.';
      if (!a.alive || !b.alive) return 'One of them is past caring.';
      return null;
    },
    apply(ctx, a, b) {
      const x = a!;
      const y = b!;
      addCondition(ctx.god, {
        kind: 'rumour',
        targetKind: 'nemesis',
        targetId: x.id,
        otherId: y.id,
        magnitude: 0.9,
        duration: 4,
        note: `${fullName(x)} has heard something about ${fullName(y)}`,
      });
      const sx = simOf(x);
      sx.loyalty = Math.max(0, sx.loyalty - 14);
      const bonded = x.master === y.id || x.allies.includes(y.id);
      return {
        headline: `${fullName(x)} HAS HEARD SOMETHING ABOUT ${fullName(y)}.`,
        detail: [
          bonded
            ? 'They were sworn to each other. That is exactly why it will work.'
            : 'It will sit there until one of them decides what to do about it.',
          'Whether it is true is not the point and never was.',
        ],
        actors: [x.id, y.id],
        tone: 'bad',
      };
    },
  },

  /* ---------------------------------------------------------- BOUNTY */
  {
    id: 'bounty',
    name: 'PRICE THEIR HEAD',
    desc: 'Make killing someone worth doing.',
    promise: 'The greedy and the climbing will start looking. Nobody is obliged to find them.',
    cost: 3,
    chaos: 2,
    targeting: 'nemesis',
    check: (_c, a) => (a && a.alive ? null : 'There is no price on the dead.'),
    apply(ctx, a) {
      const n = a!;
      addCondition(ctx.god, {
        kind: 'bounty',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1,
        duration: 4,
        note: `a price on ${fullName(n)}`,
      });
      remember(n, 'GOD_MARKED_ME', ctx.mgr.turn);
      simOf(n).fear = Math.min(100, simOf(n).fear + 10);
      const hunters = ctx
        .living()
        .filter((x) => x.id !== n.id && getPersonality(x.personality).hunt > 1.2)
        .slice(0, 3)
        .map((x) => fullName(x));
      return {
        headline: `THERE IS A PRICE ON ${fullName(n)}.`,
        detail: [
          hunters.length ? `${hunters.join(', ')} are the sort who go looking.` : 'Nobody in this world hunts much. It may sit unclaimed.',
          'Whoever takes it will be stronger for having taken it.',
        ],
        actors: [n.id],
        tone: 'bad',
      };
    },
  },

  /* ---------------------------------------------------------- REVEAL */
  {
    id: 'reveal',
    name: 'REVEAL',
    desc: 'Show the world exactly where someone is.',
    promise: 'They can be reached from anywhere. Including by you.',
    cost: 2,
    chaos: 1,
    targeting: 'nemesis',
    check: (_c, a) => (a && a.alive ? null : 'There is nothing to find.'),
    apply(ctx, a) {
      const n = a!;
      addCondition(ctx.god, {
        kind: 'exposure',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1,
        duration: 3,
        note: `everyone knows where ${fullName(n)} is`,
      });
      const s = simOf(n);
      s.hiddenUntil = 0;
      s.fear = Math.min(100, s.fear + 8);
      remember(n, 'GOD_EXPOSED_ME', ctx.mgr.turn);
      return {
        headline: `${fullName(n)} CANNOT HIDE.`,
        detail: [
          `Anyone who wants them can reach ${AREA_NAMES[n.territory] ?? n.territory.toUpperCase()} without the usual trouble.`,
          'You can see them clearly too, for as long as it lasts.',
        ],
        actors: [n.id],
        tone: 'neutral',
      };
    },
  },

  /* ---------------------------------------------------------- PROVOKE */
  {
    id: 'provoke',
    name: 'PROVOKE',
    desc: 'Arrange for two people to be in the same place with a reason.',
    promise: 'An opening, on both sides. Neither of them has to take it.',
    cost: 4,
    chaos: 3,
    targeting: 'pair',
    check: (_c, a, b) => {
      if (!a || !b) return 'It takes two.';
      if (a.id === b.id) return 'They cannot be provoked into fighting themselves.';
      if (!a.alive || !b.alive) return 'One of them is dead.';
      return null;
    },
    apply(ctx, a, b) {
      const x = a!;
      const y = b!;
      for (const [p, q] of [
        [x, y],
        [y, x],
      ] as Array<[Nemesis, Nemesis]>) {
        addCondition(ctx.god, {
          kind: 'rumour',
          targetKind: 'nemesis',
          targetId: p.id,
          otherId: q.id,
          magnitude: 1.1,
          duration: 3,
          note: `${fullName(p)} has been given a reason to look at ${fullName(q)}`,
        });
        addCondition(ctx.god, {
          kind: 'opportunity',
          targetKind: 'nemesis',
          targetId: q.id,
          magnitude: 0.8,
          duration: 2,
          note: `${fullName(q)} is where ${fullName(p)} can reach them`,
        });
      }
      simOf(x).ambition = Math.min(100, simOf(x).ambition + 6);
      simOf(y).ambition = Math.min(100, simOf(y).ambition + 6);
      return {
        headline: `${fullName(x)} AND ${fullName(y)} ARE GOING TO END UP IN THE SAME ROOM.`,
        detail: [
          'Both of them now have an opening on the other and a reason to use it.',
          'Whether either takes it depends entirely on who they are.',
          'One of them may simply walk away. People do.',
        ],
        actors: [x.id, y.id],
        priority: 'notable',
        tone: 'bad',
      };
    },
  },

  /* ---------------------------------------------------------- MEND */
  {
    id: 'mend',
    name: 'MEND',
    desc: 'Close someone\'s wounds and stand over them a while.',
    promise: 'They stop bleeding and become hard to finish. They may not deserve it.',
    cost: 3,
    chaos: 3,
    targeting: 'nemesis',
    check: (_c, a) => (a && a.alive ? null : 'Mending is for the living.'),
    apply(ctx, a) {
      const n = a!;
      const s = simOf(n);
      const before = Math.round(s.injury);
      s.injury = Math.max(0, s.injury - 55);
      s.fear = Math.max(0, s.fear - 14);
      addCondition(ctx.god, {
        kind: 'ward',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1,
        duration: 2,
        note: `something is keeping ${fullName(n)} alive`,
      });
      return {
        headline: `${fullName(n)}'S WOUNDS CLOSED.`,
        detail: [
          `Injury ${before} → ${Math.round(s.injury)}.`,
          'For two cycles, anyone standing over them will find the killing blow harder to land.',
          'If it saves their life they will know something did.',
        ],
        actors: [n.id],
        tone: 'good',
      };
    },
  },

  /* ---------------------------------------------------------- RAISE */
  {
    id: 'raise',
    name: 'RAISE',
    desc: 'Pull one of the dead back out.',
    promise: 'They come back knowing they were dead. Nothing about that is free.',
    cost: 8,
    chaos: 10,
    targeting: 'dead',
    check: (_c, a) => {
      if (!a) return 'Choose one of the dead.';
      if (a.alive) return 'They are already walking.';
      return null;
    },
    apply(ctx, a) {
      const n = a!;
      const label = ctx.scar(n, 'the god');
      const pool = traitsOfKind('mutation').filter((t) => !n.strengths.includes(t.id));
      if (pool.length && n.strengths.length < 5) n.strengths.push(ctx.rng.pick(pool).id);
      ctx.mgr.resurrect(n, label);
      const s = simOf(n);
      s.fear = Math.max(0, s.fear - 30);
      s.confidence = Math.min(100, s.confidence + 25);
      s.ambition = Math.min(100, s.ambition + 15);
      remember(n, 'GOD_RAISED_ME', ctx.mgr.turn);
      ctx.deed(n, 'was pulled back out of the ground by something enormous', 5);
      const killer = ctx.mgr.byId(s.killedById);
      if (killer && killer.alive && !s.revengeTargets.includes(killer.id)) {
        s.revengeTargets.push(killer.id);
        s.goal = 'revenge';
        s.goalTargetId = killer.id;
      }
      return {
        headline: `${fullName(n)} IS STANDING UP.`,
        detail: [
          label ? `They came back with ${label.toLowerCase()}.` : 'They came back changed.',
          killer && killer.alive ? `${fullName(killer)} killed them. They have not forgotten.` : 'Whatever killed them is not around to see it.',
          'The world noticed this. So did they.',
        ],
        actors: [n.id],
        priority: 'legendary',
        tone: 'bad',
      };
    },
  },

  /* ---------------------------------------------------------- CALAMITY */
  {
    id: 'calamity',
    name: 'CALAMITY',
    desc: 'Put something into the world that should not be in it.',
    promise: 'A threat with its own ideas. It will not be on your side.',
    cost: 6,
    chaos: 20,
    targeting: 'area',
    check: (ctx, _a, _b, areaId) => {
      if (!areaId) return 'Choose ground.';
      if (ctx.living().length >= 22) return 'There is no room left in this world.';
      return null;
    },
    apply(ctx, _a, _b, areaId) {
      const area = areaId ?? AREAS[0].id;
      const beast = ctx.mgr.recruit('captain', false);
      beast.territory = area;
      beast.personality = 'madman';
      beast.archetype = 'heavy';
      beast.level = Math.min(30, beast.level + 5 + Math.round(ctx.god.chaos * 0.05));
      const muts = traitsOfKind('mutation');
      for (let i = 0; i < 2; i++) {
        const t = ctx.rng.pick(muts);
        if (!beast.strengths.includes(t.id) && beast.strengths.length < 5) beast.strengths.push(t.id);
      }
      recomputePower(beast);
      const s = simOf(beast);
      s.ambition = 90;
      s.fear = 0;
      s.confidence = 90;
      s.goal = 'conquer';
      s.crisisBorn = false;
      ctx.deed(beast, 'was not born, exactly', 4);

      addCondition(ctx.god, {
        kind: 'omen',
        targetKind: 'world',
        targetId: 'world',
        magnitude: 1,
        duration: 5,
        note: `something came out of ${AREA_NAMES[area] ?? area}`,
      });
      addCondition(ctx.god, {
        kind: 'unrest',
        targetKind: 'area',
        targetId: area,
        magnitude: 1,
        duration: 4,
        note: 'nobody wants to be there',
      });
      ctx.chronicle('mutation', `Something came up out of ${AREA_NAMES[area] ?? area}.`, [beast.id], true, 'bad');
      return {
        headline: `SOMETHING CAME UP OUT OF ${AREA_NAMES[area] ?? area}.`,
        detail: [
          `${fullName(beast)}. Power ${beast.power}. It wants ground and it does not tire.`,
          'It is not yours. It was never going to be yours.',
          'Twenty chaos. You will feel this for the rest of the run.',
        ],
        actors: [beast.id],
        priority: 'legendary',
        tone: 'bad',
      };
    },
  },

  /* ---------------------------------------------------------- CROWN (unlock) */
  {
    id: 'crown',
    name: 'CROWN',
    desc: 'Make the world treat someone as though they were already above it.',
    promise: 'Doors open for them. Whether they walk through is theirs.',
    cost: 6,
    chaos: 6,
    targeting: 'nemesis',
    requires: 'int_crown',
    check: (_c, a) => {
      if (!a || !a.alive) return 'You cannot crown the dead.';
      if (rankIndex(a.rank) >= 4) return 'They are already at the top.';
      return null;
    },
    apply(ctx, a) {
      const n = a!;
      addCondition(ctx.god, {
        kind: 'opportunity',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1.4,
        duration: 4,
        note: `the way up is open for ${fullName(n)}`,
      });
      addCondition(ctx.god, {
        kind: 'blessing',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 0.5,
        duration: 4,
        note: 'carried',
      });
      const s = simOf(n);
      s.ambition = Math.min(100, s.ambition + 35);
      s.confidence = Math.min(100, s.confidence + 20);
      remember(n, 'GOD_BLESSED_ME', ctx.mgr.turn);
      ctx.deed(n, 'was pointed at the top of the world', 3);
      return {
        headline: `${fullName(n)} HAS BEEN SHOWN THE WAY UP.`,
        detail: [
          'Ambition surged. Everything above them looks reachable now.',
          'They will start challenging people they had no business challenging.',
          'They may not survive that.',
        ],
        actors: [n.id],
        priority: 'major',
        tone: 'gold',
      };
    },
  },

  /* ---------------------------------------------------------- DESCEND */
  {
    id: 'descend',
    name: 'DESCEND',
    desc: 'Stop arranging it and go down there yourself.',
    promise: 'One confrontation, in your own hands. The world does not wait for you.',
    cost: 7,
    chaos: 12,
    targeting: 'nemesis',
    check: (ctx, a) => {
      if (!a || !a.alive) return 'There is nobody there to meet.';
      if (ctx.god.pendingDescent) return 'You are already going.';
      return null;
    },
    apply(ctx, a) {
      const n = a!;
      const sit =
        ctx.god.situations.find((s) => s.id === ctx.god.focusSituationId) ??
        ctx.god.situations.find((s) => s.actors.includes(n.id)) ??
        null;
      const tower = ctx.god.scenarioFlags?.towerCommander && n.territory === 'tower' && n.archetype === 'commander';
      const spear = n.stolen.some((s) => s.weaponId === 'spear');
      ctx.god.pendingDescent = {
        nemesisId: n.id,
        reason: sit?.headline ?? `${fullName(n)} is waiting`,
        goal: tower
          ? spear
            ? `Enter the Tower. Take the spear — or break ${fullName(n)}'s command.`
            : `Enter the Tower. End ${fullName(n)}'s command, or leave it stronger.`
          : `Find ${fullName(n)}. Kill, spare, or retreat — the board remembers.`,
        situationId: sit?.id ?? null,
        conditionNote: 'Exposure. They know something is coming in person.',
        cyclesWhileGone: 2,
        scenario: tower ? 'tower' : 'hunt',
      };
      ctx.god.descents++;
      addCondition(ctx.god, {
        kind: 'exposure',
        targetKind: 'nemesis',
        targetId: n.id,
        magnitude: 1,
        duration: 2,
        note: `something is coming for ${fullName(n)} in person`,
      });
      simOf(n).fear = Math.min(100, simOf(n).fear + 20);
      return {
        headline: `YOU ARE GOING DOWN THERE FOR ${fullName(n)}.`,
        detail: [
          tower
            ? 'The Tower is a physical place. Your strategic marks are already in the air.'
            : 'One confrontation, in your own hands, with everything the third-person game gives you.',
          'Cycles keep turning while you are in it. Whatever you left half-arranged will finish without you.',
          'Twelve chaos, because a god with a sword in its hand is the least subtle thing in this world.',
        ],
        actors: [n.id],
        priority: 'legendary',
        tone: 'gold',
      };
    },
  },

  /* ---------------------------------------------------------- STILL (unlock) */
  {
    id: 'still',
    name: 'BE STILL',
    desc: 'Take your hands off the world for a moment.',
    promise: 'Chaos falls. Nothing else happens, which is the point.',
    cost: 5,
    chaos: -14,
    targeting: 'none',
    requires: 'int_still',
    check: (ctx) => (ctx.god.chaos < 10 ? 'The world is quiet enough already.' : null),
    apply(ctx) {
      const before = Math.round(ctx.god.chaos);
      return {
        headline: 'YOU TOOK YOUR HANDS OFF IT.',
        detail: [`Chaos ${before} → ${Math.max(0, before - 14)}.`, 'Nothing else changed. That is what stillness is.'],
        actors: [],
        priority: 'notable',
        tone: 'good',
      };
    },
  },
];

export const INTERVENTION_MAP = new Map(INTERVENTIONS.map((i) => [i.id, i]));

/** The interventions this save has access to. */
export function availableInterventions(unlocked: readonly string[]): InterventionDef[] {
  return INTERVENTIONS.filter((i) => !i.requires || unlocked.includes(i.requires));
}

export interface SpendResult {
  ok: boolean;
  reason?: string;
  effect?: InterventionEffect;
}

/**
 * The single entry point. Charges the resources, applies the intervention,
 * writes the beat. Nothing else in the codebase is allowed to charge Influence.
 */
export function performIntervention(
  ctx: GodContext,
  def: InterventionDef,
  a: Nemesis | null,
  b: Nemesis | null,
  areaId: string | null
): SpendResult {
  const god: GodState = ctx.god;
  if (god.ended) return { ok: false, reason: 'The run is over.' };
  if (god.influence < def.cost) return { ok: false, reason: `Not enough influence — ${def.cost} needed.` };
  const why = def.check(ctx, a, b, areaId);
  if (why) return { ok: false, reason: why };

  god.influence = Math.round((god.influence - def.cost) * 10) / 10;
  god.influenceSpent += def.cost;
  god.interventionsUsed[def.id] = (god.interventionsUsed[def.id] ?? 0) + 1;
  addChaos(god, def.chaos);

  const effect = def.apply(ctx, a, b, areaId);
  ctx.refreshConditions();
  ctx.emit(
    'intervention',
    effect.priority ?? 'notable',
    effect.headline,
    [
      ...effect.detail,
      `${def.name} · ${def.cost} influence · ${def.chaos >= 0 ? '+' : ''}${def.chaos} chaos`,
    ],
    effect.actors,
    effect.tone ?? 'neutral'
  );
  return { ok: true, effect };
}
