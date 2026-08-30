/**
 * Owns the persistent roster and the hierarchy.
 *
 * Everything that changes the world's cast goes through here so that there is
 * exactly one place that writes to the save file and one place that decides
 * who is Overlord.
 */

import { RNG, mixSeed, randomSeed } from '../core/RNG';
import type { SaveData, SaveSystem } from '../core/SaveSystem';
import { defaultGodHistory, defaultPlayerMeta, defaultSettings, SAVE_VERSION } from '../core/SaveSystem';
import type { Bus } from '../core/Events';
import { AREAS } from '../data/areas';
import { seedBiomes } from '../world/BiomeState';
import { rollAge, type AgeModifier, type AgeState } from '../data/ages';
import { chooseTitle } from '../data/names';
import { isPlayerFacingEvent, makeEvent, type WorldEvent } from '../world/WorldEvent';
import type { Nemesis, Rank } from './Nemesis';
import { fullName, rankIndex, RANK_ORDER } from './Nemesis';
import { generateNemesis, recomputePower } from './NemesisGenerator';
import { remember, recomputeRevenge } from './NemesisMemory';
import { refreshSignature } from '../data/signatures';
import { purgeReferences, makeRivals, setMaster } from './NemesisRelationships';
import { simOf } from '../god/GodTypes';
import { trimEventLog as trimLog, MAX_LOG } from '../sim/ChronicleArchive';

export class NemesisManager {
  data!: SaveData;
  ageState!: AgeState;

  /** Suppress overlord resurrections during succession scrambling (W-1). */
  suppressOverlordReturnsUntilTurn = 0;

  private saveSys: SaveSystem;
  private bus: Bus;
  private rng: RNG;

  constructor(saveSys: SaveSystem, bus: Bus) {
    this.saveSys = saveSys;
    this.bus = bus;
    this.rng = new RNG(randomSeed());
  }

  /* ============================================================
     lifecycle
     ============================================================ */

  loadExisting(): boolean {
    const d = this.saveSys.load();
    if (!d) return false;
    this.data = d;
    this.ageState = rollAge(d.worldAge, d.worldSeed);
    this.data.ageName = this.ageState.name;
    this.data.ageModifiers = this.ageState.modifiers;
    this.rng = new RNG(mixSeed(d.worldSeed, d.worldTurn));
    this.fillRanks();
    return true;
  }

  newWorld(seed = randomSeed()): void {
    const territories: Record<string, string | null> = {};
    for (const a of AREAS) territories[a.id] = null;

    this.data = {
      saveVersion: SAVE_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      worldSeed: seed,
      worldTurn: 1,
      worldAge: 1,
      ageModifiers: [],
      ageName: '',
      nemeses: [],
      eventLog: [],
      chronicleArchives: [],
      territories,
      nextId: 1,
      nextEventId: 1,
      usedNames: [],
      storyView: { panX: 0, panY: 0, zoom: 1 },
      playerMeta: defaultPlayerMeta(),
      settings: this.data?.settings ?? defaultSettings(),
      run: null,
      territoryMods: {},
      god: null,
      // A new world does not erase the Book of Legends or what has been
      // unlocked — that is the whole point of them surviving the reset.
      legends: this.data?.legends ?? [],
      godUnlocks: this.data?.godUnlocks ?? [],
      godHistory: this.data?.godHistory ?? defaultGodHistory(),
      biomes: seedBiomes(seed),
      npcQuests: [],
      nextQuestId: 1,
    };
    this.ageState = rollAge(1, seed);
    this.data.ageName = this.ageState.name;
    this.data.ageModifiers = this.ageState.modifiers;
    this.rng = new RNG(seed);

    this.seedRoster();
    this.log(makeEvent(1, 1, 'age_begins', `${this.ageState.name} begins.`, [], true, 'gold', { known: true }));
    this.persist();
  }

  /**
   * A new world for a new long game.
   *
   * The roster, the ground and the chronicle are replaced. The Book of
   * Legends, the unlocks, the settings and everything the player has banked
   * are not — that separation is the entire point of the roguelite reset, and
   * it is why a legend's relic can turn up in a world that never met them.
   * The Age carries forward, so each run's world is a little further along
   * and a little stranger than the last.
   */
  reseedWorld(seed = randomSeed()): void {
    const meta = this.data.playerMeta;
    const settings = this.data.settings;
    const legends = this.data.legends;
    const unlocks = this.data.godUnlocks;
    const history = this.data.godHistory;
    const age = Math.max(1, (this.data.worldAge ?? 1) + 1);

    this.newWorld(seed);

    this.data.playerMeta = meta;
    this.data.settings = settings;
    this.data.legends = legends;
    this.data.godUnlocks = unlocks;
    this.data.godHistory = history;
    this.data.worldAge = age;
    this.ageState = rollAge(age, seed);
    this.data.ageName = this.ageState.name;
    this.data.ageModifiers = this.ageState.modifiers;
    this.persist();
  }

