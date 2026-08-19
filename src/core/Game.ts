/**
 * Wiring. Owns the renderer, the loop, the UI state machine, and the flow
 * between runs, deaths and world turns.
 */

import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { Input } from './Input';
import { SaveSystem, type Quality, type Settings } from './SaveSystem';
import { createBus, type Bus } from './Events';
import { RNG, randomSeed } from './RNG';
import { Telemetry } from './Telemetry';

import { Arena } from '../world/Arena';
import { World, type ArrivalContext } from '../world/World';
import { simulateTurn, simulateSuccession } from '../world/WorldSimulation';
import type { WorldEvent } from '../world/WorldEvent';

import { NemesisManager } from '../nemesis/NemesisManager';
import { fullName, rankIndex, type Archetype, type Nemesis, type Rank, type WeaponType } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar } from '../nemesis/NemesisMemory';
import { makeRivals } from '../nemesis/NemesisRelationships';
import { NemesisEncounterDirector, aidCallout, betrayalCallout, duelCallout } from '../nemesis/NemesisEncounterDirector';
import { classifyEncounter, type EncounterKind } from '../nemesis/EncounterKind';
import { encounterLine } from '../nemesis/EncounterCopy';
import { rankName } from '../nemesis/NemesisManager';

import { Player } from '../player/Player';
import { Enemy } from '../enemy/Enemy';
import { CombatSystem } from '../combat/CombatSystem';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { Particles } from '../fx/Particles';
import { VFX } from '../fx/VFX';
import { PostFX } from '../fx/PostFX';
import { crossedFootstep, buildAttackTimeline } from '../anim/AnimEvents';
import { AudioManager } from '../audio/AudioManager';
import { AbilityManager } from '../abilities/AbilityManager';

import { HUD } from '../ui/HUD';
import { TitleScreen } from '../ui/TitleScreen';
import { HierarchyScreen } from '../ui/HierarchyScreen';
import { DeathReport } from '../ui/DeathReport';
import { NemesisIntro } from '../ui/NemesisIntro';
import { PowerSelect } from '../ui/PowerSelect';
import { PauseScreen } from '../ui/PauseScreen';
import { DebugOverlay, type DebugHooks } from '../ui/DebugOverlay';
import { AIStatus } from '../ui/AIStatus';

import { AIContentService } from '../ai/AIContentService';
import type { MythEventKind } from '../ai/AITypes';

import { getArea } from '../data/areas';
import { type PowerDef, type PowerId } from '../data/abilities';
import { RELIC_WEAPONS } from '../data/weapons';
import { getPersonality } from '../data/personalities';
import { traitName } from '../data/traits';
import { RUN_STATS, formatStat, statValue, type RunStatId } from '../data/stats';
import { ATTACK_MAP } from '../data/attacks';
import { DebugDraw } from '../fx/DebugDraw';

type Mode = 'title' | 'playing' | 'paused' | 'hierarchy' | 'report' | 'power' | 'dying';

