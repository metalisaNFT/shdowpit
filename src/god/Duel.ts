/**
 * Headless combat between two characters.
 *
 * This is not a comparison of two `power` integers with a random tiebreak. It
 * is a real exchange stepped at 120ms, using the game's own attack table,
 * weapon reach and damage, trait modifiers, posture, flee thresholds and
 * personality nerve. Two characters with identical `power` fight completely
 * differently if one is a heavy with a club and the other a duelist with a
 * spear, and that difference is where the stories come from.
 *
 * It deliberately does NOT decide what happens to the loser. A fight ends with
 * someone on the ground; whether they are killed, spared, humiliated or robbed
 * is a decision the actor makes afterwards, and that decision is the story.
 */

import type { RNG } from '../core/RNG';
import { chooseAttack, type EnemyAttackDef } from '../data/attacks';
import { TELEGRAPH } from '../data/balance';
import type { Fighter } from './Combatant';
import { fleeThreshold } from './Combatant';

const STEP = 0.12;
const MAX_TIME = 42;
const START_DISTANCE = 7;

export type DuelEnding = 'down' | 'flight' | 'stalemate';

export interface DuelBeat {
  t: number;
  /** rendered fragment, e.g. "took a club to the ribs" */
  text: string;
  actorId: string;
  kind: 'open' | 'break' | 'parry' | 'crush' | 'turn' | 'flee' | 'finish' | 'stand';
}

export interface DuelResult {
  aId: string;
  bId: string;
  winnerId: string;
  loserId: string;
  ending: DuelEnding;
  /** winner health remaining, 0..1 */
  winnerHp: number;
  loserHp: number;
  /** how one-sided it was, 0..1 */
  margin: number;
  duration: number;
  exchanges: number;
  beats: DuelBeat[];
  /** posture breaks suffered by the loser */
  breaks: number;
  /** the loser answered a blow with a parry at least once */
  loserFoughtWell: boolean;
  injuryToLoser: number;
  injuryToWinner: number;
}

interface Side {
  f: Fighter;
  escape: number;
  /** free window at the start, bought by a condition */
  edge: number;
}

