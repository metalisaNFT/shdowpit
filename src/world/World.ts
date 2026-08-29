/**
 * The run director.
 *
 * Decides who is standing in the arena at any moment: it keeps the local
 * population topped up, walks named enemies on stage when the player enters
 * their ground, sends hunters after the player, and lets rivals interrupt each
 * other's fights. It also translates what happens in the arena back into
 * changes on the persistent Nemesis records.
 */

import * as THREE from 'three';
import { RNG, mixSeed, randomSeed } from '../core/RNG';
import type { EncounterTuning } from '../core/Telemetry';
import type { Bus } from '../core/Events';
import { AREAS, areaAt, getArea, nearestArea, type AreaDef } from '../data/areas';
import { getPersonality } from '../data/personalities';
import { pickAdaptation } from '../data/traits';
import { chooseTitle } from '../data/names';
import { RELIC_WEAPONS, PLAYER_WEAPONS } from '../data/weapons';
import { equippedWeapon, markRecovered, mint, syncLegacyWeapons } from '../progress/Progression';
import { weaponIdFor } from '../data/equipment';
import type { ItemInstance } from '../progress/Types';
import { makeEvent } from './WorldEvent';
import type { Arena } from './Arena';
import { Enemy } from '../enemy/Enemy';
import { updateEnemyAI } from '../enemy/EnemyAI';
import { CombatDirector } from '../combat/CombatDirector';
import type { Player } from '../player/Player';
import { NemesisManager } from '../nemesis/NemesisManager';
import { generateGrunt, recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar, remember, recomputeRevenge } from '../nemesis/NemesisMemory';
import { makeRivals } from '../nemesis/NemesisRelationships';
import type { Nemesis, ScarId, StolenItem } from '../nemesis/Nemesis';
import { fullName, rankIndex } from '../nemesis/Nemesis';
import { emptyRunState, type RunState } from '../run/RunState';
import { addHeat, tickHeatEconomy, spendSpawn, spawnSafeOffset, crossedThreshold, heatLabel, syncHeatGates } from './Heat';
import { HEAT, REMNANT, EXTRACT } from '../data/balance';
import { presentTerritory, type TerritoryPresentation } from './TerritoryRules';
import { snapshotOccupancy, type OccupancyMap } from './WorldOccupancy';
import { pickMultiRule, type MultiRule } from '../nemesis/MultiEncounter';
import { applyStagingPose, resolveIgnoredStaging, STAGING_IGNORE_S } from '../nemesis/Staging';
import type { ExtractSite } from './Extraction';
import { mergeArchetypeWeights, type LegendSpawnBias } from '../god/PitBridge';
import { signatureEventMatches } from '../data/signatures';

const MAX_GRUNTS = 16;
const MAX_NAMED_ACTIVE = 3;
const DESPAWN_DISTANCE = 110;
/** seconds between reinforcements while a group is still standing */
const RESPAWN_INTERVAL = 6;
/** longer pause after the player clears the field — the "I won that" beat */
const RESPAWN_AFTER_CLEAR = 11;

export interface ArrivalContext {
  hunting: boolean;
  interrupting: boolean;
  resurrected: boolean;
}

export interface WorldHooks {
  onNamedArrival(e: Enemy, salt: number, ctx: ArrivalContext): void;
  onNamedEscape(e: Enemy): void;
  onToast(text: string, tone?: 'neutral' | 'hot' | 'gold' | 'good'): void;
  onOverlordSlain(e: Enemy): void;
  onNamedDefeated(e: Enemy, escaped: boolean): void;
  onDuel(a: Enemy, b: Enemy): void;
  onAid(guard: Enemy, master: Enemy): void;
  /** Area law presentation — banner + once-per-area toast live here. */
  onEnterTerritory?(areaName: string, presentation: TerritoryPresentation): void;
}

export class World {
  enemies: Enemy[] = [];
  currentArea: AreaDef = AREAS[0];

  run: RunState = emptyRunState();
  multiRule: MultiRule | null = null;
  private stageTimer = STAGING_IGNORE_S;
  private stageResolved = false;
  extractSites: ExtractSite[] = [];
  occupancy: OccupancyMap = {};
  /** HUD label: area name, or the road between areas. */
  locationLabel = 'THE PIT';
  vendettaCounters = { posture: 0, interrupts: 0, parries: 0, weakness: false, adapted: false, loyalistSeparated: false };

  /** Kit + legend lean for grunt spawns — set by Game each tick. */
  spawnTuning: EncounterTuning | null = null;
  legendBias: LegendSpawnBias | null = null;

  resetVendettaCounters(): void {
    this.vendettaCounters = { posture: 0, interrupts: 0, parries: 0, weakness: false, adapted: false, loyalistSeparated: false };
  }

  /** nemesis ids already resolved this run (dead, escaped, or fled) */
  private resolvedThisRun = new Set<string>();
  /** nemesis ids currently on stage */
  private activeNamed = new Map<string, Enemy>();

  private rng: RNG;
  private huntTimer = 60;
  private gruntSeed = 1;
  private encounterSalt = 0;
  /** gates reinforcement spawns so kills buy quiet — see maintainPopulation */
  private respawnTimer = 0;
  /** stock the area in one go on arrival, then drip afterwards */
  private bulkFill = true;
  /** territory laws already announced this run (area id) */
  private lawTold = new Set<string>();
  /** who last killed the player — used for next-run payoff spawn */
  lastKillerId: string | null = null;

  /** run stopwatch, seconds */
  runTime = 0;
  runActive = false;

  /**
   * Named enemies the player was recently fighting, used to detect a flee.
   * id -> seconds spent out of engagement range after having been engaged.
   */
  private fleeWatch = new Map<string, { engaged: boolean; away: number; noted: boolean }>();

  /**
   * Gates how many enemies may be committed to an attack at once. Lives here
   * because the World owns the enemy list; CombatSystem and the AI both read
   * it. See combat/CombatDirector.ts.
   */
  readonly director = new CombatDirector();

  constructor(
    private mgr: NemesisManager,
    private arena: Arena,
    private scene: THREE.Object3D,
    _bus: Bus,
    private hooks: WorldHooks
  ) {
    this.rng = new RNG(randomSeed());
    void _bus;
  }

  /* ============================================================
     run lifecycle
     ============================================================ */

