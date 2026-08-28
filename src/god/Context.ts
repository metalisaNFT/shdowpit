/**
 * The simulation's working surface for one cycle.
 *
 * Actions do not talk to the manager, the feed and the chronicle separately —
 * they talk to this, which keeps every consequence flowing through one place.
 * That matters more than it looks: it is why a death always writes a memory in
 * the victim's allies, always shakes the house, always reaches the feed, and
 * always reaches the chronicle the rest of the game already reads.
 */

import type { RNG } from '../core/RNG';
import type { AgeModifier } from '../data/ages';
import { getPersonality } from '../data/personalities';
import { chooseTitle } from '../data/names';
import { makeEvent, type WorldEvent, type WorldEventType } from '../world/WorldEvent';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { fullName, rankIndex, type MemoryType, type Nemesis, type ScarId } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar, remember } from '../nemesis/NemesisMemory';
import { makeRivals, purgeReferences, setMaster } from '../nemesis/NemesisRelationships';
import { addCondition, ConditionIndex } from './Conditions';
import { factionFor, shakeFaction } from './Factions';
import { makeFighter } from './Combatant';
import { resolveDuel, type DuelResult } from './Duel';
import { simOf, type ActDef, type Beat, type BeatPriority, type Decision, type GodState } from './GodTypes';

const SCARS: ScarId[] = [
  'burn',
  'missing_eye',
  'broken_mask',
  'metal_jaw',
  'damaged_arm',
  'cracked_armor',
  'corruption',
  'shattered_horn',
];

export type Aftermath =
  | 'killed'
  | 'spared'
  | 'humiliated'
  | 'robbed'
  | 'escaped'
  | 'stalemate'
  | 'imprisoned'
  | 'ransomed'
  | 'recruited';

export interface FightOutcome {
  duel: DuelResult;
  winner: Nemesis;
  loser: Nemesis;
  aftermath: Aftermath;
  upset: boolean;
  /** rendered sentence for the feed */
  headline: string;
  detail: string[];
}

export class GodContext {
  readonly mgr: NemesisManager;
  readonly god: GodState;
  readonly rng: RNG;
  readonly age: AgeModifier;
  readonly act: ActDef;
  cond: ConditionIndex;

  beats: Beat[] = [];
  deaths: string[] = [];
  /**
   * Set for the duration of one character's action. Any beat whose primary
   * actor is that character inherits their reasoning, which is what makes the
   * feed answerable rather than merely readable.
   */
  attributing: Decision | null = null;
  /**
   * Characters the god was propping up who lost anyway this cycle. The single
   * most important thing the tutorial can point at, so it is measured rather
   * than guessed at from the feed text.
   */
  blessedLosers: string[] = [];
  /** ids that already acted this cycle, so nobody acts twice */
  acted = new Set<string>();

  constructor(mgr: NemesisManager, god: GodState, rng: RNG, age: AgeModifier, act: ActDef) {
    this.mgr = mgr;
    this.god = god;
    this.rng = rng;
    this.age = age;
    this.act = act;
    this.cond = new ConditionIndex(god);
  }

  refreshConditions(): void {
    this.cond = new ConditionIndex(this.god);
  }

  get cycle(): number {
    return this.god.cycle;
  }

  living(): Nemesis[] {
    return this.mgr.living();
  }

  name(id: string | null | undefined): string {
    const n = this.mgr.byId(id);
    return n ? fullName(n) : 'SOMEONE';
  }

  /* ============================================================
     output
     ============================================================ */

  emit(
    kind: string,
    priority: BeatPriority,
    headline: string,
    detail: string[],
    actors: string[],
    tone: Beat['tone'] = 'neutral'
  ): Beat {
    const b: Beat = {
      id: 'b' + this.god.nextBeatId.toString(36),
      cycle: this.god.cycle,
      priority,
      headline,
      detail,
      actors,
      tone,
      kind,
    };
    // Only the beat the acting character actually caused inherits their
    // reasoning. A grudge sworn by a bystander during someone else's fight is
    // not explained by the fighter's decision.
    const attr = this.attributing;
    if (attr && attr.chosen && actors[0] === attr.actorId && priority !== 'background') {
      const who = this.mgr.byId(attr.actorId);
      b.why = {
        actorId: attr.actorId,
        actorName: attr.actorName,
        personality: who ? getPersonality(who.personality).name : '',
        actionName: attr.chosen.actionName,
        targetName: attr.chosen.targetName,
        targetKind: attr.chosen.targetKind,
        total: attr.chosen.total,
        parts: attr.chosen.parts,
        marks: attr.chosen.marks ?? [],
        alternatives: attr.considered
          .filter((c) => c.actionId !== attr.chosen!.actionId || c.targetId !== attr.chosen!.targetId)
          .filter((c) => c.total <= attr.chosen!.total)
          .slice(0, 2)
          .map((c) => ({ actionName: c.actionName, targetName: c.targetName, total: c.total })),
      };
      if (attr.rationed) b.why.rationed = attr.rationed;
    }
    this.god.nextBeatId++;
    this.beats.push(b);
    this.god.feed.push(b);
    if (this.god.feed.length > 400) this.god.feed.splice(0, this.god.feed.length - 400);
    return b;
  }

