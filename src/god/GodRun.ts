/**
 * The run controller.
 *
 * Owns the cycle, the phases, the two resources and the ending. Everything
 * else in `src/god/` is a pure-ish system that this drives; keeping the state
 * machine in one file is what stops the god layer from turning into another
 * Game.ts.
 */

import { RNG, mixSeed, randomSeed } from '../core/RNG';
import type { NemesisManager } from '../nemesis/NemesisManager';
import { fullName, rankIndex, type Nemesis } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { AREA_NAMES } from '../data/names';
import { getPersonality } from '../data/personalities';
import { actForCycle, advanceAct, effectiveAct, getAct, actIndex, RUN_DEADLINE } from './Arc';
import { addCondition } from './Conditions';
import { GodContext } from './Context';
import { birthCrisis, crisisLabel, crisisTick } from './Crisis';
import { seedFactions, livingFactions } from './Factions';
import { chaosTier, decayChaos, INFLUENCE, regenInfluence } from './Influence';
import {
  availableInterventions,
  performIntervention,
  INTERVENTION_MAP,
  type InterventionDef,
  type SpendResult,
} from './Interventions';
import { applyLegacies, harvestLegends, recordLegends } from './Legends';
import { simulateCycle } from './Autonomy';
import { buildSituations } from './Situations';
import { evaluateUnlocks, startingConditions, type StartingConditions } from './Unlocks';
import { buildAftermath, intentionFromLastMove, type CycleSpend } from './Aftermath';
import { actIntention, defaultDescentBrief, pickOpeningFocus, stageTowerCommander } from './Opening';
import {
  GOD_STATE_VERSION,
  simOf,
  type AftermathReport,
  type Beat,
  type CycleSummary,
  type DescentBrief,
  type GodPhase,
  type GodState,
  type LegacyEcho,
  type RunOutcome,
  type Situation,
} from './GodTypes';

export interface GodRunHooks {
  /** new beats produced by whatever just happened */
  onBeats?(beats: Beat[]): void;
  onPhase?(phase: GodPhase): void;
  onCycle?(cycle: number): void;
  onEnd?(outcome: RunOutcome): void;
  /** ask the owner to write the save */
  persist?(): void;
}

export interface AffordableIntervention {
  def: InterventionDef;
  affordable: boolean;
}

export function emptyGodState(seed: number, run: number, bonus = 0): GodState {
  return {
    version: GOD_STATE_VERSION,
    run,
    seed,
    rngState: seed >>> 0,
    cycle: 1,
    phase: 'observe',
    act: 'early',
    influence: INFLUENCE.start + bonus,
    influenceMax: INFLUENCE.max + bonus,
    chaos: 0,
    chaosPeak: 0,
    conditions: [],
    nextConditionId: 1,
    factions: [],
    nextFactionId: 1,
    crisis: null,
    championId: null,
    feed: [],
    nextBeatId: 1,
    situations: [],
    decisions: [],
    interventionsUsed: {},
    influenceSpent: 0,
    descents: 0,
    pendingDescent: null,
    focusSituationId: null,
    openingDone: false,
    boardUnlocked: false,
    lastAftermath: null,
    lastDescentReport: null,
    scenarioFlags: { towerCommander: false },
    history: [],
    legacyEchoes: [],
    ended: false,
    outcome: null,
  };
}

/** Older saves used a string pendingDescent and lacked disclosure fields. */
export function migrateGodState(raw: GodState): GodState {
  const g = raw as GodState & { pendingDescent?: DescentBrief | string | null };
  if (!g.scenarioFlags) g.scenarioFlags = { towerCommander: false };
  if (g.focusSituationId === undefined) g.focusSituationId = null;
  if (g.openingDone === undefined) g.openingDone = g.cycle > 1;
  if (g.boardUnlocked === undefined) g.boardUnlocked = g.cycle > 2 || g.openingDone;
  if (g.lastAftermath === undefined) g.lastAftermath = null;
  if (g.lastDescentReport === undefined) g.lastDescentReport = null;
  if (!g.legacyEchoes) g.legacyEchoes = [];
  if (typeof g.pendingDescent === 'string') {
    g.pendingDescent = {
      nemesisId: g.pendingDescent,
      reason: 'You chose to descend',
      goal: 'Confront them in person',
      situationId: null,
      conditionNote: 'Exposure',
      cyclesWhileGone: 2,
      scenario: 'hunt',
    };
  } else if (g.pendingDescent === undefined) {
    g.pendingDescent = null;
  }
  g.version = GOD_STATE_VERSION;
  return g;
}