  startRun(player: Player): void {
    this.clearEnemies();
    this.resolvedThisRun.clear();
    this.activeNamed.clear();
    this.fleeWatch.clear();
    this.runTime = 0;
    this.runActive = true;
    this.encounterSalt = this.mgr.turn;
    this.rng = new RNG(mixSeed(this.mgr.data.worldSeed, this.mgr.turn * 7717 + this.mgr.data.playerMeta.runs));
    this.huntTimer = 55 + this.rng.range(0, 40);
    this.arena.resetShrines();
    this.arena.resetCaches();
    this.run = emptyRunState(mixSeed(this.mgr.data.worldSeed, this.mgr.turn * 9973));
    this.run.started = true;
    this.run.territoryMods = { ...(this.mgr.data.territoryMods ?? {}) };
    this.multiRule = null;
    this.stageTimer = STAGING_IGNORE_S;
    this.stageResolved = false;
    this.vendettaCounters = { posture: 0, interrupts: 0, parries: 0, weakness: false, adapted: false, loyalistSeparated: false };
    this.lawTold.clear();
    this.buildExtractSites();
    this.mgr.data.run = this.run;
    this.refreshOccupancy();

    const start = this.arena.spawnPoint('pit', this.rng, 0.1, 0.35);
    player.spawn(start.x, start.z, this.rng.range(-Math.PI, Math.PI), this.mgr.data.playerMeta.vigour, this.mgr.data.playerMeta.equipped);
    player.stats.run = this.run;
    player.stats.techniques = this.mgr.data.playerMeta.techniques[this.mgr.data.playerMeta.equipped] ?? [];
    this.currentArea = getArea('pit');
    this.locationLabel = `${this.currentArea.name}  ·  ${this.currentArea.landmark}`;
    this.respawnTimer = 0;
    this.bulkFill = true;
    this.populateArea(this.currentArea, player, true);
    this.spawnRunPayoff(player);
    this.tellAreaLaw(this.currentArea, true);
  }

  endRun(): void {
    this.runActive = false;
    this.mgr.data.run = null;
    this.clearEnemies();
  }

  clearEnemies(): void {
    for (const e of this.enemies) {
      this.scene.remove(e.rig.root);
      e.dispose();
    }
    this.enemies.length = 0;
    this.activeNamed.clear();
  }

  /* ============================================================
     per-frame
     ============================================================ */

  update(dt: number, player: Player): void {
    if (!this.runActive) return;
    this.runTime += dt;

    /* ---- area transitions ----
       Only switch when the player actually enters another region's floor.
       Corridors stay attached to the last place, so the approach is travel,
       not a second arena. */
    const inside = areaAt(player.position.x, player.position.z);
    if (inside) {
      if (inside.id !== this.currentArea.id) {
        addHeat(this.run, HEAT.areaChange);
        this.run.areaDwell = 0;
        this.run.lastAreaId = inside.id;
        this.currentArea = inside;
        this.onEnterArea(inside, player);
      }
      this.locationLabel = `${inside.name}  ·  ${inside.landmark}`;
      if (inside.id === 'tower') {
        const d = Math.hypot(player.position.x - inside.cx, player.position.z - inside.cz);
        if (d < 26) this.locationLabel = `${inside.name}  ·  THE RING`;
      }
    } else {
      const toward = nearestArea(player.position.x, player.position.z);
      this.locationLabel = `THE APPROACH — ${toward.landmark}`;
    }

    const inCombat = this.playerInCombat(player);
    const relic = !['sword', 'greatsword', 'spear', 'hammer'].includes(player.stats.weaponId);
    const pres = this.territoryNow();
    const dampen =
      pres.liberation?.kind === 'heat_dampen' ||
      (!!pres.liberation && pres.rules.some((r) => r.id === 'void_quiet'));
    const tracking = pres.rules.some((r) => r.id === 'tracking_patrols');
    let dwellMul = 1;
    if (dampen) dwellMul = 0.4;
    else if (tracking) dwellMul = 1.5;
    tickHeatEconomy(this.run, dt, inCombat, !!inside, relic, dwellMul);

    /* ---- combat director pressure ---- */
    if (this.run.heat >= 85 || this.enemies.filter((e) => e.alive && e.named).length >= 2) {
      this.director.setPressure('extreme');
    } else if (this.run.heat >= 60) {
      this.director.setPressure('high');
    } else {
      this.director.setPressure('normal');
    }

    /* ---- combat director ---- */
    // Release permits from anyone who is no longer actually attacking, so a
    // staggered or dead enemy cannot hold a slot and starve the encounter.
    const live = new Set<number>();
    for (const e of this.enemies) {
      if (e.alive && e.combat.attacking) live.add(e.uid);
    }
    this.director.update(dt, live);

    /* ---- AI + entity update ---- */
    const ctx = {
      player,
      enemies: this.enemies,
      arena: this.arena,
      dt,
      director: this.director,
      worldAge: this.mgr.age,
      spawnCommanded: (src: Enemy) => {
        if (src.summonUsed) return;
        src.summonUsed = true;
        const g = this.spawnGrunt(src.position.x + 2.4, src.position.z - 1.6);
        g.summoned = true;
        g.protectTarget = src;
        g.nemesis.persistent = false;
      },
    };
    for (const e of this.enemies) {
      if (e.alive) updateEnemyAI(e, ctx);
    }

    this.tickNamedPresentation(dt, player);
    this.tickPlayerFlee(dt, player);

    /* ---- housekeeping ---- */
    this.reapEnemies(player);
    this.maintainPopulation(player, dt);
    this.updateRivalries();
    this.refreshMultiRule();
    this.tickStaging(dt, player);

    /* ---- hunters / heat pulses ---- */
    this.huntTimer -= dt;
    syncHeatGates(this.run);
    const crossed = crossedThreshold(this.run.lastThreshold, this.run.heat);
    if (crossed !== null && spendSpawn(this.run)) {
      this.run.lastThreshold = crossed;
      this.pulseHeat(player, crossed);
    } else if (this.huntTimer <= 0) {
      this.huntTimer = 60 + this.rng.range(0, 55);
      if (this.run.heat >= 60) {
        const hunted = this.tryHunt(player);
        if (hunted) this.hooks.onToast(this.huntToast(hunted), 'hot');
      }
    }
  }