  /** Also write it into the chronicle the rest of the game already reads. */
  chronicle(
    type: WorldEventType,
    text: string,
    actors: string[],
    important = false,
    tone: WorldEvent['tone'] = 'neutral'
  ): WorldEvent {
    return this.mgr.log(makeEvent(this.mgr.turn, this.mgr.age, type, text, actors, important, tone, { known: true }));
  }

  deed(n: Nemesis, text: string, weight = 1): void {
    const s = simOf(n);
    // The same sentence twice is not two deeds. A repeat deepens the one that
    // is already there, which is how "kept walking away from Varock" becomes a
    // single line the Book of Legends can actually use.
    const prior = s.deeds.find((d) => d.text === text);
    if (prior) {
      prior.weight = Math.min(9, prior.weight + 1);
      prior.cycle = this.god.cycle;
      s.reputation = Math.min(200, s.reputation + weight);
      return;
    }
    s.deeds.push({ cycle: this.god.cycle, text, weight });
    if (s.deeds.length > 24) s.deeds.splice(0, s.deeds.length - 24);
    s.reputation = Math.min(200, s.reputation + weight * 3);
  }

  /* ============================================================
     the fight
     ============================================================ */

  fight(a: Nemesis, b: Nemesis, kind: 'duel' | 'challenge' | 'betrayal' | 'hunt' | 'war' = 'duel'): FightOutcome {
    const fa = makeFighter(a, this.age, this.cond.tiltFor(a.id));
    const fb = makeFighter(b, this.age, this.cond.tiltFor(b.id));
    // A knife in the back is a knife in the back.
    if (kind === 'betrayal') fa.tilt.edge = Math.max(fa.tilt.edge, 1.1);
    if (kind === 'hunt') fa.tilt.edge = Math.max(fa.tilt.edge, 0.4);

    const duel = resolveDuel(fa, fb, this.rng);
    const winner = duel.winnerId === a.id ? a : b;
    const loser = duel.loserId === a.id ? a : b;
    const upset = loser.power > winner.power * 1.15;
    if (
      this.cond
        .on(loser.id)
        .some((c) => c.source === 'god' && c.targetId === loser.id && (c.kind === 'blessing' || c.kind === 'ward'))
    ) {
      this.blessedLosers.push(loser.id);
    }

    const ws = simOf(winner);
    const ls = simOf(loser);

    ws.wins++;
    ls.losses++;
    ws.injury = Math.min(100, ws.injury + duel.injuryToWinner);
    ls.injury = Math.min(100, ls.injury + duel.injuryToLoser);
    ws.confidence = Math.min(100, ws.confidence + 6 + (upset ? 12 : 0));
    ls.confidence = Math.max(0, ls.confidence - 9);
    ws.fear = Math.max(0, ws.fear - 4);
    ls.fear = Math.min(100, ls.fear + 11);

    makeRivals(winner, loser);
    trimRivalries(winner);
    trimRivalries(loser);
    remember(winner, 'I_DEFEATED_RIVAL', this.mgr.turn, loser.id);
    remember(loser, 'RIVAL_DEFEATED_ME', this.mgr.turn, winner.id);
    if (upset) {
      remember(winner, 'I_BEAT_A_STRONGER_FOE', this.mgr.turn, loser.id);
      remember(loser, 'I_LOST_TO_A_WEAKER_FOE', this.mgr.turn, winner.id);
      this.deed(winner, `beat ${fullName(loser)}, who was the stronger`, 3);
    }

    winner.level = Math.min(30, winner.level + 1);
    recomputePower(winner);

    const aftermath = duel.ending === 'flight' ? this.handleFlight(winner, loser) : duel.ending === 'stalemate' ? 'stalemate' : this.handleDown(winner, loser, kind);

    const detail: string[] = duel.beats.map((x) => cap(x.text));
    detail.push(
      `${duel.exchanges} exchanges over ${duel.duration}s · ${fullName(winner)} finished on ${Math.round(duel.winnerHp * 100)}% health`
    );
    if (upset) detail.push(`${fullName(winner)} was the weaker on paper. Not today.`);

    const headline = this.fightHeadline(winner, loser, aftermath, kind, upset);
    return { duel, winner, loser, aftermath, upset, headline, detail };
  }