  persist(): void {
    if (!this.data) return;
    this.trimEventLog();
    this.saveSys.save(this.data);
  }

  /** Centralized event log trim — archives before dropping. */
  trimEventLog(max = MAX_LOG): void {
    trimLog(this, max);
  }

  wipe(): void {
    this.saveSys.wipe();
  }

  /* ============================================================
     accessors
     ============================================================ */

  get turn(): number {
    return this.data.worldTurn;
  }

  get age(): number {
    return this.data.worldAge;
  }

  get mods(): AgeModifier {
    return this.ageState.combined;
  }

  get roster(): Nemesis[] {
    return this.data.nemeses;
  }

  living(): Nemesis[] {
    return this.data.nemeses.filter((n) => n.alive);
  }

  /** Tracked characters — excludes throwaway rabble. */
  namedLiving(): Nemesis[] {
    return this.living().filter((n) => n.persistent !== false && !!n.name);
  }

  dead(): Nemesis[] {
    return this.data.nemeses.filter((n) => !n.alive);
  }

  byId(id: string | null | undefined): Nemesis | null {
    if (!id) return null;
    return this.data.nemeses.find((n) => n.id === id) ?? null;
  }

  ofRank(rank: Rank): Nemesis[] {
    return this.living().filter((n) => n.rank === rank);
  }

  overlord(): Nemesis | null {
    return this.ofRank('overlord')[0] ?? null;
  }

  /** Living nemeses whose home area this is. */
  inTerritory(areaId: string): Nemesis[] {
    return this.living().filter((n) => n.territory === areaId);
  }

  territoryHolder(areaId: string): Nemesis | null {
    return this.byId(this.data.territories[areaId] ?? null);
  }

  takenNames(): Set<string> {
    return new Set(this.data.nemeses.map((n) => n.name.toLowerCase()));
  }

  nextId(): string {
    const id = 'n' + this.data.nextId.toString(36);
    this.data.nextId++;
    return id;
  }

  /* ============================================================
     roster construction
     ============================================================ */

  private targetCounts(): Record<Rank, number> {
    const extra = Math.min(Math.round(this.mods.extraCaptains), 5);
    return {
      overlord: 1,
      warlord: 2,
      captain: 4 + Math.ceil(extra / 2),
      elite: 4 + Math.floor(extra / 2),
      grunt: 0,
    };
  }

  private seedRoster(): void {
    const targets = this.targetCounts();
    const order: Rank[] = ['overlord', 'warlord', 'captain', 'elite'];
    for (const rank of order) {
      for (let i = 0; i < targets[rank]; i++) {
        const n = this.recruit(rank, false);
        simOf(n);
      }
    }
    // Seed rivalries with standing grudges so situations read intent from cycle 1.
    const alive = this.living();
    for (let i = 0; i < Math.min(3, Math.floor(alive.length / 3)); i++) {
      const a = this.rng.pick(alive);
      const b = this.rng.pick(alive);
      if (a.id === b.id || !makeRivals(a, b)) continue;
      const hunter = this.rng.chance(0.5) ? a : b;
      const target = hunter.id === a.id ? b : a;
      const s = simOf(hunter);
      s.goal = 'revenge';
      s.goalTargetId = target.id;
      if (!s.revengeTargets.includes(target.id)) s.revengeTargets.push(target.id);
      s.goalAge = 2 + this.rng.int(0, 4);
    }
    // Attach loyalists to superiors.
    for (const n of alive) {
      if (n.personality === 'loyalist' && rankIndex(n.rank) < 3) {
        const sup = this.living().filter((m) => rankIndex(m.rank) > rankIndex(n.rank));
        if (sup.length) setMaster(n, this.rng.pick(sup));
      }
    }
    this.assignTerritories();
  }