export class GodRun {
  readonly mgr: NemesisManager;
  god: GodState;
  private rng: RNG;
  private hooks: GodRunHooks;
  private start: StartingConditions;
  /** echoes of previous runs, shown once on the first board */
  echoes: LegacyEcho[] = [];

  constructor(mgr: NemesisManager, hooks: GodRunHooks = {}) {
    this.mgr = mgr;
    this.hooks = hooks;
    this.start = startingConditions(mgr.data.godUnlocks ?? []);
    this.god = emptyGodState(randomSeed(), (mgr.data.godHistory?.runs ?? 0) + 1, this.start.influenceBonus);
    this.rng = new RNG(this.god.rngState);
  }

  /* ============================================================
     lifecycle
     ============================================================ */

  /** Begin a fresh run against the world that is already in the save. */
  begin(seed = randomSeed()): void {
    const unlocked = this.mgr.data.godUnlocks ?? [];
    this.start = startingConditions(unlocked);
    this.god = emptyGodState(seed, (this.mgr.data.godHistory?.runs ?? 0) + 1, this.start.influenceBonus);
    this.rng = new RNG(mixSeed(seed, 0x9e37));

    this.mgr.fillRanks();
    seedFactions(this.god, this.mgr, this.rng);
    stageTowerCommander(this.mgr, this.god, this.rng);

    if (this.start.brokenOrder) this.breakTheOrder();
    this.echoes = applyLegacies(this.mgr, this.god, this.mgr.data.legends ?? [], this.rng);
    this.god.legacyEchoes = this.echoes;
    if (this.start.patron) this.appointPatron();

    for (const n of this.mgr.living()) {
      const s = simOf(n);
      const p = getPersonality(n.personality);
      s.ambition = clamp(s.ambition + (this.start.hungry ? 20 : 0) + this.rng.int(-10, 15));
      s.confidence = clamp(s.confidence + this.rng.int(-12, 12));
      // Loyalty is a fact about who they are, not a flat starting number. A
      // world where every bond begins equally solid never produces a betrayal
      // worth watching.
      s.loyalty = clamp(30 + (2 - p.betray) * 25 + this.rng.int(-10, 10));
      s.lastCycle = 0;
    }

    const ctx = this.context();
    const intent = actIntention('early');
    ctx.emit(
      'run',
      'legendary',
      `THE LONG GAME — RUN ${this.god.run}`,
      [
        `${this.mgr.living().length} named characters. ${livingFactions(this.god).length} houses.`,
        intent.body,
        'You cannot move anyone. You can only change what it costs them to move themselves.',
      ],
      [],
      'gold'
    );
    for (const e of this.echoes) {
      ctx.emit('legacy', 'major', e.headline, [e.detail], e.actorId ? [e.actorId] : [], 'gold');
    }
    this.flush(ctx);
    this.openCycle(ctx);
    this.lockOpeningFocus();
    this.god.situations = buildSituations(this.context());
    this.persist();
  }

  /** Resume a run held in the save. */
  resume(state: GodState): void {
    this.god = migrateGodState(state);
    this.god.decisions = this.god.decisions ?? [];
    this.rng = new RNG(state.rngState || state.seed);
    this.start = startingConditions(this.mgr.data.godUnlocks ?? []);
    this.echoes = this.god.legacyEchoes ?? [];
    const ctx = this.context();
    this.god.situations = buildSituations(ctx);
    if (!this.god.focusSituationId && !this.god.openingDone) this.lockOpeningFocus();
  }