  private handleFlight(winner: Nemesis, loser: Nemesis): Aftermath {
    const ls = simOf(loser);
    ls.flights++;
    ls.fear = Math.min(100, ls.fear + 8);
    if (!ls.escapedFrom.includes(winner.id)) ls.escapedFrom.push(winner.id);
    this.wantRevenge(loser, winner);
    remember(loser, 'I_FLED_FROM', this.mgr.turn, winner.id);
    this.chronicle('enemy_escape', `${fullName(loser)} broke away from ${fullName(winner)}.`, [loser.id, winner.id]);
    return 'escaped';
  }

  /**
   * The fight decided who was standing. THIS decides who they are — and it is
   * the single most story-generating branch in the game.
   */
  private handleDown(winner: Nemesis, loser: Nemesis, kind: string): Aftermath {
    const ws = simOf(winner);
    const ls = simOf(loser);
    const pw = getPersonality(winner.personality);

    let kill = 0.3 * this.act.lethality;
    if (ws.revengeTargets.includes(loser.id)) kill += 0.28;
    if (winner.rivalries.includes(loser.id)) kill += 0.12;
    if (kind === 'betrayal') kill += 0.25;
    if (kind === 'war') kill += 0.12;
    kill += Math.min(0.3, this.cond.weight(loser.id, 'bounty') * 0.22);
    kill -= Math.min(0.42, this.cond.weight(loser.id, 'ward') * 0.34);
    if (winner.personality === 'madman') kill += 0.16;
    if (winner.personality === 'traitor' || winner.personality === 'opportunist') kill += 0.1;
    if (winner.personality === 'loyalist' || winner.personality === 'coward') kill -= 0.16;
    if (winner.personality === 'showoff') kill -= 0.14;
    const fw = factionFor(this.god, winner);
    const fl = factionFor(this.god, loser);
    if (fw && fl && fw.id === fl.id) kill -= 0.3;
    kill = Math.max(0.03, Math.min(0.9, kill));

    if (this.rng.chance(kill)) {
      this.killOff(loser, winner, kind === 'betrayal' ? 'a knife in the dark' : 'the fight');
      return 'killed';
    }

    // Being warded is why they are still breathing — but who put the ward
    // there decides what they learn from it. A god's hand is remembered very
    // differently from an ally's shield.
    const wards = this.cond.on(loser.id).filter((c) => c.kind === 'ward' && c.targetId === loser.id);
    if (wards.length) {
      if (wards.some((c) => c.source === 'god')) {
        remember(loser, 'GOD_SAVED_ME', this.mgr.turn, winner.id);
        this.deed(loser, 'was pulled out of a death they had earned', 3);
      } else {
        this.deed(loser, 'was carried off the field by their own', 1);
      }
    }

    // Alive. So what does the winner do with them?
    const loserValuable = loser.stolen.length > 0 || rankIndex(loser.rank) >= 2;
    if (
      rankIndex(winner.rank) >= 3 &&
      loserValuable &&
      (winner.personality === 'ambitious' || winner.personality === 'collector' || pw.hunt > 1.2) &&
      this.rng.chance(0.28)
    ) {
      if (rankIndex(loser.rank) > 0) this.mgr.demote(loser, `${fullName(winner)} caged them`);
      ls.goal = 'hide';
      ls.fear = Math.min(100, ls.fear + 22);
      remember(loser, 'I_WAS_CAGED_BY', this.mgr.turn, winner.id);
      addCondition(this.god, {
        kind: 'mark',
        targetKind: 'nemesis',
        targetId: loser.id,
        magnitude: 1,
        duration: 4,
        note: `held under ${fullName(winner)}`,
        source: 'world',
      });
      this.wantRevenge(loser, winner);
      this.deed(winner, `caged ${fullName(loser)} as leverage`, 2);
      return 'imprisoned';
    }

    if (
      loser.stolen.length &&
      (winner.personality === 'opportunist' || winner.personality === 'traitor') &&
      this.rng.chance(0.35)
    ) {
      remember(winner, 'I_ROBBED_THEM', this.mgr.turn, loser.id);
      remember(loser, 'I_WAS_ROBBED_BY', this.mgr.turn, winner.id);
      this.wantRevenge(loser, winner);
      ls.confidence = Math.max(0, ls.confidence - 10);
      this.deed(winner, `held ${loser.stolen[0]!.name} over ${fullName(loser)}'s head`, 2);
      return 'ransomed';
    }

    if (
      fw &&
      fl &&
      fw.id === fl.id &&
      (winner.personality === 'loyalist' || winner.personality === 'showoff') &&
      this.rng.chance(0.4)
    ) {
      setMaster(loser, winner);
      remember(loser, 'I_SWORE_TO', this.mgr.turn, winner.id);
      ls.loyalty = Math.min(100, ls.loyalty + 14);
      this.deed(winner, `took ${fullName(loser)} under their wing`, 2);
      return 'recruited';
    }

    if (winner.personality === 'showoff' || (pw.ambition > 1.4 && this.rng.chance(0.5))) {
      loser.humiliations = (loser.humiliations ?? 0) + 1;
      ls.fear = Math.min(100, ls.fear + 16);
      ls.confidence = Math.max(0, ls.confidence - 16);
      ls.reputation = Math.max(-100, ls.reputation - 8);
      this.wantRevenge(loser, winner);
      remember(winner, 'I_HUMILIATED_NEMESIS', this.mgr.turn, loser.id);
      remember(loser, 'I_WAS_HUMILIATED_BY', this.mgr.turn, winner.id);
      this.deed(winner, `left ${fullName(loser)} alive and laughed about it`, 2);
      return 'humiliated';
    }

    if (loser.stolen.length && (pw.steal > 1.1 || this.rng.chance(0.3))) {
      const item = loser.stolen.pop()!;
      winner.stolen.push(item);
      recomputePower(winner);
      recomputePower(loser);
      remember(winner, 'I_ROBBED_THEM', this.mgr.turn, loser.id);
      remember(loser, 'I_WAS_ROBBED_BY', this.mgr.turn, winner.id);
      this.wantRevenge(loser, winner);
      this.deed(winner, `took ${item.name} off ${fullName(loser)}`, 2);
      this.chronicle('weapon_theft', `${fullName(winner)} took ${item.name} from ${fullName(loser)}.`, [winner.id, loser.id], true, 'gold');
      return 'robbed';
    }

    remember(winner, 'I_SPARED_NEMESIS', this.mgr.turn, loser.id);
    remember(loser, 'I_WAS_SPARED_BY', this.mgr.turn, winner.id);
    ls.loyalty = Math.min(100, ls.loyalty + 6);
    // A scar is what "spared" actually means.
    if (this.rng.chance(0.55)) this.scar(loser, fullName(winner));
    return 'spared';
  }