export function resolveDuel(a: Fighter, b: Fighter, rng: RNG): DuelResult {
  const A: Side = { f: a, escape: 0, edge: a.tilt.edge };
  const B: Side = { f: b, escape: 0, edge: b.tilt.edge };
  const beats: DuelBeat[] = [];
  let dist = START_DISTANCE;
  let t = 0;
  let exchanges = 0;
  let breaksA = 0;
  let breaksB = 0;
  let parriedA = false;
  let parriedB = false;

  // An edge is a head start, not a win: the other side simply cannot act yet.
  if (A.edge > 0) B.f.busy = Math.min(1.6, A.edge);
  if (B.edge > 0) A.f.busy = Math.min(1.6, B.edge);

  beats.push({
    t: 0,
    text: openingLine(a, b, rng),
    actorId: a.id,
    kind: 'open',
  });

  let ending: DuelEnding = 'stalemate';
  let escapedId: string | null = null;
  let endT = 0;

  while (t < MAX_TIME) {
    t += STEP;

    for (const [me, you] of [
      [A, B],
      [B, A],
    ] as Array<[Side, Side]>) {
      const f = me.f;
      const o = you.f;
      if (f.hp <= 0 || o.hp <= 0) continue;

      if (f.brokenTimer > 0) {
        f.brokenTimer -= STEP;
        if (f.brokenTimer <= 0) {
          f.broken = false;
          f.posture = 0;
        }
        continue;
      }

      f.busy -= STEP;
      if (f.busy > 0) continue;

      /* ---- leaving ---- */
      const thresh = fleeThreshold(f);
      if (!f.fleeing && thresh >= 0 && f.hp / f.maxHp < thresh) {
        f.fleeing = true;
        beats.push({ t, text: `${f.name} broke and ran`, actorId: f.id, kind: 'flee' });
      }
      if (f.fleeing) {
        // Speed is the whole question. A heavy running from a duelist is not
        // running anywhere.
        me.escape += (f.speed - o.speed * 0.92) * STEP + 0.12;
        dist += Math.max(0.4, f.speed * STEP * 0.7);
        f.busy = STEP;
        if (me.escape > 3.2 || dist > 22) {
          ending = 'flight';
          escapedId = f.id;
          endT = t;
          t = MAX_TIME;
          break;
        }
        continue;
      }

      /* ---- a broken opponent is an open invitation ---- */
      if (o.broken) {
        const dmg = f.damage * 1.9 * incoming(o, 'heavy', true);
        o.hp -= dmg;
        f.landed++;
        f.biggestHit = Math.max(f.biggestHit, dmg);
        o.brokenTimer = Math.max(0.25, o.brokenTimer - 0.5);
        f.busy = 0.7;
        exchanges++;
        if (dmg > o.maxHp * 0.2) {
          beats.push({ t, text: `${f.name} punished the opening`, actorId: f.id, kind: 'crush' });
        }
        continue;
      }

      /* ---- choose something that actually makes sense from here ---- */
      const reach = f.weapon.reach;
      const def = chooseAttack({
        archetype: f.archetype,
        rankIndex: f.rankIdx,
        distance: dist,
        reach,
        aggression: f.personality.aggression,
        allowUnblockable: f.rankIdx >= 2,
        allowDelayed: f.rankIdx >= 2,
        rand: () => rng.next(),
      });

      if (!def) {
        // Out of position for everything it owns — so it repositions, which is
        // why archers back off and heavies close in without being told to.
        const want = preferredRange(f);
        const move = f.speed * STEP * 2.4;
        dist += dist > want ? -Math.min(move, dist - want) : Math.min(move, want - dist);
        dist = Math.max(1.1, dist);
        f.busy = 0.24;
        continue;
      }

      exchanges++;
      const anticipation = Math.max(TELEGRAPH.minAnticipation, def.anticipation) + def.delay;
      f.busy = anticipation + def.active + def.recovery;
      f.lastAttackId = def.id;
      f.hits++;
      if (def.lunge > 0) dist = Math.max(1.1, dist - def.lunge * def.active * 3);

      /* ---- the answer ---- */
      const answer = react(o, def, rng);
      if (answer === 'dodge') {
        dist = Math.min(14, dist + 0.9);
        continue;
      }
      if (answer === 'parry') {
        o.parries++;
        if (o === A.f) parriedA = true;
        else parriedB = true;
        f.posture += f.postureMax * 0.34;
        f.busy += 0.45;
        beats.push({ t, text: `${o.name} turned ${f.name}'s blade`, actorId: o.id, kind: 'parry' });
        if (f.posture >= f.postureMax) {
          f.broken = true;
          f.brokenTimer = 1.3;
          if (f === A.f) breaksA++;
          else breaksB++;
          beats.push({ t, text: `${f.name}'s guard came apart`, actorId: f.id, kind: 'break' });
        }
        continue;
      }
      if (answer === 'block') {
        o.posture += f.weapon.stagger * def.postureMul * 0.4 * (1 - o.mods.staggerResist);
        continue;
      }

      /* ---- it lands ---- */
      const source = def.damageMul > 1.15 ? 'heavy' : def.ranged ? 'ranged' : 'light';
      let dmg = f.damage * def.damageMul * def.hits * incoming(o, source, false);
      if (o.hp / o.maxHp < 0.3) dmg *= Math.max(1, f.personality.desperation * 0.35 + 0.65);
      o.hp -= dmg;
      f.landed++;
      f.biggestHit = Math.max(f.biggestHit, dmg);

      o.posture += f.weapon.stagger * def.postureMul * (1 - o.mods.staggerResist);
      if (o.posture >= o.postureMax && !o.broken) {
        o.broken = true;
        o.brokenTimer = 1.35;
        if (o === A.f) breaksA++;
        else breaksB++;
        beats.push({ t, text: `${f.name} broke ${o.name}'s guard`, actorId: f.id, kind: 'break' });
      } else if (dmg > o.maxHp * 0.22) {
        beats.push({ t, text: `${f.name} landed something that told`, actorId: f.id, kind: 'crush' });
      }

      // Counterstrike is a trait, and it is meant to punish greed.
      if (o.mods.counterChance > 0 && rng.chance(o.mods.counterChance) && !o.broken) {
        const c = o.damage * 0.8 * incoming(f, 'light', false);
        f.hp -= c;
        o.landed++;
        beats.push({ t, text: `${o.name} answered in the same breath`, actorId: o.id, kind: 'turn' });
      }

      if (o.hp <= 0) {
        ending = 'down';
        endT = t;
        t = MAX_TIME;
        break;
      }
    }

    // Posture recovers when nobody is pressing.
    A.f.posture = Math.max(0, A.f.posture - A.f.postureMax * 0.09 * STEP);
    B.f.posture = Math.max(0, B.f.posture - B.f.postureMax * 0.09 * STEP);
    if (A.f.hp <= 0 || B.f.hp <= 0) {
      ending = 'down';
      if (!endT) endT = t;
      break;
    }
  }

  if (!endT) endT = Math.min(t, MAX_TIME);

  /* ---- who came out of it ---- */
  const aFrac = A.f.hp / A.f.maxHp;
  const bFrac = B.f.hp / B.f.maxHp;
  let winner: Fighter;
  let loser: Fighter;
  if (ending === 'flight') {
    loser = escapedId === a.id ? a : b;
    winner = loser === a ? b : a;
  } else if (ending === 'down') {
    winner = A.f.hp <= 0 ? b : a;
    loser = winner === a ? b : a;
  } else {
    winner = aFrac >= bFrac ? a : b;
    loser = winner === a ? b : a;
  }

  const wFrac = Math.max(0, winner === a ? aFrac : bFrac);
  const lFrac = Math.max(0, loser === a ? aFrac : bFrac);
  const margin = Math.min(1, Math.max(0, wFrac - lFrac));

  if (ending === 'down') {
    beats.push({ t: endT, text: `${loser.name} went down`, actorId: winner.id, kind: 'finish' });
  } else if (ending === 'stalemate') {
    beats.push({ t: endT, text: 'neither of them could finish it', actorId: winner.id, kind: 'stand' });
  }

  const takenLoser = 1 - lFrac;
  const takenWinner = 1 - wFrac;
  const loserBreaks = loser === a ? breaksA : breaksB;

  return {
    aId: a.id,
    bId: b.id,
    winnerId: winner.id,
    loserId: loser.id,
    ending,
    winnerHp: wFrac,
    loserHp: lFrac,
    margin,
    duration: Math.round(endT * 10) / 10,
    exchanges,
    beats: curate(beats),
    breaks: loserBreaks,
    loserFoughtWell: (loser === a ? parriedA : parriedB) || lFrac > 0.28,
    injuryToLoser: Math.round(takenLoser * 46 + loserBreaks * 5),
    injuryToWinner: Math.round(takenWinner * 26),
  };

  /* ---- local helpers, so the numbers stay next to their use ---- */

  function incoming(target: Fighter, source: 'light' | 'heavy' | 'ranged', fromBehind: boolean): number {
    let mul = target.mods.armour * target.tilt.armour;
    if (source === 'light') mul *= target.mods.vsLight;
    else if (source === 'heavy') mul *= target.mods.vsHeavy;
    else mul *= target.mods.vsRanged;
    if (fromBehind && !target.mods.rearGuard) mul *= target.mods.vsBack;
    return mul;
  }

  function react(target: Fighter, def: EnemyAttackDef, r: RNG): 'hit' | 'dodge' | 'block' | 'parry' {
    if (target.broken) return 'hit';
    if (def.intent !== 'unblockable') {
      // Skill at turning a blade is rank and archetype, not luck alone.
      let parry = 0.05 + target.rankIdx * 0.035;
      if (target.archetype === 'duelist') parry += 0.09;
      if (target.archetype === 'commander') parry += 0.04;
      if (def.intent === 'parryable') parry += 0.08;
      if (def.delay > 0) parry *= 0.45;
      parry *= 0.55 + (target.hp / target.maxHp) * 0.6;
      if (r.chance(parry)) return 'parry';
    }
    if (target.mods.dodgeChance > 0 && r.chance(target.mods.dodgeChance)) return 'dodge';
    if (target.mods.blockChance > 0 && r.chance(target.mods.blockChance)) return 'block';
    return 'hit';
  }
}