  /** Called after CombatSystem so death bookkeeping happens once per frame. */
  postUpdate(dt: number, player: Player): void {
    void dt;
    void player;
  }

  /* ============================================================
     population
     ============================================================ */

  private onEnterArea(area: AreaDef, player: Player): void {
    this.bulkFill = true;
    this.respawnTimer = 0;
    this.populateArea(area, player, false);
    this.tellAreaLaw(area, false);
  }

  private tellAreaLaw(area: AreaDef, initial: boolean): void {
    const p = this.territoryNow();
    const rule = p.rules[0];
    if (this.hooks.onEnterTerritory) {
      this.hooks.onEnterTerritory(area.name, p);
    }
    if (this.lawTold.has(area.id)) {
      if (!this.hooks.onEnterTerritory) {
        this.hooks.onToast(`ENTERING ${area.name} — ${area.combat}`, 'neutral');
      }
      return;
    }
    this.lawTold.add(area.id);
    if (rule && rule.id !== 'void_quiet') {
      const who = p.holderName !== 'UNCLAIMED' ? `${p.holderName} · ` : '';
      this.hooks.onToast(`${who}${rule.title} — ${rule.counterplay}`, 'gold');
    } else if (!initial) {
      this.hooks.onToast(`ENTERING ${area.name} — ${area.combat}`, 'neutral');
    }
  }

  /**
   * After death the world turned. Prove it in the first seconds: killer with
   * stolen steel, or anyone still carrying the player's weapon, walks on stage.
   */
  private spawnRunPayoff(player: Player): void {
    const thief =
      (this.lastKillerId ? this.mgr.byId(this.lastKillerId) : null) ??
      this.mgr.living().find((n) => n.stolen.some((s) => s.kind === 'weapon')) ??
      null;
    if (!thief || !thief.alive) return;
    if (this.activeNamed.has(thief.id) || this.resolvedThisRun.has(thief.id)) return;
    if (this.activeNamed.size >= MAX_NAMED_ACTIVE) return;
    const carrying = thief.stolen.find((s) => s.kind === 'weapon');
    const isKiller = this.lastKillerId === thief.id;
    if (!carrying && !isKiller) return;
    this.spawnNamed(thief, player, true, undefined, undefined, { hunting: true });
    // Toast lives on arrival / pendingWorldPayoff — spawning is the body change.
    this.lastKillerId = null;
  }

  private populateArea(area: AreaDef, player: Player, initial: boolean): void {
    // Named enemies whose ground this is walk on stage.
    const locals = this.mgr
      .living()
      .filter((n) => n.territory === area.id && !this.resolvedThisRun.has(n.id) && !this.activeNamed.has(n.id))
      .sort((a, b) => b.power - a.power);

    const room = MAX_NAMED_ACTIVE - this.activeNamed.size;
    const bring = initial ? Math.min(1, room) : Math.min(room, locals.length > 2 ? 2 : locals.length);
    for (let i = 0; i < bring; i++) {
      const n = locals[i];
      if (!n) break;
      // Not every captain shows up every time you walk in.
      const p = getPersonality(n.personality);
      const chance = 0.55 + p.hunt * 0.12 + n.revengeChance * 0.35 + (n.rank === 'overlord' ? 1 : 0);
      if (!initial && !this.rng.chance(Math.min(0.95, chance))) continue;
      this.spawnNamed(n, player, false);
    }
  }

  /**
   * Keep the area populated — but on a drip, not a tap.
   *
   * This used to refill to target every single frame, so clearing a group
   * spawned the replacements the same instant. There was no lull, no "I won
   * that fight" beat, and the arena felt like an endless conveyor. Now a
   * reinforcement arrives at most every `RESPAWN_INTERVAL` seconds, and
   * emptying the area buys a longer breath before the next one walks in.
   */
  private maintainPopulation(player: Player, dt: number): void {
    if (this.respawnTimer > 0) this.respawnTimer -= dt;
    const alive = this.enemies.filter((e) => e.alive && !e.named).length;
    const target = Math.min(
      MAX_GRUNTS,
      Math.max(2, this.currentArea.population + Math.floor(this.mgr.age / 2) + this.gruntDelta())
    );
    if (alive >= target) return;

    // Entering an area (or starting a run) stocks it in one go — the drip is
    // about not replacing the group you just beat, not about arriving in an
    // empty world.
    if (this.bulkFill) {
      this.bulkFill = false;
      for (let i = alive; i < target; i++) {
        const pt = this.arena.spawnPoint(this.currentArea.id, this.rng, 0.35, 0.98);
        if (Math.hypot(pt.x - player.position.x, pt.z - player.position.z) < 26) continue;
        this.spawnGrunt(pt.x, pt.z);
      }
      this.respawnTimer = RESPAWN_INTERVAL;
      return;
    }

    if (this.respawnTimer > 0) return;
    // Clearing the field earns a real pause; topping a group up does not.
    this.respawnTimer = alive === 0 ? RESPAWN_AFTER_CLEAR : RESPAWN_INTERVAL;

    // One at a time — a whole group appearing at once is what made refills
    // read as a spawn wave.
    for (let attempt = 0; attempt < 6; attempt++) {
      const pt = this.arena.spawnPoint(this.currentArea.id, this.rng, 0.35, 0.98);
      const d = Math.hypot(pt.x - player.position.x, pt.z - player.position.z);
      if (d < 26) continue;
      this.spawnGrunt(pt.x, pt.z);
      return;
    }
  }

  private reapEnemies(player: Player): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      if (e.alive && e.escapedAway) {
        this.handleEscape(e);
        this.despawn(i);
        continue;
      }

      if (!e.alive) {
        // Leave corpses around briefly for weight, then clear them.
        e.stateTime += 0;
        if ((e.rig.root.userData.deadFor = (e.rig.root.userData.deadFor ?? 0) + 0.016) > 6) {
          this.despawn(i);
        }
        continue;
      }