  private lockOpeningFocus(): void {
    const focus = pickOpeningFocus(this.god.situations);
    this.god.focusSituationId = focus?.id ?? null;
    this.god.openingDone = false;
    this.god.boardUnlocked = false;
  }

  /** Player acknowledged the opening or made their first move. */
  markOpeningProgress(unlockBoard = false): void {
    this.god.openingDone = true;
    if (unlockBoard || this.god.cycle >= 3) this.god.boardUnlocked = true;
    this.persist();
  }

  clearAftermath(): void {
    this.god.lastAftermath = null;
    this.persist();
  }

  clearDescentReport(): void {
    this.god.lastDescentReport = null;
    this.persist();
  }

  private pendingSpends: CycleSpend[] = [];
  private advancedQuiet = false;
  lastBlessedLosers: string[] = [];
  lastCycleBeats: Beat[] = [];

  get spentThisCycle(): boolean {
    return this.pendingSpends.length > 0;
  }

  private breakTheOrder(): void {
    // THE BROKEN ORDER: no seat, and more houses than there is room for.
    const ov = this.mgr.overlord();
    if (ov) this.mgr.demote(ov, 'the order was broken before it began');
    for (let i = 0; i < this.start.extraFactions; i++) {
      const cap = this.mgr.ofRank('captain').find((n) => !simOf(n).factionId || this.rng.chance(0.5));
      if (!cap) break;
      seedExtraHouse(this.god, cap, this.rng);
    }
  }

  private appointPatron(): void {
    const pool = this.mgr.living().filter((n) => rankIndex(n.rank) <= 2);
    if (!pool.length) return;
    const who = pool[this.rng.int(0, pool.length - 1)];
    const s = simOf(who);
    s.ambition = Math.min(100, s.ambition + 30);
    s.confidence = Math.min(100, s.confidence + 20);
    addCondition(this.god, {
      kind: 'blessing',
      targetKind: 'nemesis',
      targetId: who.id,
      magnitude: 1,
      duration: 4,
      note: 'yours from the first cycle',
    });
    this.god.championId = who.id;
  }

  /* ============================================================
     the cycle
     ============================================================ */

  private context(): GodContext {
    return new GodContext(this.mgr, this.god, this.rng, this.mgr.mods, effectiveAct(this.god));
  }

  private flush(ctx: GodContext): void {
    if (ctx.beats.length) this.hooks.onBeats?.(ctx.beats);
    this.god.rngState = this.rng.state;
  }

  private setPhase(p: GodPhase): void {
    this.god.phase = p;
    this.hooks.onPhase?.(p);
  }

  /** OBSERVE: hand the player a readable board and something to spend. */
  private openCycle(ctx: GodContext): void {
    this.setPhase('observe');
    const act = advanceAct(this.god);
    if (act) {
      ctx.emit('act', 'legendary', `${act.name}`, [act.blurb, `Cycle ${this.god.cycle}.`], [], 'gold');
      ctx.chronicle('age_begins', act.name, [], true, 'gold');
    }
    this.maybeBirthCrisis(ctx);
    this.god.situations = buildSituations(ctx);
    this.hooks.onCycle?.(this.god.cycle);
    this.flush(ctx);
  }