  /** Create a new named enemy at `rank`. */
  recruit(rank: Rank, announce = true): Nemesis {
    const id = this.nextId();
    const seed = mixSeed(this.data.worldSeed, this.data.nextId * 7919 + this.data.worldTurn);
    const n = generateNemesis({
      id,
      seed,
      rank,
      turn: this.data.worldTurn,
      age: this.mods,
      taken: this.takenNames(),
    });
    this.data.nemeses.push(n);
    simOf(n);
    if (announce) {
      this.log(
        makeEvent(this.turn, this.age, 'birth', `${fullName(n)} joined the ${rankLabel(rank)}.`, [n.id], false)
      );
    }
    return n;
  }

  /**
   * Make the hierarchy consistent: exactly one Overlord, the right number of
   * warlords and captains, promoting from below and recruiting if the world
   * has run out of bodies.
   */
  fillRanks(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const targets = this.targetCounts();
    const chain: Rank[] = ['overlord', 'warlord', 'captain', 'elite'];

    for (const rank of chain) {
      let have = this.ofRank(rank);

      // Too many at this rank (can happen after a resurrection) — demote the weakest.
      while (have.length > targets[rank] && rank !== 'elite') {
        have.sort((a, b) => a.power - b.power || a.returns - b.returns);
        const victim = have.shift()!;
        const ev = this.demote(victim, 'the hierarchy closed around them');
        if (rankIndex(rank) >= 2) {
          ev.important = true;
          ev.text = `${fullName(victim)} WAS DISPLACED — the hierarchy closed around them.`.toUpperCase();
        }
        events.push(ev);
        have = this.ofRank(rank);
      }

      while (have.length < targets[rank]) {
        const below = RANK_ORDER[rankIndex(rank) - 1];
        let candidate: Nemesis | null = null;
        if (below) {
          const pool = this.ofRank(below);
          if (pool.length > 0) {
            pool.sort((a, b) => b.power - a.power);
            candidate = pool[0];
          }
        }
        if (!candidate) {
          candidate = this.recruit(rank, false);
          events.push(
            makeEvent(
              this.turn,
              this.age,
              'recruitment',
              `${fullName(candidate)} rose out of nowhere to take a place among the ${rankLabel(rank)}.`,
              [candidate.id],
              rankIndex(rank) >= 2
            )
          );
        } else {
          events.push(this.promote(candidate, rank));
        }
        have = this.ofRank(rank);
      }
    }

    this.trimRoster(events);
    this.assignTerritories();
    return events;
  }

  /**
   * The brief asks for 10–15 tracked characters. Resurrections and recruitment
   * can push past that, so the least interesting elites quietly drop back into
   * the rabble — never anyone the player has history with or the god run marked.
   */
  private isGodMarked(n: Nemesis): boolean {
    const god = this.data.god;
    if (!god) return false;
    if (god.championId === n.id) return true;
    if (god.conditions.some((c: import('../god/GodTypes').Condition) => c.targetKind === 'nemesis' && c.targetId === n.id)) return true;
    if (god.situations.some((s: import('../god/GodTypes').Situation) => s.actors.includes(n.id))) return true;
    return n.memory.some((m) => m.type === 'GOD_BLESSED_ME' || m.type === 'GOD_CURSED_ME' || m.type === 'GOD_SAVED_ME');
  }

  private trimRoster(events: WorldEvent[]): void {
    const targets = this.targetCounts();
    const cap = targets.overlord + targets.warlord + targets.captain + targets.elite + 2;
    let living = this.living();
    if (living.length <= cap) return;
    const god = this.data.god;
    const expendable = living
      .filter((n) => {
        if (n.rank !== 'elite') return false;
        if (n.killsAgainstPlayer > 0 || n.defeatsByPlayer > 0 || n.escapedPlayer > 0 || n.returns > 0) return false;
        if (n.stolen.length > 0 || n.playerRelationship !== 0) return false;
        if (this.isGodMarked(n)) return false;
        const s = simOf(n);
        if (s.deeds.length > 0 || s.revengeTargets.length > 0) return false;
        if (god?.conditions.some((c: import('../god/GodTypes').Condition) => c.targetKind === 'nemesis' && c.targetId === n.id)) return false;
        return true;
      })
      .sort((a, b) => a.power - b.power);
    if (living.length > cap && !expendable.length && god) {
      events.push(
        makeEvent(
          this.turn,
          this.age,
          'succession',
          'The board is crowded — your marked champions hold their ground.',
          [],
          true,
          'neutral'
        )
      );
    }
    while (living.length > cap && expendable.length) {
      const n = expendable.shift()!;
      n.alive = false;
      n.diedOnTurn = this.turn;
      purgeReferences(this.data.nemeses, n.id);
      this.data.nemeses = this.data.nemeses.filter((x) => x.id !== n.id);
      events.push(
        makeEvent(this.turn, this.age, 'death', `${fullName(n)} disappeared into the rabble.`, [n.id], false)
      );
      living = this.living();
    }
  }