const RELIC_ORDER = ['sunblade', 'ashfang', 'longtooth'];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private input: Input;
  private bus: Bus = createBus();
  private saveSys = new SaveSystem();
  private audio = new AudioManager();
  private particles = new Particles();
  private vfx = new VFX(this.particles);
  private prevLocoPhase = 0;
  private arena = new Arena();
  private post!: PostFX;
  private camera: ThirdPersonCamera;
  private mgr: NemesisManager;
  private world: World;
  private player = new Player();
  private combat!: CombatSystem;
  private abilities: AbilityManager;
  private rng = new RNG(randomSeed());
  /**
   * Presentation only. Nothing this object returns is ever written into a
   * mechanical field — see src/ai/AITypes.ts for the full contract.
   */
  private ai = new AIContentService();
  private encounter = new NemesisEncounterDirector();
  /** QA + death analysis. Off by default; see core/Telemetry.ts. */
  readonly telemetry = new Telemetry();

  private ui: {
    hud: HUD;
    title: TitleScreen;
    hierarchy: HierarchyScreen;
    report: DeathReport;
    intro: NemesisIntro;
    power: PowerSelect;
    pause: PauseScreen;
    debug: DebugOverlay;
    aiStatus: AIStatus;
  };

  private mode: Mode = 'title';
  private lockGrace = 0;
  private deathTimer = 0;
  private pendingKiller: Enemy | null = null;
  private lockTargetUid: number | null = null;
  private debugInvulnerable = false;
  private debugInfiniteSurge = false;
  private debugOpen = false;
  /** scene-space debug rendering: vectors, hitboxes, trajectories (F1) */
  private debugDraw = new DebugDraw();
  /** kills needed for the next stat-boon offer — MegaBonk-style growth */
  private nextBoonKills = 7;
  /** True between the Overlord's death and the succession report. */
  private succession = false;
  private quality: Quality;
  private lowFpsTime = 0;
  private markedUid = -1;
  private uiRoot: HTMLElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;

    // Antialiasing is fixed at context creation, so the stored/URL quality has
    // to be read before the renderer exists.
    const boot = readBootQuality();
    this.quality = boot;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: boot === 'high',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatioFor(boot));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.camera.setArena(this.arena);
    this.post = new PostFX(this.renderer, this.arena.scene, this.camera.camera);
    this.post.configure(boot, window.innerWidth, window.innerHeight);

    this.input = new Input(canvas);
    this.mgr = new NemesisManager(this.saveSys, this.bus);
    this.abilities = new AbilityManager(this.rng);

    this.ui = {
      hud: new HUD(),
      title: new TitleScreen(),
      hierarchy: new HierarchyScreen(),
      report: new DeathReport(),
      intro: new NemesisIntro(),
      power: new PowerSelect(),
      pause: new PauseScreen(),
      debug: new DebugOverlay(),
      aiStatus: new AIStatus(),
    };
    for (const k of Object.keys(this.ui) as Array<keyof typeof this.ui>) {
      uiRoot.append(this.ui[k].root);
    }
    this.setupAI();
    this.bindEncounter();

    this.world = new World(this.mgr, this.arena, this.arena.scene, this.bus, {
      onNamedArrival: (e, salt, ctx) => this.onNamedArrival(e, salt, ctx),
      onNamedEscape: (e) => this.encounter.begin(e, this.mgr.turn, { outcome: 'escape' }),
      onToast: (t, tone) => this.ui.hud.toast(t, tone),
      onOverlordSlain: (e) => this.onOverlordSlain(e),
      onNamedDefeated: (e, escaped) => this.onNamedDefeated(e, escaped),
      onDuel: (a, b) => {
        this.ui.hud.toast(duelCallout(a.nemesis, b.nemesis), 'gold');
        this.audio.play('nemesis_betrayal', { volume: 0.45 });
      },
      onAid: (g, m) => this.ui.hud.toast(aidCallout(g.nemesis, m.nemesis), 'gold'),
    });

    this.arena.scene.add(this.particles.group);
    this.arena.scene.add(this.vfx.group);
    this.arena.scene.add(this.player.root);

    this.combat = new CombatSystem(
      this.player,
      this.world.enemies,
      this.arena,
      this.particles,
      this.vfx,
      this.audio,
      this.loopRef(),
      this.camera,
      this.arena.scene,
      {
        onEnemyKilled: (e, executed) => this.onEnemyKilled(e, executed),
        onPlayerKilled: (killer) => this.onPlayerKilled(killer),
        onPlayerDamaged: (from, amount) => this.onPlayerDamaged(from, amount),
        onParrySuccess: (e) => this.world.noteParry(e),
        onEnemyStaggered: () => void 0,
        onHabit: (k, amount) => {
          this.player.stats.habits[k] += amount ?? 1;
        },
        onExecutionStarted: (e) => this.onNamedExecution(e),
      }
    );

    this.combat.telemetry = this.telemetry;

    this.bus.on('sfx', ({ name, volume, pitch }) => this.audio.play(name, { volume, pitch }));
    this.bus.on('worldEvent', (ev) => {
      if (ev.important && this.mode === 'playing') this.ui.hud.toast(ev.text, ev.tone === 'bad' ? 'hot' : 'gold');
    });

    window.addEventListener('resize', () => this.onResize());
    canvas.addEventListener('mousedown', () => {
      this.audio.unlock();
      if (this.mode === 'playing' && !this.input.isPointerLocked) {
        this.lockGrace = 0.6;
        this.input.requestPointerLock();
      }
    });
    window.addEventListener('keydown', (e) => this.onRawKey(e));
  }

  /** GameLoop is constructed lazily so `this` is fully initialised. */
  private _loop: GameLoop | null = null;
  private loopRef(): GameLoop {
    if (!this._loop) this._loop = new GameLoop((dt, rdt) => this.tick(dt, rdt));
    return this._loop;
  }

  /* ============================================================
     AI (presentation only)
     ============================================================ */

  /**
   * Wire the AI service to the UI. Note what is NOT here: nothing subscribes
   * the game loop to an AI promise, and no method below is awaited on a frame
   * path. AI content arrives by callback and is picked up on the next render.
   */
  private setupAI(): void {
    this.ai.bind({
      onStatusChange: () => {
        this.ui.aiStatus.setIndicator(this.ai.indicator());
        // Connection (or the local engine) can appear after boot. If we are
        // still on title with a real save, start filling the hierarchy then.
        if (this.mode === 'title' && this.saveSys.exists()) this.warmTitleGeneration();
      },
      onContentReady: (id, kind) => {
        // A portrait or title landing while the Book is open should show up
        // without the player doing anything.
        this.ui.hierarchy.refreshIfOpen();
        // If the enemy on screen just earned a title, say so — quietly.
        if (kind === 'identity' && this.mode === 'playing') {
          const n = this.mgr.byId(id);
          if (n && this.world.enemies.some((e) => e.alive && e.named && e.nemesis.id === id)) {
            this.ui.hud.toast(`${n.name.toUpperCase()} IS NOW ${this.ai.titleFor(n)}`, 'gold', 4);
          }
        }
      },
      onFirstGeneration: () => this.ui.aiStatus.showHerald(),
      onDirty: () => {
        this.aiDirty = true;
      },
    });
    this.ui.aiStatus.onOpenSettings = () => this.openAISettings();
    // Closing the tab mid-burst must not lose generated content. Closing the
    // tab also tells the local engine to wind down (a refresh can cancel).
    window.addEventListener('pagehide', () => {
      this.flushAI();
      this.ai.backend.localGoodbye();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAI();
    });
    this.ai.init();
    window.setInterval(() => {
      if (this.ai.backend.localRunning) void this.ai.backend.localHeartbeat();
    }, 20_000);
  }

  private bindEncounter(): void {
    const g = this;
    this.encounter.bind({
      presentCard: (p) => g.ui.intro.present(p),
      revealCard: (part) => g.ui.intro.reveal(part),
      hideCard: () => g.ui.intro.hide(),
      callout: (text, tone) => g.ui.hud.toast(text, tone),
      playSfx: (name, volume) => g.audio.play(name, { volume }),
      duckAudio: (s) => g.audio.duck(s),
      cameraEmphasis: (x, y, z, amount) => {
        g.camera.pulseFov(4 + amount * 6);
        g.camera.nudgeToward(x, y, z, amount);
      },
      storyVfx: (kind, e, accent) => {
        const map =
          kind === 'RESURRECTION_RETURN'
            ? 'resurrection'
            : kind === 'OVERLORD_ENCOUNTER'
              ? 'overlord'
              : kind === 'PROMOTION_REVEAL'
                ? 'promotion'
                : kind === 'ESCAPE' || kind === 'FAKE_DEATH'
                  ? 'escape'
                  : kind === 'NEMESIS_DEFEATED'
                    ? 'death'
                    : 'arrival';
        g.vfx.story(map, e.position.x, e.position.z, accent || e.rig.accent);
      },
      playPose: (e, pose) => {
        e.rig.anim.proudWalk = pose.proudWalk;
        e.taunt(pose.clip, pose.rate);
      },
      shake: (a) => g.camera.shake(a),
      slowMo: (s, scale) => g.loop.slowMo(s, scale),
      hitStop: (s) => g.loop.hitStop(s),
      clearSlowMo: () => g.loop.clearSlowMo(),
      portraitFor: (n) => g.ai.portraitFor(n),
      titleFor: (n) => g.ai.titleFor(n),
      tauntFor: (n, salt) => g.ai.tauntFor(n, salt),
    });
  }

  /** Set when generated content changed and the save is due a write. */
  private aiDirty = false;
  private aiSaveTimer = 0;

  private syncAIWorld(): void {
    this.ai.setWorld({
      turn: this.mgr.turn,
      age: this.mgr.age,
      ageName: this.mgr.ageState.name,
      nameOf: (id) => {
        const n = this.mgr.byId(id);
        return n ? n.name.toUpperCase() : '';
      },
    });
  }

  /**
   * The single funnel for myth events. Safe to call when AI is off.
   *
   * Persists straight away rather than waiting for the batching timer: myth
   * events are rare (a handful per run) and they carry the version bumps that
   * define a nemesis's identity. Losing one to a closed tab would desync the
   * cache keys from the character.
   */
  private myth(n: Nemesis | null | undefined, kind: MythEventKind): void {
    if (!n) return;
    this.syncAIWorld();
    this.ai.onMythEvent(n, kind);
    this.aiDirty = false;
    this.mgr.persist();
  }

  /**
   * Read the world log after a simulated turn and raise a myth event for each
   * thing that actually happened. This keeps the AI layer downstream of the
   * simulation rather than tangled into it.
   */
  private mythFromEvents(events: WorldEvent[]): void {
    for (const ev of events) {
      const actors = ev.actors ?? [];
      const primary = this.mgr.byId(actors[0] ?? null);
      if (!primary) continue;
      switch (ev.type) {
        case 'promotion':
          this.myth(
            primary,
            primary.rank === 'overlord'
              ? 'became_overlord'
              : primary.rank === 'warlord'
                ? 'promoted_warlord'
                : 'promoted_captain'
          );
          break;
        case 'resurrection':
          this.myth(primary, 'returned_from_death');
          break;
        case 'injury':
        case 'mutation':
          this.myth(primary, 'major_scar');
          break;
        case 'weapon_theft':
          this.myth(primary, 'stole_weapon');
          break;
        case 'betrayal':
        case 'assassination':
        case 'duel':
          this.myth(primary, 'killed_rival');
          break;
        default:
          break;
      }
    }
  }

  private openAISettings(): void {
    if (this.mode === 'playing') this.openPause();
    else if (this.mode === 'title') this.openTitleSettings();
    this.ui.pause.focusAI();
  }

  /**
   * Settings from the title screen: same pause panel, but the run never
   * starts and `mode` stays `title` so Esc returns here rather than into play.
   */
  private openTitleSettings(): void {
    if (this.mode !== 'title') return;
    this.ui.pause.open(
      this.mgr.data.settings,
      {
        onResume: () => this.ui.pause.close(),
        onExtract: () => this.ui.pause.close(),
        onQuit: () => this.ui.pause.close(),
        onSettingsChanged: (s) => {
          this.applySettings(s);
          if (this.saveSys.exists()) this.mgr.persist();
        },
        ai: this.aiSettingsHooks(),
      },
      false
    );
  }

  /**
   * Queue titles/portraits for the Overlord and captains while the player is
   * still on title (or the instant a new world is persisted). Never blocks.
   */
  private warmTitleGeneration(): void {
    if (!this.mgr.data) return;
    this.syncAIWorld();
    this.ai.ensureRoster(this.mgr.living());
  }

  /** Handed to the settings panel so it never touches the service directly. */
  private aiSettingsHooks() {
    const g = this;
    return {
      getSettings: () => g.mgr.data.settings.ai,
      setSettings: (s: typeof g.mgr.data.settings.ai) => {
        g.mgr.data.settings.ai = s;
        g.ai.setSettings(s);
        // A title screen with no save is a throwaway roster — keep settings
        // in memory so NEW WORLD inherits them, but do not persist or spend
        // requests on a world the player has not started.
        if (g.saveSys.exists()) {
          g.mgr.persist();
          if (g.mode === 'title') g.warmTitleGeneration();
        }
      },
      status: () => {
        const st = g.ai.status();
        return {
          connected: st.connected,
          verified: st.verified,
          error: st.error,
          backendReachable: st.backendReachable,
        };
      },
      connect: (key: string) => g.ai.backend.connect(key),
      disconnect: () => g.ai.backend.disconnect(),
      test: () => g.ai.backend.test(),
      textAvailable: () => g.ai.backend.textAvailable,
      /* ---- LOCAL AI ENGINE (side-by-side provider) ---- */
      localStatus: () => g.ai.backend.localStatus(),
      localInstall: async () => {
        await g.ai.backend.localInstall();
      },
      localStart: async () => {
        await g.ai.backend.localStart();
      },
      localStop: async () => {
        await g.ai.backend.localStop();
      },
      localRestart: async () => {
        await g.ai.backend.localRestart();
      },
      localRemove: async (purgeModels: boolean) => {
        await g.ai.backend.localRemove(purgeModels);
      },
      localOpenFolder: async () => {
        await g.ai.backend.localOpenFolder();
      },
      activity: () => {
        const st = g.ai.status();
        if (st.mode === 'off') return 'Off — local generation';
        if (!st.connected) return 'Not connected — local generation';
        if (st.active > 0) return `Generating (${st.active} active, ${st.queued} queued)`;
        if (st.queued > 0) return `${st.queued} queued`;
        const last = st.last;
        if (last && last.state === 'failed') return `Idle — last request failed: ${last.error}`;
        if (last) return `Idle — last ${last.kind} ${last.latencyMs}ms`;
        return 'Idle';
      },
    };
  }

  /* ============================================================
     boot
     ============================================================ */

  /**
   * Rebuilding the arena clears the scene, so every caller has to put the
   * player, the particles and any live enemies back. One place to get it right.
   */
  private rebuildArena(): void {
    this.arena.build(this.mgr.data.worldSeed, this.mgr.mods);
    this.camera.setArena(this.arena);
    this.arena.scene.add(this.particles.group);
    this.arena.scene.add(this.vfx.group);
    this.arena.scene.add(this.player.root);
    this.arena.scene.add(this.debugDraw.group);
    for (const e of this.world.enemies) this.arena.scene.add(e.rig.root);
  }

  start(): void {
    const loaded = this.mgr.loadExisting();
    if (!loaded) {
      // Build a provisional world so the title screen has something to show
      // after the player presses NEW WORLD; nothing is written until then.
      this.mgr.newWorld(randomSeed());
      this.saveSys.wipe();
      this.mgr.data.worldTurn = 1;
    }
    const urlQuality = new URLSearchParams(location.search).get('quality');
    if (urlQuality === 'low' || urlQuality === 'medium' || urlQuality === 'high') {
      this.mgr.data.settings.quality = urlQuality;
      this.mgr.data.settings.autoQuality = false;
    }
    this.applySettings(this.mgr.data.settings);
    this.syncAIWorld();
    this.rebuildArena();
    this.showTitle(loaded);
    this.loop.start();
  }

  private showTitle(hasSave: boolean): void {
    this.mode = 'title';
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.hud.setVisible(false);
    this.ui.report.hide();
    this.ui.intro.hide();
    this.ui.power.hide();
    this.ui.hierarchy.close();
    this.ui.pause.close();
    this.world.endRun();

    const ov = this.mgr.overlord();
    this.ui.title.present(
      {
        hasSave,
        age: this.mgr.age,
        ageName: this.mgr.ageState.name,
        turn: this.mgr.turn,
        overlord: ov ? fullName(ov) : '',
        livingNamed: this.mgr.living().length,
        runs: this.mgr.data.playerMeta.runs,
        deaths: this.mgr.data.playerMeta.deaths,
      },
      {
        onContinue: () => this.beginPlaying(),
        onNewWorld: () => {
          this.mgr.newWorld(randomSeed());
          this.rebuildArena();
          this.beginPlaying();
        },
        onReset: () => {
          this.mgr.wipe();
          this.mgr.newWorld(randomSeed());
          this.rebuildArena();
          this.showTitle(true);
        },
      }
    );
    if (hasSave) this.warmTitleGeneration();
  }

  private beginPlaying(): void {
    this.audio.unlock();
    this.ui.title.hide();
    this.ui.pause.close();
    this.mgr.persist();
    this.warmTitleGeneration();
    this.startRun();
  }

  /* ============================================================
     runs
     ============================================================ */

  private startRun(): void {
    this.mgr.data.playerMeta.runs++;
    this.mgr.fillRanks();
    this.world.startRun(this.player);
    this.combat.setEnemies(this.world.enemies);
    this.combat.clearProjectiles();
    this.particles.clear();
    this.vfx.clear();
    this.nextBoonKills = 7;

    this.camera.snapBehind(this.player.position, this.player.facing);
    this.lockTargetUid = null;
    this.encounter.reset();
    this.camera.clearStoryFocus();
    this.loop.clearSlowMo();

    this.mode = 'playing';
    this.input.setEnabled(true);
    this.input.clearBuffers();
    this.lockGrace = 0.8;
    this.input.requestPointerLock();
    this.loop.paused = false;
    this.loop.clearTimeEffects();

    this.ui.hud.setVisible(true);
    this.ui.report.hide();
    this.refreshPowerChips();
    // `world.startRun` above can spawn a named enemy, whose arrival card owns
    // the centre of the screen. The area banner is the lesser message and the
    // area name is permanently in the HUD corner anyway, so it simply yields
    // rather than trying to share the space.
    if (!this.ui.intro.active) {
      this.ui.hud.showAreaBanner('THE PIT', `AGE ${this.mgr.age} — ${this.mgr.ageState.name}`);
    }
    this.ui.hud.toast('FIND SOMETHING WORTH REMEMBERING', 'neutral', 5);
    this.mgr.persist();
  }

  private endRunAndBank(): void {
    const meta = this.mgr.data.playerMeta;
    const s = this.player.stats;
    meta.essence += s.essence;
    for (const k of Object.keys(s.habits) as Array<keyof typeof s.habits>) {
      meta.habits[k] += s.habits[k];
    }
    meta.vigour = Math.min(60, Math.floor(meta.essence / 40) * 2);
    this.mgr.persist();
  }

  /* ============================================================
     frame
     ============================================================ */

  private get loop(): GameLoop {
    return this.loopRef();
  }

  /** Last error thrown inside a frame, surfaced by __state() for tests. */
  private lastTickError = '';

  private tick(dt: number, rdt: number): void {
    try {
      this.tickInner(dt, rdt);
    } catch (err) {
      this.lastTickError = String((err as Error)?.stack ?? err);
      console.error('[SHDOWPIT] frame error', err);
    }
  }

  private tickInner(dt: number, rdt: number): void {
    this.input.beginFrame();

    switch (this.mode) {
      case 'playing':
        this.tickPlaying(dt, rdt);
        break;
      case 'dying':
        this.tickDying(dt, rdt);
        break;
      default:
        this.tickIdle(dt, rdt);
        break;
    }

    this.ui.intro.update(rdt);
    this.tickAI(rdt);
    if (this.telemetry.enabled) this.sampleTelemetry(rdt);
    this.particles.update(dt > 0 ? dt : rdt * 0.02);
    this.vfx.update(dt > 0 ? dt : rdt * 0.02, rdt);
    this.arena.update(rdt, this.loop.elapsed, this.player.position.x, this.player.position.z);
    this.post.render();

    if (this.ui.debug.visible) {
      const info = this.renderer.info.render;
      this.ui.debug.setPerf(this.loop.fps, this.world.enemies.length, info.calls, info.triangles);
      this.ui.debug.tick();
    }

    this.input.endFrame();
  }

  /**
   * The AI's entire per-frame cost: reconcile the notice list with the queue,
   * age out finished notices, and occasionally persist generated content.
   * No awaits, no allocation in the common case.
   */
  private tickAI(rdt: number): void {
    this.ui.aiStatus.sync(this.ai.queue.live);
    this.ui.aiStatus.update(rdt);
    this.ui.aiStatus.setIndicator(this.ai.indicator());
    // Title is the one fullscreen screen that is allowed to show the indicator:
    // generation warms the roster before a run starts, and the player needs
    // to see that — and to reach settings — without beginning play.
    this.ui.aiStatus.setVisible(this.mode === 'playing' || this.mode === 'dying' || this.mode === 'title');

    if (!this.aiDirty) return;
    // Batch writes: generated content arrives in bursts and the save is a
    // whole-world JSON blob. Wall-clock, not `rdt`, because rdt is clamped and
    // would stretch this to many real seconds on a slow machine.
    const now = performance.now();
    if (now < this.aiSaveTimer) return;
    this.aiSaveTimer = now + 1500;
    this.aiDirty = false;
    this.mgr.persist();
  }

  /** Flush anything pending before the tab goes away. */
  private flushAI(): void {
    this.ai.textCache.flush();
    if (!this.aiDirty) return;
    this.aiDirty = false;
    this.mgr.persist();
  }

  /**
   * One fixed-shape sample per frame while QA recording is on. Kept cheap and
   * allocation-light; all analysis happens offline in tools/qa.mjs.
   */
  private sampleTelemetry(rdt: number): void {
    this.telemetry.advance(rdt);
    const p = this.player;
    const rig = p.qaRig();
    const cam = this.camera.camera.position;

    let attackers = 0;
    let winding = 0;
    let nearest = Infinity;
    let overlap = 0;
    let alive = 0;
    let nearestEnemy: Enemy | null = null;

    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      alive++;
      const st = e.combat.state;
      if (st === 'windup' || st === 'active') attackers++;
      if (st === 'windup') winding++;
      const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      if (d < nearest) {
        nearest = d;
        nearestEnemy = e;
      }
      const pen = e.radius + p.radius - d;
      if (pen > overlap) overlap = pen;
      this.telemetry.pushEnemy({
        t: this.telemetry.now,
        uid: e.uid,
        state: e.state,
        combatState: st,
        facing: e.facing,
        x: e.position.x,
        z: e.position.z,
        speed: Math.hypot(e.velocity.x, e.velocity.z),
        distToPlayer: d,
        attackId: e.combat.current?.id ?? '',
        intent: e.combat.current?.intent ?? '',
        postureFrac: e.combat.postureFrac,
      });
    }

    this.telemetry.pushFrame({
      t: this.telemetry.now,
      action: p.combat.action,
      phase: p.combat.phase,
      speed: Math.hypot(p.controller.velocity.x, p.controller.velocity.z),
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      facing: p.facing,
      rigYaw: rig.rigYaw,
      armR: rig.armR,
      bodyX: rig.bodyX,
      bodyY: rig.bodyY,
      walkPhase: rig.walkPhase,
      camDist: this.camera.currentDist,
      camYaw: this.camera.yaw,
      camPitch: this.camera.pitch,
      camY: cam.y,
      camToPlayer: Math.hypot(cam.x - p.position.x, cam.y - (p.position.y + 1.45), cam.z - p.position.z),
      enemiesAlive: alive,
      attackers,
      winding,
      nearestDist: nearest === Infinity ? -1 : nearest,
      overlap,
      nearestLos: nearestEnemy
        ? this.arena.lineOfSight(nearestEnemy.position.x, nearestEnemy.position.z, p.position.x, p.position.z)
        : true,
      fps: this.loop.fps,
    });
  }

  private tickIdle(dt: number, rdt: number): void {
    // Keep the camera drifting over the arena so the title screen has life.
    if (this.mode === 'title') {
      this.camera.yaw += rdt * 0.06;
      this.camera.pitch = -0.3;
      this.camera.distance = 26;
      this.camera.update(dt, rdt, TITLE_FOCUS, null);
    } else {
      this.camera.update(0, rdt, this.player.position, null);
    }
    for (const e of this.world.enemies) e.update(0, rdt);
  }

  private tickPlaying(dt: number, rdt: number): void {
    if (this.lockGrace > 0) this.lockGrace -= rdt;
    else if (!this.input.isPointerLocked && this.mode === 'playing' && !this.debugOpen && !this.qaNoAutoPause) {
      // Losing pointer lock pauses a human's game. QA harnesses run headless
      // with no real pointer lock, so __qaStart() turns this off — otherwise
      // every keyboard-only test phase silently freezes the sim.
      this.openPause();
      return;
    }

    if (!this.debugOpen) this.handlePlayingInput();

    const lockPoint = this.currentLockPoint();
    this.player.update(dt, rdt, this.input, this.camera, this.arena, lockPoint);

    // FOOTSTEP events off the shared gait cycle (see anim/AnimEvents.ts):
    // planted-foot phases kick a little dust so movement grips the ground.
    {
      const phase = this.player.anim.locoPhase;
      const speed = Math.hypot(this.player.controller.velocity.x, this.player.controller.velocity.z);
      if (speed > 3.4 && crossedFootstep(this.prevLocoPhase, phase)) {
        this.particles.dust(this.player.position.x, 0.12, this.player.position.z, speed > 8 ? 4 : 2);
      }
      this.prevLocoPhase = phase;
    }

    // The combo finisher steps forward. Attacks that move you are what stop a
    // combo from feeling like swinging at air while the target drifts away.
    const lunge = this.player.combat.comboLunge;
    if (lunge > 0) {
      const f = this.player.facing;
      this.player.position.x += -Math.sin(f) * lunge * dt;
      this.player.position.z += -Math.cos(f) * lunge * dt;
    }
    if (this.debugInvulnerable) this.player.stats.hp = this.player.stats.maxHp;
    if (this.debugInfiniteSurge) this.player.stats.surge = this.player.stats.surgeMax;

    this.world.update(dt, this.player);
    this.encounter.update(rdt, this.encounterSafety(), this.player);
    this.combat.setEnemies(this.world.enemies);

    for (const e of this.world.enemies) e.update(dt, rdt);

    this.combat.update(dt);
    this.combat.checkStampede();
    this.separateBodies();
    this.world.postUpdate(dt, this.player);

    if (this.debugDraw.any) {
      this.debugDraw.update(this.player, this.world.enemies, this.combat.liveProjectiles);
    }

    /* camera */
    const framing = this.bestFramingTarget();
    this.camera.setObstacles(this.cameraObstacles());
    const focusE = this.encounter.focusEnemy;
    if (focusE) {
      this.camera.setStoryFocus(focusE.position.x, 1.38, focusE.position.z);
      this.camera.lockTarget = null;
    } else {
      this.camera.lockTarget = lockPoint;
    }
    this.camera.applyLook(
      this.input.lookDX,
      this.input.lookDY,
      this.input.mouseSensitivity * this.mgr.data.settings.mouseSensitivity,
      this.mgr.data.settings.invertY
    );
    if (this.input.wheel !== 0) this.camera.zoom(this.input.wheel);
    this.camera.update(dt, rdt, this.player.position, framing ? framing.position : null);

    /* HUD */
    const plateTarget = this.plateTarget();
    const ov = this.mgr.overlord();
    this.ui.hud.update(
      rdt,
      this.player,
      {
        areaName: this.world.currentArea.name,
        ageName: this.mgr.ageState.name,
        age: this.mgr.age,
        turn: this.mgr.turn,
        overlordName: ov ? ov.name.toUpperCase() : '',
      },
      plateTarget,
      this.world.enemies,
      this.arena.shrines
    );
    this.ui.hud.setLowHealth(this.player.stats.hp / this.player.stats.maxHp);
    this.updatePrompt();
    this.autoQuality(rdt);
  }

  /**
   * Push the player and enemies out of each other.
   *
   * Enemies already separate from each other in the AI, but nothing kept them
   * out of the player — the QA pass measured 0.85m of interpenetration, which
   * is most of a body. The player is treated as much heavier than an enemy so
   * being crowded pushes them around rather than shoving them off a ledge.
   */
  private separateBodies(): void {
    const p = this.player;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const dx = p.position.x - e.position.x;
      const dz = p.position.z - e.position.z;
      const min = p.radius + e.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / d;
      // 25% player, 75% enemy — the world moves around you, not the reverse.
      p.position.x += dx * push * 0.25;
      p.position.z += dz * push * 0.25;
      e.position.x -= dx * push * 0.75;
      e.position.z -= dz * push * 0.75;
    }
  }

  private tickDying(dt: number, rdt: number): void {
    this.player.update(dt, rdt, this.input, this.camera, this.arena, null);
    for (const e of this.world.enemies) e.update(dt, rdt);
    this.combat.update(dt);
    const focusE = this.encounter.focusEnemy ?? this.pendingKiller;
    if (focusE) {
      this.camera.setStoryFocus(focusE.position.x, 1.38, focusE.position.z);
      this.camera.lockTarget = null;
    } else {
      this.camera.lockTarget = null;
    }
    this.camera.update(dt, rdt, this.player.position, null);
    this.encounter.update(rdt, this.encounterSafety(), this.player);

    this.deathTimer -= rdt;
    if (this.deathTimer <= 0) {
      this.mode = 'report';
      this.runDeathSimulation();
    }
  }

  /* ============================================================
     input
     ============================================================ */

  private handlePlayingInput(): void {
    const p = this.player;
    const input = this.input;

    if (input.pressed('hierarchy')) {
      this.openHierarchy();
      return;
    }
    if (input.pressed('pause')) {
      this.openPause();
      return;
    }
    if (input.pressed('lockon')) this.toggleLockOn();

    if (!p.alive) return;

    // Buffered inputs are only *consumed* once they actually fire, so a press
    // made half a beat early during recovery or a stagger still comes out.
    if (input.buffered('light')) {
      if (p.combat.tryAttack('light', p.weapon, p.stats)) input.consume('light');
    } else if (input.buffered('heavy')) {
      if (p.combat.tryAttack('heavy', p.weapon, p.stats)) input.consume('heavy');
    }

    if (input.buffered('dodge', 260)) {
      let dx = 0;
      let dz = 0;
      if (Math.abs(input.axisX) > 0.01 || Math.abs(input.axisY) > 0.01) {
        const f = this.camera.forward(TMP_A);
        const r = this.camera.right(TMP_B);
        dx = r.x * input.axisX + f.x * input.axisY;
        dz = r.z * input.axisX + f.z * input.axisY;
      } else {
        dx = Math.sin(p.facing);
        dz = Math.cos(p.facing);
      }
      const l = Math.hypot(dx, dz) || 1;
      if (p.combat.tryDodge(dx / l, dz / l)) {
        input.consume('dodge');
        this.combat.onPlayerDodge();
      }
    }

    if (input.buffered('parry', 220)) {
      if (p.combat.tryParry()) input.consume('parry');
    }

    // VOID NEEDLE — fires if a charge is banked; the throw overlays movement.
    if (input.buffered('ranged', 260)) {
      if (p.stats.rangedCharges >= 1 && p.combat.tryRanged()) {
        p.stats.rangedCharges -= 1;
        input.consume('ranged');
      } else if (p.stats.rangedCharges < 1) {
        input.consume('ranged');
        this.audio.play('ui', { volume: 0.25, pitch: 0.6, minGap: 0.3 });
      }
    }

    if (input.pressed('interact')) this.doInteract();
  }

  private doInteract(): void {
    const p = this.player;
    const target = this.combat.findExecutable();
    if (target && p.combat.canAct) {
      p.combat.startExecute(target.uid);
      p.facing = Math.atan2(-(target.position.x - p.position.x), -(target.position.z - p.position.z));
      this.camera.shake(0.2);
      return;
    }
    const shrine = this.arena.nearestShrine(p.position.x, p.position.z, 4.5);
    if (shrine) {
      this.arena.markShrineUsed(shrine);
      this.audio.play('pickup', { volume: 0.9 });
      this.particles.pillar(shrine.position.x, shrine.position.z, 0xffb020, 1.2);
      this.offerPower('A SHRINE STILL WORKS');
    }
  }

  private updatePrompt(): void {
    const target = this.combat.findExecutable();
    if (target) {
      this.ui.hud.setPrompt(`E — EXECUTE ${target.named ? target.nemesis.name.toUpperCase() : 'THEM'}`);
      return;
    }
    const shrine = this.arena.nearestShrine(this.player.position.x, this.player.position.z, 4.5);
    if (shrine) {
      this.ui.hud.setPrompt('E — TAKE A POWER');
      return;
    }
    this.ui.hud.setPrompt(null);
  }

  private onRawKey(e: KeyboardEvent): void {
    if (e.code === 'F1') {
      e.preventDefault();
      // The overlay is DOM, so pointer lock has to go while it is open or the
      // buttons never receive the click.
      this.debugOpen = this.ui.debug.toggle(this.debugHooks());
      if (this.debugOpen) {
        this.input.setEnabled(false);
        this.input.exitPointerLock();
      } else if (this.mode === 'playing') {
        this.input.setEnabled(true);
        this.lockGrace = 0.8;
        this.input.requestPointerLock();
      }
      return;
    }
    if (this.mode === 'power' && /^Digit[1-9]$/.test(e.code)) {
      this.ui.power.pickIndex(parseInt(e.code.slice(5), 10) - 1);
      return;
    }
    if (e.code === 'Escape') {
      if (this.mode === 'hierarchy') {
        this.closeHierarchy();
      } else if (this.mode === 'paused') {
        this.resumeFromPause();
      } else if (this.mode === 'title' && this.ui.pause.visible) {
        this.ui.pause.close();
      }
      return;
    }
    if (e.code === 'Tab' && this.mode === 'hierarchy') {
      e.preventDefault();
      this.closeHierarchy();
    }
  }

  /* ============================================================
     lock-on & framing
     ============================================================ */

  private toggleLockOn(): void {
    if (!this.mgr.data.settings.softLockOn) return;
    if (this.lockTargetUid !== null) {
      this.lockTargetUid = null;
      return;
    }
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    const fx = -Math.sin(this.camera.yaw);
    const fz = -Math.cos(this.camera.yaw);
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const dx = e.position.x - this.player.position.x;
      const dz = e.position.z - this.player.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 30) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      const score = dot * 2 - d * 0.04 + (e.named ? 0.6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.lockTargetUid = best ? best.uid : null;
    if (best) this.audio.play('ui', { volume: 0.5 });
  }

  private currentLockPoint(): THREE.Vector3 | null {
    if (this.lockTargetUid === null) return null;
    const e = this.world.enemies.find((x) => x.uid === this.lockTargetUid);
    if (!e || !e.alive) {
      this.lockTargetUid = null;
      return null;
    }
    const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
    if (d > 38) {
      this.lockTargetUid = null;
      return null;
    }
    return e.position;
  }

  /** Live bodies the camera must not sit inside. Rebuilt in place each frame. */
  private obstacleBuf: Array<{ x: number; z: number; r: number }> = [];
  private cameraObstacles(): Array<{ x: number; z: number; r: number }> {
    this.obstacleBuf.length = 0;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
      if (d > 18) continue;
      this.obstacleBuf.push({ x: e.position.x, z: e.position.z, r: e.radius });
    }
    return this.obstacleBuf;
  }

  private bestFramingTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bestD = 24;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
      const weighted = d - (e.named ? 6 : 0);
      if (weighted < bestD) {
        bestD = weighted;
        best = e;
      }
    }
    return best;
  }

  private plateTarget(): Enemy | null {
    // Named enemies own the plate from across the arena; a grunt earns it only
    // up close, because their posture bar matters while you are fighting them.
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
      const limit = e.named ? 34 : 10;
      if (d > limit) continue;
      const score = (e.named ? 100 : 0) - d;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private encounterSafety() {
    const p = this.player;
    let incomingActive = false;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      if (d < 10 && (e.combat.state === 'active' || e.combat.state === 'windup')) incomingActive = true;
    }
    let projectileClose = false;
    for (const pr of this.combat.liveProjectiles) {
      if (Math.hypot(pr.x - p.position.x, pr.z - p.position.z) < 6) projectileClose = true;
    }
    return {
      playerHpFrac: p.stats.hp / Math.max(1, p.stats.maxHp),
      playerStaggered: p.combat.action === 'stagger',
      incomingActive,
      projectileClose,
    };
  }

  /* ============================================================
     combat callbacks
     ============================================================ */

  private onNamedArrival(e: Enemy, salt: number, ctx: ArrivalContext): void {
    this.ui.hud.clearAreaBanner();
    this.syncAIWorld();
    this.encounter.begin(e, salt, ctx);
    if (e.nemesis.memory.length === 0 && e.nemesis.defeatsByPlayer === 0) {
      this.myth(e.nemesis, 'first_encounter');
    } else {
      this.ai.ensureFor(e.nemesis);
    }
  }

  private onNamedExecution(e: Enemy): void {
    if (!e.named) return;
    const words = encounterLine(e.nemesis, 'NEMESIS_DEFEATED', this.mgr.turn);
    if (words) this.ui.hud.toast(`"${words}"`, 'neutral');
    this.camera.pulseFov(4);
    this.vfx.story('death', e.position.x, e.position.z, e.rig.accent);
  }

  private onEnemyKilled(e: Enemy, executed: boolean): void {
    const rank = e.nemesis.rank;
    const wasOverlord = rank === 'overlord';
    this.player.stats.essence += e.named ? 30 + rankIndex(rank) * 25 : 4;
    if (e.named) this.world.noteAllyKilled(e.nemesis);
    this.world.onEnemyKilled(e, executed);
    // An Overlord's death starts the succession; a power offer would collide
    // with it, so the reward for that kill is the relic instead.
    if (!wasOverlord && e.named && rankIndex(rank) >= 2 && this.mode === 'playing') {
      // Beating a captain is always worth something.
      window.setTimeout(() => {
        if (this.mode === 'playing') this.offerPower(`${e.nemesis.name.toUpperCase()} IS DEAD`);
      }, 900);
    } else if (this.mode === 'playing' && !this.succession && this.player.stats.runKills >= this.nextBoonKills) {
      // The MegaBonk loop: keep killing, keep growing. Thresholds stretch so
      // the early run levels fast and the late run has to earn it.
      this.nextBoonKills = Math.ceil(this.nextBoonKills * 1.55 + 3);
      window.setTimeout(() => {
        if (this.mode === 'playing') this.offerBoons('THE PIT FEEDS YOU');
      }, 500);
    }
    this.refreshPowerChips();
  }

  private onNamedDefeated(e: Enemy, escaped: boolean): void {
    if (escaped) {
      e.alive = true;
      e.hp = Math.max(1, e.maxHp * 0.15);
      e.combat.reset(e.combat.postureMax);
      e.escaping = true;
      e.escapedAway = false;
      if (!e.escapePresented) {
        e.escapePresented = true;
        this.encounter.begin(e, this.mgr.turn, { outcome: 'fake_death' });
      }
      this.particles.burst(e.position.x, 1.2, e.position.z, 20, 0xffffff, 9, { size: 0.14 });
      this.myth(e.nemesis, 'survived_death');
    } else if (e.named) {
      this.encounter.begin(e, this.mgr.turn, { outcome: 'nemesis_dead' });
      this.ai.bumpEvents(e.nemesis);
      this.aiDirty = true;
    }
    this.mgr.persist();
  }

  private onPlayerDamaged(_from: Enemy | null, amount: number): void {
    this.ui.hud.damageVignette(0.2 + amount / 60);
  }

  private onPlayerKilled(killer: Enemy | null): void {
    // See onOverlordSlain: dying during the succession would abort it.
    if (this.succession) {
      this.player.stats.hp = Math.max(1, this.player.stats.hp);
      return;
    }
    if (this.mode !== 'playing') return;
    this.mode = 'dying';
    this.pendingKiller = killer;
    this.deathTimer = 3.2;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.loop.slowMo(2.2, 0.28);
    this.camera.shake(0.9);
    this.audio.play('player_death', { volume: 1 });
    this.ui.hud.screenFlash('#ff2010', 0.55, 700);
    this.ui.hud.setPrompt(null);
    if (killer && killer.named) {
      this.ui.hud.toast(`${fullName(killer.nemesis)} KILLED YOU`, 'hot', 6);
      this.encounter.begin(killer, this.mgr.turn, { outcome: 'player_dead' });
    }
  }

  /* ============================================================
     death → world turn → report
     ============================================================ */

  private runDeathSimulation(): void {
    const killer = this.pendingKiller;
    this.pendingKiller = null;

    const killerNemesis = this.world.onPlayerKilled(
      killer,
      this.mgr.data.playerMeta.equipped,
      this.player.stats.habits as unknown as Record<string, number>
    );
    this.endRunAndBank();

    // Whoever just killed you is the single most story-worthy enemy in the
    // world right now, so they get the highest-priority generation slot.
    if (killerNemesis) this.myth(killerNemesis, 'killed_player');

    const beforeTurn = this.mgr.turn;
    const result = simulateTurn(this.mgr);
    void beforeTurn;
    this.mythFromEvents(result.events);

    const events: WorldEvent[] = this.mgr.data.eventLog.filter(
      (ev) => ev.turn >= result.turn - 1 && ev.type !== 'player_death'
    );

    const highlights = this.mgr.living().map((n) => n.name.toUpperCase());
    this.world.endRun();
    this.ui.hud.setVisible(false);

    this.presentReport({
      title: 'YOU DIED',
      subtitle: killerNemesis
        ? `${fullName(killerNemesis)} — WHILE YOU WERE DEAD`
        : 'WHILE YOU WERE DEAD',
      events,
      highlight: highlights,
      buttonLabel: 'RISE  ▸',
      spotlight: killerNemesis
        ? {
            portrait: this.ai.portraitFor(killerNemesis),
            name: killerNemesis.name.toUpperCase(),
            title: this.ai.titleFor(killerNemesis),
            line: this.encounter.last?.line ?? encounterLine(killerNemesis, 'PLAYER_DEFEATED', this.mgr.turn),
            stole: killerNemesis.stolen[0]?.name,
            rankFrom: this.encounter.last?.rank,
            rankTo: rankName(killerNemesis.rank),
          }
        : undefined,
      onContinue: () => {
        this.lastReport = null;
        this.ui.report.hide();
        this.startRun();
      },
    });
    this.audio.play('world_event', { volume: 0.6 });
  }

  private onOverlordSlain(e: Enemy): void {
    const name = fullName(e.nemesis);

    // The succession runs on a 2.6s delay so the kill can land dramatically.
    // If the player dies inside that window — an arrow already in flight, a
    // last swing — `mode` becomes 'report' and the timeout below bails out:
    // the Overlord is dead, but the crown never passes and the age never
    // turns. The kill has been earned, so hold the player safe until the
    // succession has actually been committed.
    this.succession = true;
    this.player.godMode = true;
    this.combat.clearProjectiles();

    this.ui.hud.screenFlash('#ffd36e', 0.6, 900);
    this.loop.slowMo(2.4, 0.25);
    this.camera.shake(1.2);
    this.audio.play('execute', { volume: 1 });
    this.mgr.data.playerMeta.overlordsSlain++;

    // The reward: a relic, permanently.
    const meta = this.mgr.data.playerMeta;
    const owned = new Set(meta.weapons);
    const relic = RELIC_ORDER.find((r) => !owned.has(r));
    if (relic) {
      meta.weapons.push(relic);
      meta.equipped = relic;
      this.ui.hud.toast(`YOU TOOK ${RELIC_WEAPONS[relic].name}`, 'gold', 6);
    }
    meta.essence += 200;

    window.setTimeout(() => {
      this.succession = false;
      this.player.godMode = this.debugInvulnerable;
      if (this.mode === 'title' || this.mode === 'report') return;
      this.ui.power.hide();
      this.ui.hierarchy.close();
      this.ui.pause.close();
      this.mode = 'report';
      this.loop.paused = false;
      this.input.setEnabled(false);
      this.input.exitPointerLock();
      this.endRunAndBank();

      const successionEvents = simulateSuccession(this.mgr);
      this.mythFromEvents(successionEvents);
      const ageEvent = this.mgr.advanceAge();
      this.rebuildArena();
      this.mgr.fillRanks();
      this.mgr.persist();

      this.world.endRun();
      this.ui.hud.setVisible(false);
      this.presentReport({
        title: 'THE SEAT IS EMPTY',
        subtitle: `${name} IS DEAD — ${this.mgr.ageState.name} BEGINS`,
        events: [...successionEvents, ageEvent],
        highlight: this.mgr.living().map((n) => n.name.toUpperCase()),
        buttonLabel: 'INTO THE NEW AGE  ▸',
        onContinue: () => {
          this.lastReport = null;
          this.ui.report.hide();
          this.startRun();
        },
      });
    }, 2600);
  }

  /* ============================================================
     powers
     ============================================================ */

  /** Roll `n` distinct stat boons, weighted, skipping capped stats. */
  private rollStatBoons(n: number): RunStatId[] {
    const stats = this.player.stats;
    const pool = RUN_STATS.filter((d) => !stats.statAtCap(d.id));
    const picks: RunStatId[] = [];
    const remaining = pool.slice();
    while (picks.length < n && remaining.length) {
      let total = 0;
      for (const d of remaining) total += d.weight;
      let r = this.rng.next() * total;
      let idx = remaining.length - 1;
      for (let j = 0; j < remaining.length; j++) {
        r -= remaining[j].weight;
        if (r <= 0) {
          idx = j;
          break;
        }
      }
      picks.push(remaining[idx].id);
      remaining.splice(idx, 1);
    }
    return picks;
  }

  /** Wrap a stat boon as an offer card. */
  private boonCard(id: RunStatId): PowerDef {
    const stats = this.player.stats;
    const def = RUN_STATS.find((d) => d.id === id)!;
    const now = statValue(def, stats.statCount(id));
    const then = statValue(def, stats.statCount(id) + 1);
    return {
      id: `stat:${id}` as PowerId,
      name: def.name,
      tag: 'STAT',
      desc: `${def.desc}  (${formatStat(def, now)} → ${formatStat(def, then)})`,
      short: def.name,
      stackable: true,
      weight: def.weight,
    };
  }

  private presentOffer(options: PowerDef[], subtitle: string): void {
    this.mode = 'power';
    this.ui.intro.hide();
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.loop.paused = true;
    this.ui.power.present(options, subtitle, (p) => {
      const id = String(p.id);
      if (id.startsWith('stat:')) {
        this.player.stats.addStatBoon(id.slice(5) as RunStatId);
        this.ui.hud.toast(`${p.name} UP`, 'gold');
      } else {
        this.player.stats.addPower(p.id);
        this.ui.hud.toast(`GAINED ${p.name}`, 'gold');
      }
      this.refreshPowerChips();
      this.audio.play('pickup', { volume: 0.8 });
      this.resumeToPlaying();
    });
  }

  /** Shrines and captain kills: two mechanics and a stat, take one. */
  private offerPower(subtitle: string): void {
    const powers = this.abilities.roll(this.player.stats.powers, 2);
    const options: PowerDef[] = [...powers, ...this.rollStatBoons(1).map((id) => this.boonCard(id))];
    if (!options.length) {
      this.player.stats.heal(30);
      this.ui.hud.toast('NOTHING LEFT TO LEARN — HEALED', 'good');
      return;
    }
    this.presentOffer(options, subtitle);
  }

  /** Kill-streak growth: three stats, take one. Pure MegaBonk. */
  private offerBoons(subtitle: string): void {
    const options = this.rollStatBoons(3).map((id) => this.boonCard(id));
    if (!options.length) return;
    this.presentOffer(options, subtitle);
  }

  private refreshPowerChips(): void {
    this.ui.hud.setPowers(this.player.stats.powers.list().map((x) => ({ name: x.def.short, count: x.count })));
  }

  /* ============================================================
     screens
     ============================================================ */

  private openHierarchy(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'hierarchy';
    this.ui.intro.hide();
    this.loop.paused = true;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.hierarchy.open(this.mgr, () => this.closeHierarchy(), this.ai);
  }

  /** Stored so the report can be restored after a detour into the hierarchy. */
  private lastReport: ReportArgs | null = null;

  private presentReport(opts: ReportArgs): void {
    this.lastReport = opts;
    this.ui.intro.hide();
    this.ui.report.present({
      title: opts.title,
      subtitle: opts.subtitle,
      events: opts.events,
      highlight: opts.highlight,
      buttonLabel: opts.buttonLabel,
      extras: [{ label: 'VIEW HIERARCHY', onClick: () => this.openHierarchyFromReport() }],
      onContinue: opts.onContinue,
      spotlight: opts.spotlight,
    });
  }

  private openHierarchyFromReport(): void {
    this.ui.report.hide();
    this.ui.hierarchy.open(
      this.mgr,
      () => {
        this.ui.hierarchy.close();
        if (this.lastReport) this.presentReport(this.lastReport);
        else this.startRun();
      },
      this.ai
    );
  }

  private closeHierarchy(): void {
    this.ui.hierarchy.close();
    if (this.mode !== 'hierarchy') return;
    this.resumeToPlaying();
  }

  private openPause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.ui.intro.hide();
    this.loop.paused = true;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.pause.open(
      this.mgr.data.settings,
      {
        onResume: () => this.resumeFromPause(),
        onExtract: () => {
          this.ui.pause.close();
          this.endRunAndBank();
          this.world.endRun();
          this.ui.hud.setVisible(false);
          this.mode = 'report';
          this.presentReport({
            title: 'YOU WALKED AWAY',
            subtitle: 'THE WORLD DID NOT MOVE',
            events: this.mgr.recentEvents(1),
            buttonLabel: 'AGAIN  ▸',
            onContinue: () => {
              this.lastReport = null;
              this.ui.report.hide();
              this.startRun();
            },
          });
        },
        onQuit: () => {
          this.ui.pause.close();
          this.endRunAndBank();
          this.showTitle(true);
        },
        onSettingsChanged: (s) => {
          this.applySettings(s);
          this.mgr.persist();
        },
        ai: this.aiSettingsHooks(),
        runStats: () =>
          this.player.stats.statList().map((s) => ({ name: s.def.name, text: s.text, count: s.count })),
      },
      this.world.runActive
    );
  }

  private resumeFromPause(): void {
    this.ui.pause.close();
    if (this.mode !== 'paused') return;
    this.resumeToPlaying();
  }

  private resumeToPlaying(): void {
    this.mode = 'playing';
    this.loop.paused = false;
    this.input.setEnabled(true);
    this.input.clearBuffers();
    this.lockGrace = 0.8;
    this.input.requestPointerLock();
    this.ui.hud.setVisible(true);
  }

  /* ============================================================
     settings & resize
     ============================================================ */

  private applySettings(s: Settings): void {
    this.audio.setVolume(s.masterVolume);
    this.camera.shakeScale = s.cameraShake;
    this.ui.hud.setMinimapVisible(s.showMinimap);
    this.ai.setSettings(s.ai);
    this.applyQuality(s.quality);
    if (this.mode === 'title' && this.saveSys.exists()) this.warmTitleGeneration();
  }

  /**
   * Render quality. The map and the enemy count never change — only shadow
   * resolution and pixel density — so gameplay is identical at every setting.
   */
  private applyQuality(q: Quality, rebuild = false): void {
    this.quality = q;
    const shadow = q === 'high' ? 2048 : q === 'medium' ? 1024 : 0;
    this.renderer.setPixelRatio(pixelRatioFor(q));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = shadow > 0;
    this.post?.configure(q, window.innerWidth, window.innerHeight);
    this.arena.setShadowQuality(shadow);
    if (rebuild) this.rebuildArena();
  }

  /**
   * If the machine cannot hold a playable frame rate, step the quality down
   * once rather than letting the player fight a slideshow.
   */
  private autoQuality(rdt: number): void {
    if (!this.mgr.data.settings.autoQuality) return;
    if (this.quality === 'low') return;
    if (this.loop.fps > 45) {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - rdt);
      return;
    }
    this.lowFpsTime += rdt;
    if (this.lowFpsTime < 4) return;
    this.lowFpsTime = 0;
    const next: Quality = this.quality === 'high' ? 'medium' : 'low';
    this.mgr.data.settings.quality = next;
    this.applyQuality(next, true);
    this.ui.hud.toast(`RENDER QUALITY LOWERED TO ${next.toUpperCase()}`, 'neutral', 5);
    console.info('[SHDOWPIT] auto quality ->', next);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.resize(w / h);
  }

  /* ============================================================
     debug
     ============================================================ */

  private debugHooks(): DebugHooks {
    const g = this;
    return {
      spawnNemesis(rank: Rank) {
        const n = g.mgr.recruit(rank, true);
        n.territory = g.world.currentArea.id;
        g.mgr.persist();
        if (g.mode === 'playing') g.world.spawnNamed(n, g.player, true);
      },
      summonNemesis(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return;
        if (!n.alive) {
          n.alive = true;
          n.diedOnTurn = null;
        }
        if (g.mode === 'playing') g.world.spawnNamed(n, g.player, true);
      },
      spawnGrunt() {
        if (g.mode !== 'playing') return;
        const a = g.player.facing;
        g.world.spawnGrunt(g.player.position.x - Math.sin(a) * 7, g.player.position.z - Math.cos(a) * 7);
      },
      killPlayer() {
        g.player.stats.hp = 0;
        g.player.combat.die();
        const killer = g.world.enemies.find((e) => e.alive && e.named) ?? null;
        g.onPlayerKilled(killer);
      },
      damagePlayer(amount: number) {
        g.player.stats.hp = Math.max(0, g.player.stats.hp - amount);
        g.ui.hud.damageVignette(0.4);
        if (g.player.stats.hp <= 0) {
          g.player.combat.die();
          g.onPlayerKilled(null);
        }
      },
      healPlayer() {
        g.player.stats.hp = g.player.stats.maxHp;
      },
      killTarget(id: string) {
        const e = g.world.enemies.find((x) => x.alive && x.named && x.nemesis.id === id);
        if (e) {
          e.hp = 0;
          e.kill();
          g.onEnemyKilled(e, false);
          return;
        }
        const n = g.mgr.byId(id);
        if (n && n.alive) {
          g.mgr.killNemesis(n, true, 'the debug menu');
          g.mgr.persist();
        }
      },
      makeOverlord(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return;
        const current = g.mgr.overlord();
        // Demote the sitting Overlord first, or fillRanks immediately puts the
        // newcomer back down and the crown never actually moves.
        if (current && current.id !== n.id) g.mgr.demote(current, 'a debug coup');
        if (!n.alive) {
          n.alive = true;
          n.diedOnTurn = null;
        }
        g.mgr.promote(n, 'overlord');
        g.mgr.assignTerritories();
        g.mgr.persist();
        g.myth(n, 'became_overlord');
      },
      scarTarget(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return;
        const options: Array<Parameters<typeof applyScar>[1]> = [
          'burn',
          'missing_eye',
          'broken_mask',
          'metal_jaw',
          'damaged_arm',
          'cracked_armor',
          'shattered_horn',
        ];
        const unused = options.find((s) => !n.scars.some((x) => x.id === s)) ?? 'burn';
        const label = applyScar(n, unused, g.mgr.turn, 'the debug menu');
        recomputePower(n);
        if (label) {
          g.mgr.log({
            turn: g.mgr.turn,
            age: g.mgr.age,
            type: 'injury',
            text: `${fullName(n)} CAME AWAY WITH ${label}.`.toUpperCase(),
            actors: [n.id],
            important: true,
            tone: 'bad',
          });
        }
        g.mgr.persist();
        g.myth(n, 'major_scar');
      },
      forceEscape(id: string) {
        const e = g.world.enemies.find((x) => x.alive && x.named && x.nemesis.id === id);
        if (!e) return;
        e.hp = Math.max(1, e.maxHp * 0.15);
        e.escaping = true;
        e.escapedAway = false;
        g.particles.burst(e.position.x, 1.2, e.position.z, 20, 0xffffff, 9, { size: 0.14 });
        g.myth(e.nemesis, 'survived_death');
        window.setTimeout(() => {
          if (e.alive && e.escaping) e.escapedAway = true;
        }, 1500);
      },
      resetRun() {
        if (g.mode === 'title') return;
        g.ui.power.hide();
        g.ui.hierarchy.close();
        g.ui.pause.close();
        g.ui.report.hide();
        g.world.endRun();
        g.player.stats.hp = g.player.stats.maxHp;
        g.startRun();
      },
      resetSave() {
        g.mgr.wipe();
        g.ai.clearCaches();
        g.mgr.newWorld(randomSeed());
        g.world.endRun();
        g.rebuildArena();
        g.showTitle(true);
      },
      regenerateAI(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return;
        g.ai.bumpVisual(n);
        g.ai.bumpEvents(n);
        g.syncAIWorld();
        g.ai.ensureFor(n);
      },
      clearAICache() {
        g.ai.clearCaches();
      },
      killAllEnemies() {
        for (const e of [...g.world.enemies]) {
          if (e.alive) {
            e.hp = 0;
            e.kill();
            g.onEnemyKilled(e, false);
          }
        }
      },
      advanceWorld() {
        simulateTurn(g.mgr);
        g.mgr.persist();
      },
      advanceAge() {
        simulateSuccession(g.mgr);
        g.mgr.advanceAge();
        g.world.endRun();
        g.rebuildArena();
        g.mgr.fillRanks();
        g.mgr.persist();
        if (g.mode === 'playing') g.startRun();
      },
      promote(id: string) {
        const n = g.mgr.byId(id);
        if (n) {
          g.mgr.promote(n);
          g.mgr.persist();
          // Go through the same funnel as a simulated promotion, so the debug
          // panel exercises the real path rather than a parallel one.
          g.myth(
            n,
            n.rank === 'overlord'
              ? 'became_overlord'
              : n.rank === 'warlord'
                ? 'promoted_warlord'
                : 'promoted_captain'
          );
        }
      },
      demote(id: string) {
        const n = g.mgr.byId(id);
        if (n) {
          g.mgr.demote(n, 'the debug menu');
          g.mgr.persist();
        }
      },
      forceBetrayal(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return;
        const others = g.mgr.living().filter((x) => x.id !== n.id);
        if (!others.length) return;
        const victim = g.mgr.byId(n.master ?? n.allies[0]) ?? others[0];
        makeRivals(n, victim);
        g.world.forceRivalry(n, victim);
        g.mgr.log({
          turn: g.mgr.turn,
          age: g.mgr.age,
          type: 'betrayal',
          text: `${fullName(n)} TURNED ON ${fullName(victim)}.`.toUpperCase(),
          actors: [n.id, victim.id],
          important: true,
          tone: 'bad',
        });
        g.ui.hud.toast(betrayalCallout(n, victim), 'hot');
        g.audio.play('nemesis_betrayal', { volume: 0.7 });
        g.mgr.persist();
      },
      forceResurrection(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return;
        if (n.alive) {
          n.alive = false;
          n.diedOnTurn = g.mgr.turn - 1;
        }
        const label = applyScar(n, 'corruption', g.mgr.turn, 'debug');
        g.mgr.resurrect(n, label);
        recomputePower(n);
        g.mgr.persist();
        // Coming back from the dead changes how they look and how they are
        // written about; without this the cached portrait would stick.
        g.myth(n, 'returned_from_death');
      },
      giveAbility(id: PowerId) {
        g.player.stats.addPower(id);
        g.refreshPowerChips();
      },
      teleport(areaId: string) {
        const a = getArea(areaId);
        const pt = g.arena.spawnPoint(a.id, g.rng, 0.1, 0.4);
        g.player.position.set(pt.x, 0, pt.z);
        g.camera.snapBehind(g.player.position, g.player.facing);
      },
      toggleInvulnerable() {
        g.debugInvulnerable = !g.debugInvulnerable;
        g.player.godMode = g.debugInvulnerable;
        return g.debugInvulnerable;
      },
      toggleInfiniteSurge() {
        g.debugInfiniteSurge = !g.debugInfiniteSurge;
        return g.debugInfiniteSurge;
      },
      setTimeScale(s: number) {
        g.loop.timeScale = s;
      },
      getTimeScale() {
        return g.loop.timeScale;
      },
      toggleDraw(flag: 'vectors' | 'hitboxes' | 'hurtboxes' | 'trajectories') {
        g.debugDraw.flags[flag] = !g.debugDraw.flags[flag];
        if (!g.debugDraw.any) g.debugDraw.clear();
        return g.debugDraw.flags[flag];
      },
      drawFlags() {
        return { ...g.debugDraw.flags };
      },
      forceAttack(kind: 'any' | 'slam' | 'projectile') {
        return g.forceEnemyAttack(kind);
      },
      grantStat(id: string, count: number) {
        for (let i = 0; i < count; i++) g.player.stats.addStatBoon(id as RunStatId);
      },
      runStats() {
        return g.player.stats.statList().map((s) => ({
          name: s.def.name,
          text: s.text,
          count: s.count,
        }));
      },
      animState() {
        return g.__animState();
      },
      combatState() {
        const out: Array<{
          uid: number;
          label: string;
          state: string;
          intent: string;
          combatState: string;
          attack: string;
          telegraph: number;
          posture: number;
          broken: boolean;
          staggerLeft: number;
          slowed: boolean;
          poisoned: boolean;
        }> = [];
        for (const e of g.world.enemies) {
          if (!e.alive) continue;
          out.push({
            uid: e.uid,
            label: e.named ? e.nemesis.name.toUpperCase() : `${e.nemesis.archetype} #${e.uid}`,
            state: e.state,
            intent: e.intent,
            combatState: e.combat.state,
            attack: e.combat.current?.id ?? '',
            telegraph: Math.round(Math.max(0, e.combat.windupRemaining) * 100) / 100,
            posture: Math.round(e.combat.postureFrac * 100),
            broken: e.combat.broken,
            staggerLeft: e.combat.state === 'stagger' ? Math.round(e.combat.t * 100) / 100 : 0,
            slowed: e.slowTimer > 0,
            poisoned: e.poisoned,
          });
        }
        return out;
      },
      listNemeses() {
        return g.mgr.roster.map((n) => ({
          id: n.id,
          label: `${n.alive ? '' : '† '}${fullName(n)} — ${n.rank.toUpperCase()} L${n.level}`,
        }));
      },
      inspect(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return '';
        return describeNemesis(n, g.mgr, g.ai);
      },
      inspectMemory(id: string) {
        const n = g.mgr.byId(id);
        if (!n) return '';
        if (!n.memory.length) return '(no memory)';
        return n.memory
          .slice(-16)
          .map((m) => `T${m.turn}  ${m.type}${m.subject ? ' <- ' + (g.mgr.byId(m.subject)?.name ?? '?') : ''}`)
          .join('\n');
      },
      liveState() {
        return {
          fps: g.loop.fps,
          playerState: g.player.combat.action,
          playerHp: `${Math.ceil(g.player.stats.hp)} / ${g.player.stats.maxHp}`,
          enemies: g.world.enemies.length,
          enemiesAlive: g.world.enemies.filter((e) => e.alive).length,
          worldTurn: g.mgr.turn,
          worldAge: g.mgr.age,
          ageName: g.mgr.ageState.name,
          area: g.world.currentArea.name,
          namedAlive: g.mgr.living().length,
          mode: g.mode,
        };
      },
      aiState() {
        const st = g.ai.status();
        const last = st.last;
        return {
          provider: st.provider,
          connection: !st.backendReachable
            ? 'NO LOCAL SERVER'
            : st.connected
              ? st.verified
                ? 'CONNECTED'
                : 'CONNECTED (UNTESTED)'
              : 'DISCONNECTED',
          mode: st.mode,
          queue: st.queued,
          active: st.active,
          cachedText: st.cachedText,
          cachedPortraits: st.cachedPortraits,
          lastRequest: last ? `NEMESIS_${last.kind.toUpperCase()}` : '—',
          lastResult: last ? last.state.toUpperCase() + (last.error ? ` (${last.error})` : '') : '—',
          latency: last && last.latencyMs ? `${last.latencyMs} ms` : '—',
          requests: g.ai.queue.live.map((r) => `${r.kind.toUpperCase()} — ${r.label} — ${r.state.toUpperCase()}`),
        };
      },
      worldSummary() {
        const ov = g.mgr.overlord();
        return [
          `AGE ${g.mgr.age} — ${g.mgr.ageState.name}`,
          `TURN ${g.mgr.turn}`,
          `NAMED ALIVE ${g.mgr.living().length} / ${g.mgr.roster.length}`,
          `OVERLORD ${ov ? fullName(ov) : '—'}`,
          `AREA ${g.world.currentArea.name}`,
          `RUNS ${g.mgr.data.playerMeta.runs} DEATHS ${g.mgr.data.playerMeta.deaths}`,
        ].join('\n');
      },
      saveNow() {
        g.mgr.persist();
      },
      lastEncounter() {
        return (g.encounter.last as unknown as Record<string, unknown>) ?? null;
      },
      playEncounter(kind: string) {
        const e = g.world.enemies.find((x) => x.alive && x.named);
        if (!e) return;
        g.encounter.playKind(e, kind as EncounterKind, g.mgr.turn);
      },
      stageNemesisLoop(id: string) {
        const n = g.mgr.byId(id);
        if (!n || g.mode !== 'playing') return;
        if (!n.alive) {
          n.alive = true;
          n.diedOnTurn = null;
        }
        const resurrected = n.memory[n.memory.length - 1]?.type === 'I_RETURNED_FROM_DEATH';
        let e: Enemy | null =
          g.world.enemies.find((x) => x.alive && x.named && x.nemesis.id === n.id) ?? null;
        if (!e) {
          e = g.world.spawnNamed(
            n,
            g.player,
            true,
            g.player.position.x + 6,
            g.player.position.z + 6,
            { resurrected }
          );
        }
        if (!e) return;
        e.pendingIntro = false;
        e.introHold = true;
        const kind = classifyEncounter(n, { resurrected });
        g.encounter.playKind(e, kind, g.mgr.turn);
        g.ui.hud.toast(
          `${kind.replace(/_/g, ' ')}  ·  then escape / return / death / promote / kill / revive`,
          'gold',
          5.5
        );
      },
    };
  }

  /**
   * Force a nearby enemy to perform an attack right now — the F1 buttons and
   * the QA harness use this to stage telegraphs deterministically.
   */
  /** `kind` may also be an exact attack id from data/attacks.ts. */
  private forceEnemyAttack(kind: 'any' | 'slam' | 'projectile' | string): string {
    const exact = ATTACK_MAP.get(kind) ?? null;
    const candidates = this.world.enemies.filter((e) => {
      if (!e.alive) return false;
      if (exact) return exact.archetypes.includes(e.nemesis.archetype);
      if (kind === 'slam') return e.nemesis.archetype === 'heavy';
      if (kind === 'projectile') return !!e.weapon.ranged;
      return true;
    });
    if (!candidates.length) return 'no suitable enemy alive';
    let best = candidates[0];
    let bestD = Infinity;
    for (const e of candidates) {
      const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    const id = kind === 'slam' ? 'ground_slam' : kind === 'projectile' ? 'single_arrow' : null;
    const def =
      exact ??
      (id
        ? ATTACK_MAP.get(id)!
        : (() => {
            const pool = [...ATTACK_MAP.values()].filter(
              (a) => a.archetypes.includes(best.nemesis.archetype) && a.minRank === 0
            );
            return pool[Math.floor(Math.random() * pool.length)] ?? [...ATTACK_MAP.values()][0];
          })());
    best.faceToward(this.player.position.x, this.player.position.z, 10, 99);
    best.combat.startAttack(def, best.weapon, best.mods, def.anticipation);
    return `${best.named ? best.nemesis.name : best.nemesis.archetype} -> ${def.id}`;
  }

  /* ============================================================
     test hooks (used by tools/playtest.mjs and the browser console)
     ============================================================ */

  get __fps(): number {
    return this.loop.fps;
  }

  /** Snapshot of live state, for the automated playtest. */
  __state(): Record<string, unknown> {
    const named = this.world.enemies.filter((e) => e.named);
    return {
      mode: this.mode,
      fps: Math.round(this.loop.fps),
      pointerLocked: this.input.isPointerLocked,
      playerHp: Math.round(this.player.stats.hp),
      playerMaxHp: this.player.stats.maxHp,
      playerAction: this.player.combat.action,
      area: this.world.currentArea.name,
      enemies: this.world.enemies.length,
      enemiesAlive: this.world.enemies.filter((e) => e.alive).length,
      named: named.map((e) => `${fullName(e.nemesis)} [${e.nemesis.rank}] ${Math.round(e.hp)}/${e.maxHp}`),
      runKills: this.player.stats.runKills,
      powers: this.player.stats.powers.ids(),
      worldTurn: this.mgr.turn,
      worldAge: this.mgr.age,
      shrinesLeft: this.arena.shrines.filter((s) => !s.used).length,
      colliders: this.arena.colliders.length,
      axisX: this.input.axisX,
      axisY: this.input.axisY,
      loopPaused: this.loop.paused,
      debugOpen: this.debugOpen,
      lockGrace: Math.round(this.lockGrace * 100) / 100,
      vel: Math.round(Math.hypot(this.player.controller.velocity.x, this.player.controller.velocity.z) * 100) / 100,
      dodgeCd: Math.round(this.player.combat.dodgeCooldown * 100) / 100,
      deathTimer: Math.round(this.deathTimer * 100) / 100,
      quality: this.quality,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
      kills: this.mgr.data.playerMeta.kills,
      namedAlive: this.mgr.living().length,
      lastTickError: this.lastTickError,
    };
  }

  /** Test-only invulnerability, so input checks are not cut short by dying. */
  __godMode(on: boolean): void {
    this.debugInvulnerable = on;
    this.player.godMode = on;
    if (on) this.player.stats.hp = this.player.stats.maxHp;
  }

  __playerPos(): { x: number; z: number } {
    return { x: this.player.position.x, z: this.player.position.z };
  }

  private nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  __nearestEnemyHp(): number {
    const e = this.nearestEnemy();
    return e ? Math.round(e.hp) : -1;
  }

  /** Lock a test onto one specific enemy so its health can be tracked. */
  __markNearest(): number {
    const e = this.nearestEnemy();
    this.markedUid = e ? e.uid : -1;
    return this.markedUid;
  }

  __markedHp(): number {
    const e = this.world.enemies.find((x) => x.uid === this.markedUid);
    return e ? Math.round(e.hp) : -1;
  }

  __faceMarked(): void {
    const e = this.world.enemies.find((x) => x.uid === this.markedUid);
    if (!e || !e.alive) return;
    const dx = e.position.x - this.player.position.x;
    const dz = e.position.z - this.player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.player.facing = Math.atan2(-dx, -dz);
    this.player.snapFacing();
    this.camera.yaw = this.player.facing;
    if (d > 2) {
      this.player.position.x = e.position.x - (dx / d) * 1.9;
      this.player.position.z = e.position.z - (dz / d) * 1.9;
    }
  }

  /** Turn to the closest enemy and close the gap, so a test can land hits. */
  __faceNearest(): void {
    const e = this.nearestEnemy();
    if (!e) return;
    const dx = e.position.x - this.player.position.x;
    const dz = e.position.z - this.player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.player.facing = Math.atan2(-dx, -dz);
    this.player.snapFacing();
    this.camera.yaw = this.player.facing;
    if (d > 2) {
      this.player.position.x = e.position.x - (dx / d) * 1.9;
      this.player.position.z = e.position.z - (dz / d) * 1.9;
    }
  }

  /** Kill the player from a test, going through the real death flow. */
  __forceDeath(): void {
    if (this.mode !== 'playing') return;
    this.player.stats.hp = 0;
    this.player.combat.die();
    const killer = this.world.enemies.find((e) => e.alive && e.named) ?? this.world.enemies.find((e) => e.alive) ?? null;
    this.onPlayerKilled(killer ?? null);
  }

  /** Summon a specific rank next to the player, for testing encounters. */
  __summonRank(rank: Rank): string {
    const candidates = this.mgr.living().filter((n) => n.rank === rank);
    const n = candidates[0] ?? this.mgr.recruit(rank, false);
    n.territory = this.world.currentArea.id;
    const e = this.world.spawnNamed(
      n,
      this.player,
      true,
      this.player.position.x + 6,
      this.player.position.z + 6
    );
    return e ? fullName(n) : 'failed';
  }

  /** Damage every live enemy, to test kill/escape/loot bookkeeping. */
  __smiteEnemies(): number {
    let n = 0;
    for (const e of [...this.world.enemies]) {
      if (!e.alive) continue;
      e.hp = 0;
      e.kill();
      this.onEnemyKilled(e, false);
      n++;
    }
    return n;
  }

  /**
   * The debug hooks, for tests. Same surface the F1 panel drives, so a test
   * exercises the real code path rather than a parallel one.
   */
  __debug(): DebugHooks {
    return this.debugHooks();
  }

  /** The named enemy currently on stage, if any. */
  __namedOnStage(): { id: string; name: string; title: string; hp: number } | null {
    const e = this.world.enemies.find((x) => x.alive && x.named);
    if (!e) return null;
    return {
      id: e.nemesis.id,
      name: e.nemesis.name,
      title: this.ai.titleFor(e.nemesis),
      hp: Math.round(e.hp),
    };
  }

  /** Presentation snapshot for tests. */
  __lastEncounter(): Record<string, unknown> | null {
    return (this.encounter.last as unknown as Record<string, unknown>) ?? null;
  }

  /* ---------- QA hooks ---------- */

  /**
   * REQUIRED TEST 1 — FACING. Rendered face direction vs logical forward for
   * the player and every live enemy, as dot products. 1 = perfect agreement,
   * -1 = running backwards. The rendered direction comes from the scene graph
   * itself, so a regression in the rig's forward axis cannot hide.
   */
  __qaFacing(): {
    player: { dot: number; moveDot: number; rigYawErr: number };
    enemies: Array<{ uid: number; dot: number; toPlayerDot: number; state: string }>;
  } {
    const p = this.player;
    const face = p.faceDirection(QA_V1);
    const fx = -Math.sin(p.facing);
    const fz = -Math.cos(p.facing);
    const v = p.controller.velocity;
    const speed = Math.hypot(v.x, v.z);
    const moveDot = speed > 1 ? (face.x * v.x + face.z * v.z) / speed : 1;
    const rig = p.qaRig();
    const enemies: Array<{ uid: number; dot: number; toPlayerDot: number; state: string }> = [];
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      const ef = e.faceDirection(QA_V2);
      const efx = -Math.sin(e.facing);
      const efz = -Math.cos(e.facing);
      const dxp = p.position.x - e.position.x;
      const dzp = p.position.z - e.position.z;
      const dl = Math.hypot(dxp, dzp) || 1;
      enemies.push({
        uid: e.uid,
        dot: ef.x * efx + ef.z * efz,
        toPlayerDot: (ef.x * dxp + ef.z * dzp) / dl,
        state: e.state,
      });
    }
    return {
      player: {
        dot: face.x * fx + face.z * fz,
        moveDot,
        rigYawErr: Math.abs(wrapAngleQA(rig.rigYaw - p.facing)),
      },
      enemies,
    };
  }

  /** Attack-direction agreement: weapon tip side vs facing at this instant. */
  __qaAttackVector(): { phase: string; tipDot: number } {
    const p = this.player;
    p.root.updateWorldMatrix(true, true);
    const tip = p.weaponTip(QA_V1);
    const dx = tip.x - p.position.x;
    const dz = tip.z - p.position.z;
    const l = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(p.facing);
    const fz = -Math.cos(p.facing);
    return { phase: `${p.combat.action}/${p.combat.phase}`, tipDot: (dx * fx + dz * fz) / l };
  }

  /** Live projectiles for TEST 4. */
  /**
   * Animation QA readout — the test-scene display data: state, clip, clip
   * time, forward/attack vectors, the live hitbox window and root motion.
   */
  __animState(): Record<string, unknown> {
    const p = this.player;
    const c = p.combat;
    const lunge = c.comboLunge;
    const fx = -Math.sin(p.facing);
    const fz = -Math.cos(p.facing);
    const px = p.position.x;
    const pz = p.position.z;
    const enemies = this.world.enemies
      .filter((e) => e.alive || e.state === 'dead')
      .sort((a2, b2) => {
        // live enemies first, nearest first — the readout shows the fight
        if (a2.alive !== b2.alive) return a2.alive ? -1 : 1;
        const da = (a2.position.x - px) ** 2 + (a2.position.z - pz) ** 2;
        const db = (b2.position.x - px) ** 2 + (b2.position.z - pz) ** 2;
        return da - db;
      })
      .slice(0, 8)
      .map((e) => ({
        uid: e.uid,
        arch: e.nemesis.archetype,
        state: e.rig.anim.stateName,
        clip: e.rig.anim.clipName,
        clipTime: +e.rig.anim.clipTime.toFixed(3),
        combatState: e.combat.state,
        attack: e.combat.current?.id ?? null,
        locoPhase: +e.rig.anim.locoPhase.toFixed(3),
      }));
    // The reusable animation-event data for the CURRENT attack, so the QA
    // display (and tests) can see the explicit HITBOX_ON/OFF schedule.
    const timeline =
      c.action === 'attack'
        ? buildAttackTimeline(c.timings(p.weapon), {
            heavy: c.attackKind === 'heavy',
            comboWindow: 0.45,
          }).map((e2) => ({ t: +e2.t.toFixed(3), kind: e2.kind }))
        : null;
    return {
      player: {
        state: p.anim.stateName,
        clip: p.anim.clipName,
        clipTime: +p.anim.clipTime.toFixed(3),
        action: c.action,
        phase: c.phase,
        forward: { x: +fx.toFixed(3), z: +fz.toFixed(3) },
        attackVector: c.action === 'attack' ? { x: +fx.toFixed(3), z: +fz.toFixed(3) } : null,
        hitboxActive: c.action === 'attack' && c.phase === 'active',
        rootMotion: { x: +(fx * lunge).toFixed(2), z: +(fz * lunge).toFixed(2) },
        locoPhase: +p.anim.locoPhase.toFixed(3),
        events: timeline,
      },
      enemies,
      timeScale: this.loop.timeScale,
    };
  }

  __qaProjectiles(): Array<{ kind: string; intent: string; speed: number; x: number; z: number }> {
    return this.combat.liveProjectiles.map((a) => ({
      kind: a.kind,
      intent: a.intent,
      speed: Math.round(Math.hypot(a.vx, a.vy, a.vz) * 10) / 10,
      x: Math.round(a.x * 10) / 10,
      z: Math.round(a.z * 10) / 10,
    }));
  }

  __qaHazards(): number {
    return this.combat.liveHazards.length;
  }

  /** Enemy movement/combat intents for TEST 2. */
  __qaEnemies(): Array<{
    uid: number;
    archetype: string;
    state: string;
    intent: string;
    combatState: string;
    dist: number;
    speed: number;
    slowed: boolean;
    posture: number;
  }> {
    const p = this.player;
    return this.world.enemies
      .filter((e) => e.alive)
      .map((e) => ({
        uid: e.uid,
        archetype: e.nemesis.archetype,
        state: e.state,
        intent: e.intent,
        combatState: e.combat.state,
        dist: Math.round(Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) * 10) / 10,
        speed: Math.round(Math.hypot(e.velocity.x, e.velocity.z) * 100) / 100,
        slowed: e.slowTimer > 0,
        posture: Math.round(e.combat.postureFrac * 100),
      }));
  }

  /** Force one enemy to flee, for the ranged-interrupt half of TEST 2. */
  __qaForceFlee(): boolean {
    const e = this.nearestEnemy();
    if (!e) return false;
    e.escaping = true;
    return true;
  }

  /** Fire the Void Needle as if the player pressed the button. */
  __qaFireNeedle(): boolean {
    const p = this.player;
    if (p.stats.rangedCharges < 1) p.stats.rangedCharges = 1;
    if (p.combat.tryRanged()) {
      p.stats.rangedCharges -= 1;
      return true;
    }
    return false;
  }

  __qaRangedCharges(): number {
    return Math.round(this.player.stats.rangedCharges * 100) / 100;
  }

  /** Grant run-stat boons directly, for TEST 5 build assembly. */
  __qaGrantStat(id: string, count = 1): void {
    for (let i = 0; i < count; i++) this.player.stats.addStatBoon(id as RunStatId);
  }

  __qaStatValue(id: string): number {
    return this.player.stats.stat(id as RunStatId);
  }

  __qaForceAttack(kind: 'any' | 'slam' | 'projectile'): string {
    return this.forceEnemyAttack(kind);
  }

  /** Who is telegraphing right now, and what they are threatening. */
  __qaTelegraphs(): Array<{ uid: number; state: string; intent: string; attack: string; progress: number }> {
    const out: Array<{ uid: number; state: string; intent: string; attack: string; progress: number }> = [];
    for (const e of this.world.enemies) {
      if (!e.alive || !e.combat.attacking) continue;
      out.push({
        uid: e.uid,
        state: e.combat.state,
        intent: e.combat.intent,
        attack: e.combat.current?.id ?? '',
        progress: Math.round(e.combat.windupProgress() * 100) / 100,
      });
    }
    return out;
  }


  /**
   * Put exactly one of each archetype on the field, next to the player.
   * The archetype and weapon are forced before the Enemy is constructed, since
   * Enemy reads both from the Nemesis record in its constructor.
   */
  __qaSpawnArchetypes(): string[] {
    const want: Array<[Archetype, WeaponType]> = [
      ['fighter', 'sword'],
      ['heavy', 'club'],
      ['archer', 'bow'],
    ];
    const out: string[] = [];
    let i = 0;
    for (const [arch, wep] of want) {
      const n = this.mgr.recruit('elite', false);
      n.archetype = arch;
      n.weapon = wep;
      n.territory = this.world.currentArea.id;
      const ang = (i / want.length) * Math.PI * 2;
      const dist = arch === 'archer' ? 16 : 9;
      const e = this.world.spawnNamed(
        n,
        this.player,
        false,
        this.player.position.x + Math.sin(ang) * dist,
        this.player.position.z + Math.cos(ang) * dist
      );
      out.push(`${arch}:${e ? n.name : 'FAILED'}`);
      i++;
    }
    this.mgr.persist();
    return out;
  }

  /** Spawn exactly one enemy of the given archetype near the player. */
  __qaSpawnOne(arch: Archetype, dist = 12): string {
    const weapon: WeaponType = arch === 'heavy' ? 'club' : arch === 'archer' ? 'bow' : 'sword';
    const n = this.mgr.recruit('elite', false);
    n.archetype = arch;
    n.weapon = weapon;
    n.territory = this.world.currentArea.id;
    const a = this.player.facing;
    const e = this.world.spawnNamed(
      n,
      this.player,
      false,
      this.player.position.x - Math.sin(a) * dist,
      this.player.position.z - Math.cos(a) * dist
    );
    return e ? `${arch}:${e.uid}` : 'failed';
  }

  /** Fill the arena with anonymous grunts, to test crowd readability. */
  __qaSpawnCrowd(count: number): number {
    let made = 0;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const r = 11 + (i % 3) * 3;
      const e = this.world.spawnGrunt(
        this.player.position.x + Math.sin(ang) * r,
        this.player.position.z + Math.cos(ang) * r
      );
      if (e) made++;
    }
    return made;
  }

  /** Stand the player just in front of a tall collider, facing it. */
  __qaSeekWall(): { x: number; z: number } | null {
    let best: { x: number; z: number; r: number } | null = null;
    let bestD = Infinity;
    for (const c of this.arena.colliders) {
      if (!c.tall) continue;
      const d = Math.hypot(c.x - this.player.position.x, c.z - this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = { x: c.x, z: c.z, r: c.kind === 'circle' ? c.r : Math.hypot(c.hx, c.hz) };
      }
    }
    if (!best) return null;
    const ang = Math.atan2(this.player.position.x - best.x, this.player.position.z - best.z);
    const stand = best.r + 5;
    this.player.position.set(best.x + Math.sin(ang) * stand, 0, best.z + Math.cos(ang) * stand);
    this.player.facing = Math.atan2(-(best.x - this.player.position.x), -(best.z - this.player.position.z));
    this.player.snapFacing();
    this.camera.yaw = this.player.facing;
    this.camera.snapBehind(this.player.position, this.player.facing);
    return { x: best.x, z: best.z };
  }


  private qaNoAutoPause = false;

  __qaStart(): void {
    this.telemetry.start();
    this.qaNoAutoPause = true;
  }

  __qaStop(): Record<string, unknown> {
    this.telemetry.stop();
    return this.telemetry.dump() as unknown as Record<string, unknown>;
  }

  __deaths(): unknown[] {
    return this.telemetry.deathLog;
  }

  /* ---------- AI test hooks ---------- */

  __aiStatus(): Record<string, unknown> {
    const st = this.ai.status();
    return {
      ...st,
      last: st.last ? { kind: st.last.kind, state: st.last.state, error: st.last.error } : null,
      indicator: this.ai.indicator(),
      settings: this.mgr.data.settings.ai,
    };
  }

  /** Re-read the backend connection state (used after connecting out-of-band). */
  __aiRefresh(): void {
    void this.ai.backend.refresh();
  }

  /** Full request log, for debugging why a generation did or did not land. */
  __aiRequests(): Array<Record<string, unknown>> {
    return this.ai.queue.history.map((r) => ({
      id: r.id,
      kind: r.kind,
      who: r.label,
      nemesisId: r.nemesisId,
      state: r.state,
      error: r.error,
      ms: r.latencyMs,
    }));
  }

  __aiHistory(id: string): Array<{ title: string; turn: number }> {
    const n = this.mgr.byId(id);
    if (!n) return [];
    return (n.ai?.portraitHistory ?? []).map((h) => ({ title: h.title, turn: h.turn }));
  }

  __setAIMode(mode: 'off' | 'text' | 'full'): void {
    const s = { ...this.mgr.data.settings.ai, mode };
    this.mgr.data.settings.ai = s;
    this.ai.setSettings(s);
    this.mgr.persist();
  }

  /** Switch provider routing live — no restart of anything. */
  __setAIProvider(provider: 'openai' | 'local' | 'auto'): void {
    const s = { ...this.mgr.data.settings.ai, provider };
    this.mgr.data.settings.ai = s;
    this.ai.setSettings(s);
    this.mgr.persist();
  }

  /** Local engine status, as the UI sees it. For the test harness. */
  async __localAIStatus(): Promise<Record<string, unknown>> {
    const st = await this.ai.backend.localStatus();
    return {
      provider: this.mgr.data.settings.ai.provider ?? 'auto',
      textAvailable: this.ai.backend.textAvailable,
      imageAvailable: this.ai.backend.imageAvailable,
      installed: Boolean(st?.installed),
      running: Boolean(st?.running),
      textReady: Boolean(st?.textReady),
      imageReady: Boolean(st?.imageReady),
      progressState: st?.progress?.state ?? '',
    };
  }

  /** Content the UI would show right now for the first living named enemy. */
  __aiContentFor(id?: string): Record<string, unknown> | null {
    const n = id ? this.mgr.byId(id) : (this.mgr.living()[0] ?? null);
    if (!n) return null;
    return {
      id: n.id,
      name: n.name,
      title: this.ai.titleFor(n),
      taunt: this.ai.tauntFor(n, 0),
      chronicle: this.ai.chronicleFor(n),
      // A hash, not a prefix: every data URL starts with the same 24 bytes.
      portrait: hashString(this.ai.portraitFor(n)),
      portraitKind: this.ai.portraitFor(n).slice(0, 22),
      portraitKey: n.ai?.portrait?.key ?? '',
      portraitIsGenerated: this.ai.hasGeneratedPortrait(n),
      visualVersion: n.ai?.visualVersion ?? 0,
      eventVersion: n.ai?.eventVersion ?? 0,
    };
  }

  /** Fire a myth event by hand, to exercise the trigger path without waiting. */
  __fireMyth(id: string, kind: MythEventKind): void {
    this.myth(this.mgr.byId(id), kind);
  }

  /** Everything the save holds, so a test can assert no key is in it. */
  __rawSave(): string {
    return localStorage.getItem('shdowpit.world.v1') ?? '';
  }

  __grantPower(id: PowerId): void {
    this.player.stats.addPower(id);
    this.refreshPowerChips();
  }

  __teleport(areaId: string): void {
    const a = getArea(areaId);
    const pt = this.arena.spawnPoint(a.id, this.rng, 0.1, 0.4);
    this.player.position.set(pt.x, 0, pt.z);
  }

  /** Run the world simulation forward without playing, to stress the systems. */
  __stressTurns(n: number): {
    turns: number;
    events: number;
    living: number;
    dead: number;
    overlord: string;
    promotions: number;
    resurrections: number;
    betrayals: number;
    distinctOverlords: number;
    errors: string[];
  } {
    const errors: string[] = [];
    const overlords = new Set<string>();
    let promotions = 0;
    let resurrections = 0;
    let betrayals = 0;
    let events = 0;
    for (let i = 0; i < n; i++) {
      try {
        const res = simulateTurn(this.mgr);
        events += res.events.length;
        for (const ev of res.events) {
          if (ev.type === 'promotion') promotions++;
          else if (ev.type === 'resurrection') resurrections++;
          else if (ev.type === 'betrayal') betrayals++;
        }
        const ov = this.mgr.overlord();
        if (ov) overlords.add(ov.id);
        else errors.push(`turn ${this.mgr.turn}: no overlord`);
        const living = this.mgr.living().length;
        if (living < 8) errors.push(`turn ${this.mgr.turn}: roster collapsed to ${living}`);
      } catch (err) {
        errors.push(`turn ${i}: ${String(err)}`);
        break;
      }
    }
    const ov = this.mgr.overlord();
    return {
      turns: n,
      events,
      living: this.mgr.living().length,
      dead: this.mgr.dead().length,
      overlord: ov ? fullName(ov) : '—',
      promotions,
      resurrections,
      betrayals,
      distinctOverlords: overlords.size,
      errors,
    };
  }

  dispose(): void {
    this.loop?.stop();
    this.input.dispose();
    this.world.endRun();
    this.player.dispose();
    this.combat.dispose();
    this.particles.clear();
    this.vfx.dispose();
    this.arena.clear();
    this.renderer.dispose();
    while (this.uiRoot.firstChild) this.uiRoot.removeChild(this.uiRoot.firstChild);
  }
}