  /**
   * INTERFERE → SIMULATE → CONSEQUENCES → next OBSERVE.
   * This is the only way the world moves.
   */
  advanceCycle(): Beat[] {
    if (this.god.ended) return [];
    const ctx = this.context();
    const focusActors = this.focusActorIds();

    this.setPhase('simulate');
    const result = simulateCycle(ctx);
    this.god.decisions = result.decisions;
    this.lastBlessedLosers = result.blessedLosers;
    crisisTick(ctx);

    this.setPhase('consequences');
    for (const d of result.decisions) {
      if (!d.rationed) continue;
      ctx.emit(
        'sim',
        'notable',
        `${d.actorName} rationed — fight budget spent`,
        [
          `Wanted ${d.rationed.actionName} on ${d.rationed.targetName}, did ${d.chosen?.actionName ?? 'something else'} instead.`,
        ],
        [d.actorId]
      );
    }
    const legendary = ctx.beats.filter((b) => b.priority === 'legendary').length;
    const major = ctx.beats.filter((b) => b.priority === 'major').length;
    this.god.history.push(summarise(this.god, ctx, result.deaths.length));
    if (this.god.history.length > 60) this.god.history.shift();

    this.mgr.data.worldTurn++;
    this.flush(ctx);

    this.lastCycleBeats = ctx.beats.slice();

    const ended = this.checkEnd(ctx);
    if (ended) {
      this.persist();
      return ctx.beats;
    }

    /* ---- the next cycle opens ---- */
    const finishedCycle = this.god.cycle;
    this.god.cycle++;
    decayChaos(this.god);
    const regen = regenInfluence(this.god, {
      actIndex: actIndex(this.god.act),
      legendaryBeats: legendary,
      majorBeats: major,
      deaths: result.deaths.length,
    });
    const next = this.context();
    if (regen.gained > 0) {
      next.emit('influence', 'background', `+${regen.gained} INFLUENCE.`, regen.reasons, []);
    }
    this.openCycle(next);

    const intention = intentionFromLastMove(this.pendingSpends, this.advancedQuiet);
    const spendTargetIds = this.pendingSpends.flatMap((s) => s.targetIds);
    this.god.lastAftermath = buildAftermath({
      ctx: next,
      god: this.god,
      beats: ctx.beats,
      decisions: result.decisions,
      intention,
      focusActorIds: focusActors,
      spendTargetIds,
      finishedCycle,
    });
    this.pendingSpends = [];
    this.advancedQuiet = false;
    this.markOpeningProgress(this.god.cycle >= 3);

    this.persist();
    return [...ctx.beats, ...next.beats];
  }

  private focusActorIds(): string[] {
    const sit = this.god.situations.find((s) => s.id === this.god.focusSituationId);
    if (sit?.actors.length) return [...sit.actors];
    return this.god.conditions.filter((c) => c.source === 'god').map((c) => c.targetId);
  }

  /** Run cycles with no interference. Used by acceleration and by tests. */
  fastForward(cycles: number): Beat[] {
    const out: Beat[] = [];
    for (let i = 0; i < cycles && !this.god.ended; i++) out.push(...this.advanceCycle());
    return out;
  }

  /**
   * Player ADVANCE / ×N. If Influence was already spent this cycle, the
   * aftermath keeps that spend even when later skip-cycles have none.
   */
  advanceMany(n: number): { beats: Beat[]; cycles: number } {
    const voice = this.pendingSpends.length ? intentionFromLastMove(this.pendingSpends, false) : null;
    const quietSkip = this.advancedQuiet && !voice;
    const beats: Beat[] = [];
    let cycles = 0;
    for (let i = 0; i < n && !this.god.ended; i++) {
      if (quietSkip) this.advancedQuiet = true;
      beats.push(...this.advanceCycle());
      cycles++;
    }
    if (voice) this.revoiceAftermath(voice);
    return { beats, cycles };
  }

  private revoiceAftermath(intention: string): void {
    const a = this.god.lastAftermath;
    if (!a) return;
    a.intention = intention;
  }

  /* ============================================================
     interference
     ============================================================ */

  interventions(): AffordableIntervention[] {
    const unlocked = this.mgr.data.godUnlocks ?? [];
    return availableInterventions(unlocked).map((def) => ({
      def,
      affordable: this.god.influence >= def.cost,
    }));
  }