  /** Give every area a holder; the Overlord always sits in the Fortress alone. */
  assignTerritories(): void {
    const ov = this.overlord();
    if (ov) {
      ov.territory = 'fortress';
      this.data.territories.fortress = ov.id;
      for (const a of AREAS) {
        if (a.id === 'fortress') continue;
        if (this.data.territories[a.id] === ov.id) this.data.territories[a.id] = null;
      }
    }
    for (const a of AREAS) {
      if (a.id === 'fortress' && ov) continue;
      const holder = this.byId(this.data.territories[a.id]);
      if (holder && holder.alive && holder.rank !== 'overlord') continue;
      if (holder?.rank === 'overlord') this.data.territories[a.id] = null;
      const locals = this.living()
        .filter((n) => n.territory === a.id && n.rank !== 'overlord')
        .sort((x, y) => y.power - x.power);
      this.data.territories[a.id] = locals[0]?.id ?? null;
    }
  }

  /* ============================================================
     rank changes
     ============================================================ */

  promote(n: Nemesis, to?: Rank): WorldEvent {
    const from = n.rank;
    const next = to ?? RANK_ORDER[Math.min(rankIndex(n.rank) + 1, RANK_ORDER.length - 1)];
    n.rank = next;
    n.level += 1 + rankIndex(next);
    remember(n, 'I_WAS_PROMOTED', this.turn);
    n.title = chooseTitle(n, this.titlesInUse(n));
    recomputePower(n);
    this.bus.emit('nemesisPromoted', { nemesis: n, from, to: next });
    return this.log(
      makeEvent(
        this.turn,
        this.age,
        'promotion',
        `${fullName(n)} became ${rankArticle(next)}.`,
        [n.id],
        rankIndex(next) >= 2,
        'gold',
        { payload: { rankFrom: from, rankTo: next } }
      )
    );
  }

  demote(n: Nemesis, reason = ''): WorldEvent {
    const from = n.rank;
    const next = RANK_ORDER[Math.max(rankIndex(n.rank) - 1, 0)];
    if (next === n.rank) {
      return this.log(makeEvent(this.turn, this.age, 'demotion', `${fullName(n)} has nothing left to lose.`, [n.id]));
    }
    n.rank = next;
    n.level = Math.max(1, n.level - 1);
    remember(n, 'I_WAS_DEMOTED', this.turn);
    recomputePower(n);
    return this.log(
      makeEvent(
        this.turn,
        this.age,
        'demotion',
        reason ? `${fullName(n)} was cast down — ${reason}.` : `${fullName(n)} was cast down.`,
        [n.id],
        false,
        'bad',
        { payload: { rankFrom: from, rankTo: next, cause: reason } }
      )
    );
  }

  /** Mark a nemesis dead. They stay in the roster so they can return. */
  killNemesis(n: Nemesis, byPlayer: boolean, cause = ''): WorldEvent {
    // Already dead: return an event nobody logs, so the chronicle stays clean.
    if (!n.alive) return makeEvent(this.turn, this.age, 'death', '', [n.id]);
    n.alive = false;
    n.diedOnTurn = this.turn;
    // Their territory is now open.
    for (const a of AREAS) {
      if (this.data.territories[a.id] === n.id) this.data.territories[a.id] = null;
    }
    // Allies take it personally — written once after the survive roll (World.onEnemyKilled).
    this.bus.emit('nemesisDied', { nemesis: n, byPlayer });
    return this.log(
      makeEvent(
        this.turn,
        this.age,
        byPlayer ? 'player_kill' : 'death',
        cause || (byPlayer ? `You killed ${fullName(n)}.` : `${fullName(n)} died.`),
        [n.id],
        rankIndex(n.rank) >= 2,
        byPlayer ? 'good' : 'neutral'
      )
    );
  }