/**
 * A duel produces dozens of small moments. A story needs four. Keep the
 * opening, the ending, and the most distinct things that happened between —
 * one per kind, so five parries do not read as five separate events.
 */
function curate(all: DuelBeat[]): DuelBeat[] {
  const open = all.find((b) => b.kind === 'open');
  const close = all.filter((b) => b.kind === 'finish' || b.kind === 'stand' || b.kind === 'flee').pop();
  const seen = new Set<string>();
  const middle: DuelBeat[] = [];
  for (const b of all) {
    if (b === open || b === close) continue;
    const key = b.kind + ':' + b.actorId;
    if (seen.has(key)) continue;
    seen.add(key);
    middle.push(b);
  }
  const ORDER: Record<string, number> = { break: 0, crush: 1, turn: 2, parry: 3, flee: 4, stand: 5 };
  middle.sort((x, y) => (ORDER[x.kind] ?? 9) - (ORDER[y.kind] ?? 9));
  const out: DuelBeat[] = [];
  if (open) out.push(open);
  out.push(...middle.slice(0, 3).sort((x, y) => x.t - y.t));
  if (close) out.push(close);
  return out;
}

function preferredRange(f: Fighter): number {
  if (f.archetype === 'archer') return Math.min(16, f.weapon.reach * 0.45);
  if (f.archetype === 'heavy') return f.weapon.reach * 0.8;
  return f.weapon.reach * 0.9;
}

function openingLine(a: Fighter, b: Fighter, rng: RNG): string {
  const options = [
    `${a.name} and ${b.name} came together`,
    `${b.name} did not step back`,
    `neither of them looked for a way out`,
    `${a.name} moved first`,
  ];
  return rng.pick(options);
}