function pixelRatioFor(q: Quality): number {
  if (q === 'high') return Math.min(window.devicePixelRatio, 2);
  if (q === 'medium') return 1;
  return 0.6;
}

/** Quality chosen before the renderer exists: URL param wins, then the save. */
function readBootQuality(): Quality {
  const url = new URLSearchParams(location.search).get('quality');
  if (url === 'low' || url === 'medium' || url === 'high') return url;
  try {
    const raw = localStorage.getItem('shdowpit.world.v1');
    if (raw) {
      const q = JSON.parse(raw)?.settings?.quality;
      if (q === 'low' || q === 'medium' || q === 'high') return q;
    }
  } catch {
    /* ignore */
  }
  return 'high';
}

interface ReportArgs {
  title: string;
  subtitle: string;
  events: WorldEvent[];
  highlight?: string[];
  buttonLabel: string;
  onContinue: () => void;
  spotlight?: import('../ui/DeathReport').ReportSpotlight;
}

/** Test-only: a stable short digest, so a test can compare two data URLs. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const TITLE_FOCUS = new THREE.Vector3(0, 2, 0);
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const QA_V1 = new THREE.Vector3();
const QA_V2 = new THREE.Vector3();

function wrapAngleQA(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function describeNemesis(n: Nemesis, mgr: NemesisManager, ai?: AIContentService): string {
  const lines: string[] = [];
  lines.push(`${fullName(n)}`);
  lines.push(`id=${n.id}`);
  lines.push(`${n.rank.toUpperCase()} · ${n.archetype} · ${n.weapon} · L${n.level} · PWR ${n.power}`);
  lines.push(`${getPersonality(n.personality).name}`);
  lines.push(`alive=${n.alive} returns=${n.returns} revenge=${n.revengeChance.toFixed(2)}`);
  lines.push(`grudge=${n.playerRelationship} killsYou=${n.killsAgainstPlayer} youKilled=${n.defeatsByPlayer} escaped=${n.escapedPlayer}`);
  lines.push(`S: ${n.strengths.map(traitName).join(', ') || '—'}`);
  lines.push(`W: ${n.weaknesses.map(traitName).join(', ') || '—'}`);
  lines.push(`A: ${n.adaptations.map(traitName).join(', ') || '—'}`);
  lines.push(`scars: ${n.scars.map((s) => s.id).join(', ') || '—'}`);
  lines.push(`rivals: ${n.rivalries.map((id) => mgr.byId(id)?.name ?? '?').join(', ') || '—'}`);
  lines.push(`allies: ${n.allies.map((id) => mgr.byId(id)?.name ?? '?').join(', ') || '—'}`);
  lines.push(`stolen: ${n.stolen.map((s) => s.name).join(', ') || '—'}`);
  lines.push(`memory: ${n.memory.slice(-6).map((m) => m.type).join(', ') || '—'}`);
  if (ai) {
    const a = n.ai;
    lines.push(`ai.title: ${a?.title ?? '(local)'}`);
    lines.push(`ai.taunts: ${a?.taunts?.length ?? 0}`);
    lines.push(`ai.chronicle: ${a?.chronicle ? 'yes' : '(local)'}`);
    lines.push(
      `ai.portrait: ${a?.portrait ? (ai.hasGeneratedPortrait(n) ? 'generated' : 'pending') : 'procedural'}` +
        `  history=${a?.portraitHistory?.length ?? 0}`
    );
    lines.push(`ai.versions: visual=${a?.visualVersion ?? 0} events=${a?.eventVersion ?? 0}`);
  }
  return lines.join('\n');
}