  private fightHeadline(w: Nemesis, l: Nemesis, a: Aftermath, kind: string, upset: boolean): string {
    const W = fullName(w);
    const L = fullName(l);

    // Someone who broke and ran was never run down, and a sentence that says
    // both at once is the kind of thing that makes a generated feed read as
    // generated. The escape gets its own shape.
    if (a === 'escaped') {
      const lines =
        kind === 'betrayal'
          ? [`${W} came at ${L} from behind, and ${L} did not stay to find out how it ended`]
          : kind === 'hunt'
            ? [`${W} caught up with ${L}, who would not stand and fight`]
            : [
                `${L} broke away from ${W} rather than finish it`,
                `${W} had ${L} beaten, and ${L} left`,
                `${L} would not stand in front of ${W}`,
              ];
      return (this.rng.pick(lines) + '.').toUpperCase();
    }

    const opener =
      kind === 'betrayal'
        ? `${W} turned on ${L}`
        : kind === 'challenge'
          ? `${W} challenged ${L}`
          : kind === 'hunt'
            ? `${W} ran ${L} down`
            : kind === 'war'
              ? `${W} met ${L} on the line`
              : `${W} fought ${L}`;
    const tail =
      a === 'killed'
        ? ' and killed them.'
        : a === 'humiliated'
          ? ' and left them breathing, which was worse.'
          : a === 'robbed'
            ? ' and walked off with what they were carrying.'
            : a === 'imprisoned'
              ? ' and kept them alive as a trophy in chains.'
              : a === 'ransomed'
                ? ' and kept what they carried as leverage.'
                : a === 'recruited'
                  ? ' and took them under their wing.'
                  : a === 'spared'
                    ? ' and let them live.'
                    : ' to no conclusion.';
    return (opener + tail + (upset && a !== 'stalemate' ? ` Nobody expected that.` : '')).toUpperCase();
  }

  /* ============================================================
     consequences
     ============================================================ */