      const d = Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z);
      if (d > DESPAWN_DISTANCE && !e.named) this.despawn(i);
    }
  }

  /**
   * Pull a named enemy off the stage without running any death, escape or
   * reward bookkeeping. For flows that rewrite the record directly
   * (resurrection, debug) and must not have a leftover body react to it.
   */
  removeNamedFromStage(nemesisId: string): boolean {
    const i = this.enemies.findIndex((e) => e.named && e.nemesis.id === nemesisId);
    if (i < 0) return false;
    this.despawn(i);
    return true;
  }

  private despawn(index: number): void {
    const e = this.enemies[index];
    if (e.named) this.activeNamed.delete(e.nemesis.id);
    this.scene.remove(e.rig.root);
    e.dispose();
    this.enemies.splice(index, 1);
  }

  /* ============================================================
     spawning
     ============================================================ */

  spawnGrunt(x: number, z: number): Enemy {
    const seed = mixSeed(this.mgr.data.worldSeed, this.gruntSeed++ * 2654435761);
    let level = 1 + Math.floor(this.mgr.age * 1.2) + this.rng.int(0, 2) + Math.floor(this.currentArea.danger * 0.8);
    const tuning = this.spawnTuning;
    if (tuning) level = Math.max(1, level + tuning.gruntLevelDelta);
    let weights: number[] | undefined;
    if (tuning || this.legendBias) {
      const kitW = tuning?.archetypeWeights;
      const legW = this.legendBias?.archetypeWeights;
      if (kitW && legW) weights = mergeArchetypeWeights(kitW, legW);
      else weights = kitW ?? legW;
    }
    const n = generateGrunt(seed, level, this.mgr.mods, this.currentArea.id, weights ? { archetypeWeights: weights } : undefined);
    const e = new Enemy(n, this.mgr.mods);
    e.spawn(x, z, this.rng.range(-Math.PI, Math.PI));
    this.scene.add(e.rig.root);
    this.enemies.push(e);
    return e;
  }

  /** Bring a named nemesis into the arena. */
  spawnNamed(
    n: Nemesis,
    player: Player,
    dramatic: boolean,
    atX?: number,
    atZ?: number,
    opts?: { hunting?: boolean; resurrected?: boolean }
  ): Enemy | null {
    if (this.activeNamed.has(n.id)) return this.activeNamed.get(n.id)!;
    if (!n.alive) return null;

    const hunting = opts?.hunting ?? dramatic;
    const resurrected = opts?.resurrected ?? n.memory[n.memory.length - 1]?.type === 'I_RETURNED_FROM_DEATH';
    const interrupting = this.playerInCombat(player);

    let x = atX;
    let z = atZ;
    let entrance: Enemy['entranceKind'] = 'immediate';

    if (x === undefined || z === undefined) {
      if (resurrected) {
        const ang = this.rng.range(-0.6, 0.6);
        const dist = 14 + this.rng.range(0, 4);
        const yaw = player.facing + ang;
        x = player.position.x - Math.sin(yaw) * dist;
        z = player.position.z - Math.cos(yaw) * dist;
        entrance = 'resurrection';
      } else if (hunting) {
        const off = spawnSafeOffset(player.position.x, player.position.z, player.facing, n.personality === 'hunter', HEAT.spawnMinDistance + this.rng.range(0, 6));
        x = off.x;
        z = off.z;
        entrance = n.personality === 'hunter' ? 'behind' : 'walk';
      } else {
        const pt = this.arena.spawnPoint(this.currentArea.id, this.rng, 0.55, 0.98);
        x = pt.x;
        z = pt.z;
        let tries = 0;
        while (Math.hypot(x - player.position.x, z - player.position.z) < (dramatic ? 14 : 22) && tries++ < 10) {
          const p2 = this.arena.spawnPoint(this.currentArea.id, this.rng, 0.5, 0.98);
          x = p2.x;
          z = p2.z;
        }
        entrance = 'walk';
      }
    }

    const e = new Enemy(n, this.mgr.mods);
    e.spawn(x, z, Math.atan2(-(player.position.x - x), -(player.position.z - z)));
    e.entranceKind = entrance;
    e.pendingIntro = true;
    e.introHold = true;
    const d0 = Math.hypot(x - player.position.x, z - player.position.z);
    e.introDelay = d0 < 20 || entrance === 'immediate' || atX !== undefined ? 0.12 : 8;
    this.scene.add(e.rig.root);
    this.enemies.push(e);
    this.activeNamed.set(n.id, e);

    this.encounterSalt++;
    e.rig.root.userData.arrivalCtx = { hunting, interrupting, resurrected, salt: this.encounterSalt };
    return e;
  }

  private playerInCombat(player: Player): boolean {
    if (!player.alive) return false;
    if (player.combat.action === 'attack' || player.combat.action === 'execute') return true;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z);
      if (d < 14 && (e.combat.attacking || e.state === 'chase' || e.state === 'attack')) return true;
    }
    return false;
  }

  private tickNamedPresentation(dt: number, player: Player): void {
    for (const e of this.enemies) {
      if (!e.alive || !e.named) continue;

      if (e.escaping && !e.escapePresented) {
        e.escapePresented = true;
        this.pickEscapeAim(e, player);
        this.hooks.onNamedEscape(e);
      }

      if (!e.pendingIntro) continue;
      e.introDelay -= dt;
      const d = Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z);
      const closeEnough =
        e.entranceKind === 'resurrection' ||
        e.entranceKind === 'immediate' ||
        d < 16 ||
        (e.introDelay <= 0 && d < 24);
      if (!closeEnough) continue;
      e.pendingIntro = false;
      const ctx = (e.rig.root.userData.arrivalCtx ?? {
        hunting: false,
        interrupting: this.playerInCombat(player),
        resurrected: false,
        salt: this.encounterSalt,
      }) as ArrivalContext & { salt?: number };
      this.hooks.onNamedArrival(e, ctx.salt ?? this.encounterSalt, {
        hunting: ctx.hunting,
        interrupting: ctx.interrupting,
        resurrected: ctx.resurrected,
      });
    }
  }

  private pickEscapeAim(e: Enemy, player: Player): void {
    const dx = e.position.x - player.position.x;
    const dz = e.position.z - player.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const far = this.arena.spawnPoint(this.currentArea.id, this.rng, 0.82, 0.98);
    const alongX = e.position.x + (dx / len) * 40;
    const alongZ = e.position.z + (dz / len) * 40;
    const useFar = Math.hypot(far.x - player.position.x, far.z - player.position.z) > 28;
    e.escapeAim.x = useFar ? far.x : alongX;
    e.escapeAim.z = useFar ? far.z : alongZ;
    e.hasEscapeAim = true;
  }

  private tickPlayerFlee(dt: number, player: Player): void {
    if (!player.alive) return;
    for (const e of this.enemies) {
      if (!e.alive || !e.named || e.escaping) continue;
      const d = Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z);
      let w = this.fleeWatch.get(e.nemesis.id);
      if (!w) {
        w = { engaged: false, away: 0, noted: false };
        this.fleeWatch.set(e.nemesis.id, w);
      }
      if (d < 12 && (e.state === 'chase' || e.state === 'attack' || e.state === 'hunt_player' || e.combat.attacking)) {
        w.engaged = true;
        w.away = 0;
      } else if (w.engaged && d > 22) {
        w.away += dt;
        if (!w.noted && w.away >= 4) {
          w.noted = true;
          this.noteFlee(e);
        }
      }
    }
  }

  private tryHunt(player: Player): Nemesis | null {
    if (this.activeNamed.size >= MAX_NAMED_ACTIVE) return null;
    const candidates = this.mgr
      .living()
      .filter((n) => !this.resolvedThisRun.has(n.id) && !this.activeNamed.has(n.id) && n.rank !== 'overlord');
    if (!candidates.length) return null;

    const weights = candidates.map((n) => {
      const p = getPersonality(n.personality);
      const stealBoost = n.stolen.some((s) => s.kind === 'weapon') ? 0.55 : 0;
      const holderBoost = this.mgr.data.territories[this.currentArea.id] === n.id ? 0.35 : 0;
      const legendBoost = this.legendBias?.huntWeight(n) ?? 0;
      return 0.15 + p.hunt * 0.4 + n.revengeChance * 1.4 + n.playerRelationship * 0.008 + stealBoost + holderBoost + legendBoost;
    });
    const pick = this.rng.weighted(candidates, weights);
    const rate = this.mgr.mods.huntRate;
    if (!this.rng.chance(Math.min(0.9, rate + pick.revengeChance * 0.4))) return null;

    this.spawnNamed(pick, player, true, undefined, undefined, { hunting: true });
    return pick;
  }

  /** Named hunter arrival copy — who + why, never generic heat alone. */
  private huntToast(n: Nemesis): string {
    const who = fullName(n).toUpperCase();
    const steel = n.stolen.find((s) => s.kind === 'weapon');
    if (steel) return `${who} — YOUR ${steel.name} BROUGHT THEM`;
    if (n.killsAgainstPlayer > 0 || n.revengeChance > 0.45) return `${who} — GRUDGE`;
    if (this.mgr.data.territories[this.currentArea.id] === n.id) return `${who} — HOLDER LAW`;
    if (n.personality === 'hunter') return `${who} — HUNTING YOU`;
    return `${who} — HEAT DREW THEM`;
  }

  /* ============================================================
     rivalries on stage
     ============================================================ */

  private updateRivalries(): void {
    const named = this.enemies.filter((e) => e.alive && e.named);
    if (named.length < 2) return;
    for (const a of named) {
      if (a.rivalTarget && a.rivalTarget.alive) continue;
      for (const b of named) {
        if (a === b) continue;
        if (!a.nemesis.rivalries.includes(b.nemesis.id)) continue;
        const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        if (d < 26) {
          const p = getPersonality(a.nemesis.personality);
          // Not everyone drops what they are doing to settle a score.
          if (this.rng.chance(0.25 + p.revenge * 0.25)) {
            a.rivalTarget = b;
            b.rivalTarget = a;
            this.hooks.onDuel(a, b);
          }
          break;
        }
      }
    }

    // Loyalists guard their masters.
    for (const a of named) {
      if (a.protectTarget || a.nemesis.personality !== 'loyalist') continue;
      const masterId = a.nemesis.master;
      if (!masterId) continue;
      const m = this.activeNamed.get(masterId);
      if (m && m.alive) {
        a.protectTarget = m;
        if (!a.aidPresented) {
          a.aidPresented = true;
          this.hooks.onAid(a, m);
        }
      }
    }
  }

  /* ============================================================
     outcomes
     ============================================================ */

  /** An enemy died in the arena. */
  /**
   * @param definite skip the fake-death roll entirely. Used by debug tools
   *        and scripted deaths, where "kill this one" has to mean it — a
   *        nondeterministic survive roll made those paths untestable and
   *        left a walking corpse mutating the record afterwards.
   */
  onEnemyKilled(e: Enemy, executed: boolean, definite = false): void {
    const turn = this.mgr.turn;
    if (!e.named) {
      this.mgr.data.playerMeta.kills++;
      return;
    }

    const n = e.nemesis;
    this.activeNamed.delete(n.id);
    this.resolvedThisRun.add(n.id);
    n.defeatsByPlayer++;

    // Some of them do not actually die.
    const p = getPersonality(n.personality);
    let survive = definite ? 0 : 0.08 * p.survival + this.mgr.mods.resurrection * 0.25;
    if (executed) survive *= 0.25;
    if (!definite && n.personality === 'survivor') survive += 0.16;
    if (!definite && rankIndex(n.rank) >= 3) survive += 0.06;
    survive *= 1 - (n.fakeDeathPenalty ?? 0);
    if (this.run.blockFakeDeath) {
      survive = 0;
      this.run.blockFakeDeath = false;
      this.run.remnants = Math.max(0, this.run.remnants - REMNANT.fakeDeathCost);
    }

    if (this.rng.chance(Math.min(0.42, survive))) {
      // Faked it.
      const scar = this.rng.pick(SCAR_POOL);
      applyScar(n, scar, turn, 'left for dead');
      n.escapedPlayer++;
      remember(n, 'I_ESCAPED_PLAYER', turn);
      n.title = chooseTitle(n, this.mgr.titlesInUse(n));
      recomputeRevenge(n);
      recomputePower(n);
      this.mgr.log(
        makeEvent(turn, this.mgr.age, 'enemy_escape', `${fullName(n)} was not finished after all.`, [n.id], true, 'bad')
      );
      this.hooks.onNamedDefeated(e, true);
      return;
    }

    remember(n, executed ? 'PLAYER_EXECUTED_ME' : 'PLAYER_KILLED_ME', turn);
    this.recoverStolen(n);
    this.mgr.data.playerMeta.kills++;
    this.mgr.data.playerMeta.namedKills++;

    const wasOverlord = n.rank === 'overlord';
    this.mgr.killNemesis(n, true, `You killed ${fullName(n)}.`);
    this.hooks.onNamedDefeated(e, false);

    if (wasOverlord) this.hooks.onOverlordSlain(e);
  }

  /** A named enemy walked away under their own power. */
  private handleEscape(e: Enemy): void {
    if (!e.named) return;
    const n = e.nemesis;
    this.activeNamed.delete(n.id);
    this.resolvedThisRun.add(n.id);
    n.escapedPlayer++;
    remember(n, 'I_ESCAPED_PLAYER', this.mgr.turn);
    recomputeRevenge(n);
    n.title = chooseTitle(n, this.mgr.titlesInUse(n));
    recomputePower(n);
    this.mgr.log(
      makeEvent(this.mgr.turn, this.mgr.age, 'enemy_escape', `${fullName(n)} broke off and vanished.`, [n.id], false, 'bad')
    );
  }

  /** The player was killed. Returns the killer's record, if named. */
  onPlayerKilled(
    killer: Enemy | null,
    playerWeaponId: string,
    habits: Record<string, number>,
    opts?: { forceSteal?: boolean }
  ): Nemesis | null {
    const turn = this.mgr.turn;
    this.mgr.data.playerMeta.deaths++;

    let killerNemesis: Nemesis | null = null;
    if (killer && killer.named) {
      const n = killer.nemesis;
      killerNemesis = n;
      this.lastKillerId = n.id;
      n.killsAgainstPlayer++;
      remember(n, 'I_KILLED_PLAYER', turn);
      recomputeRevenge(n);

      // Adaptation: they have been watching how you fight.
      const adapt = pickAdaptation(habits, n.adaptations);
      if (adapt && n.adaptations.length < 3) {
        n.adaptations.push(adapt);
        this.mgr.log(
          makeEvent(turn, this.mgr.age, 'mutation', `${fullName(n)} has learned something about you.`, [n.id], true, 'bad')
        );
      }

      // Looting. This is what creates personal revenge objectives.
      const p = getPersonality(n.personality);
      const meta = this.mgr.data.playerMeta;
      const inst = equippedWeapon(meta.progress);
      const notable = !!inst && (inst.rarity !== 'common' || inst.defId === 'sunspear' || inst.favorite);
      const willSteal =
        (opts?.forceSteal || inst?.defId === 'sunspear' || this.rng.chance(Math.min(0.85, 0.3 * p.steal + (notable ? 0.35 : 0.15)))) &&
        (inst || playerWeaponId);
      if (willSteal) {
        const stolen = inst
          ? this.takeInstance(n, inst)
          : itemForWeapon(playerWeaponId);
        if (stolen) {
          n.stolen.push(stolen);
          remember(n, 'I_STOLE_PLAYER_WEAPON', turn);
          const wid = stolen.weaponId ?? playerWeaponId;
          if (wid && !meta.lostWeapons.includes(wid)) meta.lostWeapons.push(wid);
          this.mgr.log(
            makeEvent(turn, this.mgr.age, 'weapon_theft', `${fullName(n)} took ${stolen.name} from your body.`, [n.id], true, 'bad', {
              payload: { itemName: stolen.name, weaponId: wid, instanceId: stolen.instanceId },
              known: true,
              witnessed: true,
            })
          );
        }
      }

      n.level += 1;
      n.title = chooseTitle(n, this.mgr.titlesInUse(n));
      recomputePower(n);

      // Killing you is the fastest promotion in the world.
      if (rankIndex(n.rank) < 4 && this.rng.chance(0.55 + getPersonality(n.personality).ambition * 0.15)) {
        this.mgr.promote(n);
      }

      this.mgr.log(
        makeEvent(turn, this.mgr.age, 'player_death', `${fullName(n)} killed you.`, [n.id], true, 'bad')
      );
    } else {
      this.mgr.log(makeEvent(turn, this.mgr.age, 'player_death', 'You died with nobody to blame.', [], true, 'bad'));
    }

    // Everyone who watched remembers.
    for (const e of this.enemies) {
      if (!e.alive || !e.named || e.nemesis === killerNemesis) continue;
      if (this.rng.chance(0.4)) remember(e.nemesis, 'PLAYER_RAN_FROM_ME', turn);
    }

    this.runActive = false;
    return killerNemesis;
  }

  /** Debug / tests: steal equipped gear without killing the player. */
  forceStealFrom(n: Nemesis): StolenItem | null {
    const inst = equippedWeapon(this.mgr.data.playerMeta.progress);
    if (!inst) return null;
    const stolen = this.takeInstance(n, inst);
    n.stolen.push(stolen);
    remember(n, 'I_STOLE_PLAYER_WEAPON', this.mgr.turn);
    const wid = stolen.weaponId;
    const meta = this.mgr.data.playerMeta;
    if (wid && !meta.lostWeapons.includes(wid)) meta.lostWeapons.push(wid);
    this.mgr.log(
      makeEvent(this.mgr.turn, this.mgr.age, 'weapon_theft', `${fullName(n)} took ${stolen.name}.`, [n.id], true, 'bad', {
        payload: { itemName: stolen.name, weaponId: wid, instanceId: stolen.instanceId },
        known: true,
        witnessed: true,
      })
    );
    recomputePower(n);
    return stolen;
  }

  private takeInstance(n: Nemesis, inst: ItemInstance): StolenItem {
    const meta = this.mgr.data.playerMeta;
    const prog = meta.progress;
    prog.inventory = prog.inventory.filter((x) => x.id !== inst.id);
    if (prog.loadout.weapon === inst.id) prog.loadout.weapon = null;
    const remaining = prog.inventory.filter((x) => x.kind === 'weapon');
    if (!remaining.length) {
      const fallback = mint(prog, 'iron_sword');
      prog.inventory.push(fallback);
      prog.loadout.weapon = fallback.id;
    } else if (!prog.loadout.weapon) {
      prog.loadout.weapon = remaining[0].id;
    }
    inst.history.push({ type: 'stolen_by', nemesisId: n.id, nemesisName: n.name, turn: this.mgr.turn });
    const weaponId = weaponIdFor(inst);
    if (/spear/.test(weaponId)) n.weapon = 'spear';
    syncLegacyWeapons(meta);
    return {
      name: inst.name,
      kind: inst.kind === 'relic' ? 'relic' : 'weapon',
      weaponId,
      instanceId: inst.id,
      instance: inst,
    };
  }

  /** Killing a nemesis who carries your weapon gives it back. */
  private recoverStolen(n: Nemesis): void {
    if (!n.stolen.length) return;
    const meta = this.mgr.data.playerMeta;
    const prog = meta.progress;
    for (const item of n.stolen) {
      if (item.instance) {
        markRecovered(item.instance, n.id, n.name, this.mgr.turn);
        if (!prog.inventory.some((x) => x.id === item.instance!.id)) prog.inventory.push(item.instance);
        prog.loadout.weapon = item.instance.id;
      }
      if (item.weaponId) {
        if (!meta.weapons.includes(item.weaponId)) meta.weapons.push(item.weaponId);
        const i = meta.lostWeapons.indexOf(item.weaponId);
        if (i >= 0) meta.lostWeapons.splice(i, 1);
      }
      this.hooks.onToast(`RECOVERED ${item.name}`, 'gold');
      this.mgr.log(
        makeEvent(this.mgr.turn, this.mgr.age, 'weapon_theft', `You took ${item.name} back.`, [n.id], true, 'good', {
          payload: { itemName: item.name, weaponId: item.weaponId, recoveredFrom: n.name },
          known: true,
          witnessed: true,
        })
      );
    }
    n.stolen.length = 0;
    syncLegacyWeapons(meta);
    recomputePower(n);
  }

  /** The player fled combat range of a named enemy. */
  noteFlee(e?: Enemy): void {
    if (e) {
      if (e.alive && e.named) remember(e.nemesis, 'PLAYER_RAN_FROM_ME', this.mgr.turn);
      return;
    }
    for (const x of this.enemies) {
      if (x.alive && x.named) remember(x.nemesis, 'PLAYER_RAN_FROM_ME', this.mgr.turn);
    }
  }

  /** Player used fire; nearby named enemies notice. */
  noteFire(): void {
    for (const e of this.enemies) {
      if (e.alive && e.named && e.burning > 0) {
        remember(e.nemesis, 'PLAYER_BURNED_ME', this.mgr.turn);
      }
    }
  }

  noteParry(e: Enemy): void {
    if (e.named) remember(e.nemesis, 'PLAYER_PARRIED_ME', this.mgr.turn);
  }

  /** Rivalries formed by the player killing someone's ally, etc. */
  noteAllyKilled(victim: Nemesis): void {
    for (const other of this.mgr.living()) {
      if (other.allies.includes(victim.id)) {
        remember(other, 'PLAYER_KILLED_MY_ALLY', this.mgr.turn, victim.id);
        const live = this.activeNamed.get(other.id);
        if (live && live.alive && signatureEventMatches(other, 'ally_fallen')) {
          live.queueSignatureCue();
        }
      }
    }
  }

  activeNamedList(): Enemy[] {
    return Array.from(this.activeNamed.values());
  }

  markResolved(id: string): void {
    this.resolvedThisRun.add(id);
  }

  /** Force two named enemies into a feud, used by the debug tools. */
  forceRivalry(a: Nemesis, b: Nemesis): void {
    makeRivals(a, b);
    const ea = this.activeNamed.get(a.id);
    const eb = this.activeNamed.get(b.id);
    if (ea && eb) {
      ea.rivalTarget = eb;
      eb.rivalTarget = ea;
    }
  }

  territoryNow(): TerritoryPresentation {
    const holderId = this.mgr.data.territories[this.currentArea.id] ?? null;
    const holder = holderId ? this.mgr.byId(holderId) : null;
    return presentTerritory(this.currentArea, holder && holder.alive ? holder : null, this.run.territoryMods, this.mgr.turn);
  }

  private gruntDelta(): number {
    const p = this.territoryNow();
    let d = this.spawnTuning?.gruntPopDelta ?? 0;
    if (p.liberation?.kind === 'fewer_patrols') d -= 3;
    if (p.rules.some((r) => r.id === 'elevated_archers' || r.id === 'tracking_patrols')) d += 2;
    if (p.rules.some((r) => r.id === 'armored_gate')) d += 1;
    if (this.run.heat >= 20) d += 1;
    if (this.run.heat >= 40) d += 1;
    return d;
  }

  private pulseHeat(player: Player, threshold: number): void {
    if (threshold >= 100) {
      const ov = this.mgr.overlord();
      if (ov && !this.resolvedThisRun.has(ov.id) && !this.activeNamed.has(ov.id)) {
        this.spawnNamed(ov, player, true, undefined, undefined, { hunting: true });
        this.hooks.onToast(`${fullName(ov).toUpperCase()} — THE CROWN ANSWERS HEAT`, 'hot');
      } else {
        this.hooks.onToast(this.heatFallbackToast(threshold, 'overlord'), 'hot');
      }
      return;
    }
    if (threshold >= 95) {
      this.hooks.onToast(this.heatFallbackToast(threshold, 'reinforce'), 'hot');
      for (let i = 0; i < 2; i++) {
        const off = spawnSafeOffset(player.position.x, player.position.z, player.facing + i, false, HEAT.spawnMinDistance + 4);
        this.spawnGrunt(off.x, off.z);
      }
      return;
    }
    if (threshold >= 75) {
      const named = this.mgr.living().filter((n) => n.rivalries.length && !this.activeNamed.has(n.id) && !this.resolvedThisRun.has(n.id));
      if (named[0]) {
        this.spawnNamed(named[0], player, true, undefined, undefined, { hunting: true });
        this.hooks.onToast(this.huntToast(named[0]), 'hot');
      } else {
        const hunted = this.tryHunt(player);
        this.hooks.onToast(hunted ? this.huntToast(hunted) : this.heatFallbackToast(threshold, 'pressure'), 'hot');
      }
      return;
    }
    if (threshold >= 60) {
      const hunted = this.tryHunt(player);
      this.hooks.onToast(hunted ? this.huntToast(hunted) : this.heatFallbackToast(threshold, 'hunt_miss'), 'hot');
    } else if (threshold >= 40) {
      this.hooks.onToast(this.heatFallbackToast(threshold, 'patrol'), 'hot');
      const off = spawnSafeOffset(player.position.x, player.position.z, player.facing, false, HEAT.spawnMinDistance);
      this.spawnGrunt(off.x, off.z);
    } else {
      this.hooks.onToast(this.heatFallbackToast(threshold, 'stir'), 'hot');
    }
  }

  /** When heat rises but no named hunter walks on stage — still name the consequence. */
  private heatFallbackToast(
    threshold: number,
    kind: 'overlord' | 'reinforce' | 'pressure' | 'hunt_miss' | 'patrol' | 'stir'
  ): string {
    void threshold;
    const label = heatLabel(this.run.heat);
    const terr = this.territoryNow();
    const holder =
      terr.holderName !== 'UNCLAIMED' ? terr.holderName.toUpperCase() : null;
    const rule = terr.rules[0] && terr.rules[0].id !== 'void_quiet' ? terr.rules[0].title : null;

    if (kind === 'reinforce') {
      return this.run.lockedExits
        ? `EXITS LOCKED — REINFORCEMENTS CLOSING IN`
        : `HEAT — ${label} · REINFORCEMENTS CLOSING IN`;
    }
    if (kind === 'overlord') {
      return this.run.lockedExits
        ? 'EXITS LOCKED — THE OVERLORD IS STIRRING'
        : `HEAT PEAK — ${label} · THE OVERLORD IS STIRRING`;
    }
    if (kind === 'patrol') {
      return holder && rule
        ? `${holder} · ${rule} — PATROLS TIGHTEN`
        : `HEAT — ${label} · PATROLS TIGHTEN`;
    }
    if (this.run.lockedExits) {
      return 'EXITS LOCKED — HOLD THE GATE OR BREAK OUT';
    }
    if (kind === 'pressure' || kind === 'hunt_miss') {
      if (holder && rule) return `${holder} · HOLDER LAW PRESSURE — ${rule}`;
      return `HEAT — ${label} · THE AREA IS HUNTING YOU`;
    }
    return holder ? `HEAT — ${label} · ${holder}'S GROUND NOTICES YOU` : `HEAT — ${label} · KEEP MOVING`;
  }

  private refreshMultiRule(): void {
    const named = this.enemies.filter((e) => e.alive && e.named).map((e) => e.nemesis);
    const next = pickMultiRule(named);
    if (next && (!this.multiRule || this.multiRule.id !== next.id)) {
      this.multiRule = next;
      this.stageTimer = STAGING_IGNORE_S;
      this.stageResolved = false;
      this.hooks.onToast(`${next.title} — ${next.desc}`, 'gold');
    }
    if (named.length < 2) this.multiRule = null;
  }

  private tickStaging(dt: number, player: Player): void {
    const inCombat = this.playerInCombat(player);
    applyStagingPose(this.enemies, this.multiRule, player, inCombat);
    if (!this.multiRule || inCombat || this.stageResolved) return;
    this.stageTimer -= dt;
    if (this.stageTimer > 0) return;
    this.stageResolved = true;
    const resolved = resolveIgnoredStaging(this.multiRule, this.enemies, this.mgr.turn, this.mgr.age);
    if (!resolved) return;
    this.hooks.onToast(resolved.toast, 'neutral');
    for (const ev of resolved.events) this.mgr.log(ev);
    if (this.multiRule.id === 'coward_alarm') {
      const off = spawnSafeOffset(player.position.x, player.position.z, player.facing, false, HEAT.spawnMinDistance);
      this.spawnGrunt(off.x, off.z);
    }
  }

  private buildExtractSites(): void {
    this.extractSites = AREAS.map((a, i) => {
      const pt = this.arena.extractPoint(a.id);
      return { id: `ex-${a.id}-${i}`, areaId: a.id, x: pt.x, z: pt.z, label: `GATE — ${a.landmark}` };
    });
  }

  refreshOccupancy(): void {
    this.occupancy = snapshotOccupancy(this.mgr, this.run.started ? this.run : null);
    this.arena.applyOccupancy(this.occupancy);
  }

  nearestExtract(x: number, z: number, maxD: number): ExtractSite | null {
    let best: ExtractSite | null = null;
    let bestD = maxD;
    for (const s of this.extractSites) {
      if (this.run.lockedExits && s.areaId !== this.currentArea.id) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  dropRemnant(named: boolean, playerCredit: boolean, summoned: boolean): void {
    if (!playerCredit || summoned) return;
    if (named) this.run.remnants = Math.min(REMNANT.maxCarry, this.run.remnants + 1 + REMNANT.namedBonus);
    else if (this.rng.chance(REMNANT.dropChance)) this.run.remnants = Math.min(REMNANT.maxCarry, this.run.remnants + 1);
  }

  liberateCurrent(kind: string): void {
    this.run.territoryMods[this.currentArea.id] = { kind, untilTurn: this.mgr.turn + 2 };
    this.mgr.data.territoryMods = this.run.territoryMods;
    this.refreshOccupancy();
  }

  tickExtraction(dt: number, player: Player): boolean {
    if (!this.run.extraction.active) return false;
    const site = this.extractSites.find((s) => s.id === this.run.extraction.siteId);
    if (!site) {
      this.run.extraction.active = false;
      return false;
    }
    const dist = Math.hypot(player.position.x - site.x, player.position.z - site.z);
    if (dist > 5.2) {
      this.cancelExtraction('LEFT THE GATE');
      return false;
    }
    this.run.extraction.progress += dt / EXTRACT.channelTime;
    if (this.run.extraction.progress >= 1) {
      this.run.extraction.active = false;
      return true;
    }
    return false;
  }

  cancelExtraction(reason?: string): void {
    if (!this.run.extraction.active) return;
    this.run.extraction.active = false;
    this.run.extraction.progress = 0;
    this.run.extraction.siteId = null;
    if (reason) this.hooks.onToast(reason, 'hot');
  }
}

const SCAR_POOL: ScarId[] = [
  'burn',
  'missing_eye',
  'broken_mask',
  'metal_jaw',
  'damaged_arm',
  'cracked_armor',
  'corruption',
  'shattered_horn',
];

function itemForWeapon(weaponId: string): StolenItem | null {
  const relic = RELIC_WEAPONS[weaponId];
  if (relic) return { name: relic.name, kind: 'relic', weaponId };
  const basic = PLAYER_WEAPONS[weaponId];
  if (basic) return { name: `YOUR ${basic.name}`, kind: 'weapon', weaponId };
  return null;
}