  intervene(id: string, aId: string | null, bId: string | null, areaId: string | null): SpendResult {
    const def = INTERVENTION_MAP.get(id);
    if (!def) return { ok: false, reason: 'No such intervention.' };
    const unlocked = this.mgr.data.godUnlocks ?? [];
    if (def.requires && !unlocked.includes(def.requires)) return { ok: false, reason: 'Not unlocked.' };
    const ctx = this.context();
    this.setPhase('interfere');
    const a = this.mgr.byId(aId);
    const b = this.mgr.byId(bId);
    const res = performIntervention(ctx, def, a, b, areaId);
    if (res.ok) {
      this.trackChampion(aId);
      this.god.situations = buildSituations(ctx);
      this.pendingSpends.push({
        name: def.name,
        targetNames: [a, b].filter(Boolean).map((n) => fullName(n!)),
        targetIds: [aId, bId].filter((id): id is string => !!id),
      });
      this.advancedQuiet = false;
      if (id === 'descend' && a && this.god.pendingDescent) {
        const sit =
          this.god.situations.find((s) => s.id === this.god.focusSituationId) ??
          this.god.situations.find((s) => s.actors.includes(a.id)) ??
          null;
        this.god.pendingDescent = defaultDescentBrief(a, this.god, sit);
      }
    }
    this.flush(ctx);
    if (res.ok) this.persist();
    return res;
  }

  /** Advance with no spend — autonomy is the move. Ignored if you already spent. */
  noteQuietAdvance(): void {
    if (this.pendingSpends.length) return;
    this.advancedQuiet = true;
  }

  getAftermath(): AftermathReport | null {
    return this.god.lastAftermath;
  }

  getPendingDescent(): DescentBrief | null {
    return this.god.pendingDescent;
  }

  refreshSituations(): void {
    this.god.situations = buildSituations(this.context());
  }

  intentionBlurb() {
    return actIntention(this.god.act);
  }

  /**
   * The champion is not chosen, it is noticed: whoever the player has spent
   * the most on. It is what the end-of-run summary is written about.
   */
  private trackChampion(id: string | null): void {
    if (!id) return;
    const n = this.mgr.byId(id);
    if (!n) return;
    const invested = this.god.conditions.filter(
      (c) => c.targetId === id && c.source === 'god' && (c.kind === 'blessing' || c.kind === 'ward' || c.kind === 'opportunity')
    ).length;
    if (!this.god.championId) {
      if (invested > 0) this.god.championId = id;
      return;
    }
    const cur = this.god.conditions.filter((c) => c.targetId === this.god.championId && c.source === 'god').length;
    if (invested > cur) this.god.championId = id;
  }

  /* ============================================================
     the crisis and the end
     ============================================================ */

  private maybeBirthCrisis(ctx: GodContext): void {
    if (this.god.crisis) return;
    const living = ctx.living();
    if (living.length < 3) return;
    const byPower = living.slice().sort((a, b) => b.power - a.power);
    const runaway = byPower[1] ? byPower[0].power > byPower[1].power * 2.1 : false;
    const due = this.god.cycle >= getAct('crisis').from;
    const boiling = this.god.chaos >= 85;
    if (!due && !runaway && !boiling) return;
    birthCrisis(ctx);
  }

  private checkEnd(ctx: GodContext): boolean {
    const crisis = this.god.crisis;
    if (crisis && crisis.resolved === 'defeated') {
      this.finish(ctx, 'triumph');
      return true;
    }
    if (crisis && crisis.resolved === 'consumed') {
      this.finish(ctx, 'collapse');
      return true;
    }
    if (this.mgr.living().length < 3) {
      this.finish(ctx, 'collapse');
      return true;
    }
    if (this.god.cycle >= RUN_DEADLINE) {
      if (crisis && crisis.resolved === 'none') crisis.resolved = 'consumed';
      this.finish(ctx, crisis ? 'collapse' : 'stalemate');
      return true;
    }
    return false;
  }

  /** Stop the run early, banking whatever it produced. */
  abandon(): RunOutcome {
    if (this.god.outcome) return this.god.outcome;
    const ctx = this.context();
    this.finish(ctx, 'abandoned');
    return this.god.outcome!;
  }