  /** Bring someone back, scarred and angrier. A former Overlord re-enters one rank down. */
  resurrect(n: Nemesis, scarLabel: string | null): WorldEvent {
    const wasOverlord = n.rank === 'overlord';
    n.alive = true;
    n.diedOnTurn = null;
    n.returns++;
    n.level += 1;
    if (wasOverlord) {
      n.rank = 'warlord';
      remember(n, 'I_WAS_DEMOTED', this.turn);
    }
    remember(n, 'I_RETURNED_FROM_DEATH', this.turn);
    n.title = chooseTitle(n, this.titlesInUse(n));
    recomputeRevenge(n);
    recomputePower(n);
    refreshSignature(n);
    this.bus.emit('nemesisReturned', { nemesis: n });
    const detail = scarLabel ? ` ${scarLabel} and all.` : '';
    return this.log(
      makeEvent(
        this.turn,
        this.age,
        'resurrection',
        `${fullName(n)} was not as dead as you thought.${detail}`,
        [n.id],
        true,
        'bad'
      )
    );
  }

  /** Titles currently worn by others, so the roster does not homogenise. */
  titlesInUse(exclude: Nemesis): Set<string> {
    const s = new Set<string>();
    for (const n of this.data.nemeses) {
      if (n.id !== exclude.id && n.alive && n.title) s.add(n.title);
    }
    return s;
  }

  /** Drop long-dead unimportant records so the save does not grow forever. */
  pruneDead(): void {
    const keep: Nemesis[] = [];
    for (const n of this.data.nemeses) {
      if (n.alive) {
        keep.push(n);
        continue;
      }
      const age = this.turn - (n.diedOnTurn ?? 0);
      const memorable = n.revengeChance > 0.3 || n.killsAgainstPlayer > 0 || n.returns > 0 || n.stolen.length > 0;
      if (age <= 10 || memorable) keep.push(n);
      else purgeReferences(this.data.nemeses, n.id);
    }
    this.data.nemeses = keep;
  }

  /* ============================================================
     logging
     ============================================================ */

  log(ev: WorldEvent): WorldEvent {
    if (!ev.id) {
      const n = this.data.nextEventId ?? 1;
      ev.id = 'e' + n.toString(36);
      this.data.nextEventId = n + 1;
    }
    if (ev.witnessed === undefined) ev.witnessed = isPlayerFacingEvent(ev.type);
    if (ev.known === undefined) ev.known = ev.witnessed;
    if (ev.runId === undefined) ev.runId = this.data.playerMeta.runs;
    this.data.eventLog.push(ev);
    this.bus.emit('worldEvent', ev);
    return ev;
  }

  /** After a recap, the player has been told everything from this turn onward. */
  markEventsKnown(fromTurn?: number): void {
    for (const ev of this.data.eventLog) {
      if (fromTurn === undefined || ev.turn >= fromTurn) ev.known = true;
    }
  }

  /** Events from the most recent `turns` world turns, newest last. */
  recentEvents(turns = 1): WorldEvent[] {
    const from = this.turn - turns + 1;
    return this.data.eventLog.filter((e) => e.turn >= from);
  }

  /* ============================================================
     ages
     ============================================================ */

  advanceAge(): WorldEvent {
    this.data.worldAge++;
    this.ageState = rollAge(this.data.worldAge, this.data.worldSeed);
    this.data.ageName = this.ageState.name;
    this.data.ageModifiers = this.ageState.modifiers;
    return this.log(
      makeEvent(
        this.turn,
        this.age,
        'age_begins',
        `A new age begins: ${this.ageState.name}.`,
        [],
        true,
        'gold',
        { known: true, witnessed: true }
      )
    );
  }

  advanceTurn(): void {
    this.data.worldTurn++;
    this.rng = new RNG(mixSeed(this.data.worldSeed, this.data.worldTurn * 2654435761));
  }

  get simRng(): RNG {
    return this.rng;
  }
}

export function rankLabel(r: Rank): string {
  switch (r) {
    case 'overlord':
      return 'overlords';
    case 'warlord':
      return 'warlords';
    case 'captain':
      return 'captains';
    case 'elite':
      return 'elites';
    default:
      return 'rabble';
  }
}

export function rankArticle(r: Rank): string {
  switch (r) {
    case 'overlord':
      return 'Overlord';
    case 'warlord':
      return 'a Warlord';
    case 'captain':
      return 'a Captain';
    case 'elite':
      return 'an Elite';
    default:
      return 'nothing at all';
  }
}

export function rankName(r: Rank): string {
  return r.toUpperCase();
}
