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
import type { Bus } from '../core/Events';
import { AREAS, getArea, nearestArea, type AreaDef } from '../data/areas';
import { getPersonality } from '../data/personalities';
import { pickAdaptation } from '../data/traits';
import { chooseTitle } from '../data/names';
import { RELIC_WEAPONS, PLAYER_WEAPONS } from '../data/weapons';
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

const MAX_GRUNTS = 16;
const MAX_NAMED_ACTIVE = 3;
const DESPAWN_DISTANCE = 110;

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
}

export class World {
  enemies: Enemy[] = [];
  currentArea: AreaDef = AREAS[0];

  /** nemesis ids already resolved this run (dead, escaped, or fled) */
  private resolvedThisRun = new Set<string>();
  /** nemesis ids currently on stage */
  private activeNamed = new Map<string, Enemy>();

  private rng: RNG;
  private huntTimer = 60;
  private gruntSeed = 1;
  private encounterSalt = 0;

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

    const start = this.arena.spawnPoint('pit', this.rng, 0.1, 0.35);
    player.spawn(start.x, start.z, this.rng.range(-Math.PI, Math.PI), this.mgr.data.playerMeta.vigour, this.mgr.data.playerMeta.equipped);
    this.currentArea = getArea('pit');
    this.populateArea(this.currentArea, player, true);
  }

  endRun(): void {
    this.runActive = false;
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

    /* ---- area transitions ---- */
    const area = nearestArea(player.position.x, player.position.z);
    if (area.id !== this.currentArea.id) {
      this.currentArea = area;
      this.onEnterArea(area, player);
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
    };
    for (const e of this.enemies) {
      if (e.alive) updateEnemyAI(e, ctx);
    }

    this.tickNamedPresentation(dt, player);
    this.tickPlayerFlee(dt, player);

    /* ---- housekeeping ---- */
    this.reapEnemies(player);
    this.maintainPopulation(player);
    this.updateRivalries();

    /* ---- hunters ---- */
    this.huntTimer -= dt;
    if (this.huntTimer <= 0) {
      this.huntTimer = 60 + this.rng.range(0, 55);
      this.tryHunt(player);
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
    this.hooks.onToast(`ENTERING ${area.name}`, 'neutral');
    this.populateArea(area, player, false);
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

  private maintainPopulation(player: Player): void {
    const alive = this.enemies.filter((e) => e.alive && !e.named).length;
    const target = Math.min(MAX_GRUNTS, this.currentArea.population + Math.floor(this.mgr.age / 2));
    if (alive >= target) return;
    // Spawn just out of sight and let them walk in.
    for (let i = alive; i < target; i++) {
      const pt = this.arena.spawnPoint(this.currentArea.id, this.rng, 0.35, 0.98);
      const d = Math.hypot(pt.x - player.position.x, pt.z - player.position.z);
      if (d < 26) continue;
      this.spawnGrunt(pt.x, pt.z);
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
    const level = 1 + Math.floor(this.mgr.age * 1.2) + this.rng.int(0, 2) + Math.floor(this.currentArea.danger * 0.8);
    const n = generateGrunt(seed, level, this.mgr.mods, this.currentArea.id);
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
      } else if (hunting && n.personality === 'hunter') {
        const dist = 16 + this.rng.range(0, 5);
        const yaw = player.facing + Math.PI + this.rng.range(-0.35, 0.35);
        x = player.position.x - Math.sin(yaw) * dist;
        z = player.position.z - Math.cos(yaw) * dist;
        entrance = 'behind';
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

  private tryHunt(player: Player): void {
    if (this.activeNamed.size >= MAX_NAMED_ACTIVE) return;
    const candidates = this.mgr
      .living()
      .filter((n) => !this.resolvedThisRun.has(n.id) && !this.activeNamed.has(n.id) && n.rank !== 'overlord');
    if (!candidates.length) return;

    const weights = candidates.map((n) => {
      const p = getPersonality(n.personality);
      return 0.15 + p.hunt * 0.4 + n.revengeChance * 1.4 + n.playerRelationship * 0.008;
    });
    const pick = this.rng.weighted(candidates, weights);
    const rate = this.mgr.mods.huntRate;
    if (!this.rng.chance(Math.min(0.9, rate + pick.revengeChance * 0.4))) return;

    this.spawnNamed(pick, player, true, undefined, undefined, { hunting: true });
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
  onEnemyKilled(e: Enemy, executed: boolean): void {
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
    let survive = 0.08 * p.survival + this.mgr.mods.resurrection * 0.25;
    if (executed) survive *= 0.25; // an execution is meant to be final
    if (n.personality === 'survivor') survive += 0.16;
    if (rankIndex(n.rank) >= 3) survive += 0.06;

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
  onPlayerKilled(killer: Enemy | null, playerWeaponId: string, habits: Record<string, number>): Nemesis | null {
    const turn = this.mgr.turn;
    this.mgr.data.playerMeta.deaths++;

    let killerNemesis: Nemesis | null = null;
    if (killer && killer.named) {
      const n = killer.nemesis;
      killerNemesis = n;
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
      if (this.rng.chance(Math.min(0.85, 0.3 * p.steal + 0.2)) && playerWeaponId) {
        const item = itemForWeapon(playerWeaponId);
        if (item) {
          n.stolen.push(item);
          remember(n, 'I_STOLE_PLAYER_WEAPON', turn);
          this.mgr.data.playerMeta.lostWeapons.push(playerWeaponId);
          const idx = this.mgr.data.playerMeta.weapons.indexOf(playerWeaponId);
          if (idx >= 0) this.mgr.data.playerMeta.weapons.splice(idx, 1);
          if (this.mgr.data.playerMeta.equipped === playerWeaponId) {
            this.mgr.data.playerMeta.equipped = this.mgr.data.playerMeta.weapons[0] ?? 'sword';
            if (!this.mgr.data.playerMeta.weapons.length) this.mgr.data.playerMeta.weapons.push('sword');
          }
          this.mgr.log(
            makeEvent(turn, this.mgr.age, 'weapon_theft', `${fullName(n)} took ${item.name} from your body.`, [n.id], true, 'bad')
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

  /** Killing a nemesis who carries your weapon gives it back. */
  private recoverStolen(n: Nemesis): void {
    if (!n.stolen.length) return;
    for (const item of n.stolen) {
      if (item.weaponId) {
        const meta = this.mgr.data.playerMeta;
        if (!meta.weapons.includes(item.weaponId)) meta.weapons.push(item.weaponId);
        const i = meta.lostWeapons.indexOf(item.weaponId);
        if (i >= 0) meta.lostWeapons.splice(i, 1);
        this.hooks.onToast(`RECOVERED ${item.name}`, 'gold');
        this.mgr.log(
          makeEvent(this.mgr.turn, this.mgr.age, 'weapon_theft', `You took ${item.name} back.`, [n.id], true, 'good')
        );
      }
    }
    n.stolen.length = 0;
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