  private finish(ctx: GodContext, ending: RunOutcome['ending']): void {
    const god = this.god;
    god.ended = true;
    this.setPhase('ended');

    const crisis = god.crisis;
    const slayer = ctx.mgr.byId(crisis?.slainById);
    const interventions = Object.values(god.interventionsUsed).reduce((a, b) => a + b, 0);

    const outcome: RunOutcome = {
      ending,
      cycles: god.cycle,
      chaosPeak: Math.round(god.chaosPeak),
      influenceSpent: Math.round(god.influenceSpent),
      interventions,
      crisis: crisis ? `${crisis.title} — ${crisisLabel(ctx, crisis)}` : 'No crisis ever formed.',
      crisisKind: crisis?.kind ?? null,
      slayerName: slayer ? fullName(slayer) : '',
      revengeChains: countRevengeChains(ctx),
      highlights: this.highlights(ctx, ending, slayer),
      legendsMade: [],
      essence: 0,
      unlocked: [],
    };

    const legends = harvestLegends(ctx, outcome, god.run);
    outcome.legendsMade = legends.map((l) => `${l.name} ${l.title}`.trim());
    this.mgr.data.legends = recordLegends(this.mgr.data.legends ?? [], legends);

    const history = this.mgr.data.godHistory;
    history.runs++;
    if (ending === 'triumph') history.triumphs++;
    if (ending === 'collapse') history.collapses++;
    history.legendsMade += legends.length;
    history.bestChaos = Math.max(history.bestChaos, outcome.chaosPeak);
    if (crisis && !history.crisisKinds.includes(crisis.kind)) history.crisisKinds.push(crisis.kind);

    const earned = evaluateUnlocks(outcome, history, this.mgr.data.godUnlocks ?? []);
    outcome.unlocked = earned.map((u) => u.id);
    this.mgr.data.godUnlocks = [...(this.mgr.data.godUnlocks ?? []), ...outcome.unlocked];

    // Essence is the one number that crosses over into the third-person game.
    outcome.essence =
      20 +
      god.cycle * 3 +
      legends.length * 25 +
      (ending === 'triumph' ? 120 : ending === 'collapse' ? 40 : 20) +
      Math.round(outcome.chaosPeak * 0.6);
    this.mgr.data.playerMeta.essence += outcome.essence;

    god.outcome = outcome;
    ctx.emit(
      'run',
      'legendary',
      ENDING_HEADLINE[ending],
      [
        ...outcome.highlights,
        `${god.cycle} cycles · ${interventions} interventions · peak chaos ${outcome.chaosPeak}`,
        legends.length ? `Into the Book: ${outcome.legendsMade.join(', ')}.` : 'Nobody here was worth remembering.',
        outcome.unlocked.length ? `Unlocked: ${outcome.unlocked.map((u) => u.toUpperCase()).join(', ')}.` : '',
      ].filter(Boolean),
      [],
      ending === 'triumph' ? 'gold' : 'bad'
    );
    this.flush(ctx);
    this.mgr.data.god = null;
    this.hooks.onEnd?.(outcome);
    this.persist();
  }

  private highlights(ctx: GodContext, ending: RunOutcome['ending'], slayer: Nemesis | null): string[] {
    const out: string[] = [];
    const crisis = this.god.crisis;
    if (ending === 'triumph' && crisis) {
      out.push(
        slayer
          ? `${fullName(slayer)} ended ${crisisLabel(ctx, crisis)}. You never touched either of them.`
          : `${crisis.title} was answered — nobody is quite sure by whom.`
      );
    } else if (ending === 'collapse') {
      out.push(crisis ? `${crisisLabel(ctx, crisis)} was never answered. The world is theirs.` : 'The world emptied out.');
    } else if (ending === 'stalemate') {
      out.push('Nothing in this world ever grew large enough to end it.');
    } else {
      out.push('You took your hands off it and walked away.');
    }

    const champ = ctx.mgr.byId(this.god.championId);
    if (champ) {
      const s = simOf(champ);
      out.push(
        `${fullName(champ)} was the one you kept touching — ${s.wins} wins, ${s.losses} losses, ${s.kills.length} kills, and ${
          champ.playerRelationship > 40 ? 'they came to hate you for it' : champ.playerRelationship < -40 ? 'they never knew why they were lucky' : 'they never worked out why'
        }.`
      );
    }
    const most = ctx.mgr.roster.slice().sort((a, b) => simOf(b).deeds.length - simOf(a).deeds.length)[0];
    if (most && simOf(most).deeds.length) {
      out.push(`Most storied: ${fullName(most)} — ${simOf(most).deeds.slice(-1)[0].text}.`);
    }
    const tier = chaosTier(this.god.chaosPeak);
    out.push(`The world ended ${tier.name.toLowerCase()}. ${tier.blurb}`);
    return out;
  }