  /**
   * Wanting somebody dead is not a list entry, it is a plan. A character who
   * has been humiliated, robbed, betrayed or driven off does not merely record
   * the fact — it becomes what they are trying to do, and `goalAge` then makes
   * it louder every cycle they fail to act on it. That is the difference
   * between a grudge and a long grudge.
   */
  wantRevenge(actor: Nemesis, target: Nemesis): void {
    if (actor.id === target.id) return;
    const s = simOf(actor);
    if (!s.revengeTargets.includes(target.id)) s.revengeTargets.push(target.id);
    if (s.revengeTargets.length > 4) s.revengeTargets.shift();
    // A standing revenge against somebody else is not overwritten lightly; the
    // older grudge has to have gone cold first.
    if (s.goal === 'revenge' && s.goalTargetId && s.goalTargetId !== target.id && s.goalAge < 6) return;
    s.goal = 'revenge';
    s.goalTargetId = target.id;
    s.goalAge = 0;
  }

  scar(n: Nemesis, cause: string): string | null {
    const label = applyScar(n, this.rng.pick(SCARS), this.mgr.turn, cause);
    if (!label) return null;
    n.title = chooseTitle(n, this.mgr.titlesInUse(n));
    recomputePower(n);
    return label;
  }

  killOff(victim: Nemesis, killer: Nemesis | null, cause: string): void {
    if (!victim.alive) return;
    const vs = simOf(victim);
    vs.killedById = killer ? killer.id : null;

    // Loot moves. This is how a stolen weapon keeps travelling.
    if (victim.stolen.length && killer) {
      const item = victim.stolen.pop()!;
      killer.stolen.push(item);
      recomputePower(killer);
      this.chronicle('weapon_theft', `${fullName(killer)} took ${item.name} off the body.`, [killer.id, victim.id], true, 'gold');
    }

    if (killer) {
      const ks = simOf(killer);
      ks.kills.push(victim.id);
      ks.reputation = Math.min(200, ks.reputation + 6 + rankIndex(victim.rank) * 4);
      ks.confidence = Math.min(100, ks.confidence + 8);
      remember(killer, 'I_KILLED_NEMESIS', this.mgr.turn, victim.id);
      this.deed(killer, `killed ${fullName(victim)}`, 2 + rankIndex(victim.rank));
      ks.revengeTargets = ks.revengeTargets.filter((x) => x !== victim.id);
    }

    this.mgr.killNemesis(victim, false, killer ? `${fullName(killer)} killed ${fullName(victim)}.` : `${fullName(victim)} died — ${cause}.`);
    this.deaths.push(victim.id);
    shakeFaction(this.god, vs.factionId, -8 - rankIndex(victim.rank) * 4);

    // The people who cared take it personally. This is where revenge chains
    // start, and they start whether or not anyone is watching.
    for (const aid of victim.allies) {
      const ally = this.mgr.byId(aid);
      if (!ally || !ally.alive || !killer) continue;
      const pa = getPersonality(ally.personality);
      if (ally.master === victim.id) remember(ally, 'MY_MASTER_FELL', this.mgr.turn, victim.id);
      if (pa.revenge > 1.2 || ally.master === victim.id || this.rng.chance(0.35)) {
        makeRivals(ally, killer);
        this.wantRevenge(ally, killer);
        this.emit(
          'grudge',
          'notable',
          `${fullName(ally)} SWORE TO ANSWER FOR ${fullName(victim)}.`,
          [`${fullName(ally)} will be looking for ${fullName(killer)} from now on.`],
          [ally.id, killer.id],
          'bad'
        );
      }
    }

    // Anyone who was hunting the dead has to find something else to want.
    for (const other of this.mgr.living()) {
      const os = simOf(other);
      os.revengeTargets = os.revengeTargets.filter((x) => x !== victim.id);
      if (os.goalTargetId === victim.id) {
        os.goalTargetId = null;
        os.goal = 'survive';
        os.goalAge = 0;
      }
    }
  }

  /** Permanently remove someone the world has finished with. */
  erase(n: Nemesis): void {
    purgeReferences(this.mgr.data.nemeses, n.id);
    this.mgr.data.nemeses = this.mgr.data.nemeses.filter((x) => x.id !== n.id);
  }

  rememberBetween(a: Nemesis, type: MemoryType, b: Nemesis): void {
    remember(a, type, this.mgr.turn, b.id);
  }
}

/**
 * Everyone fights everyone eventually, and a character who is the rival of
 * eleven people is the rival of nobody. Keep the most recent handful.
 */
const MAX_RIVALRIES = 5;
function trimRivalries(n: Nemesis): void {
  if (n.rivalries.length > MAX_RIVALRIES) n.rivalries.splice(0, n.rivalries.length - MAX_RIVALRIES);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