  /* ============================================================
     accessors for the UI
     ============================================================ */

  get situations(): Situation[] {
    return this.god.situations;
  }

  get ended(): boolean {
    return this.god.ended;
  }

  get outcome(): RunOutcome | null {
    return this.god.outcome;
  }

  feedSince(id: string | null): Beat[] {
    if (!id) return this.god.feed;
    const i = this.god.feed.findIndex((b) => b.id === id);
    return i < 0 ? this.god.feed : this.god.feed.slice(i + 1);
  }

  act() {
    return getAct(this.god.act);
  }

  cyclesLeft(): number {
    return Math.max(0, (this.god.crisis?.deadline ?? RUN_DEADLINE) - this.god.cycle);
  }

  persist(): void {
    this.god.rngState = this.rng.state;
    if (!this.god.ended) this.mgr.data.god = serialiseGod(this.god);
    this.mgr.persist();
    this.hooks.persist?.();
  }
}

/* ============================================================
   helpers
   ============================================================ */

const ENDING_HEADLINE: Record<RunOutcome['ending'], string> = {
  triumph: 'THE WORLD HELD.',
  collapse: 'THE WORLD DID NOT HOLD.',
  stalemate: 'NOTHING EVER CAME OF IT.',
  abandoned: 'YOU LET GO.',
};

/** Decisions are a debugging view of one cycle; they never go into the save. */
export function serialiseGod(god: GodState): GodState {
  return { ...god, decisions: [] };
}

/**
 * A chain is A wanting B while B wants C. One is a grudge; three at once is a
 * world that has stopped being about any single fight.
 */
function countRevengeChains(ctx: GodContext): number {
  let chains = 0;
  for (const a of ctx.mgr.living()) {
    for (const bId of simOf(a).revengeTargets) {
      const b = ctx.mgr.byId(bId);
      if (!b || !b.alive) continue;
      if (simOf(b).revengeTargets.some((cId) => cId !== a.id && ctx.mgr.byId(cId)?.alive)) {
        chains++;
        break;
      }
    }
  }
  return chains;
}

function summarise(god: GodState, ctx: GodContext, deaths: number): CycleSummary {
  const top = ctx.mgr
    .living()
    .slice()
    .sort((a, b) => b.power - a.power)[0];
  return {
    cycle: god.cycle,
    act: god.act,
    chaos: Math.round(god.chaos),
    influence: Math.round(god.influence * 10) / 10,
    living: ctx.mgr.living().length,
    deaths,
    beats: ctx.beats.length,
    topActor: top ? fullName(top) : '',
  };
}

function seedExtraHouse(god: GodState, leader: Nemesis, rng: RNG): void {
  const f = {
    id: 'f' + god.nextFactionId.toString(36),
    name: `THE ${rng.pick(['SPLINTER', 'SECOND', 'OUTER', 'LESSER'])} ${rng.pick(['GATE', 'HAND', 'MARCH', 'CHOIR'])}`,
    colour: 0xffffff,
    leaderId: leader.id,
    memberIds: [leader.id],
    territories: [] as string[],
    strength: leader.power,
    stability: 55 + rng.int(0, 20),
    aggression: 55 + rng.int(0, 30),
    warWith: [] as string[],
    bornCycle: 0,
    destroyedCycle: null,
  };
  god.nextFactionId++;
  god.factions.push(f);
  simOf(leader).factionId = f.id;
  recomputePower(leader);
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Used by the board and the debug panel. */
export function areaLabel(id: string): string {
  return AREA_NAMES[id] ?? id.toUpperCase();
}

export { actForCycle };
