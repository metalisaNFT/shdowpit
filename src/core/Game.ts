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
import { makeEvent } from '../world/WorldEvent';
import type { WorldEvent } from '../world/WorldEvent';
import { composeRunRecap, composeWorldTurnRecap } from '../story/StoryRecap';
import {
  encounterHeadlineFor,
  observeEncounter,
  observeRecapBeats,
  arcVoiceFor,
  journeyLineFor,
  observeArcs,
  observeJourney,
  observeTimeline,
  recapBeatKey,
  recapBeatLineFor,
  timelineDetailFor,
  type EncounterOverlayContext,
} from '../story/StoryAI';
import { buildTimeline } from '../story/StoryTimeline';
import { runStorySelfTest, formatStorySelfTest } from '../story/StorySelfTest';
import { runWiringSelfTest, formatWiringSelfTest } from './WiringSelfTest';
import { inspectArc, inspectEdge, inspectNode, inspectRecap } from '../story/StoryInspector';
import { buildStoryModel } from '../story/StoryModel';
import { simulateTurn, simulateSuccession } from '../world/WorldSimulation';
import { heatLabel, addHeat } from '../world/Heat';
import { applyVerticalSlice } from '../world/VerticalSlice';
import { TutorialController, markTutorial, tutorialDone, type TutorialId } from './Tutorial';

import { NemesisManager } from '../nemesis/NemesisManager';
import { fullName, rankIndex, type Archetype, type Nemesis, type Rank, type WeaponType } from '../nemesis/Nemesis';
import { recomputePower } from '../nemesis/NemesisGenerator';
import { applyScar, remember, SCAR_NAMES } from '../nemesis/NemesisMemory';
import { breakBond, makeRivals } from '../nemesis/NemesisRelationships';
import { NemesisEncounterDirector, aidCallout, betrayalCallout, duelCallout } from '../nemesis/NemesisEncounterDirector';
import { classifyEncounter, type EncounterKind } from '../nemesis/EncounterKind';
import { encounterLine, relationshipLabel } from '../nemesis/EncounterCopy';
import { rankName } from '../nemesis/NemesisManager';
import { accentColorFor } from '../nemesis/NemesisAppearance';
import { signatureDef, signatureEventMatches } from '../data/signatures';
import { CONDITION_LABEL } from '../god/Conditions';
import { liberationRewardFor, type TerritoryPresentation } from '../world/TerritoryRules';

import { Player } from '../player/Player';
import { Enemy } from '../enemy/Enemy';
import { CombatSystem } from '../combat/CombatSystem';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { Particles } from '../fx/Particles';
import { VFX } from '../fx/VFX';
import { DamageNumbers } from '../fx/DamageNumbers';
import { PostFX } from '../fx/PostFX';
import { crossedFootstep, buildAttackTimeline } from '../anim/AnimEvents';
import { AudioManager } from '../audio/AudioManager';

import { HUD } from '../ui/HUD';
import { decideOverlays } from '../ui/OverlayGate';
import { TitleScreen } from '../ui/TitleScreen';
import { HierarchyScreen } from '../ui/HierarchyScreen';
import { DeathReport } from '../ui/DeathReport';
import { NemesisIntro } from '../ui/NemesisIntro';
import { ChoiceOverlay } from '../ui/ChoiceOverlay';
import { PowerSelect } from '../ui/PowerSelect';
import { PauseScreen } from '../ui/PauseScreen';
import { DebugOverlay, type DebugHooks, type GodDebugState } from '../ui/DebugOverlay';
import { AIStatus } from '../ui/AIStatus';
import { BuildScreen } from '../ui/BuildScreen';
import { ComicViewer } from '../ui/ComicViewer';
import { ComicService } from '../comic/ComicService';
import type { ComicQualityProfileId } from '../comic/Types';

import { GodRun } from '../god/GodRun';
import { addChaos, chaosTier } from '../god/Influence';
import { livingFactions } from '../god/Factions';
import {
  beatKey,
  beatVoiceFor,
  crisisVoiceFor,
  dossierFor,
  dossierKey,
  legendKey,
  legendVoiceFor,
  mechanicalSnapshot,
  observeEnding,
  observeGodBeats,
  observeInspect,
  observeAftermath,
  observeSituations,
  aftermathLinkFor,
  situationVoiceFor,
  situationKey,
  recapKey,
  recapLineFor,
} from '../god/GodAI';
import { GodScreen } from '../ui/GodScreen';
import { PrimerScreen } from '../ui/GodTutorial';
import { Guide, STEP_COUNT, STEP_ORDER, pickLesson, type GuideEvent, type Lesson } from '../god/Teaching';
import { LegendsScreen, RunEndScreen } from '../ui/LegendsScreen';
import { BEAT_RANK, simOf, type Beat, type RunOutcome } from '../god/GodTypes';
import { GodClock, pickPauseBeat, pickSpectacleBeat, type GodClockState } from '../god/Clock';
import { GodSpectator } from '../ui/GodSpectator';
import { populatedAreas } from '../ui/GodMap';
import { activeConditionLabels, applyLegacyPresence, applyTiltToEnemy, legacyArrivalToast, legendOmenFor, legacyTiltFor, legendSpawnBias, mergeCombatTilts, nemesisTilt, resolveLegacyEcho } from '../god/PitBridge';
import { encounterTuningFromKit } from '../core/Telemetry';
import { removeConditions } from '../god/Conditions';
import { describeQuietDecline, spectacleCauseCaption } from '../god/Aftermath';

import { AIContentService } from '../ai/AIContentService';
import type { MythEventKind } from '../ai/AITypes';

import { type PowerDef, type PowerId } from '../data/abilities';
import { getArea } from '../data/areas';
import { chooseTitle } from '../data/names';
import { rollPowerOffers, rollUncappedStats } from '../abilities/OfferRoller';
import { activeReactions, potentialReactions } from '../abilities/Reactions';
import { AbilityRuntime, type FailReason } from '../abilities/AbilityRuntime';
import { DEFAULT_LOADOUT, getSkill, isUltimateSkill, isUnlockableSkill, profileFor, STARTING_SKILLS, weaponFamily, type SkillId } from '../data/skills';
import { factsFromNemesis, rollVendetta, applyVendettaProgress, vendettaHud, applyVendettaRewardKind, adaptationHabitFor, type VendettaInstance } from '../nemesis/Vendetta';
import { nemesisRewardChoices } from '../nemesis/NemesisRewards';
import { outcomeOptions, type OutcomeId } from '../nemesis/EncounterOutcomes';
import { HEAT, HEAL_ECON, REMNANT, EXTRACT, OUTCOME } from '../data/balance';
import { RELIC_WEAPONS } from '../data/weapons';
import { getPersonality } from '../data/personalities';
import { traitName } from '../data/traits';
import { RUN_STATS, formatStat, statValue, type RunStatId } from '../data/stats';
import { ATTACK_MAP } from '../data/attacks';
import type { DamageInfo } from '../combat/Types';
import { canProc } from '../combat/ProcRules';
import { DebugDraw } from '../fx/DebugDraw';
import {
  addMastery,
  applyBuildToStats,
  applyStartingPerks,
  cinderBonusForNamedKill,
  ensureStarterGear,
  equipItem,
  grantCinders,
  mint,
  runLootChoices,
  startingBoonOffset,
  startingPerkNames,
  syncLegacyWeapons,
  syncStartingUnlocks,
  unlockNode,
  respecTree,
} from '../progress/Progression';
import type { ItemDef } from '../data/equipment';
import { SKILL_NODE_MAP } from '../data/skillTree';

type Mode =
  | 'title'
  | 'playing'
  | 'paused'
  | 'hierarchy'
  | 'report'
  | 'power'
  | 'dying'
  | 'choice'
  | 'build'
  /** THE LONG GAME: the god layer's board */
  | 'god'
  | 'legends'
  | 'godend';

/** Seconds of unbroken calm before the optional vendetta prompt may open. */
const VENDETTA_CALM_REQUIRED = 1.4;
/** Seconds of play owed to the player after any offer closes. */
const OFFER_QUIET_AFTER = 3;
/** Named-kill rewards get this window before a comic page may open. */
const COMIC_HOLD_AFTER_NAMED = 1.0;
/** Seconds of empty-arena calm before a recap may open. */
const COMIC_CALM_REQUIRED = 0.85;
/** Seconds of breathing room between exchanges (enemies alive but idle). */
const COMIC_SOFT_CALM = 0.55;
/** Drop a queued encounter recap if the player has already moved on. */
const COMIC_EXPIRE = 14;

const RELIC_ORDER = ['sunblade', 'ashfang', 'longtooth'];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private input: Input;
  private bus: Bus = createBus();
  private saveSys = new SaveSystem();
  private audio = new AudioManager();
  private particles = new Particles();
  private vfx = new VFX(this.particles);
  private damageNumbers = new DamageNumbers();
  private prevLocoPhase = 0;
  private arena = new Arena();
  private post!: PostFX;
  private camera: ThirdPersonCamera;
  private mgr: NemesisManager;
  private world: World;
  private player = new Player();
  private combat!: CombatSystem;
  private abilities = new AbilityRuntime();
  private tutorial = new TutorialController();
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
    choice: ChoiceOverlay;
    pause: PauseScreen;
    debug: DebugOverlay;
    aiStatus: AIStatus;
    build: BuildScreen;
    god: GodScreen;
    primer: PrimerScreen;
    legends: LegendsScreen;
    godEnd: RunEndScreen;
    comic: ComicViewer;
  };

  private mode: Mode = 'title';

  /* ---- THE LONG GAME ---- */
  private godRun: GodRun | null = null;
  /** set while the player has DESCENDED into a third-person run from the board */
  private descent: {
    nemesisId: string;
    cycle: number;
    brief: import('../god/GodTypes').DescentBrief;
    snapshot: {
      alive: boolean;
      power: number;
      territory: string;
      scars: number;
      injury: number;
      stolen: number;
      holder: string | null;
    };
    playerDied: boolean;
    extracted: boolean;
  } | null = null;
  /** cycle counter shown in the god screen's acceleration readout */
  private godBusy = false;
  private godGuide = new Guide();
  private godLesson: Lesson | null = null;
  private godIdleCycles = 0;
  private godClock: GodClock | null = null;
  private godSpectator: GodSpectator | null = null;
  private pendingSpectacleBeat: Beat | null = null;
  /** the roster screen is shared; this says where CLOSE should return to */
  private hierarchyFromGod = false;
  private lockGrace = 0;
  private deathTimer = 0;
  private pendingKiller: Enemy | null = null;
  /** Lines to toast in the first seconds of the next run — world turned while dead. */
  private pendingWorldPayoff: string[] = [];
  private lockTargetUid: number | null = null;
  private debugInvulnerable = false;
  private debugInfiniteSurge = false;
  private debugOpen = false;
  /** scene-space debug rendering: vectors, hitboxes, trajectories (F1) */
  private debugDraw = new DebugDraw();
  /** kills needed for the next stat-boon offer — MegaBonk-style growth */
  private nextBoonKills = 7;
  /** alternates kill-milestone offers between stat boons and run loot */
  private runLootCycle = 0;
  /** A vendetta offer is armed and waiting for a safe beat to open. */
  private vendettaOfferPending = false;
  /** Rumour omens toast once per descent when no specific actor is tagged. */
  private legacyOmenShown = false;
  /** StoryAI overlay facts for the next encounter card. */
  private encounterAiContext: EncounterOverlayContext = {};
  /** Last dramatic combat line for encounter copy. */
  private combatOverlayNote = '';
  private lastSpawnTuningNote = '';
  private spawnTuningTimer = 0;
  /** Non-blocking vendetta rolled and waiting for Y/N. */
  private vendettaOffer: VendettaInstance | null = null;
  /** Seconds of play this run — gates early-run interruptions. */
  private runClock = 0;
  /** Seconds of uninterrupted calm, for the vendetta lull test. */
  private calmTime = 0;
  /** Seconds before another optional offer may open after one closed. */
  private offerQuiet = 0;
  /** Fullscreen offer waiting for intro / lull to finish. */
  private pendingModal: { label: string; open: () => void } | null = null;
  /** Real-time seconds of idle with no intro, before a queued modal may open. */
  private modalCalm = 0;
  /** True between the Overlord's death and the succession report. */
  private succession = false;
  private quality: Quality;
  private lowFpsTime = 0;
  private markedUid = -1;
  private uiRoot: HTMLElement;
  private comic!: ComicService;
  /** True while the comic viewer owns input (overlay, not a Mode). */
  private comicOpen = false;
  /** Encounter recap waiting for rewards / a lull. */
  private pendingComic: import('../comic/Types').ComicSequence | null = null;
  /** Seconds after a named kill before a queued comic may present. */
  private comicHold = 0;
  /** Playing-time while a comic has been waiting. */
  private comicAge = 0;
  /** Seconds of empty-arena idle before a queued recap may present. */
  private comicCalm = 0;
  /** Vertical-slice / debug: present as soon as the intro is not busy. */
  private comicForce = false;

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

    this.ui = {
      hud: new HUD(),
      title: new TitleScreen(),
      hierarchy: new HierarchyScreen(),
      report: new DeathReport(),
      intro: new NemesisIntro(),
      power: new PowerSelect(),
      choice: new ChoiceOverlay(),
      pause: new PauseScreen(),
      debug: new DebugOverlay(),
      aiStatus: new AIStatus(),
      build: new BuildScreen(),
      god: new GodScreen(),
      primer: new PrimerScreen(),
      legends: new LegendsScreen(),
      godEnd: new RunEndScreen(),
      comic: new ComicViewer(),
    };
    for (const k of Object.keys(this.ui) as Array<keyof typeof this.ui>) {
      uiRoot.append(this.ui[k].root);
    }
    this.ui.hud.root.append(this.damageNumbers.root);
    this.setupAI();
    this.bindEncounter();

    this.world = new World(this.mgr, this.arena, this.arena.scene, this.bus, {
      onNamedArrival: (e, salt, ctx) => this.onNamedArrival(e, salt, ctx),
      onNamedEscape: (e) => {
        this.finishVendettaAgainst(e, false, true);
        this.encounter.begin(e, this.mgr.turn, { outcome: 'escape' });
      },
      onToast: (t, tone) => this.ui.hud.toast(t, tone),
      onOverlordSlain: (e) => this.onOverlordSlain(e),
      onNamedDefeated: (e, escaped) => this.onNamedDefeated(e, escaped),
      onDuel: (a, b) => {
        this.ui.hud.toast(duelCallout(a.nemesis, b.nemesis), 'gold');
        this.audio.play('nemesis_betrayal', { volume: 0.45 });
      },
      onAid: (g, m) => this.ui.hud.toast(aidCallout(g.nemesis, m.nemesis), 'gold'),
      onEnterTerritory: (areaName, p) => this.onEnterTerritory(areaName, p),
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
      this.damageNumbers,
      this.audio,
      this.loopRef(),
      this.camera,
      this.arena.scene,
      {
        onEnemyKilled: (e, executed) => this.onEnemyKilled(e, executed),
        onPlayerKilled: (killer) => this.onPlayerKilled(killer),
        onPlayerDamaged: (from, amount) => this.onPlayerDamaged(from, amount),
        onParrySuccess: (e, perfect) => {
          this.world.noteParry(e);
          if (this.isVendettaTarget(e) && perfect) this.world.vendettaCounters.parries++;
        },
        onEnemyStaggered: () => void 0,
        onHabit: (k, amount) => {
          this.player.stats.habits[k] += amount ?? 1;
          this.trackVendettaAdaptation(k);
        },
        onExecutionStarted: (e) => this.onNamedExecution(e),
        onPostureBroken: (e) => {
          if (this.isVendettaTarget(e)) this.world.vendettaCounters.posture++;
          this.maybeOpenOutcome(e);
        },
        onInterrupt: (e) => {
          if (this.isVendettaTarget(e)) this.world.vendettaCounters.interrupts++;
        },
        onWeaknessHit: (e) => {
          if (this.isVendettaTarget(e)) this.world.vendettaCounters.weakness = true;
        },
        onProcNote: (t) => {
          this.world.run.lastProcNote = t;
          const named = this.world.enemies.find((e) => e.alive && e.named);
          const dramatic = /KILL RHYTHM|THE CHASE|PLAGUE WAVE|BLOOD TITHE|RICOCHET|SECOND WIND/.test(t);
          this.bus.emit('combatProc', { note: t, nemesisId: named?.nemesis.id, dramatic });
          this.ui.hud.toast(t, 'gold', 1.6);
        },
        onEnemyStrikeLanded: (e, info) => {
          if (!e.named) return;
          this.bus.emit('namedStrike', {
            nemesisId: e.nemesis.id,
            fromPlayer: false,
            amount: info.amount,
            critical: info.critical,
            attackLabel: info.attackLabel,
          });
        },
        onPlayerStrikeLanded: (e, info) => {
          if (!e.named) return;
          this.bus.emit('namedStrike', {
            nemesisId: e.nemesis.id,
            fromPlayer: true,
            amount: info.amount,
            critical: info.critical,
            attackLabel: info.attackLabel,
          });
        },
      }
    );

    this.combat.telemetry = this.telemetry;
    this.combat.abilities = this.abilities;
    this.combat.setDirector(this.world.director);
    this.setupComic();

    this.bus.on('worldEvent', (ev) => {
      if (ev.important && this.mode === 'playing') this.ui.hud.toast(ev.text, ev.tone === 'bad' ? 'hot' : 'gold');
    });
    this.bus.on('nemesisPromoted', ({ nemesis, to }) => {
      if (this.mode === 'playing') {
        this.ui.hud.toast(`${fullName(nemesis)} IS NOW ${to.toUpperCase()}`, 'gold', 4);
        if (this.descent) {
          const live = this.world.enemies.find((e) => e.alive && e.nemesis.id === nemesis.id);
          if (live) {
            applyTiltToEnemy(live, nemesisTilt(this.godRun?.god ?? null, nemesis.id));
            this.ui.hud.toast('THE BOARD SHIFTS BENEATH YOU', 'hot', 2.6);
          }
        }
      }
      this.aiDirty = true;
    });
    this.bus.on('nemesisDied', ({ nemesis, byPlayer }) => {
      if (!byPlayer && this.mode === 'playing') {
        this.ui.hud.toast(`${fullName(nemesis)} FELL`, 'neutral', 3.5);
      }
      this.aiDirty = true;
    });
    this.bus.on('nemesisReturned', ({ nemesis }) => {
      if (this.mode === 'playing') this.ui.hud.toast(`${fullName(nemesis)} RETURNED`, 'hot', 4.5);
      this.aiDirty = true;
      if (this.mode === 'playing') this.comic?.onNamedIntro(nemesis.id, 'FROM THE DEAD');
    });
    this.bus.on('namedStrike', ({ nemesisId, fromPlayer, amount, critical, attackLabel }) => {
      if (fromPlayer) {
        if (amount >= 18 || critical) this.comic?.onPlayerStrike(nemesisId, { amount, critical, attackLabel });
        if (amount >= 22 || critical) {
          this.combatOverlayNote = critical ? `YOU CRIT ${attackLabel}` : `HEAVY HIT — ${attackLabel}`;
        }
      } else {
        this.comic?.onNamedStrike(nemesisId, {
          critical,
          amount,
          attackId: attackLabel,
          attackLabel,
        });
        if (amount >= 20) this.combatOverlayNote = `${attackLabel} HURT YOU`;
      }
      if (amount >= 28 || critical) this.aiDirty = true;
    });
    this.bus.on('combatProc', ({ note, nemesisId, dramatic }) => {
      if (!dramatic || !nemesisId) return;
      this.comic?.onProcFlourish(nemesisId, note);
      this.combatOverlayNote = note;
      this.audio.play('stagger', { volume: 0.42, pitch: 0.88, minGap: 0.9 });
      if (this.descent) this.ui.hud.toast(`THE BOARD FEELS IT — ${note}`, 'gold', 2.4);
      const n = this.mgr.byId(nemesisId);
      if (n && note === 'KILL RHYTHM' && this.rng.chance(0.35)) {
        remember(n, 'PLAYER_HUMILIATED_ME', this.mgr.turn);
      }
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
     Comic combat (presentation — simulation facts only)
     ============================================================ */

  private setupComic(): void {
    const g = this;
    this.comic = new ComicService({
      renderer: this.renderer,
      scene: this.arena.scene,
      backend: this.ai.backend,
      world: {
        getSubjects(nemesisId) {
          const e = g.world.enemies.find((x) => x.named && x.nemesis.id === nemesisId);
          if (!e) return null;
          return {
            player: g.player.position.clone(),
            enemy: e.position.clone(),
            enemyFacing: e.facing,
            playerFacing: g.player.facing,
          };
        },
        getSeed(nemesisId) {
          const n = g.mgr.byId(nemesisId);
          if (!n) return null;
          const rel = relationshipLabel(n);
          return {
            nemesisId: n.id,
            nemesisName: n.name,
            title: g.ai.titleFor(n),
            rank: n.rank,
            weapon: n.weapon,
            locationName: g.world.currentArea.name,
            relationshipNote: rel || '',
          };
        },
        hpFracs(nemesisId) {
          const e = g.world.enemies.find((x) => x.nemesis.id === nemesisId);
          return {
            player: g.player.stats.maxHp > 0 ? g.player.stats.hp / g.player.stats.maxHp : 1,
            enemy: e && e.maxHp > 0 ? e.hp / e.maxHp : 1,
          };
        },
      },
      onSequenceReady: (seq) => g.openComic(seq),
      onPanelReady: (panel, seq) => {
        if (g.comicOpen && g.ui.comic.visible) {
          g.ui.comic.appendPanel(panel, seq);
          if (seq.ready) g.ui.comic.finalizeSequence(seq);
          return;
        }
        if (!g.pendingComic && !g.comicOpen) {
          g.pendingComic = seq;
          g.comicAge = 0;
        }
        if (g.pendingComic === seq && panel.state === 'ready') g.tryPresentComic();
      },
    });
    this.comic.setQuality('potato');
    // Save data is not loaded until start(); applySettings() sets enabled there.
  }

  private openComic(seq: import('../comic/Types').ComicSequence): void {
    if (this.comicOpen) {
      if (this.ui.comic.visible) this.ui.comic.finalizeSequence(seq);
      return;
    }
    this.pendingComic = seq;
    this.comicAge = 0;
    this.tryPresentComic();
  }

  private enemiesAttacking(): boolean {
    return this.world.enemies.some(
      (e) => e.alive && (e.combat.state === 'windup' || e.combat.state === 'hold' || e.combat.state === 'active')
    );
  }

  private comicArenaCalm(): boolean {
    if (this.player.combat.action !== 'idle') return false;
    if (this.enemiesAttacking()) return false;
    const empty = !this.world.enemies.some((e) => e.alive);
    return this.comicCalm >= (empty ? COMIC_CALM_REQUIRED : COMIC_SOFT_CALM);
  }

  private tryPresentComic(): void {
    if (!this.pendingComic || this.comicOpen) return;
    if (this.mode !== 'playing') return;
    if (this.pendingModal) return;
    if (this.encounter.busy || this.ui.intro.active) return;
    if (!this.pendingComic.panels.some((p) => p.state === 'ready' || p.state === 'failed')) return;
    if (!this.comicForce) {
      if (this.qaSuppressOffers) return;
      if (this.comicHold > 0) return;
      if (this.offerQuiet > 0) return;
      if (!this.comicArenaCalm()) return;
    }
    this.presentComicNow(this.pendingComic);
  }

  private presentComicNow(seq: import('../comic/Types').ComicSequence): void {
    this.pendingComic = null;
    this.comicForce = false;
    this.comicAge = 0;
    this.comicHold = 0;
    this.comicCalm = 0;
    this.comicOpen = true;
    this.uiRoot.classList.add('comic-open');
    this.input.exitPointerLock();
    this.input.setEnabled(false);
    this.input.clearBuffers();
    this.loop.paused = true;
    this.ui.comic.beginSequence(seq, () => this.closeComic());
    for (const p of seq.panels) {
      if (p.state === 'ready' || p.state === 'failed') this.ui.comic.appendPanel(p, seq);
    }
    if (seq.ready) this.ui.comic.finalizeSequence(seq);
  }

  private closeComic(): void {
    this.comicOpen = false;
    this.uiRoot.classList.remove('comic-open');
    this.input.clearBuffers();
    const keepPaused =
      this.mode === 'paused' ||
      this.mode === 'hierarchy' ||
      this.mode === 'power' ||
      this.mode === 'choice' ||
      this.mode === 'report' ||
      this.mode === 'build' ||
      this.mode === 'godend';
    this.loop.paused = keepPaused;
    if (this.mode === 'playing') {
      this.input.setEnabled(true);
      this.lockGrace = 0.8;
      this.input.requestPointerLock();
    }
  }

  /** Close the viewer and optionally drop a queued recap (death, title, new run). */
  private dismissComic(dropQueue: boolean): void {
    if (this.comicOpen) this.ui.comic.hide();
    if (dropQueue) {
      this.pendingComic = null;
      this.comicForce = false;
      this.comicAge = 0;
      this.comicHold = 0;
      this.comicCalm = 0;
    }
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
        if (this.ui.report.visible && this.lastReport?.recap?.length) {
          this.presentReport(this.lastReport);
        }
        if (this.mode === 'god' && this.ui.god.visible) this.ui.god.refresh();
        if (this.mode === 'legends' && this.ui.legends.visible) this.ui.legends.refresh();
        if (this.mode === 'godend' && this.ui.godEnd.visible && this.godRun?.outcome) {
          this.ui.godEnd.refreshVoice(recapLineFor(this.ai, this.godRun.outcome, this.godRun.god.run));
        }
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
      presentCard: (p) => {
        g.ui.hud.clearAreaBanner();
        g.tutorial.dismiss();
        g.ui.intro.present(p);
      },
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
      observeEncounter: (n, kind, headline, chip) => {
        g.syncAIWorld();
        observeEncounter(g.ai, n, kind, headline, chip, {
          ...g.encounterAiContext,
          recentProc: g.world.run.lastProcNote || g.encounterAiContext.recentProc,
          combatNote: g.combatOverlayNote || g.encounterAiContext.combatNote,
        });
        g.encounterAiContext = {};
      },
      headlineFor: (n, kind, fallback) => encounterHeadlineFor(g.ai, n, kind, fallback),
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
    else if (this.mode === 'god' || this.mode === 'legends' || this.mode === 'godend') this.openGodSettings();
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
        onSkipTutorials: () => this.skipGodTeaching(),
        onReplayTutorials: () => this.replayGodTeaching(),
        ...this.telemetryPauseHooks(),
      },
      false,
      { asSettings: true }
    );
  }

  /**
   * Settings from THE LONG GAME. Same panel as title; mode stays `god` so
   * closing it returns to the board rather than starting a 3D run.
   */
  private openGodSettings(): void {
    if (this.mode !== 'god' && this.mode !== 'legends' && this.mode !== 'godend') return;
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
        onSkipTutorials: () => this.skipGodTeaching(),
        onReplayTutorials: () => this.replayGodTeaching(),
        ...this.telemetryPauseHooks(),
      },
      false,
      { asSettings: true }
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

  private telemetryPauseHooks(): Pick<import('../ui/PauseScreen').PauseHandlers, 'telemetryOptIn' | 'onTelemetryOptInChanged'> {
    return {
      telemetryOptIn: this.mgr.data.playerMeta.telemetryOptIn,
      onTelemetryOptInChanged: (v) => {
        this.mgr.data.playerMeta.telemetryOptIn = v;
        this.syncTelemetryOptIn();
        if (this.saveSys.exists()) this.mgr.persist();
      },
    };
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
    this.world.refreshOccupancy();
    this.camera.setArena(this.arena);
    this.arena.scene.add(this.particles.group);
    this.arena.scene.add(this.vfx.group);
    this.arena.scene.add(this.player.root);
    this.arena.scene.add(this.debugDraw.group);
    for (const e of this.world.enemies) this.arena.scene.add(e.rig.root);
    if (this.mode === 'god') {
      this.player.root.visible = false;
      this.godSpectator?.invalidateNav();
      this.syncGodWorldPop();
    }
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
    ensureStarterGear(this.mgr.data.playerMeta);
    this.syncTelemetryOptIn();
    this.syncAIWorld();
    this.rebuildArena();
    this.showTitle(loaded);
    this.loop.start();
  }

  private showTitle(hasSave: boolean): void {
    this.mode = 'title';
    this.ui.aiStatus.clear();
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.hud.setVisible(false);
    this.ui.report.hide();
    this.ui.intro.hide();
    this.ui.power.hide();
    this.ui.choice.hide();
    this.dismissComic(true);
    this.ui.hierarchy.close();
    this.ui.pause.close();
    this.ui.build.hide();
    this.ui.god.hide();
    this.ui.primer.hide();
    this.ui.legends.hide();
    this.ui.godEnd.hide();
    this.world.endRun();
    this.setGodOverviewPresentation(false);

    const ov = this.mgr.overlord();
    const meta = this.mgr.data.playerMeta;
    const newPerks = syncStartingUnlocks(meta);
    if (newPerks.length) {
      for (const id of newPerks) this.ui.hud.toast(`UNLOCKED ${startingPerkNames([id])[0]}`, 'gold', 4);
    }
    this.ui.title.present(
      {
        hasSave,
        age: this.mgr.age,
        ageName: this.mgr.ageState.name,
        turn: this.mgr.turn,
        overlord: ov ? fullName(ov) : '',
        livingNamed: this.mgr.living().length,
        runs: meta.runs,
        deaths: meta.deaths,
        legendCount: (this.mgr.data.legends ?? []).length,
        startingPerks: startingPerkNames(meta.unlockedStarting),
      },
      {
        onContinue: () => this.beginPlaying(),
        onNewWorld: () => {
          this.mgr.newWorld(randomSeed());
          this.rebuildArena();
          this.godRun = null;
          this.openLongGame();
        },
        onReset: () => {
          this.mgr.wipe();
          this.mgr.newWorld(randomSeed());
          this.rebuildArena();
          this.godRun = null;
          this.showTitle(true);
        },
        onBuild: () => this.openBuild('title'),
        onLongGame: () => {
          if (!this.saveSys.exists()) {
            this.mgr.newWorld(randomSeed());
            this.rebuildArena();
          }
          this.openLongGame();
        },
        onDescendAlone: () => {
          if (!this.saveSys.exists()) {
            this.mgr.newWorld(randomSeed());
            this.rebuildArena();
          }
          this.beginPlaying();
        },
        onLegends: () => this.openLegends('title'),
        onSettings: () => this.openTitleSettings(),
        hasGodRun: !!this.mgr.data.god,
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
    const perkNotes = applyStartingPerks(this.mgr.data.playerMeta, this.world.run);
    this.combatOverlayNote = '';
    this.encounterAiContext = {};
    this.lastSpawnTuningNote = '';
    this.spawnTuningTimer = 0;
    this.refreshSpawnTuning(true);
    this.combat.setEnemies(this.world.enemies);
    this.combat.run = this.world.run;
    this.combat.clearProjectiles();
    this.particles.clear();
    this.vfx.clear();
    this.damageNumbers.clear();
    this.nextBoonKills = Math.max(4, 7 - startingBoonOffset(this.mgr.data.playerMeta));
    this.runLootCycle = 0;
    this.vendettaOfferPending = false;
    this.vendettaOffer = null;
    this.runClock = 0;
    this.calmTime = 0;
    this.offerQuiet = 0;
    this.pendingModal = null;
    this.modalCalm = 0;
    this.dismissComic(true);

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
    const terr = this.world.territoryNow();
    const rule = terr.rules[0];
    const bannerSub =
      terr.holderName !== 'UNCLAIMED' && rule
        ? `${terr.holderName.toUpperCase()} · ${rule.title}`
        : `AGE ${this.mgr.age} — ${this.mgr.ageState.name}`;
    if (!this.ui.intro.active) {
      this.ui.hud.showAreaBanner(this.world.currentArea.name.toUpperCase(), bannerSub);
    }
    const payoff = this.pendingWorldPayoff.splice(0, this.pendingWorldPayoff.length);
    if (payoff.length) {
      for (const line of payoff.slice(0, 2)) this.ui.hud.toast(line, line.includes('STILL') || line.includes('KILLED') ? 'hot' : 'gold', 5.5);
    } else {
      this.ui.hud.toast('FIND SOMETHING WORTH REMEMBERING', 'neutral', 5);
    }
    for (const note of perkNotes) this.ui.hud.toast(note, 'gold', 3.5);
    this.syncSkillLoadout();
    this.maybeTeach('basics');
    if (this.mgr.data.playerMeta.runs >= 2) this.maybeTeach('second_run');
    this.applyPlayerBuild(true);
    this.mgr.persist();
  }

  private onEnterTerritory(areaName: string, p: TerritoryPresentation): void {
    const rule = p.rules[0];
    const sub =
      p.holderName !== 'UNCLAIMED' && rule
        ? `${p.holderName.toUpperCase()} · ${rule.title}`
        : rule?.id === 'void_quiet'
          ? 'UNCLAIMED GROUND'
          : areaName;
    if (!this.ui.intro.active && !this.encounter.busy) {
      this.ui.hud.showAreaBanner(areaName.toUpperCase(), sub);
    }
  }


  /* ============================================================
     THE LONG GAME — the god layer
     ============================================================ */

  /**
   * Start or resume the god-layer run. The world in the save is the same world
   * the third-person game uses; the long game simply stops moving a hero
   * through it and starts moving the conditions around it.
   */
  private openLongGame(): void {
    this.audio.unlock();
    this.ui.title.hide();
    this.ui.pause.close();
    this.ui.report.hide();
    this.ui.hud.setVisible(false);
    this.world.endRun();

    if (!this.godRun) {
      this.godRun = new GodRun(this.mgr, {
        onBeats: (beats) => this.onGodBeats(beats),
        onEnd: (o) => this.onGodEnd(o),
      });
    }
    const saved = this.mgr.data.god;
    if (saved && !saved.ended) {
      this.godRun.resume(saved);
    } else {
      this.ai.invalidateGodWork();
      this.mgr.data.playerMeta.runs++;
      this.godRun.begin(randomSeed());
      this.godIdleCycles = 0;
      this.godLesson = null;
    }
    const tut = this.mgr.data.settings.tutorial;
    this.godGuide.load(tut.godGuide || 'select');
    if (tut.skipped) this.godGuide.finish();
    this.showGodScreen();
  }

  private showGodScreen(): void {
    if (!this.godRun) return;
    this.ui.aiStatus.clear();
    this.mode = 'god';
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.loop.paused = false;
    this.ui.legends.hide();
    this.ui.godEnd.hide();
    this.ui.primer.hide();
    this.ui.god.bindTeach({
      onSkip: () => this.skipGodTeaching(),
      onDismiss: () => this.dismissGodLesson(),
      onPrimer: () => this.openPrimer(),
    });
    this.setupGodOracle();
    this.ui.god.present({
      run: () => this.godRun!,
      advance: (n) => this.godAdvance(n),
      intervene: (id, a, b, area) => this.godIntervene(id, a, b, area),
      openRoster: () => this.openRosterFromGod(),
      openLegends: () => this.openLegends('god'),
      abandon: () => this.abandonGodRun(),
      close: () => this.showTitle(true),
      portraitFor: (n) => this.ai.portraitFor(n),
      displayName: (n) => this.ai.displayName(n),
      dossierFor: (n) => (this.godRun ? dossierFor(this.ai, n, this.godRun.god, this.mgr) : ''),
      chronicleFor: (n) => this.ai.chronicleFor(n),
      beatVoiceFor: (b) => (this.godRun ? beatVoiceFor(this.ai, b, this.godRun.god) : null),
      crisisVoiceFor: () => (this.godRun ? crisisVoiceFor(this.ai, this.godRun.god) : null),
      aftermathLinkFor: (cycle, label, text) =>
        this.godRun ? aftermathLinkFor(this.ai, this.godRun.god.run, cycle, label, text) : text,
      situationVoiceFor: (s) => (this.godRun ? situationVoiceFor(this.ai, s, this.godRun.god) : null),
      inspectCharacter: (n) => {
        if (!this.godRun) return;
        this.syncAIWorld();
        observeInspect(this.ai, this.mgr, this.godRun.god, n);
      },
      clearAftermath: () => {
        this.godRun?.clearAftermath();
        this.playPendingGodSpectacle();
      },
      clearDescentReport: () => this.godRun?.clearDescentReport(),
      onTeach: (ev) => this.onGodTeach(ev),
      canCompleteAftermath: () => this.godAftermathGate(),
      openSettings: () => this.openGodSettings(),
      onAreaFocus: (areaId) => {
        this.godSpectator?.focusArea(areaId);
        this.godSpectator?.setObserveFocus(true);
      },
      onClockToggle: () => this.godClock?.togglePause(),
      onClockDismiss: () => this.onGodClockDismiss(),
    });
    this.refreshGodTeach();
    this.syncGodClockPhase();
    this.setGodOverviewPresentation(true);
  }

  /** Hide the playable body and clear the field while the oracle UI owns the viewport. */
  private setGodOverviewPresentation(active: boolean): void {
    this.player.root.visible = !active;
    if (active) {
      this.world.clearEnemies();
      this.combat.clearProjectiles();
      this.particles.clear();
      this.vfx.clear();
      this.damageNumbers.clear();
      this.syncGodWorldPop();
    } else {
      this.godSpectator?.clearWorld();
    }
  }

  private syncGodWorldPop(): void {
    if (this.godRun && this.godSpectator) {
      this.godSpectator.syncWorld(this.godRun);
    }
  }

  private setupGodOracle(): void {
    if (!this.godSpectator) {
      this.godSpectator = new GodSpectator(this.camera, this.arena, this.mgr, {
        vfx: this.vfx,
        damageNumbers: this.damageNumbers,
        audio: this.audio,
      });
      this.godSpectator.onCaption = (text) => this.ui.god.setCaption(text);
      this.godSpectator.onSpectacleDone = () => this.onGodSpectacleDone();
      this.godSpectator.onAmbientChange = (active) => this.ui.god.setDistantViolence(active);
    }
    if (!this.godClock) {
      this.godClock = new GodClock(this.mgr.data.settings.god);
      this.godClock.bind({
        onAdvance: () => this.godAdvance(1),
        onStateChange: () => this.syncGodClockPhase(),
      });
    } else {
      this.godClock.setSettings(this.mgr.data.settings.god);
    }
    const tut = this.mgr.data.settings.tutorial;
    if (!this.godRun?.god.openingDone && !tut.skipped) {
      this.godClock.pauseForTutorial();
    } else if (this.godRun) {
      this.godClock.enterObserve(this.godRun.act().tempo);
    }
    if (this.godRun) this.godSpectator.setIdleAreas(populatedAreas(this.godRun));
  }

  private syncGodClockPhase(): void {
    const run = this.godRun;
    if (!run || !this.godClock) return;
    if (run.god.lastDescentReport || run.god.lastAftermath) {
      this.godClock.enterModal();
      return;
    }
    if (this.godSpectator?.isPlaying()) {
      this.godClock.enterSpectating();
      return;
    }
    if (this.godClock.waitingBeat) return;
    if (run.spentThisCycle) {
      this.godClock.enterIntervening();
      return;
    }
    this.godClock.enterObserve(run.act().tempo);
  }

  private onGodClockDismiss(): void {
    const run = this.godRun;
    if (!run) return;
    if (this.godClock?.waitingBeat || this.ui.god.visible) {
      if (this.godClock?.waitingBeat) {
        this.godClock.dismissBeat();
        this.ui.god.dismissPauseBeat();
      } else if (run.god.lastAftermath) {
        if (!this.ui.god.advanceAftermathStep()) this.syncGodClockPhase();
        return;
      }
      this.syncGodClockPhase();
      return;
    }
    if (!run.spentThisCycle) {
      run.noteQuietAdvance();
      this.godAdvance(1);
    } else {
      this.godAdvance(1);
    }
  }

  private onGodSpectacleDone(): void {
    this.ui.god.setSpectacleBeat(null);
    const run = this.godRun;
    if (run?.god.lastAftermath) {
      this.syncAIWorld();
      observeAftermath(this.ai, this.mgr, run.god, run.god.lastAftermath);
      this.godClock?.enterModal();
    } else {
      this.syncGodClockPhase();
    }
    this.ui.god.refresh();
  }

  private playPendingGodSpectacle(): void {
    const beat = this.pendingSpectacleBeat;
    if (!beat?.spectacle) return;
    this.pendingSpectacleBeat = null;
    this.maybePlayGodSpectacle(beat);
  }

  private maybePlayGodSpectacle(beat: Beat, causeCaption?: string | null): void {
    if (!beat.spectacle || !this.godSpectator) return;
    this.godClock?.enterSpectating();
    this.ui.god.setSpectacleBeat(beat, causeCaption ?? null);
    this.godSpectator.playDuel(beat.spectacle);
  }

  private onGodTeach(ev: GuideEvent): void {
    const tut = this.mgr.data.settings.tutorial;
    if (tut.skipped) return;
    if (this.godGuide.notify(ev)) {
      tut.godGuide = this.godGuide.step;
      this.mgr.persist();
      this.refreshGodTeach();
    }
  }

  /** Cycles 1–2: aftermath cannot clear until WHY has been opened once. */
  private godAftermathGate(): { ok: boolean; reason?: string } {
    const tut = this.mgr.data.settings.tutorial;
    if (tut.skipped) return { ok: true };
    const a = this.godRun?.god.lastAftermath;
    if (!a || a.cycle > 2) return { ok: true };
    if (this.godGuide.whyOpened) return { ok: true };
    return { ok: false, reason: 'OPEN WHY ON THIS CYCLE — THEN CONTINUE' };
  }

  private refreshGodTeach(): void {
    const tut = this.mgr.data.settings.tutorial;
    if (tut.skipped) {
      this.ui.god.teach.set(null);
      return;
    }
    this.godGuide.load(tut.godGuide || this.godGuide.step);
    if (this.godRun && this.godGuide.maybeGiveUp(this.godRun.god.cycle)) {
      tut.godGuide = 'done';
      this.mgr.persist();
    }
    if (this.godGuide.active) {
      const step = this.godGuide.current!;
      const index = STEP_ORDER.indexOf(step.id) + 1;
      this.ui.god.teach.set({ kind: 'guide', step, index, total: STEP_COUNT });
      return;
    }
    if (this.godGuide.boardReady && this.godRun && !this.godRun.god.boardUnlocked) {
      this.godRun.unlockBoard();
    }
    if (this.godLesson) {
      this.ui.god.teach.set({ kind: 'lesson', lesson: this.godLesson });
      return;
    }
    this.ui.god.teach.set(null);
  }

  private skipGodTeaching(): void {
    this.tutorial.skipAll(this.mgr.data.settings);
    this.godGuide.finish();
    this.godLesson = null;
    this.mgr.data.settings.tutorial.godGuide = 'done';
    this.godRun?.unlockBoard();
    this.mgr.persist();
    this.refreshGodTeach();
    this.ui.hud.toast('TUTORIALS SKIPPED', 'neutral');
  }

  private dismissGodLesson(): void {
    if (!this.godLesson) return;
    this.mgr.data.settings.tutorial.god[this.godLesson.id] = true;
    this.godLesson = null;
    this.mgr.persist();
    this.refreshGodTeach();
  }

  private openPrimer(): void {
    this.ui.primer.present(
      this.godRun?.god ?? null,
      () => this.ui.primer.hide(),
      () => {
        this.ui.primer.hide();
        this.replayGodTeaching();
      }
    );
  }

  private replayGodTeaching(): void {
    const s = this.mgr.data.settings;
    s.tutorial.skipped = false;
    s.tutorial.god = {};
    s.tutorial.godGuide = '';
    this.godGuide.restart();
    this.godLesson = null;
    this.mgr.persist();
    this.refreshGodTeach();
  }

  /** The roster screen is the same one the third-person game uses. */
  private openRosterFromGod(): void {
    if (!this.godRun) return;
    this.hierarchyFromGod = true;
    this.mode = 'hierarchy';
    this.ui.god.hide();
    this.ui.hierarchy.open(this.mgr, () => this.closeHierarchy(), this.ai);
  }

  /** The developer readout. Everything here is derived; nothing is stored for it. */
  private godDebugState(): GodDebugState | null {
    const run = this.godRun;
    if (!run) return null;
    const god = run.god;
    return {
      run: god.run,
      cycle: god.cycle,
      act: run.act().name,
      phase: god.phase,
      influence: `${Math.round(god.influence * 10) / 10}/${god.influenceMax}`,
      chaos: `${Math.round(god.chaos)} (${chaosTier(god.chaos).name})`,
      living: this.mgr.living().length,
      factions: livingFactions(god).map(
        (f) => `${f.name} ${Math.round(f.strength)}pw st${Math.round(f.stability)}${f.warWith.length ? ' WAR' : ''}`
      ),
      crisis: god.crisis
        ? `${god.crisis.title} — ${this.mgr.byId(god.crisis.bodyId)?.name ?? '—'} pw${Math.round(god.crisis.power)} [${god.crisis.resolved}] deadline ${god.crisis.deadline}`
        : 'none yet',
      conditions: god.conditions.map(
        (c) => `${c.kind}:${this.mgr.byId(c.targetId)?.name ?? c.targetId}${c.otherId ? '>' + (this.mgr.byId(c.otherId)?.name ?? c.otherId) : ''} x${round2(c.magnitude)} (${c.expiresCycle - god.cycle})`
      ),
      decisions: god.decisions.map((d) => ({
        actor: d.actorName,
        chosen: d.chosen ? `${d.chosen.actionName}${d.chosen.targetName ? ' -> ' + d.chosen.targetName : ''}  ${d.chosen.total}` : '—',
        considered: d.considered.map(
          (c) =>
            `${c.actionName}${c.targetName ? ' -> ' + c.targetName : ''}  ${c.total}  ` +
            `(base ${round2(c.parts.base)} per ${round2(c.parts.personality)} rel ${round2(c.parts.relationship)} mem ${round2(c.parts.memory)} ` +
            `need ${round2(c.parts.need)} dgr -${round2(c.parts.danger)} opp ${round2(c.parts.opportunity)} amb ${round2(c.parts.ambition)} noise ${round2(c.parts.noise)})`
        ),
      })),
    };
  }

  private forceGodCrisis(): string {
    const run = this.godRun;
    if (!run) return 'no run';
    run.god.cycle = Math.max(run.god.cycle, 23);
    run.god.act = 'crisis';
    if (!run.god.crisis) run.advanceMany(1);
    this.showGodScreen();
    return run.god.crisis ? run.god.crisis.title : 'pushed to the crisis act';
  }

  private godIntervene(id: string, a: string | null, b: string | null, area: string | null) {
    const run = this.godRun;
    if (!run) return { ok: false, reason: 'No run.' };
    const res = run.intervene(id, a, b, area);
    if (res.ok) {
      this.godIdleCycles = 0;
      this.onGodTeach('intervened');
      this.audio.play(interventionSfx(id), { volume: interventionSfxVolume(id) });
      this.playInterventionJuice(id, a, area, res);
      this.ui.god.pulseSpend();
      // DESCEND is the one intervention that leaves this screen.
      const target = run.god.pendingDescent;
      if (target) {
        run.god.pendingDescent = null;
        this.beginDescent(target);
        return res;
      }
      const noticed = this.noticeAfterIntervention(run, res.effect?.actors ?? [], a);
      const flashTone = interventionFlashTone(res.effect?.tone);
      if (noticed) this.ui.god.markNoticed(noticed.id, noticed.headline);
      else if (res.effect?.headline) {
        this.ui.god.flash(`YOUR MARK — ${res.effect.headline}`, flashTone, 3800);
      }
      const tierBeat = res.pauseBeats?.length ? pickPauseBeat(res.pauseBeats) : null;
      if (tierBeat) {
        this.ui.god.setPauseBeat(tierBeat);
        this.ui.god.pulseChaosTier();
        this.onGodTeach('beatOpened');
      }
      this.godClock?.enterIntervening();
      this.ui.god.refresh();
      this.syncGodWorldPop();
    }
    return res;
  }

  /** 3D ring burst + character reaction when a condition lands on the board. */
  private playInterventionJuice(
    id: string,
    primaryId: string | null,
    areaId: string | null,
    res: { effect?: { actors?: string[]; tone?: string } }
  ): void {
    const spec = this.godSpectator;
    if (!spec || id === 'descend') return;
    const tone = interventionJuiceTone(res.effect?.tone);
    const actors = res.effect?.actors?.length ? res.effect.actors : primaryId ? [primaryId] : [];
    if (actors.length) spec.markIntervention(actors, tone);
    else if (areaId) spec.markArea(areaId, tone);
  }

  /**
   * One board beat that proves the condition landed — not a feed dump.
   * Prefer a situation involving the target; else invent a compact condition line.
   */
  private noticeAfterIntervention(
    run: GodRun,
    actors: string[],
    primaryId: string | null
  ): { id: string; headline: string } | null {
    const focus = actors[0] ?? primaryId;
    if (focus) {
      const condSit = run.situations.find((s) => s.kind === 'condition' && s.actors.includes(focus));
      if (condSit) return { id: condSit.id, headline: condSit.headline };
      const sit = run.situations.find((s) => s.actors.includes(focus));
      if (sit) return { id: sit.id, headline: sit.headline };
      const n = this.mgr.byId(focus);
      const cond = run.god.conditions.find((c) => c.targetId === focus && c.source === 'god');
      if (n && cond) {
        const label = CONDITION_LABEL[cond.kind] ?? cond.kind.toUpperCase();
        return {
          id: `cond:${cond.id}`,
          headline: `${fullName(n).toUpperCase()} — ${label}`,
        };
      }
    }
    const top = run.situations.find((s) => s.kind === 'condition') ?? run.situations[0];
    return top ? { id: top.id, headline: top.headline } : null;
  }

  /**
   * Accelerated simulation. Cycles are resolved synchronously — the whole
   * point of the headless duel resolver is that a hundred of them cost
   * milliseconds — and the feed is what the player reads afterwards.
   */
  private godAdvance(cycles: number): void {
    const run = this.godRun;
    if (!run || this.godBusy || this.godSpectator?.isPlaying()) return;
    this.godBusy = true;
    const t0 = performance.now();
    let done = 0;
    const actorFocus = new Set(
      run.god.conditions.filter((c) => c.source === 'god').map((c) => c.targetId)
    );
    let noticed: Beat | null = null;
    const spent = run.spentThisCycle;
    const resolvedCycles = Math.min(cycles, 1);
    const { beats, cycles: resolved } = run.advanceMany(resolvedCycles);
    done = resolved;
    if (spent) this.godIdleCycles = 0;
    else this.godIdleCycles += resolved;
    this.onGodTeach('cycleAdvanced');
    this.maybeGodLesson();
    for (const b of beats) {
      if (noticed) break;
      if (b.kind === 'intervention') continue;
      if (actorFocus.size && !b.actors.some((id) => actorFocus.has(id))) continue;
      if (BEAT_RANK[b.priority] >= BEAT_RANK.notable) {
        noticed = b;
      }
    }
    this.godBusy = false;
    if (noticed) {
      this.ui.god.markNoticed(noticed.id.startsWith('beat:') ? noticed.id : `beat:${noticed.id}`, noticed.headline);
    } else if (cycles > 1) {
      this.ui.god.flash(`${done} CYCLES RESOLVED IN ${Math.round(performance.now() - t0)}MS`, 'neutral');
    } else {
      const quiet = this.quietAdvanceNotice(run, actorFocus);
      if (quiet) this.ui.god.markNoticed(quiet.id, quiet.headline);
    }
    if (run.ended) {
      this.presentGodEnd(run.outcome!);
      return;
    }

    const pauseBeat = pickPauseBeat(beats);
    if (pauseBeat) {
      this.godClock?.pauseForBeat(pauseBeat);
      this.ui.god.setPauseBeat(pauseBeat);
      if (pauseBeat.kind === 'chaos') this.ui.god.pulseChaosTier();
      this.onGodTeach('beatOpened');
    }

    const spectacleBeat = pickSpectacleBeat(beats);
    if (spectacleBeat?.spectacle && spent) {
      this.pendingSpectacleBeat = spectacleBeat;
      this.syncAIWorld();
      observeAftermath(this.ai, this.mgr, run.god, run.god.lastAftermath!);
      this.godClock?.enterModal();
      this.onGodTeach('beatOpened');
    } else if (spectacleBeat?.spectacle) {
      const report = run.god.lastAftermath;
      const caption = report
        ? spectacleCauseCaption(report, (cycle, label, text) =>
            aftermathLinkFor(this.ai, run.god.run, cycle, label, text)
          )
        : null;
      this.maybePlayGodSpectacle(spectacleBeat, caption);
    } else if (run.god.lastAftermath) {
      this.syncAIWorld();
      observeAftermath(this.ai, this.mgr, run.god, run.god.lastAftermath);
      this.godClock?.enterModal();
      this.onGodTeach('beatOpened');
    } else {
      this.syncGodClockPhase();
    }

    observeSituations(this.ai, this.mgr, run.god, run.god.situations);
    this.ui.god.refresh();
    this.syncGodWorldPop();
    this.refreshGodTeach();
  }

  private maybeGodLesson(): void {
    if (!this.godRun) return;
    if (this.godGuide.active || this.mgr.data.settings.tutorial.skipped) {
      this.refreshGodTeach();
      return;
    }
    if (this.godLesson) {
      this.refreshGodTeach();
      return;
    }
    const lesson = pickLesson(
      {
        god: this.godRun.god,
        mgr: this.mgr,
        cycleBeats: this.godRun.lastCycleBeats,
        outcome: this.godRun.god.outcome,
        idleCycles: this.godIdleCycles,
        blessedLosers: this.godRun.lastBlessedLosers,
        runIndex: this.godRun.god.run,
      },
      this.mgr.data.settings.tutorial.god
    );
    if (lesson) this.godLesson = lesson;
    this.refreshGodTeach();
  }

  /** Fallback when cycles produce no related beat — who declined the mark. */
  private quietAdvanceNotice(
    run: GodRun,
    actorFocus: Set<string>
  ): { id: string; headline: string } | null {
    const decline = describeQuietDecline(this.mgr, run.god, run.god.decisions, [...actorFocus]);
    if (decline) return { id: `quiet:${run.god.cycle}`, headline: decline };

    const condSit =
      run.situations.find((s) => s.kind === 'condition' && s.actors.some((id) => actorFocus.has(id))) ??
      run.situations.find((s) => s.kind === 'condition') ??
      null;
    if (condSit) {
      return { id: condSit.id, headline: `${condSit.headline} — STILL LIVE` };
    }
    const related = run.situations.find((s) => s.actors.some((id) => actorFocus.has(id)));
    if (related) return { id: related.id, headline: related.headline };
    for (const id of actorFocus) {
      const n = this.mgr.byId(id);
      const cond = run.god.conditions.find((c) => c.targetId === id && c.source === 'god');
      if (n && cond) {
        const label = CONDITION_LABEL[cond.kind] ?? cond.kind.toUpperCase();
        return {
          id: `cond:${cond.id}`,
          headline: `${fullName(n).toUpperCase()} — ${label} UNCHANGED`,
        };
      }
    }
    const top = run.situations[0];
    return top ? { id: top.id, headline: top.headline } : null;
  }

  private onGodBeats(beats: Beat[]): void {
    if (this.godRun) {
      this.syncAIWorld();
      observeGodBeats(this.ai, this.mgr, this.godRun.god, beats);
    }
    // Only the loudest beat is allowed to interrupt; everything else waits in
    // the feed, which is the difference between a story and a notification
    // storm.
    for (const b of beats) {
      if (b.priority !== 'legendary') continue;
      this.ui.god.flash(b.headline, b.tone === 'good' || b.tone === 'gold' ? 'gold' : 'hot', 4200);
      break;
    }
  }

  private onGodEnd(outcome: RunOutcome): void {
    if (this.mode === 'godend') return;
    this.presentGodEnd(outcome);
  }

  private presentGodEnd(outcome: RunOutcome): void {
    this.mode = 'godend';
    this.ui.god.hide();
    this.setGodOverviewPresentation(true);
    this.ui.aiStatus.clear();
    this.ai.invalidateGodWork();
    const legends = this.mgr.data.legends ?? [];
    if (this.godRun) {
      this.syncAIWorld();
      observeEnding(this.ai, this.mgr, this.godRun.god, outcome, legends);
    }
    this.ui.godEnd.present(
      outcome,
      {
        onNext: () => {
          this.ui.godEnd.hide();
          this.ai.invalidateGodWork();
          this.godRun = null;
          this.mgr.data.god = null;
          // A new world, with the Book and the unlocks intact. The legends of the
          // last run reach into this one as relics, descendants, rumours and
          // inherited grudges — see Legends.applyLegacies.
          this.mgr.reseedWorld(randomSeed());
          this.rebuildArena();
          this.openLongGame();
        },
        onBook: () => this.openLegends('godend'),
        onTitle: () => {
          this.ui.godEnd.hide();
          this.ai.invalidateGodWork();
          this.godRun = null;
          this.showTitle(true);
        },
      },
      recapLineFor(this.ai, outcome, this.godRun?.god.run ?? 0)
    );
  }

  private abandonGodRun(): void {
    const run = this.godRun;
    if (!run) return;
    const outcome = run.abandon();
    this.presentGodEnd(outcome);
  }

  private openLegends(from: Mode): void {
    const back = from;
    this.mode = 'legends';
    this.ui.god.hide();
    this.ui.godEnd.hide();
    this.ui.title.hide();
    this.ui.legends.present(
      this.mgr.data.legends ?? [],
      () => {
        this.ui.legends.hide();
        if (back === 'god' && this.godRun) this.showGodScreen();
        else if (back === 'godend' && this.godRun?.outcome) this.presentGodEnd(this.godRun.outcome);
        else this.showTitle(this.saveSys.exists());
      },
      {
        voiceFor: (l) => legendVoiceFor(this.ai, l),
        portraitFor: (l) => {
          const id = l.id.split(':')[1];
          const n = id ? this.mgr.byId(id) : null;
          return n ? this.ai.portraitFor(n) : '';
        },
      }
    );
  }

  /**
   * DESCEND. The god puts itself in the world for one confrontation, using the
   * whole third-person game exactly as it already exists. Nothing about the
   * run below is special-cased; the only difference is where it returns to.
   */
  private beginDescent(brief: import('../god/GodTypes').DescentBrief): void {
    this.setGodOverviewPresentation(false);
    const nemesisId = brief.nemesisId;
    const n = this.mgr.byId(nemesisId);
    const holder = this.mgr.data.territories.tower ?? null;
    this.descent = {
      nemesisId,
      cycle: this.godRun?.god.cycle ?? 0,
      brief,
      snapshot: {
        alive: !!n?.alive,
        power: n?.power ?? 0,
        territory: n?.territory ?? '',
        scars: n?.scars.length ?? 0,
        injury: n ? simOf(n).injury : 0,
        stolen: n?.stolen.length ?? 0,
        holder,
      },
      playerDied: false,
      extracted: false,
    };
    this.legacyOmenShown = false;
    this.ui.god.hide();
    this.startRun();

    if (brief.scenario === 'tower') {
      applyVerticalSlice({
        mgr: this.mgr,
        world: this.world,
        player: this.player,
        rng: this.rng,
        arena: this.arena,
      });
      // Keep the descent target as the commander even if slice reassigned ids.
      const commander = this.mgr.byId(nemesisId) ?? this.mgr.living().find((x) => x.archetype === 'commander');
      if (commander) this.descent.nemesisId = commander.id;
    } else if (n && n.alive) {
      n.territory = this.world.currentArea.id;
      this.world.spawnNamed(n, this.player, true, undefined, undefined, { hunting: true });
    }

    this.ui.hud.toast(brief.goal.toUpperCase().slice(0, 72), 'gold', 5.5);
    this.ui.hud.showAreaBanner(
      brief.scenario === 'tower' ? 'THE TOWER' : this.world.currentArea.name.toUpperCase(),
      brief.reason.toUpperCase().slice(0, 64)
    );
  }

  /**
   * Where a third-person run hands control back. Without a descent this is the
   * game it always was; with one, the board is waiting and the world has moved
   * while the player was busy.
   */
  private afterRunEnds(): void {
    const d = this.descent;
    if (!d || !this.godRun) {
      this.startRun();
      return;
    }
    this.descent = null;
    this.legacyOmenShown = false;
    const run = this.godRun;
    const cycles = Math.max(1, d.brief.cyclesWhileGone);
    run.fastForward(cycles);
    if (run.ended) {
      this.presentGodEnd(run.outcome!);
      return;
    }

    const target = this.mgr.byId(d.nemesisId);
    const lines: string[] = [];
    let outcome: import('../god/GodTypes').DescentReport['outcome'] = 'spared';
    if (d.playerDied) {
      outcome = 'player_died';
      lines.push('You died below. The mark of exposure still sits on them.');
    } else if (d.extracted) {
      outcome = 'escaped';
      lines.push('You extracted. They remember you ran.');
    } else if (target && !target.alive) {
      outcome = 'killed';
      lines.push(`${fullName(target)} is dead. The board loses a piece you touched in person.`);
      if (run.god) removeConditions(run.god, d.nemesisId, 'exposure');
    } else if (target && target.alive) {
      if (simOf(target).injury > d.snapshot.injury + 15 || target.scars.length > d.snapshot.scars) {
        outcome = 'spared';
        lines.push(`${fullName(target)} still stands — scarred. Your conditions still apply.`);
      } else {
        outcome = 'fled';
        lines.push(`${fullName(target)} still holds. The confrontation ended without a body.`);
      }
    } else {
      outcome = 'fled';
      lines.push('The target is gone from the roster.');
    }

    if (target) {
      if (target.power !== d.snapshot.power) {
        lines.push(`Power ${d.snapshot.power} → ${target.power}.`);
      }
      if (target.territory !== d.snapshot.territory) {
        lines.push(`Ground shifted: ${target.territory.toUpperCase()}.`);
      }
      if (target.stolen.length !== d.snapshot.stolen) {
        lines.push(
          target.stolen.length < d.snapshot.stolen
            ? 'Stolen steel left their hands.'
            : 'They still carry what they took.'
        );
      }
    }
    const towerNow = this.mgr.data.territories.tower ?? null;
    if (towerNow !== d.snapshot.holder) {
      const holder = towerNow ? this.mgr.byId(towerNow) : null;
      lines.push(holder ? `The Tower answers to ${fullName(holder)}.` : 'The Tower has no holder.');
    }
    lines.push(`${cycles} cycles turned while you were below. Autonomy did not wait.`);

    run.god.lastAftermath = null;
    run.god.lastDescentReport = {
      targetId: d.nemesisId,
      targetName: target ? fullName(target) : 'UNKNOWN',
      outcome,
      cyclesElapsed: cycles,
      lines,
    };
    run.refreshSituations();
    run.persist();

    this.showGodScreen();
  }

  private applyPlayerBuild(announce = false): void {
    const meta = this.mgr.data.playerMeta;
    ensureStarterGear(meta);
    const compiled = applyBuildToStats(meta, this.player.stats, this.world.run?.runLoot ?? []);
    this.player.rebuildWeapon();
    this.refreshPowerChips();
    if (announce && compiled.synergy.length) this.ui.hud.toast(compiled.synergy.join('  ·  '), 'gold', 3.2);
  }

  private openBuild(from: Mode): void {
    ensureStarterGear(this.mgr.data.playerMeta);
    const returnMode = from === 'paused' ? 'paused' : from;
    this.mode = 'build';
    this.ui.title.hide();
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.loop.paused = true;
    this.ui.pause.close();
    this.ui.build.open(
      this.mgr.data.playerMeta,
      this.player.stats,
      {
        onClose: () => {
          this.ui.build.hide();
          this.mgr.persist();
          if (returnMode === 'paused') {
            this.mode = 'paused';
            this.openPause();
          } else if (returnMode === 'title') {
            this.showTitle(true);
          } else {
            this.resumeToPlaying();
          }
        },
        onChanged: () => {
          syncLegacyWeapons(this.mgr.data.playerMeta);
          if (this.world.runActive) this.applyPlayerBuild();
          this.player.rebuildWeapon();
          this.mgr.persist();
        },
      },
      this.world.run?.runLoot ?? []
    );
  }

  private syncSkillLoadout(): void {
    const meta = this.mgr.data.playerMeta;
    if (!meta.unlockedSkills?.length) meta.unlockedSkills = [...STARTING_SKILLS];
    this.abilities.unlocked = meta.unlockedSkills.filter(isUnlockableSkill) as SkillId[];
    if (!this.abilities.unlocked.includes('shadow_step')) this.abilities.unlocked.unshift('shadow_step');
    const pair = (meta.skillLoadout ?? DEFAULT_LOADOUT) as [SkillId, SkillId];
    this.abilities.equip(pair[0], pair[1]);
    const ult = (meta.ultimateLoadout ?? 'pit_eruption') as SkillId;
    if (isUltimateSkill(ult)) this.abilities.equipUltimate(ult);
    if (!this.abilities.unlocked.includes(this.abilities.ultimate)) this.abilities.unlock(this.abilities.ultimate);
    meta.skillLoadout = this.abilities.loadout;
    meta.ultimateLoadout = this.abilities.ultimate;
    this.world.run.skillLoadout = this.abilities.loadout;
    this.abilities.reset();
  }

  private maybeTeach(id: TutorialId): void {
    const s = this.mgr.data.settings;
    if (tutorialDone(s.tutorial, id)) return;
    if (this.tutorial.offer(id)) markTutorial(s, id);
  }

  private tickTutorials(): void {
    const s = this.mgr.data.settings;
    if (s.tutorial.skipped) return;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      if (e.nemesis.rank !== 'grunt' && e.combat.postureFrac > 0.15) this.maybeTeach('posture');
      if (e.combat.intent === 'parryable' && e.combat.attacking) this.maybeTeach('parry');
    }
    if (this.abilities.ready(this.abilities.loadout[0]) && tutorialDone(s.tutorial, 'basics') && !this.tutorial.prompt) {
      this.maybeTeach('skill');
    }
  }

  private purposeLines(inCombat: boolean): string[] {
    const lines: string[] = [];
    const focus = this.plateTarget();
    if (focus?.named) {
      const n = focus.nemesis;
      const sig = n.signatureKnown ? signatureDef(n.signatureId) : null;
      if (sig) lines.push(`${sig.name} — ${sig.counterplay}`);
      const steel = n.stolen.find((s) => s.kind === 'weapon');
      if (steel) lines.push(`CARRIES YOUR ${steel.name}`);
    }
    const v = vendettaHud(this.world.run.vendetta);
    if (v) lines.push(v);
    if (inCombat) return lines.slice(0, 1);

    const terr = this.world.territoryNow();
    if (terr.holderName && terr.holderName !== 'UNCLAIMED') {
      const rule = terr.rules[0];
      if (rule) lines.push(`${terr.holderName} · ${rule.title}`);
    }
    if (!focus?.named) {
      const stolen = this.mgr.living().find((n) => n.stolen.some((s) => s.kind === 'weapon'));
      if (stolen) lines.push(`${stolen.name.toUpperCase()} CARRIES YOUR ${stolen.stolen[0]?.name ?? 'STEEL'}`);
    }
    if (this.world.run.extraction.unlocked) lines.push('EXTRACTION GATE IS LIVE');
    else if (!lines.length) lines.push('FIND A NAMED ENEMY — OR A GATE');
    return lines.slice(0, 3);
  }

  private tryPlayerSkill(slot: 'skill1' | 'skill2' | 'ultimate'): boolean {
    const p = this.player;
    const res = this.abilities.tryActivate(slot, p.combat, p.stats);
    if (!res.ok || !res.def) {
      this.telemetry.noteFail(res.reason);
      this.audio.play('skill_fail', { volume: 0.28, pitch: 0.75, minGap: 0.18 });
      if (res.reason === 'cooldown' || res.reason === 'surge') {
        this.ui.hud.toast(this.skillFailCopy(res.reason), 'hot', 0.9);
      }
      return res.reason === 'cooldown' || res.reason === 'surge' || res.reason === 'empty_slot';
    }
    const def = res.def;
    const prof = profileFor(def, p.stats.weaponId);
    const fx = -Math.sin(p.facing);
    const fz = -Math.cos(p.facing);
    const dist = def.distance * prof.reachMul;
    const speed = dist / Math.max(0.08, def.active);
    p.combat.setSkillTimings(
      def.windup * prof.windupMul,
      def.active,
      def.recover * prof.recoverMul,
      prof.armor || isUltimateSkill(def.id) ? (isUltimateSkill(def.id) ? 0.18 : 0.22) : 0,
      def.id === 'shadow_step',
      def.id === 'shadow_step' ? fx * (speed / 42) * 42 : 0,
      def.id === 'shadow_step' ? fz * (speed / 42) * 42 : 0
    );
    if (def.id === 'shadow_step') {
      p.combat.skillMoveX = fx;
      p.combat.skillMoveZ = fz;
    }
    this.telemetry.noteSkillUse(def.id);
    this.telemetry.notePlayerVerb();
    return true;
  }

  private skillFailCopy(reason: FailReason): string {
    if (reason === 'surge') return 'SURGE EMPTY';
    if (reason === 'cooldown') return 'NOT READY';
    return 'CANNOT';
  }

  private endRunAndBank(): void {
    const meta = this.mgr.data.playerMeta;
    const s = this.player.stats;
    meta.essence += s.essence;
    for (const k of Object.keys(s.habits) as Array<keyof typeof s.habits>) {
      meta.habits[k] += s.habits[k];
    }
    meta.vigour = Math.min(HEAL_ECON.maxVigour, Math.floor(meta.essence / HEAL_ECON.vigourEssenceStep) * HEAL_ECON.vigourPerStep);
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

    // The stylesheet keys gameplay-layer visibility off the current mode, so
    // fullscreen screens never have toasts / damage numbers / tutorial text
    // bleeding through them.
    if (this.uiRoot.dataset.mode !== this.mode) this.uiRoot.dataset.mode = this.mode;

    switch (this.mode) {
      case 'playing':
        this.tickPlaying(dt, rdt);
        break;
      case 'dying':
        this.tickDying(dt, rdt);
        break;
      case 'god':
        this.tickGod(dt, rdt);
        break;
      default:
        this.tickIdle(dt, rdt);
        break;
    }

    const introClock = this.mode === 'playing' || this.mode === 'dying' ? rdt : 0;
    this.ui.intro.update(introClock);
    this.tickAI(rdt);
    if (this.telemetry.enabled) this.sampleTelemetry(rdt);
    this.particles.update(dt > 0 ? dt : rdt * 0.02);
    this.vfx.update(dt > 0 ? dt : rdt * 0.02, rdt);
    this.damageNumbers.update(dt > 0 ? dt : rdt * 0.02, this.camera.camera);
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
    this.ui.aiStatus.setVisible(
      this.mode === 'playing' ||
        this.mode === 'dying' ||
        this.mode === 'title' ||
        this.mode === 'god' ||
        this.mode === 'legends' ||
        this.mode === 'godend'
    );

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
      playerFade: p.fadeAmount,
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
    if (this.mode === 'title' || this.mode === 'legends' || this.mode === 'godend') {
      this.camera.yaw += rdt * 0.06;
      this.camera.pitch = -0.3;
      this.camera.distance = 26;
      this.camera.update(dt, rdt, TITLE_FOCUS, null);
    } else {
      this.camera.update(0, rdt, this.player.position, null);
    }
    for (const e of this.world.enemies) e.update(0, rdt);
  }

  /** THE LONG GAME — hybrid clock, map pulse, oracle camera. */
  private tickGod(dt: number, rdt: number): void {
    this.ui.god.tickMap(dt);
    if (this.godSpectator) {
      this.godSpectator.update(rdt);
    } else {
      this.camera.yaw += rdt * 0.04;
      this.camera.pitch = -0.45;
      this.camera.distance = 40;
      this.camera.update(dt, rdt, TITLE_FOCUS, null);
    }
    if (this.godClock && this.godRun) {
      this.godClock.tick(rdt);
      const tempo = this.godRun.act().tempo;
      this.ui.god.setClock(
        this.godClock.stateName,
        this.godClock.countdownFrac,
        clockLabel(this.godClock.stateName, this.godClock.countdown, tempo)
      );
    }
    for (const e of this.world.enemies) e.update(0, rdt);
  }

  private tickPlaying(dt: number, rdt: number): void {
    if (this.lockGrace > 0) this.lockGrace -= rdt;
    else if (
      !this.input.isPointerLocked &&
      this.mode === 'playing' &&
      !this.debugOpen &&
      !this.comicOpen &&
      !this.qaNoAutoPause
    ) {
      // Losing pointer lock pauses a human's game. QA harnesses run headless
      // with no real pointer lock, so __qaStart() turns this off — otherwise
      // every keyboard-only test phase silently freezes the sim.
      this.openPause();
      return;
    }

    if (!this.debugOpen && !this.comicOpen) this.handlePlayingInput();

    const lockPoint = this.currentLockPoint();
    this.combat.lockUid = this.lockTargetUid;
    this.player.update(dt, rdt, this.input, this.camera, this.arena, lockPoint);

    // FOOTSTEP events off the shared gait cycle (see anim/AnimEvents.ts):
    // planted-foot phases kick a little dust so movement grips the ground.
    {
      const phase = this.player.anim.locoPhase;
      const speed = Math.hypot(this.player.controller.velocity.x, this.player.controller.velocity.z);
      if (speed > 3.4 && crossedFootstep(this.prevLocoPhase, phase)) {
        this.particles.dust(this.player.position.x, 0.12, this.player.position.z, speed > 8 ? 4 : 2);
        this.audio.play('footstep', { volume: speed > 8 ? 0.22 : 0.16, pitch: speed > 8 ? 0.92 : 1.05, minGap: 0.08 });
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

    this.spawnTuningTimer += rdt;
    if (this.spawnTuningTimer >= 8) {
      this.spawnTuningTimer = 0;
      this.refreshSpawnTuning(false);
    }

    this.world.update(dt, this.player);
    this.encounter.update(rdt, this.encounterSafety(), this.player);
    this.combat.setEnemies(this.world.enemies);

    for (const e of this.world.enemies) e.update(dt, rdt);

    this.combat.update(dt);
    this.abilities.update(dt);
    this.tutorial.update(rdt);
    this.tickTutorials();
    this.combat.checkStampede();
    this.separateBodies();
    this.world.postUpdate(dt, this.player);
    this.flushSignatureCues();
    if (this.world.tickExtraction(dt, this.player)) this.finishExtraction(true);
    this.tickVendetta();
    this.runClock += dt;
    if (this.offerQuiet > 0) this.offerQuiet -= dt;
    this.maybeOpenPendingVendetta(dt);
    this.flushPendingModal(rdt);
    this.flushPendingComic(rdt);
    if (!this.player.alive && this.mode === 'playing') this.onPlayerKilled(this.pendingKiller);

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
    // Close camera → dissolve the body rather than shoving the lens into a
    // wall. Measured to the chest, which is what the lens actually clips.
    this.player.setProximityFade(this.camera.distanceToChest(this.player.position), rdt);

    /* HUD */
    const plateTarget = this.plateTarget();
    const ov = this.mgr.overlord();
    const inCombat = this.world.enemies.some((e) => e.alive && (e.combat.attacking || e.state === 'chase' || e.state === 'attack'));
    const purpose = this.purposeLines(inCombat);
    const prompt = this.readPrompt();
    const overlay = decideOverlays({
      mode: this.mode,
      introActive: this.ui.intro.active,
      encounterBusy: this.encounter.busy,
      bannerActive: this.ui.hud.bannerActive,
      tutorialActive: !!this.tutorial.prompt,
      executable: prompt.execute,
      interact: prompt.interact,
      remnantHeal: prompt.remnant,
      inCombat,
      pendingLabel: this.pendingModal?.label ?? null,
      comicOpen: this.comicOpen,
      pendingComic: !!this.pendingComic,
    });
    const storyOwnsCentre = overlay.lane === 'intro';
    this.ui.hud.update(
      rdt,
      this.player,
      {
        areaName: this.world.locationLabel,
        ageName: this.mgr.ageState.name,
        age: this.mgr.age,
        turn: this.mgr.turn,
        overlordName: ov ? ov.name.toUpperCase() : '',
        heat: this.world.run.heat,
        heatLabel: heatLabel(this.world.run.heat),
        remnants: this.world.run.remnants,
        essence: this.mgr.data.playerMeta.essence,
        vendetta: vendettaHud(this.world.run.vendetta),
        territory: this.world.territoryNow().rules.map((r) => r.title).join(' · '),
        holderName: this.world.territoryNow().holderName,
        purpose,
        showPurpose: this.mgr.data.settings.showPurpose !== false && overlay.showPurpose,
        inCombat,
        tutorial: overlay.showTutorial ? this.tutorial.prompt : null,
        landmarks: this.arena.landmarks,
        areaColors: Object.fromEntries(
          Object.entries(this.world.occupancy).map(([id, o]) => [id, '#' + o.accent.toString(16).padStart(6, '0')])
        ),
      },
      plateTarget,
      this.world.enemies,
      this.arena.shrines
    );
    this.ui.hud.setStoryMode(storyOwnsCentre);
    this.ui.hud.setCombatFocus(overlay.combatFocus);
    this.ui.hud.setNextOverlay(overlay.nextLabel);
    this.ui.hud.setSkills(
      this.abilities.snapshot({ skill1: '1', skill2: '2', ultimate: 'G' }),
      this.player.stats.surgeFrac
    );
    for (const id of this.abilities.takeReadyPulses()) {
      this.audio.play('skill_ready', { volume: 0.28, pitch: id === 'pit_eruption' ? 0.8 : 1.15, minGap: 0.15 });
    }
    this.ui.hud.setLowHealth(this.player.stats.hp / this.player.stats.maxHp);
    if (!overlay.showBanner && this.ui.hud.bannerActive) this.ui.hud.clearAreaBanner();
    this.ui.hud.setToastsEnabled(overlay.showToasts);
    const promptText =
      overlay.showPrompt && !(prompt.remnant && !overlay.allowRemnantPrompt) ? prompt.text : null;
    this.ui.hud.setPrompt(promptText);
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
      if (p.combat.skillPassThrough) {
        e.position.x -= dx * 0.02;
        e.position.z -= dz * 0.02;
        continue;
      }
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
    if (this.comicOpen) return;
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

    if (input.buffered('skill1', 220)) {
      if (this.tryPlayerSkill('skill1')) input.consume('skill1');
    }
    if (input.buffered('skill2', 220)) {
      if (this.tryPlayerSkill('skill2')) input.consume('skill2');
    }
    if (input.buffered('ultimate', 220)) {
      if (this.tryPlayerSkill('ultimate')) input.consume('ultimate');
    }

    // Buffered inputs are only *consumed* once they actually fire, so a press
    // made half a beat early during recovery or a stagger still comes out.
    if (input.buffered('light')) {
      if (p.combat.tryAttack('light', p.weapon, p.stats)) {
        input.consume('light');
        this.telemetry.notePlayerVerb();
      }
    } else if (input.buffered('heavy')) {
      if (p.combat.tryAttack('heavy', p.weapon, p.stats)) {
        input.consume('heavy');
        this.telemetry.notePlayerVerb();
      }
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
      if (p.combat.tryDodge(dx / l, dz / l, p.stats)) {
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
    if (this.world.run.outcomeOpen) return;
    const target = this.combat.findExecutable();
    if (target && p.combat.canAct) {
      if (target.named && target.combat.broken) {
        this.maybeOpenOutcome(target, true);
        if (this.mode === 'choice') return;
      }
      p.combat.startExecute(target.uid);
      p.facing = Math.atan2(-(target.position.x - p.position.x), -(target.position.z - p.position.z));
      this.camera.shake(0.2);
      return;
    }
    const gate = this.world.nearestExtract(p.position.x, p.position.z, 4.5);
    if (gate && (this.world.run.extraction.unlocked || this.world.run.remnants >= REMNANT.extractCost)) {
      this.beginExtraction(gate.id);
      return;
    }
    const shrine = this.arena.nearestShrine(p.position.x, p.position.z, 4.5);
    if (shrine) {
      const rules = this.world.territoryNow().rules;
      if (rules.some((r) => r.id === 'poisoned_shrines') && this.world.run.remnants > 0) {
        this.world.run.remnants--;
        this.ui.hud.toast('SHRINE CLEANSED', 'good');
      } else if (rules.some((r) => r.id === 'poisoned_shrines')) {
        this.player.stats.hp = Math.max(1, this.player.stats.hp - 12);
        this.ui.hud.toast('TAINTED SHRINE', 'hot');
      }
      addHeat(this.world.run, HEAT.shrine * (rules.some((r) => r.id === 'ambitious_tithe') ? 1.5 : 1));
      this.arena.markShrineUsed(shrine);
      this.audio.play('pickup', { volume: 0.9 });
      this.particles.pillar(shrine.position.x, shrine.position.z, 0xffb020, 1.2);
      this.world.run.rerolls++;
      if (this.runLootCycle++ % 3 === 0) {
        window.setTimeout(() => {
          if (this.mode === 'playing') this.offerRunLoot('SHRINE RELIC');
        }, 500);
      } else {
        this.offerPower('A SHRINE STILL WORKS');
      }
      return;
    }
    const cache = this.arena.nearestCache(p.position.x, p.position.z, 3.6);
    if (cache) {
      this.arena.markCacheTaken(cache);
      const guarded = this.world.territoryNow().rules.some((r) => r.id === 'guarded_caches');
      this.world.run.remnants = Math.min(REMNANT.maxCarry, this.world.run.remnants + 1);
      if (guarded) addHeat(this.world.run, HEAT.shrine);
      this.ui.hud.toast(guarded ? 'A COLLECTOR STASH' : 'CACHE RIFLED', 'gold');
      this.audio.play('pickup', { volume: 0.7 });
      this.particles.pillar(cache.position.x, cache.position.z, 0x9dff6a, 0.85);
      return;
    }
    if (this.world.run.remnants > 0 && p.combat.canAct) {
      this.world.run.remnants--;
      p.combat.stagger();
      p.stats.heal(REMNANT.healAmount, 'remnant');
      this.ui.hud.toast('REMNANT CONSUMED', 'good');
      this.audio.play('heal', { volume: 0.5 });
    }
  }

  private readPrompt(): { text: string | null; execute: boolean; interact: boolean; remnant: boolean } {
    const empty = { text: null as string | null, execute: false, interact: false, remnant: false };
    if (this.vendettaOffer) {
      return {
        text: `Y — ACCEPT VENDETTA · N — NOT NOW (${this.vendettaOffer.title})`,
        execute: false,
        interact: true,
        remnant: false,
      };
    }
    const target = this.combat.findExecutable();
    if (target) {
      return {
        text: `E — EXECUTE ${target.named ? target.nemesis.name.toUpperCase() : 'THEM'}`,
        execute: true,
        interact: false,
        remnant: false,
      };
    }
    const gate = this.world.nearestExtract(this.player.position.x, this.player.position.z, 4.5);
    if (gate) {
      return {
        text:
          this.world.run.extraction.unlocked || this.world.run.remnants >= REMNANT.extractCost
            ? 'E — BEGIN EXTRACTION'
            : 'EXTRACTION LOCKED — KILL A NAMED FOE OR PAY REMNANTS',
        execute: false,
        interact: true,
        remnant: false,
      };
    }
    const shrine = this.arena.nearestShrine(this.player.position.x, this.player.position.z, 4.5);
    if (shrine) {
      return { text: 'E — TAKE A POWER', execute: false, interact: true, remnant: false };
    }
    const cache = this.arena.nearestCache(this.player.position.x, this.player.position.z, 3.6);
    if (cache) {
      return { text: 'E — RIFLE CACHE', execute: false, interact: true, remnant: false };
    }
    if (this.world.run.remnants > 0 && this.player.stats.hp / this.player.stats.maxHp < 0.72) {
      return { text: 'E — CONSUME REMNANT', execute: false, interact: false, remnant: true };
    }
    return empty;
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
    if (this.comicOpen) {
      if (
        e.code === 'Escape' ||
        e.code === 'Enter' ||
        e.code === 'Space' ||
        e.code === 'Digit1'
      ) {
        e.preventDefault();
        this.ui.comic.hide();
      }
      return;
    }
    if (this.mode === 'playing' && this.vendettaOffer) {
      if (e.code === 'KeyY') {
        e.preventDefault();
        this.acceptVendettaOffer();
        return;
      }
      if (e.code === 'KeyN') {
        e.preventDefault();
        this.refuseVendettaOffer();
        return;
      }
    }
    if (this.mode === 'power' && /^Digit[1-9]$/.test(e.code)) {
      this.ui.power.pickIndex(parseInt(e.code.slice(5), 10) - 1);
      return;
    }
    if (this.mode === 'choice' && /^Digit[1-9]$/.test(e.code)) {
      this.ui.choice.pickIndex(parseInt(e.code.slice(5), 10) - 1);
      return;
    }
    if (this.mode === 'power' && e.code === 'KeyR') {
      this.tryRerollOffer();
      return;
    }
    if (e.code === 'Escape') {
      if (this.mode === 'hierarchy') {
        this.closeHierarchy();
      } else if (this.mode === 'paused') {
        this.resumeFromPause();
      } else if (this.mode === 'build') {
        this.ui.build.hide();
        if (this.ui.title.visible) this.showTitle(this.saveSys.exists());
        else this.openPause();
      } else if (this.mode === 'title' && this.ui.pause.visible) {
        this.ui.pause.close();
      } else if (this.mode === 'god') {
        if (this.ui.pause.visible) {
          this.ui.pause.close();
          return;
        }
        if (this.ui.primer.visible) {
          this.ui.primer.hide();
          return;
        }
        // The run stays in the save; leaving the board is not abandoning it.
        this.godRun?.persist();
        this.showTitle(true);
      } else if (this.mode === 'legends') {
        this.ui.legends.hide();
        if (this.godRun && !this.godRun.ended) this.showGodScreen();
        else this.showTitle(this.saveSys.exists());
      } else if (this.mode === 'godend') {
        this.ui.godEnd.hide();
        this.godRun = null;
        this.showTitle(true);
      }
      return;
    }
    if (this.mode === 'hierarchy' && this.ui.hierarchy.handleKey(e)) {
      e.preventDefault();
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

  /** Push kit + legend lean into World spawn paths. */
  private refreshSpawnTuning(initial: boolean): void {
    this.world.spawnTuning = encounterTuningFromKit(this.telemetry.kit);
    this.world.legendBias = legendSpawnBias(this.mgr.data.legends ?? []);
    const note = this.world.spawnTuning.counterNote;
    if (note && note !== this.lastSpawnTuningNote && !initial && this.mode === 'playing') {
      this.lastSpawnTuningNote = note;
      this.ui.hud.toast(note, 'neutral', 2.8);
    }
  }

  private onNamedArrival(e: Enemy, salt: number, ctx: ArrivalContext): void {
    this.ui.hud.clearAreaBanner();
    this.syncAIWorld();
    const n = e.nemesis;
    const god = this.godRun?.god ?? null;
    const legends = this.mgr.data.legends ?? [];
    const echoes = this.godRun?.echoes ?? god?.legacyEchoes ?? [];
    let tilt = nemesisTilt(god, n.id);
    const legacy = resolveLegacyEcho(n, echoes, legends);
    const legend = legacy ? legends.find((l) => l.id === legacy.legendId) : undefined;
    const marks = god ? activeConditionLabels(god, n.id) : [];

    this.encounterAiContext = {
      legacyKind: legacy?.kind,
      legacyHeadline: legacy ? legacyArrivalToast(legacy, legend) : undefined,
      conditionMarks: marks.length ? marks.join(', ') : undefined,
      recentProc: this.world.run.lastProcNote || undefined,
      combatNote: this.combatOverlayNote || undefined,
    };

    this.encounter.begin(e, salt, ctx);
    this.vendettaOfferPending = true;
    this.maybeTeach('named');

    const comicSpeech = legacy
      ? legacyArrivalToast(legacy, legend)
      : ctx.resurrected
        ? 'FROM THE DEAD'
        : '';
    this.comic?.onNamedIntro(n.id, comicSpeech);

    if (legacy) {
      tilt = mergeCombatTilts(tilt, legacyTiltFor(legacy.kind));
      applyLegacyPresence(e, legacy);
    } else if (god && !this.legacyOmenShown) {
      const omenLegend = legendOmenFor(god, legends);
      if (omenLegend) {
        tilt = mergeCombatTilts(tilt, legacyTiltFor('rumour'));
        this.legacyOmenShown = true;
        this.ui.hud.toast(`THEY STILL TELL THE STORY OF ${omenLegend.name.toUpperCase()}`, 'gold', 4.5);
      }
    }
    if (god || legacy) {
      applyTiltToEnemy(e, tilt);
      if (marks.length) {
        this.ui.hud.toast(`${fullName(n)} · ${marks.join(' · ')}`, marks.some((m) => m.includes('CURSED') || m.includes('EXPOSED')) ? 'hot' : 'gold', 4.2);
      }
    }
    if (n.memory.length === 0 && n.defeatsByPlayer === 0) {
      this.myth(n, 'first_encounter');
    } else {
      this.ai.ensureFor(n);
    }

    const steel = n.stolen.find((s) => s.kind === 'weapon');
    const metBefore =
      n.defeatsByPlayer > 0 || n.killsAgainstPlayer > 0 || n.escapedPlayer > 0 || n.returns > 0 || n.memory.length > 0;

    if (
      !steel &&
      (ctx.resurrected || e.entranceKind === 'resurrection') &&
      signatureEventMatches(n, 'resurrection')
    ) {
      e.queueSignatureCue();
    }

    if (steel) {
      this.ui.hud.toast(`${n.name.toUpperCase()} CARRIES YOUR ${steel.name}`, 'hot', 4.5);
      this.audio.play('nemesis_return', { volume: 0.55 });
    } else if (legacy && legacy.kind !== 'relic') {
      const hot = legacy.kind === 'grudge';
      this.ui.hud.toast(legacyArrivalToast(legacy, legend), hot ? 'hot' : 'gold', 4.4);
      if (legacy.kind === 'bloodline') this.audio.play('nemesis_return', { volume: 0.48 });
    } else if (!e.signatureCue && metBefore && n.signatureKnown) {
      const sig = signatureDef(n.signatureId);
      if (sig) this.ui.hud.toast(`${n.name.toUpperCase()} · ${sig.name} — YOU KNOW THIS`, 'gold', 3.4);
    } else if (!e.signatureCue && metBefore) {
      const scar = n.scars[n.scars.length - 1];
      if (scar) {
        this.ui.hud.toast(`${n.name.toUpperCase()} STILL WEARS ${SCAR_NAMES[scar.id] ?? 'YOUR MARK'}`, 'gold', 4);
      } else if (n.killsAgainstPlayer > 0) {
        this.ui.hud.toast(`${n.name.toUpperCase()} REMEMBERS KILLING YOU`, 'hot', 4);
      }
    }
    this.combatOverlayNote = '';
  }

  private onNamedExecution(e: Enemy): void {
    if (!e.named) return;
    const words = encounterLine(e.nemesis, 'NEMESIS_DEFEATED', this.mgr.turn);
    if (words) this.ui.hud.toast(`"${words}"`, 'neutral');
    this.camera.pulseFov(4);
    this.vfx.story('death', e.position.x, e.position.z, e.rig.accent);
  }

  /** Named signature just committed — loud existing systems, no new mechanics. */
  private flushSignatureCues(): void {
    for (const e of this.world.enemies) {
      if (!e.alive || !e.named || !e.signatureCue) continue;
      e.signatureCue = false;
      const first = e.signatureCueFirst;
      e.signatureCueFirst = false;
      const def = signatureDef(e.nemesis.signatureId);
      if (!def) continue;
      const who = e.nemesis.name.toUpperCase();
      // One strong line: telegraph always; counterplay folds into the same toast
      // on first reveal (NOW panel also keeps counterplay while locked on).
      const line = `${who} · ${def.name} — ${def.telegraph}`;
      this.ui.hud.toast(line, 'hot', first ? 4.2 : 3.2);
      this.audio.play('shockwave', { volume: 0.45, pitch: 0.85 });
      this.ui.hud.screenFlash(accentColorFor(e.nemesis), 0.28, 220);
      this.camera.shake(0.18);
    }
  }

  private onEnemyKilled(e: Enemy, executed: boolean, definite = false): void {
    this.noteVendettaLoyalistKill(e);
    const rank = e.nemesis.rank;
    const wasOverlord = rank === 'overlord';
    if (e.summoned) {
      this.world.onEnemyKilled(e, executed, definite);
      return;
    }
    this.player.stats.essence += Math.round((e.named ? 30 + rankIndex(rank) * 25 : 4) * (1 + this.world.run.heat / 250));
    if (e.named && this.pendingModal?.label === 'THEIR FATE') this.pendingModal = null;
    if (e.named) {
      this.comicHold = COMIC_HOLD_AFTER_NAMED;
      this.world.noteAllyKilled(e.nemesis);
      addHeat(this.world.run, HEAT.namedKill);
      this.world.run.extraction.unlocked = true;
      this.world.run.rerolls++;
      const ci = rankIndex(rank);
      grantCinders(this.mgr.data.playerMeta, (ci >= 4 ? 8 : ci >= 3 ? 4 : ci >= 2 ? 2 : 1) + cinderBonusForNamedKill(this.mgr.data.playerMeta));
      syncStartingUnlocks(this.mgr.data.playerMeta);
      addMastery(this.mgr.data.playerMeta, weaponFamily(this.player.stats.weaponId) === 'hammer' ? 'hammer' : weaponFamily(this.player.stats.weaponId) === 'spear' ? 'spear' : 'sword');
      if (e.nemesis.name.toUpperCase() === 'VARK' && !this.mgr.data.playerMeta.progress.inventory.some((x) => x.defId === 'vark_mask')) {
        const trophy = mint(this.mgr.data.playerMeta.progress, 'vark_mask');
        trophy.history.push({ type: 'trophy', nemesisId: e.nemesis.id, nemesisName: e.nemesis.name, turn: this.mgr.turn });
        this.mgr.data.playerMeta.progress.inventory.push(trophy);
        this.ui.hud.toast("VARK'S CRACKED MASK", 'gold', 4);
      }
      if (this.abilities.unlock('void_grasp')) {
        this.ui.hud.toast('LEARNED VOID GRASP', 'gold', 3.2);
      } else {
        const extras: SkillId[] = ['spectral_guard', 'hunters_brand', 'shadow_snare', 'living_weapon', 'last_defiance'];
        const next = extras.find((id) => !this.abilities.unlocked.includes(id));
        if (next && this.abilities.unlock(next)) this.ui.hud.toast(`LEARNED ${getSkill(next).name}`, 'gold', 2.4);
      }
      this.mgr.data.playerMeta.unlockedSkills = [...this.abilities.unlocked];
    }
    this.world.dropRemnant(e.named, this.combat.lastKillPlayerCredit, false);
    this.finishVendettaAgainst(e, executed, false);
    this.world.onEnemyKilled(e, executed, definite);
    this.applyPlayerBuild();
    if (!wasOverlord && e.named && this.mode === 'playing') {
      window.setTimeout(() => {
        if (this.mode === 'playing') this.offerNemesisReward(e.nemesis, executed);
      }, 700);
    } else if (this.mode === 'playing' && !this.succession && this.player.stats.runKills >= this.nextBoonKills) {
      this.nextBoonKills = Math.ceil(this.nextBoonKills * 1.55 + 3);
      const lootTurn = this.runLootCycle++ % 2 === 0;
      window.setTimeout(() => {
        if (this.mode !== 'playing') return;
        if (lootTurn) this.offerRunLoot('RUN FINDING');
        else this.offerBoons('THE PIT FEEDS YOU');
      }, 500);
    }
    this.refreshPowerChips();
    this.mgr.data.run = this.world.run;
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
      this.comic?.onNamedOutcome(e.nemesis.id, 'enemy_escaped');
    } else if (e.named) {
      this.encounter.begin(e, this.mgr.turn, { outcome: 'nemesis_dead' });
      this.ai.bumpEvents(e.nemesis);
      this.aiDirty = true;
      this.comic?.onNamedOutcome(e.nemesis.id, 'enemy_dead');
    }
    this.mgr.persist();
  }

  private onPlayerDamaged(_from: Enemy | null, amount: number): void {
    this.ui.hud.damageVignette(0.2 + amount / 60);
    if (amount >= 8) {
      this.camera.kick(Math.min(0.35, amount / 80));
      this.camera.shake(Math.min(0.25, amount / 100));
    }
    if (this.world.run.extraction.active) this.world.cancelExtraction('EXTRACTION BROKEN');
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
    this.pendingModal = null;
    this.tutorial.dismiss();
    if (killer?.named) this.comic?.onNamedOutcome(killer.nemesis.id, 'player_dead');
    this.dismissComic(true);
    if (killer && killer.named) {
      this.ui.hud.toast(`${fullName(killer.nemesis)} KILLED YOU`, 'hot', 6);
      this.encounter.begin(killer, this.mgr.turn, { outcome: 'player_dead' });
      // Recap waits for the death report; do not steal the dying beat.
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
    this.mgr.markEventsKnown(result.turn - 1);

    this.pendingWorldPayoff = this.composeWorldPayoff(events, killerNemesis);

    const highlights = this.mgr.living().map((n) => n.name.toUpperCase());
    this.world.endRun();
    this.ui.hud.setVisible(false);

    const recap = composeWorldTurnRecap(this.mgr.data, events, killerNemesis?.id);
    this.syncAIWorld();
    observeRecapBeats(this.ai, this.mgr, recap);
    this.maybeTeach('death');
    this.presentReport({
      title: 'YOU DIED',
      subtitle: killerNemesis
        ? `${fullName(killerNemesis)} — WHILE YOU WERE DEAD`
        : 'WHILE YOU WERE DEAD',
      events,
      recap,
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
        if (this.descent) this.descent.playerDied = true;
        this.afterRunEnds();
      },
    });
    this.audio.play('world_event', { volume: 0.6 });
  }

  private composeWorldPayoff(events: WorldEvent[], killer: Nemesis | null): string[] {
    const lines: string[] = [];
    if (killer) {
      const steel = killer.stolen.find((s) => s.kind === 'weapon');
      if (steel) lines.push(`${fullName(killer).toUpperCase()} STILL CARRIES ${steel.name}`);
      else lines.push(`${fullName(killer).toUpperCase()} KILLED YOU — THE WORLD KEPT MOVING`);
    }
    const important = events.filter((e) => e.important).slice(0, 3);
    for (const ev of important) {
      const t = ev.text.toUpperCase();
      if (!lines.some((l) => l.includes(t.slice(0, 18)))) lines.push(t);
    }
    const pitHolderId = this.mgr.data.territories['pit'];
    const pitHolder = pitHolderId ? this.mgr.byId(pitHolderId) : null;
    if (pitHolder?.alive) {
      const line = `${fullName(pitHolder).toUpperCase()} HOLDS THE PIT`;
      if (!lines.includes(line)) lines.push(line);
    }
    return lines.slice(0, 3);
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
      const inst = mint(meta.progress, relic);
      meta.progress.inventory.push(inst);
      meta.progress.loadout.weapon = inst.id;
      syncLegacyWeapons(meta);
      this.ui.hud.toast(`YOU TOOK ${RELIC_WEAPONS[relic].name}`, 'gold', 6);
    }
    meta.essence += 200;
    grantCinders(meta, 8);

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
      this.mgr.markEventsKnown(this.mgr.turn);

      this.world.endRun();
      this.ui.hud.setVisible(false);
      const recap = composeWorldTurnRecap(this.mgr.data, [...successionEvents, ageEvent]);
      this.syncAIWorld();
      observeRecapBeats(this.ai, this.mgr, recap);
      this.presentReport({
        title: 'THE SEAT IS EMPTY',
        subtitle: `${name} IS DEAD — ${this.mgr.ageState.name} BEGINS`,
        events: [...successionEvents, ageEvent],
        recap,
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
      family: 'Utility',
      desc: `${def.desc}  (${formatStat(def, now)} → ${formatStat(def, then)})`,
      short: def.name,
      stackable: true,
      weight: def.weight,
    };
  }

  private runLootCard(def: ItemDef): PowerDef {
    return {
      id: `run:${def.id}` as PowerId,
      name: def.name,
      tag: 'UTILITY',
      family: 'Utility',
      desc: def.desc,
      short: def.name,
      stackable: false,
      weight: 1,
    };
  }

  /** Pick-one run modifiers — same offer shell as boons. */
  private offerRunLoot(subtitle: string): void {
    const owned = new Set(this.world.run.runLoot);
    const options = runLootChoices(this.mgr.age)
      .filter((d) => !owned.has(d.id))
      .map((d) => this.runLootCard(d));
    if (!options.length) return;
    this.presentOffer(options, subtitle, 'RUN LOOT');
  }

  private presentOffer(options: PowerDef[], subtitle: string, layer = 'RUN POWER'): void {
    this.requestModal('POWER', () => this.openPowerOffer(options, subtitle, layer));
  }

  private openPowerOffer(options: PowerDef[], subtitle: string, layer = 'RUN POWER'): void {
    if (this.mode === 'power' || this.mode === 'choice') return;
    this.mode = 'power';
    this.ui.intro.hide();
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.loop.paused = true;
    this.ui.power.present(options, subtitle, (p) => {
      const id = String(p.id);
      if (id.startsWith('run:')) {
        this.world.run.runLoot.push(id.slice(4));
        this.applyPlayerBuild(true);
        this.ui.hud.toast(`RUN — ${p.name}`, 'gold');
      } else if (id.startsWith('stat:')) {
        this.player.stats.addStatBoon(id.slice(5) as RunStatId);
        this.ui.hud.toast(`${p.name} UP`, 'gold');
      } else {
        this.player.stats.addPower(p.id);
        if (p.family === 'Execution' && !this.world.run.executionPayload) this.world.run.executionPayload = p.id;
        this.ui.hud.toast(`GAINED ${p.name}`, 'gold');
      }
      this.refreshPowerChips();
      this.mgr.data.run = this.world.run;
      this.audio.play('pickup', { volume: 0.8 });
      this.resumeToPlaying();
    }, {
      reactions: this.offerReactionText(),
      rerolls: this.world.run.rerolls + this.world.run.remnants,
      onReroll: () => this.tryRerollOffer(),
      layer,
    });
  }

  /** Shrines and captain kills: two mechanics and a stat, take one. */
  private offerPower(subtitle: string): void {
    const ctx = {
      owned: this.player.stats.powers,
      weaponId: this.player.stats.weaponId,
      statAtCap: (id: RunStatId) => this.player.stats.statAtCap(id),
      recentProc: this.world.run.lastProcNote || undefined,
    };
    const powers = rollPowerOffers(this.rng, ctx, 2);
    const stats = rollUncappedStats(this.rng, ctx, 1);
    const options: PowerDef[] = [...powers, ...stats.map((id) => this.boonCard(id))];
    if (!options.length) {
      this.player.stats.heal(30, 'empty_pool');
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

  private offerReactionText(): string {
    const act = activeReactions(this.player.stats.powers).map((r) => r.name).join(', ');
    const pot = potentialReactions(this.player.stats.powers).map((r) => r.name).join(', ');
    return [act && `ACTIVE: ${act}`, pot && `POTENTIAL: ${pot}`].filter(Boolean).join('  ·  ');
  }

  private tryRerollOffer(): void {
    if (this.mode !== 'power') return;
    if (this.world.run.rerolls > 0) this.world.run.rerolls--;
    else if (this.world.run.remnants >= REMNANT.rerollCost) this.world.run.remnants -= REMNANT.rerollCost;
    else return;
    this.ui.power.hide();
    this.offerPower('REROLL');
  }

  private maybeOpenOutcome(e: Enemy, force = false): void {
    if (!e.named || this.mode !== 'playing') return;
    if (this.world.run.outcomeOpen) return;
    const unsafe = this.world.enemies.some(
      (o) => o.alive && o !== e && Math.hypot(o.position.x - this.player.position.x, o.position.z - this.player.position.z) < OUTCOME.unsafeRadius && o.combat.attacking
    );
    if (unsafe && !force) {
      this.world.run.outcomeProtect = OUTCOME.protectWindow;
      this.player.combat.invulnerable = true;
      return;
    }
    this.world.run.outcomeOpen = true;
    this.world.run.outcomeEnemyId = e.nemesis.id;
    const opts = outcomeOptions(e.nemesis, { allyPresent: this.world.enemies.some((x) => x.alive && x.named && x !== e), heat: this.world.run.heat });
    this.requestModal('THEIR FATE', () => {
      if (this.mode !== 'playing') return;
      this.mode = 'choice';
      this.loop.paused = true;
      this.input.setEnabled(false);
      this.input.exitPointerLock();
      this.ui.choice.present(
        'THEIR FATE',
        fullName(e.nemesis).toUpperCase(),
        opts.map((o) => ({ id: o.id, title: o.title, tag: o.accepted ? 'OPEN' : 'REFUSED', desc: o.desc, disabled: !o.accepted })),
        (id) => this.resolveOutcome(e, id as OutcomeId)
      );
    });
  }

  private resolveOutcome(e: Enemy, id: OutcomeId): void {
    this.world.run.outcomeOpen = false;
    const n = e.nemesis;
    const turn = this.mgr.turn;
    if (id === 'execute') {
      this.resumeToPlaying();
      this.player.combat.startExecute(e.uid);
      return;
    }
    if (id === 'spare') {
      remember(n, 'PLAYER_SPARED_ME', turn);
      this.mgr.log(makeEvent(turn, this.mgr.age, 'player_spared', `You spared ${fullName(n)}.`, [n.id], true, 'good'));
      e.escaping = true;
    }
    if (id === 'tribute') {
      this.player.stats.essence += 40;
      remember(n, 'PLAYER_SPARED_ME', turn);
      e.escaping = true;
    }
    if (id === 'take_weapon') {
      n.stolenFromThem = n.stolenFromThem ?? [];
      n.stolenFromThem.push({ name: n.weapon, kind: 'weapon' });
      remember(n, 'PLAYER_STOLE_MY_WEAPON', turn);
      this.ui.hud.toast(`TOOK ${n.weapon.toUpperCase()}`, 'gold');
      e.escaping = true;
    }
    if (id === 'abandon_territory') {
      n.abandonedTerritoryTurn = turn;
      this.world.liberateCurrent(liberationRewardFor(n.personality, n.archetype));
      e.escaping = true;
    }
    if (id === 'informant') {
      n.informant = true;
      this.world.run.informantIds.push(n.id);
      addHeat(this.world.run, HEAT.informant);
      e.escaping = true;
    }
    if (id === 'betrayal' && n.master) {
      const m = this.mgr.byId(n.master);
      if (m) {
        breakBond(n, m);
        makeRivals(n, m);
        remember(n, 'I_BETRAYED_ALLY', turn, m.id);
        remember(m, 'I_WAS_BETRAYED', turn, n.id);
        this.mgr.log(makeEvent(turn, this.mgr.age, 'betrayal', `${fullName(n)} turned on ${fullName(m)}.`, [n.id, m.id], true, 'bad'));
      }
      e.escaping = true;
    }
    if (id === 'humiliate') {
      remember(n, 'PLAYER_HUMILIATED_ME', turn);
      n.humiliations = (n.humiliations ?? 0) + 1;
      n.branded = true;
      addHeat(this.world.run, HEAT.humiliate);
      if (rankIndex(n.rank) >= 2) this.mgr.demote(n, 'humiliation');
      this.mgr.log(makeEvent(turn, this.mgr.age, 'humiliation', `You humiliated ${fullName(n)}.`, [n.id], true, 'bad'));
      e.escaping = true;
    }
    if (id === 'branding') {
      remember(n, 'PLAYER_HUMILIATED_ME', turn);
      n.branded = true;
      const scar = applyScar(n, 'burn', turn, 'you');
      if (scar) n.title = chooseTitle(n, this.mgr.titlesInUse(n));
      n.revengeChance = Math.min(1, n.revengeChance + 0.12);
      this.mgr.log(makeEvent(turn, this.mgr.age, 'injury', `You branded ${fullName(n)}.`, [n.id], true, 'bad'));
      e.escaping = true;
    }
    if (id === 'message' && n.master) {
      remember(n, 'PLAYER_SPARED_ME', turn, n.master);
      e.escaping = true;
    }
    this.world.markResolved(n.id);
    this.resumeToPlaying();
  }

  private offerNemesisReward(n: Nemesis, executed: boolean): void {
    if (this.mode === 'power' || this.mode === 'choice') return;
    const vendetta = this.world.run.vendetta?.complete && this.world.run.vendetta.targetId === n.id;
    const rng = new RNG(this.world.run.runSeed ^ n.id.length * 997);
    const choices = nemesisRewardChoices(n, rng, { vendetta: !!vendetta, executed, farms: n.playerRewardFarms ?? 0 });
    this.requestModal('NEMESIS TROPHY', () => this.openNemesisReward(n, executed, choices));
  }

  private openNemesisReward(
    n: Nemesis,
    _executed: boolean,
    choices: ReturnType<typeof nemesisRewardChoices>
  ): void {
    if (this.mode === 'power' || this.mode === 'choice') return;
    this.mode = 'choice';
    this.loop.paused = true;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.choice.present(
      'NEMESIS TROPHY',
      `FROM ${fullName(n).toUpperCase()}`,
      choices.map((c) => ({ id: c.id, title: c.title, tag: c.kind.toUpperCase(), desc: c.desc })),
      (id) => {
        this.applyNemesisReward(n, choices.find((c) => c.id === id) ?? choices[0]);
        this.resumeToPlaying();
        const runLootRoll = rankIndex(n.rank) >= 2 || this.rng.next() < 0.3;
        if (runLootRoll) {
          window.setTimeout(() => {
            if (this.mode === 'playing') this.offerRunLoot('TROPHY SHARD');
          }, 400);
        }
        if (rankIndex(n.rank) >= 2) this.offerPower(`${n.name.toUpperCase()} IS DEAD`);
      }
    );
  }

  private applyNemesisReward(n: Nemesis, c: { kind: string; trait?: string }): void {
    n.playerRewardFarms = (n.playerRewardFarms ?? 0) + 1;
    if (c.kind === 'steal_strength' && c.trait) this.player.stats.stolenTraits.push(c.trait);
    if (c.kind === 'steal_adapt' && c.trait) {
      n.adaptations = n.adaptations.filter((t) => t !== c.trait);
      this.player.stats.stolenTraits.push(c.trait);
    }
    if (c.kind === 'tribute') this.player.stats.essence += 55;
    if (c.kind === 'permanence') n.fakeDeathPenalty = Math.min(1, (n.fakeDeathPenalty ?? 0) + 0.45);
    if (c.kind === 'destabilise') this.world.liberateCurrent('destabilised');
    if (c.kind === 'intel') this.ui.hud.toast(`INTEL: ${n.master ? 'SERVES ' + (this.mgr.byId(n.master)?.name ?? '?') : 'NO MASTER'}`, 'gold', 5);
    if (c.kind === 'technique') {
      const wid = this.player.stats.weaponId;
      const list = this.mgr.data.playerMeta.techniques[wid] ?? [];
      const add = wid.includes('sword') || wid === 'sunblade' ? 'sword_riposte_drive' : wid.includes('great') || wid === 'ashfang' ? 'gs_breaker' : 'spear_chase';
      if (!list.includes(add)) list.push(add);
      this.mgr.data.playerMeta.techniques[wid] = list;
      this.player.stats.techniques = list;
    }
    if (c.kind === 'scar_power') this.player.stats.addPower('ember');
    this.ui.hud.toast(c.kind.replace(/_/g, ' ').toUpperCase(), 'gold');
    this.mgr.persist();
  }

  private beginExtraction(siteId: string): void {
    if (this.world.run.lockedExits && !this.world.run.extractHeatImmune) {
      this.ui.hud.toast('EXITS LOCKED — HEAT', 'hot');
      return;
    }
    if (!this.world.run.extraction.unlocked && this.world.run.remnants >= REMNANT.extractCost) {
      this.world.run.remnants -= REMNANT.extractCost;
      this.world.run.extraction.paid = true;
    }
    this.world.run.extraction.active = true;
    this.world.run.extraction.siteId = siteId;
    this.world.run.extraction.progress = 0;
    addHeat(this.world.run, EXTRACT.heatOnStart);
    this.ui.hud.toast('EXTRACTION — HOLD THE GATE', 'hot');
  }

  private finishExtraction(success: boolean): void {
    this.world.run.extraction.active = false;
    if (success) {
      this.player.stats.essence += 80 + Math.round(this.world.run.heat);
      grantCinders(this.mgr.data.playerMeta, 2);
      this.mgr.log(makeEvent(this.mgr.turn, this.mgr.age, 'extraction', 'You extracted from the Pit.', [], true, 'gold'));
      for (const e of this.world.enemies) {
        if (e.named && e.alive) remember(e.nemesis, 'PLAYER_RAN_FROM_ME', this.mgr.turn);
      }
      this.mgr.markEventsKnown(this.mgr.turn);
      this.endRunAndBank();
      this.world.endRun();
      this.showWalkAway('YOU EXTRACTED', 'BONUS BANKED. THE WORLD REMEMBERS THE ESCAPE.');
    }
  }

  private showWalkAway(title: string, sub: string): void {
    this.mode = 'report';
    this.input.setEnabled(false);
    this.loop.paused = true;
    this.ui.hud.setVisible(false);
    this.ui.report.present({
      title,
      subtitle: sub,
      events: this.mgr.data.eventLog.slice(-8),
      recap: composeRunRecap(this.mgr.data, { extracted: true }),
      reducedMotion: this.mgr.data.settings.reducedMotion,
      reducedFlash: this.mgr.data.settings.reducedFlash,
      buttonLabel: 'CONTINUE',
      extras: [{ label: 'VIEW THE WEB', onClick: () => this.openHierarchyFromReport() }],
      onContinue: () => {
        if (this.descent) this.descent.extracted = true;
        this.afterRunEnds();
      },
    });
  }

  private tickVendetta(): void {
    /* progress is applied on kills/escapes */
  }

  /**
   * Open the armed vendetta offer only in a genuine LULL.
   *
   * This is an optional, world-pausing decision, so it must never ambush the
   * player mid-input. It waits for a sustained calm — nothing swinging at
   * them, nothing nearby aggroed, no card on screen, no other offer just
   * closed — rather than firing on the first frame the player happens to be
   * idle. The offer keeps indefinitely until such a moment exists.
   */
  private maybeOpenPendingVendetta(dt: number): void {
    if (this.qaSuppressOffers) return;
    if (!this.vendettaOfferPending || this.mode !== 'playing') return;
    if (this.world.run.vendetta) {
      this.vendettaOfferPending = false;
      this.vendettaOffer = null;
      this.calmTime = 0;
      return;
    }
    if (this.vendettaOffer) return;

    const s = this.encounterSafety();
    const threatNear = this.world.enemies.some(
      (e) =>
        e.alive &&
        (e.combat.attacking || e.state === 'chase' || e.state === 'attack' || e.state === 'hunt_player') &&
        Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z) < 14
    );
    const calmNow =
      this.runClock > 4 &&
      this.offerQuiet <= 0 &&
      !this.encounter.busy &&
      !this.ui.intro.active &&
      !this.comicOpen &&
      !this.pendingComic &&
      !threatNear &&
      s.playerHpFrac >= 0.4 &&
      !s.playerStaggered &&
      !s.incomingActive &&
      !s.projectileClose &&
      this.player.combat.action === 'idle';

    this.calmTime = calmNow ? this.calmTime + dt : 0;
    if (this.calmTime < VENDETTA_CALM_REQUIRED) return;

    this.calmTime = 0;
    this.vendettaOfferPending = false;
    this.maybeOfferVendetta();
  }

  private maybeOfferVendetta(): void {
    if (this.world.run.vendetta || this.vendettaOffer) return;
    const named = this.world.enemies.find((e) => e.alive && e.named);
    if (!named) return;
    if (this.world.run.offeredVendettaId === named.nemesis.id) return;
    this.world.run.offeredVendettaId = named.nemesis.id;
    const facts = factsFromNemesis(
      named.nemesis,
      (id) => this.mgr.byId(id) ?? undefined,
      (id) => !!this.mgr.byId(id)?.alive
    );
    const v = rollVendetta(facts, this.mgr.data.playerMeta.vendettaPatternHistory, this.mgr.data.worldSeed, this.mgr.turn, this.player.stats.powers);
    if (!v) return;
    this.vendettaOffer = v;
    this.ui.hud.toast(`${v.title} — ${v.reward.text}`, 'hot', 4.5);
  }

  private acceptVendettaOffer(): void {
    const v = this.vendettaOffer;
    if (!v) return;
    this.vendettaOffer = null;
    this.world.run.vendetta = v;
    v.committed = true;
    this.world.resetVendettaCounters();
    this.mgr.data.playerMeta.vendettaPatternHistory.push(v.pattern);
    this.ui.hud.toast(v.title, 'hot');
    this.offerQuiet = OFFER_QUIET_AFTER;
  }

  private refuseVendettaOffer(): void {
    this.vendettaOffer = null;
    this.offerQuiet = OFFER_QUIET_AFTER;
  }

  private isVendettaTarget(e: Enemy): boolean {
    const v = this.world.run.vendetta;
    return !!v?.committed && v.targetId === e.nemesis.id;
  }

  private trackVendettaAdaptation(habit: keyof import('./SaveSystem').PlayerHabits): void {
    const v = this.world.run.vendetta;
    if (!v?.committed) return;
    const target = this.mgr.byId(v.targetId);
    if (!target) return;
    const need = adaptationHabitFor(target.adaptations[0] ?? null);
    if (need && need === habit) this.world.vendettaCounters.adapted = true;
  }

  private noteVendettaLoyalistKill(e: Enemy): void {
    const v = this.world.run.vendetta;
    if (!v?.committed) return;
    if (e.nemesis.personality === 'loyalist' && e.nemesis.master === v.targetId) {
      this.world.vendettaCounters.loyalistSeparated = true;
    }
  }

  private finishVendettaAgainst(e: Enemy, executed: boolean, fled: boolean): void {
    const v = this.world.run.vendetta;
    if (!v || !v.committed || v.targetId !== e.nemesis.id) return;
    const facts = factsFromNemesis(
      e.nemesis,
      (id) => this.mgr.byId(id) ?? undefined,
      (id) => !!this.mgr.byId(id)?.alive
    );
    const master = e.nemesis.master ? this.mgr.byId(e.nemesis.master) : null;
    const next = applyVendettaProgress(v, {
      postureBreaks: this.world.vendettaCounters.posture,
      interrupts: this.world.vendettaCounters.interrupts,
      perfectParries: this.world.vendettaCounters.parries,
      targetFled: fled,
      targetDead: !fled,
      executed,
      allyPresent: this.world.enemies.some((x) => x.alive && x.named && x !== e && e.nemesis.allies.includes(x.nemesis.id)),
      inMasterTerritory: !!master && this.world.currentArea.id === master.territory,
      heat: this.world.run.heat,
      heatMax: HEAT.max,
      weaponId: this.player.stats.weaponId,
      stolenWeaponId: facts.stolenWeaponId,
      usedWeakness: this.world.vendettaCounters.weakness,
      usedAdaptedHabit: this.world.vendettaCounters.adapted,
      loyalistSeparated: this.world.vendettaCounters.loyalistSeparated || !facts.hasLoyalistFollower,
    });
    this.world.run.vendetta = next;
    if (next.complete) {
      this.applyVendettaCompletion(next, e.nemesis);
      this.ui.hud.toast('VENDETTA COMPLETE', 'gold');
      this.mgr.log(makeEvent(this.mgr.turn, this.mgr.age, 'vendetta', `Vendetta against ${fullName(e.nemesis)} complete.`, [e.nemesis.id], true, 'gold'));
    } else if (next.failed) {
      this.ui.hud.toast('VENDETTA FAILED', 'hot');
      remember(e.nemesis, 'PLAYER_HUMILIATED_ME', this.mgr.turn);
      this.mgr.log(makeEvent(this.mgr.turn, this.mgr.age, 'vendetta', `Vendetta against ${fullName(e.nemesis)} failed.`, [e.nemesis.id], false, 'bad'));
    }
  }

  private applyVendettaCompletion(v: VendettaInstance, n: import('../nemesis/Nemesis').Nemesis): void {
    const kind = v.reward.kind;
    switch (kind) {
      case 'essence':
        this.player.stats.essence += v.pattern === 'max_heat' ? 70 : 45;
        if (v.pattern === 'max_heat') this.world.run.extractHeatImmune = true;
        break;
      case 'technique': {
        const wid =
          v.pattern === 'defeat_recovered_weapon' && n.stolen.find((s) => s.weaponId)?.weaponId
            ? n.stolen.find((s) => s.weaponId)!.weaponId!
            : this.player.stats.weaponId;
        const list = this.mgr.data.playerMeta.techniques[wid] ?? [];
        const add =
          wid.includes('sword') || wid === 'sunblade'
            ? 'sword_riposte_drive'
            : wid.includes('great') || wid === 'ashfang'
              ? 'gs_breaker'
              : 'spear_chase';
        if (!list.includes(add)) list.push(add);
        this.mgr.data.playerMeta.techniques[wid] = list;
        this.player.stats.techniques = this.mgr.data.playerMeta.techniques[this.player.stats.weaponId] ?? list;
        break;
      }
      case 'territory':
        this.world.run.territoryMods = applyVendettaRewardKind('territory', this.world.run.territoryMods, n.territory, this.mgr.turn);
        this.mgr.data.territoryMods = this.world.run.territoryMods;
        this.world.liberateCurrent('destabilised');
        break;
      case 'permanence':
        n.fakeDeathPenalty = Math.min(1, (n.fakeDeathPenalty ?? 0) + 0.45);
        break;
      case 'weaken':
        if (n.strengths.length) n.strengths = n.strengths.slice(1);
        break;
      case 'steal_adapt':
        if (n.adaptations[0]) {
          const t = n.adaptations[0];
          n.adaptations = n.adaptations.filter((x) => x !== t);
          this.player.stats.stolenTraits.push(t);
        }
        break;
      case 'informant': {
        const loyalist = this.mgr
          .living()
          .find((x) => x.personality === 'loyalist' && x.master === n.id);
        if (loyalist) {
          loyalist.informant = true;
          this.world.run.informantIds.push(loyalist.id);
        }
        break;
      }
      case 'power':
        window.setTimeout(() => {
          if (this.mode === 'playing') this.offerPower(v.title);
        }, 900);
        break;
      case 'choice':
        break;
    }
    this.mgr.persist();
  }


  private requestModal(label: string, open: () => void): void {
    if (this.mode === 'dying' || this.mode === 'report' || this.mode === 'title') return;
    if (this.mode === 'power' || this.mode === 'choice') return;
    if (this.canOpenModal()) {
      open();
      return;
    }
    const rank = this.modalRank(label);
    if (!this.pendingModal || rank >= this.modalRank(this.pendingModal.label)) {
      this.pendingModal = { label, open };
    }
  }

  private modalRank(label: string): number {
    if (label === 'THEIR FATE') return 3;
    if (label === 'NEMESIS TROPHY') return 2;
    return 1;
  }

  private canOpenModal(): boolean {
    if (this.mode !== 'playing') return false;
    if (this.comicOpen) return false;
    if (this.encounter.busy || this.ui.intro.active) return false;
    if (this.player.combat.action !== 'idle') return false;
    return true;
  }

  private flushPendingModal(rdt: number): void {
    const calm =
      this.mode === 'playing' &&
      !this.comicOpen &&
      !this.encounter.busy &&
      !this.ui.intro.active &&
      this.player.combat.action === 'idle';
    this.modalCalm = calm ? this.modalCalm + rdt : 0;
    if (!this.pendingModal) return;
    if (!calm || this.modalCalm < 0.55) return;
    const job = this.pendingModal;
    this.pendingModal = null;
    this.modalCalm = 0;
    job.open();
  }

  private flushPendingComic(rdt: number): void {
    if (this.comicHold > 0) this.comicHold = Math.max(0, this.comicHold - rdt);
    const calmBase =
      this.mode === 'playing' &&
      !this.comicOpen &&
      !this.encounter.busy &&
      !this.ui.intro.active &&
      this.player.combat.action === 'idle';
    const emptyLull = calmBase && !this.world.enemies.some((e) => e.alive);
    const softLull = calmBase && !emptyLull && !this.enemiesAttacking();
    this.comicCalm = emptyLull || softLull ? this.comicCalm + rdt : 0;
    if (!this.pendingComic || this.comicOpen) return;
    if (this.mode !== 'playing') return;
    this.comicAge += rdt;
    if (!this.comicForce && this.comicAge > COMIC_EXPIRE) {
      this.pendingComic = null;
      this.comicAge = 0;
      return;
    }
    this.tryPresentComic();
  }

  /* ============================================================
     screens
     ============================================================ */

  private openHierarchy(): void {
    if (this.mode !== 'playing' || this.comicOpen) return;
    this.mode = 'hierarchy';
    this.loop.paused = true;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.hierarchy.open(this.mgr, () => this.closeHierarchy(), this.ai);
  }

  /** Stored so the report can be restored after a detour into the hierarchy. */
  private lastReport: ReportArgs | null = null;

  private presentReport(opts: ReportArgs): void {
    this.lastReport = opts;
    this.dismissComic(true);
    this.ui.intro.hide();
    this.ui.choice.hide();
    this.ui.power.hide();
    this.ui.report.present({
      title: opts.title,
      subtitle: opts.subtitle,
      events: opts.events,
      recap: opts.recap,
      reducedMotion: this.mgr.data.settings.reducedMotion,
      reducedFlash: this.mgr.data.settings.reducedFlash,
      highlight: opts.highlight,
      buttonLabel: opts.buttonLabel,
      extras: [{ label: 'VIEW THE WEB', onClick: () => this.openHierarchyFromReport() }],
      onContinue: opts.onContinue,
      spotlight: opts.spotlight,
      recapLineFor: opts.recap?.length ? (b) => recapBeatLineFor(this.ai, b) : undefined,
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
    if (this.hierarchyFromGod) {
      this.hierarchyFromGod = false;
      this.showGodScreen();
      return;
    }
    this.resumeToPlaying();
  }

  private openPause(): void {
    if (this.mode !== 'playing' || this.comicOpen) return;
    this.mode = 'paused';
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
        onBuild: () => this.openBuild('paused'),
        onSettingsChanged: (s) => {
          this.applySettings(s);
          this.mgr.persist();
        },
        ai: this.aiSettingsHooks(),
        runStats: () =>
          this.player.stats.statList().map((s) => ({ name: s.def.name, text: s.text, count: s.count })),
        currencies: {
          remnants: this.world.run.remnants,
          essence: this.mgr.data.playerMeta.essence,
        },
        skills: {
          unlocked: this.abilities.unlocked,
          loadout: this.abilities.loadout,
          ultimate: this.abilities.ultimate,
          ultimates: this.abilities.unlocked.filter(isUltimateSkill).concat(this.abilities.ultimate).filter((id, i, a) => a.indexOf(id) === i).map((id) => {
            const d = getSkill(id);
            return { id, name: d.name, desc: d.desc };
          }),
          descriptions: this.abilities.unlocked.filter((id) => !isUltimateSkill(id)).map((id) => {
            const d = getSkill(id);
            return { id, name: d.name, desc: d.desc };
          }),
          onEquip: (slot, id) => {
            const cur = [...this.abilities.loadout] as [SkillId, SkillId];
            cur[slot] = id;
            this.abilities.equip(cur[0], cur[1]);
            this.mgr.data.playerMeta.skillLoadout = this.abilities.loadout;
            this.world.run.skillLoadout = this.abilities.loadout;
            this.mgr.persist();
          },
          onEquipUltimate: (id) => {
            this.abilities.unlock(id);
            this.abilities.equipUltimate(id);
            this.mgr.data.playerMeta.ultimateLoadout = this.abilities.ultimate;
            this.mgr.data.playerMeta.unlockedSkills = [...this.abilities.unlocked];
            this.mgr.persist();
          },
        },
        onSkipTutorials: () => {
          this.tutorial.skipAll(this.mgr.data.settings);
          this.godGuide.finish();
          this.godLesson = null;
          this.mgr.data.settings.tutorial.godGuide = 'done';
          this.mgr.persist();
          this.ui.hud.toast('TUTORIALS SKIPPED', 'neutral');
        },
        onReplayTutorials: () => {
          this.tutorial.replay(this.mgr.data.settings);
          this.godGuide.restart();
          this.godLesson = null;
          this.mgr.persist();
        },
        ...this.telemetryPauseHooks(),
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
    this.ui.choice.hide();
    this.ui.power.hide();
    // Coming out of ANY offer, give the player their hands back for a moment
    // before another optional one may interrupt. Two modals back to back is
    // the fastest way to make a reward feel like paperwork.
    this.offerQuiet = OFFER_QUIET_AFTER;
    this.calmTime = 0;
  }

  /* ============================================================
     settings & resize
     ============================================================ */

  private applySettings(s: Settings): void {
    this.audio.setVolume(s.masterVolume);
    const motion = s.reducedMotion ? 0.5 : 1;
    this.camera.shakeScale = s.cameraShake * motion;
    this.loop.hitStopScale = motion;
    this.vfx.reduced = s.cameraShake < 0.35 || s.quality === 'low' || s.reducedMotion;
    this.ui.hud.setMinimapVisible(s.showMinimap);
    this.ui.hud.reducedFlash = s.reducedFlash;
    this.ui.hud.setScale(s.hudScale ?? 1);
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
    document.documentElement.classList.toggle('reduced-flash', s.reducedFlash);
    document.documentElement.style.setProperty('--hud-scale', String(s.hudScale ?? 1));
    this.ai.setSettings(s.ai);
    this.godClock?.setSettings(s.god);
    this.comic?.setEnabled(!s.reducedMotion);
    this.applyQuality(s.quality);
    if (this.mode === 'title' && this.saveSys.exists()) this.warmTitleGeneration();
  }

  /** Respect player opt-in for QA-grade frame/hit recording. */
  private syncTelemetryOptIn(): void {
    if (this.mgr.data.playerMeta.telemetryOptIn) this.telemetry.start();
    else this.telemetry.stop();
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
        g.damageNumbers.spawnOn(g.player, String(amount), 'hurt');
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
          // Definite: a debug kill that sometimes rolls a fake death is not a
          // debug tool, and the survivor kept walking off afterwards writing
          // I_ESCAPED_PLAYER over whatever the caller did next.
          g.onEnemyKilled(e, false, true);
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
        g.ai.invalidateAllWork();
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
        // Clear any body of theirs still on stage first. A live enemy that is
        // mid-escape will keep writing to this record after the resurrection,
        // so the returning nemesis would arrive classified as an escapee.
        g.world.removeNamedFromStage(id);
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
        g.abilities.infinite = g.debugInfiniteSurge;
        return g.debugInfiniteSurge;
      },
      resetSkillCooldowns() {
        g.abilities.reset();
      },
      freezeSkillCooldowns() {
        g.abilities.freeze = !g.abilities.freeze;
        return g.abilities.freeze;
      },
      fillSurge() {
        g.player.stats.surge = g.player.stats.surgeMax;
      },
      forceUltimate() {
        g.player.stats.surge = g.player.stats.surgeMax;
        g.abilities.infinite = true;
        g.tryPlayerSkill('ultimate');
        g.abilities.infinite = g.debugInfiniteSurge;
      },
      unlockAllSkills() {
        for (const id of ['shadow_step', 'ground_rupture', 'void_grasp', 'spectral_guard', 'hunters_brand', 'shadow_snare', 'pit_eruption', 'living_weapon', 'last_defiance'] as SkillId[]) {
          g.abilities.unlock(id);
        }
        g.mgr.data.playerMeta.unlockedSkills = [...g.abilities.unlocked];
        g.mgr.persist();
      },
      equipSkill(slot: 0 | 1, id: string) {
        if (!isUnlockableSkill(id) || isUltimateSkill(id)) return;
        const cur = [...g.abilities.loadout] as [SkillId, SkillId];
        cur[slot] = id;
        g.abilities.equip(cur[0], cur[1]);
      },
      equipUltimate(id: string) {
        if (!isUltimateSkill(id)) return;
        g.abilities.unlock(id as SkillId);
        g.abilities.equipUltimate(id as SkillId);
      },
      kitDump() {
        return {
          ...g.telemetry.kit,
          abilities: g.abilities.events.slice(-20),
          vfx: g.vfx.poolStats(),
          loadout: g.abilities.loadout,
          surge: g.player.stats.surge,
        };
      },
      progressAction(cmd: string, arg?: string) {
        return g.progressAction(cmd, arg);
      },

      /* ---- THE LONG GAME ---- */
      godState() {
        return g.godDebugState();
      },
      godAdvance(cycles: number) {
        const run = g.godRun;
        if (!run) return;
        run.advanceMany(cycles);
        if (run.ended && g.mode === 'god') g.presentGodEnd(run.outcome!);
        else g.ui.god.refresh();
      },
      godAddInfluence(amount: number) {
        const run = g.godRun;
        if (!run) return;
        run.god.influence = Math.max(0, Math.min(run.god.influenceMax, run.god.influence + amount));
        g.ui.god.refresh();
      },
      godAddChaos(amount: number) {
        const run = g.godRun;
        if (!run) return;
        addChaos(run.god, amount);
        g.ui.god.refresh();
      },
      godForceCrisis() {
        const run = g.godRun;
        if (!run) return 'no run';
        return g.forceGodCrisis();
      },
      godEndRun() {
        if (!g.godRun) return;
        g.abandonGodRun();
      },
      godStart() {
        g.openLongGame();
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
          heat: g.world.run.heat,
        };
      },
      depthAction(cmd: string) {
        g.__sim(cmd);
      },
      storyAction(cmd: string) {
        return g.__storyAction(cmd);
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
      forceComicSlice() {
        return g.__comicSlice();
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
    best.pendingIntro = false;
    best.introHold = false;
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
      heat: this.world.run.heat,
      remnants: this.world.run.remnants,
      vendetta: this.world.run.vendetta?.title ?? null,
      multiRule: this.world.multiRule?.id ?? null,
      powers: this.player.stats.powers.ids(),
      worldTurn: this.mgr.turn,
      worldAge: this.mgr.age,
      shrinesLeft: this.arena.shrines.filter((s) => !s.used).length,
      cachesLeft: this.arena.caches.filter((c) => !c.taken).length,
      landmarks: this.arena.landmarks.map((l) => l.name),
      colliders: this.arena.colliders.length,
      axisX: this.input.axisX,
      axisY: this.input.axisY,
      loopPaused: this.loop.paused,
      introActive: this.ui.intro.active,
      encounterBusy: this.encounter.busy,
      overlayNext: this.pendingModal?.label ?? (this.pendingComic ? 'ENCOUNTER' : null),
      comicOpen: this.comicOpen,
      debugOpen: this.debugOpen,
      lockGrace: Math.round(this.lockGrace * 100) / 100,
      vel: Math.round(Math.hypot(this.player.controller.velocity.x, this.player.controller.velocity.z) * 100) / 100,
      dodgeCd: Math.round(this.player.combat.dodgeCooldown * 100) / 100,
      surge: Math.round(this.player.stats.surge),
      loadout: this.abilities.loadout,
      skillCd: {
        a: Math.round(this.abilities.remaining(this.abilities.loadout[0]) * 100) / 100,
        b: Math.round(this.abilities.remaining(this.abilities.loadout[1]) * 100) / 100,
      },
      skillId: this.player.combat.skillId,
      kit: this.telemetry.kit,
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

  __fillSurge(): void {
    this.player.stats.surge = this.player.stats.surgeMax;
  }

  __kit(): Record<string, unknown> {
    return {
      ...this.telemetry.kit,
      loadout: this.abilities.loadout,
      events: this.abilities.events.slice(-24),
      vfx: this.vfx.poolStats(),
      surge: this.player.stats.surge,
    };
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
    if (e) this.encounter.playKind(e, 'FIRST_MEETING', this.mgr.turn);
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

  /**
   * Vertical slice: ensure a named nemesis is on stage, capture 4 comic panels
   * (intro / attack / impact / outcome), open the viewer when ready.
   */
  __comicSlice(qualityArg?: string): Record<string, unknown> {
    if (qualityArg === 'potato' || qualityArg === 'fast' || qualityArg === 'balanced' || qualityArg === 'offline') {
      this.comic.setQuality(qualityArg);
    }
    if (this.mode !== 'playing') {
      // Best-effort: slice needs a live arena. Tests should descend first.
      if (this.mode === 'title') {
        return { ok: false, error: 'not_playing', hint: 'descend first, then __sim("comicSlice")' };
      }
    }
    let e = this.world.enemies.find((x) => x.alive && x.named) ?? null;
    if (!e) {
      const n =
        this.mgr.living().find((x) => x.rank !== 'grunt') ??
        this.mgr.living()[0] ??
        null;
      if (!n) {
        // Spawn a captain if the roster is empty of named foes
        this.debugHooks().spawnNemesis('captain');
        e = this.world.enemies.find((x) => x.alive && x.named) ?? null;
      } else {
        e = this.world.spawnNamed(n, this.player, true, this.player.position.x + 5, this.player.position.z + 3);
      }
    }
    if (!e) return { ok: false, error: 'no_named_on_stage' };
    this.comicForce = true;
    this.comicAge = 0;
    // Pose them for a readable capture
    e.taunt();
    const result = this.comic.forceSlice(e.nemesis.id);
    return { ...result, mode: this.mode, comicOpen: this.comicOpen };
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

  /** Drop leftover skill/attack pose so a later QA beat can fire. */
  __qaIdle(): void {
    this.player.combat.reset();
    this.input.clearBuffers();
  }

  /** Grant run-stat boons directly, for TEST 5 build assembly. */
  __qaGrantStat(id: string, count = 1): void {
    for (let i = 0; i < count; i++) this.player.stats.addStatBoon(id as RunStatId);
  }

  __qaStatValue(id: string): number {
    return this.player.stats.stat(id as RunStatId);
  }

  __qaSetWeapon(id: string): void {
    this.player.stats.weaponId = id;
    this.player.rebuildWeapon();
  }

  __qaCastSkill(slot: 'skill1' | 'skill2' | 'ultimate'): boolean {
    this.abilities.reset();
    this.player.combat.reset();
    this.player.stats.surge = this.player.stats.surgeMax;
    this.abilities.infinite = true;
    const ok = this.tryPlayerSkill(slot);
    this.abilities.infinite = this.debugInfiniteSurge;
    return ok;
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
      ['duelist', 'sword'],
      ['commander', 'spear'],
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
      if (e) {
        e.pendingIntro = false;
        e.introHold = false;
      }
      out.push(`${arch}:${e ? n.name : 'FAILED'}`);
      i++;
    }
    this.mgr.persist();
    return out;
  }

  /** Spawn exactly one enemy of the given archetype near the player. */
  __qaSpawnOne(arch: Archetype, dist = 12): string {
    const weapon: WeaponType =
      arch === 'heavy' ? 'club' : arch === 'archer' ? 'bow' : arch === 'commander' ? 'spear' : 'sword';
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
    if (e) {
      e.pendingIntro = false;
      e.introHold = false;
      e.engagePlayer = true;
    }
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
  /** headless harness: never open optional world-pausing offers */
  private qaSuppressOffers = false;

  /**
   * Put the game into headless-harness mode.
   *
   * As well as disabling the lost-pointer-lock auto-pause, this suppresses the
   * optional vendetta prompt. That prompt is a world-pausing decision that
   * opens at the first calm moment, which for an animation or QA harness is
   * precisely the moment it is measuring — a frozen loop then reads as
   * "the gait cycle stopped advancing". Harnesses that mean to exercise the
   * offer (playtest, aitest) simply do not call this.
   */
  __qaStart(): void {
    this.telemetry.start();
    this.qaNoAutoPause = true;
    this.qaSuppressOffers = true;
    this.vendettaOfferPending = false;
    this.vendettaOffer = null;
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

  /** Test-only provider. Null restores the real backend path. */
  __aiInstallHarness(cfg: {
    delayMs?: number;
    available?: boolean;
    fail?: boolean;
    timeout?: boolean;
    malformed?: boolean;
    hang?: boolean;
  } | null): void {
    this.ai.installHarness(cfg);
  }

  /** Long-game AI presentation, never mechanical state. */
  __godAi(cmd: string, arg?: string): Record<string, unknown> {
    const run = this.godRun;
    if (cmd === 'harnessOff') {
      this.ai.installHarness(null);
      return { ok: true };
    }
    if (!run) return { active: false };
    if (cmd === 'snapshot') return { ok: true, snap: mechanicalSnapshot(this.mgr, run.god) };
    if (cmd === 'scope') return { scope: this.ai.generationScope, queued: this.ai.queue.queuedCount, active: this.ai.queue.activeCount, overlays: this.ai.overlayCount() };
    if (cmd === 'inspect') {
      const n = this.mgr.byId(arg ?? '') ?? this.mgr.living()[0];
      if (!n) return { ok: false };
      this.syncAIWorld();
      observeInspect(this.ai, this.mgr, run.god, n);
      if (this.mode === 'god') this.ui.god.inspect(n.id);
      const key = dossierKey(n, run.god);
      const overlay = this.ai.peekOverlay(key);
      return {
        ok: true,
        id: n.id,
        name: n.name,
        dossier: dossierFor(this.ai, n, run.god, this.mgr),
        overlay: overlay,
        generated: overlay != null,
        title: this.ai.titleFor(n),
        displayName: this.ai.displayName(n),
        eventVersion: n.ai?.eventVersion ?? 0,
      };
    }
    if (cmd === 'feedVoices') {
      const list = run.god.feed
        .filter((b) => BEAT_RANK[b.priority] >= BEAT_RANK.major)
        .slice(-40)
        .map((b) => ({
          id: b.id,
          kind: b.kind,
          headline: b.headline,
          voice: beatVoiceFor(this.ai, b, run.god),
          key: beatKey(b, run.god),
        }));
      return { list };
    }
    if (cmd === 'recap') {
      const o = run.outcome;
      if (!o) return { ok: false };
      return {
        ok: true,
        line: recapLineFor(this.ai, o, run.god.run),
        key: recapKey(o, run.god.run),
        overlay: this.ai.peekOverlay(recapKey(o, run.god.run)),
      };
    }
    if (cmd === 'legends') {
      const list = (this.mgr.data.legends ?? []).map((l) => ({
        id: l.id,
        epitaph: l.epitaph,
        voice: legendVoiceFor(this.ai, l),
        overlay: this.ai.peekOverlay(legendKey(l)),
      }));
      return { list };
    }
    if (cmd === 'situation') {
      const s = run.situations[0];
      if (!s) return { ok: false };
      return {
        ok: true,
        id: s.id,
        headline: s.headline,
        voice: situationVoiceFor(this.ai, s, run.god),
        overlay: this.ai.peekOverlay(situationKey(s, run.god)),
      };
    }
    if (cmd === 'crisis') {
      const c = run.god.crisis;
      if (!c) return { ok: false };
      return {
        ok: true,
        title: c.title,
        description: c.description,
        bodyId: c.bodyId,
        voice: crisisVoiceFor(this.ai, run.god),
      };
    }
    if (cmd === 'aftermath') {
      const a = run.god.lastAftermath;
      if (!a) return { ok: false };
      return {
        ok: true,
        intention: a.intention,
        links: a.links.map((l) => ({
          label: l.label,
          text: l.text,
          voiced: aftermathLinkFor(this.ai, run.god.run, a.cycle, l.label, l.text),
        })),
      };
    }
    if (cmd === 'endSubtitle') {
      const el = document.querySelector('#god-end-screen h2');
      return { text: el?.textContent ?? '', visible: this.mode === 'godend' };
    }
    if (cmd === 'openFeed') {
      if (this.mode === 'god') {
        if (!this.ui.god.feed.isOpen()) this.ui.god.feed.toggle();
        this.ui.god.refresh();
      }
      return { open: this.ui.god.feed.isOpen() };
    }
    return { error: 'unknown ' + cmd };
  }

  /** Pit-run story AI presentation — same contract as __godAi. */
  __storyAi(cmd: string, arg?: string): Record<string, unknown> {
    if (cmd === 'snapshot') {
      const n = this.mgr.living()[0] ?? this.mgr.roster[0];
      if (!n) return { ok: false };
      return {
        ok: true,
        id: n.id,
        rank: n.rank,
        alive: n.alive,
        power: n.power,
        title: n.title,
        eventVersion: n.ai?.eventVersion ?? 0,
      };
    }
    if (cmd === 'recapBeat') {
      const beats = this.lastReport?.recap ?? [];
      const b = beats[0];
      if (!b) return { ok: false };
      return {
        ok: true,
        line: recapBeatLineFor(this.ai, b),
        authored: b.line,
        overlay: this.ai.peekOverlay(recapBeatKey(b)),
      };
    }
    if (cmd === 'scope') {
      return { scope: this.ai.generationScope, queued: this.ai.queue.queuedCount, active: this.ai.queue.activeCount };
    }
    if (cmd === 'timeline') {
      const items = buildTimeline(this.mgr.data).filter((i) => i.important || i.witnessed).slice(-8);
      const item = items[items.length - 1];
      if (!item) return { ok: false };
      observeTimeline(this.ai, this.mgr, items);
      return {
        ok: true,
        headline: item.headline,
        detail: timelineDetailFor(this.ai, item),
        authored: item.detail,
      };
    }
    if (cmd === 'arc') {
      const model = buildStoryModel(this.mgr.data);
      const arc = model.arcs[0];
      if (!arc) return { ok: false };
      observeArcs(this.ai, this.mgr, model.arcs.slice(0, 5));
      const voice = arcVoiceFor(this.ai, arc);
      return { ok: true, state: voice.state, next: voice.next, authoredState: arc.state };
    }
    if (cmd === 'journey') {
      const n = this.mgr.byId(arg ?? '') ?? this.mgr.living()[0];
      if (!n || !n.memory.length) return { ok: false };
      const beats = n.memory.slice(-4).map((m) => {
        const sub = m.subject ? this.mgr.byId(m.subject) : null;
        return `${m.type}${sub ? ' ' + sub.name : ''}`;
      });
      observeJourney(this.ai, n, beats, { limit: 4 });
      return {
        ok: true,
        lines: beats.map((b, i) => journeyLineFor(this.ai, n, b, i)),
        authored: beats,
      };
    }
    if (cmd === 'dieNow') {
      this.player.stats.hp = 0;
      this.player.combat.die();
      if (this.mode === 'playing') this.onPlayerKilled(null);
      this.deathTimer = 0;
      if (this.mode === 'dying') {
        this.mode = 'report';
        this.runDeathSimulation();
      }
      return { ok: true, mode: this.mode, reportVisible: this.ui.report.visible };
    }
    return { error: 'unknown ' + cmd };
  }

  /** Everything the save holds, so a test can assert no key is in it. */
  __rawSave(): string {
    return localStorage.getItem('shdowpit.world.v1') ?? '';
  }

  __storySelfTest(): { passed: number; failed: number; log: string } {
    const r = runStorySelfTest();
    return { passed: r.passed, failed: r.failed, log: formatStorySelfTest(r) };
  }

  __wiringSelfTest(): {
    passed: number;
    failed: number;
    knownGaps: number;
    regressionPassed: number;
    regressionFailed: number;
    log: string;
  } {
    const r = runWiringSelfTest({
      comicServiceReady: !!this.comic,
      onGodEndIsStub: false,
      overlayGateWired: true,
      comicPlayerDeadWired: true,
      runLootWired: true,
      nemesisEventsWired: true,
      telemetryOptInWired: true,
      abilityManagerRemoved: true,
    });
    const wired = r.results.filter((x) => x.category === 'wired');
    return {
      passed: r.passed,
      failed: r.failed,
      knownGaps: r.knownGaps,
      regressionPassed: wired.filter((x) => x.ok).length,
      regressionFailed: wired.filter((x) => !x.ok).length,
      log: formatWiringSelfTest(r),
    };
  }

  __storyAction(cmd: string): string {
    const id = this.ui.debug.selectedId;
    const n = this.mgr.byId(id);
    switch (cmd) {
      case 'openWeb':
        if (this.mode === 'playing') this.openHierarchy();
        this.ui.hierarchy.setTab('web');
        return 'web';
      case 'openTimeline':
        if (this.mode === 'playing') this.openHierarchy();
        this.ui.hierarchy.setTab('timeline');
        return 'timeline';
      case 'openThreads':
        if (this.mode === 'playing') this.openHierarchy();
        this.ui.hierarchy.setTab('threads');
        return 'threads';
      case 'focus':
        if (n) {
          if (this.mode === 'playing') this.openHierarchy();
          this.ui.hierarchy.focusCharacter(n.id);
        }
        return id;
      case 'steal':
        if (!n) return 'no target';
        n.stolen.push({ name: 'Ashfang', kind: 'weapon', weaponId: 'ashfang' });
        if (!this.mgr.data.playerMeta.lostWeapons.includes('ashfang')) {
          this.mgr.data.playerMeta.lostWeapons.push('ashfang');
        }
        this.mgr.log(
          makeEvent(this.mgr.turn, this.mgr.age, 'weapon_theft', `${fullName(n)} took Ashfang.`, [n.id], true, 'gold', {
            payload: { itemName: 'Ashfang', weaponId: 'ashfang' },
            known: true,
            witnessed: true,
          })
        );
        this.mgr.persist();
        return 'stolen';
      case 'territory':
        if (!n) return 'no target';
        this.mgr.data.territories[this.world.currentArea.id] = n.id;
        n.territory = this.world.currentArea.id;
        this.mgr.log(
          makeEvent(
            this.mgr.turn,
            this.mgr.age,
            'territory',
            `${fullName(n)} seized ${this.world.currentArea.name}.`,
            [n.id],
            true,
            'gold',
            { payload: { areaId: this.world.currentArea.id }, known: true }
          )
        );
        this.mgr.persist();
        return n.territory;
      case 'recap':
        return inspectRecap(this.mgr.data);
      case 'inspect': {
        const model = buildStoryModel(this.mgr.data, undefined, true);
        const edge = model.edges[0];
        const arc = model.arcs[0];
        return [
          inspectNode(this.mgr.data, id || 'player'),
          edge ? inspectEdge(this.mgr.data, edge.id) : '',
          arc ? inspectArc(this.mgr.data, arc.id) : '',
        ].join('\n---\n');
      }
      case 'selftest':
        return formatStorySelfTest(runStorySelfTest());
      case 'stress': {
        const t0 = performance.now();
        for (let i = 0; i < 100; i++) simulateTurn(this.mgr);
        const model = buildStoryModel(this.mgr.data);
        return `100 turns in ${(performance.now() - t0).toFixed(0)}ms · nodes ${model.visibleNodes.length} · events ${this.mgr.data.eventLog.length}`;
      }
      case 'clearLayout':
        this.mgr.data.storyView = { panX: 0, panY: 0, zoom: 1 };
        this.mgr.persist();
        return 'cleared';
      default:
        return 'unknown';
    }
  }

  private progressAction(cmd: string, arg?: string): string {
    const meta = this.mgr.data.playerMeta;
    ensureStarterGear(meta);
    const p = meta.progress;
    const give = (defId: string) => {
      const it = mint(p, defId);
      p.inventory.push(it);
      if (it.kind === 'weapon' || it.slot === 'chest' || it.kind === 'relic' || it.kind === 'trophy') equipItem(meta, it.id);
      this.applyPlayerBuild();
      this.mgr.persist();
      return `${it.name} (${it.id})`;
    };
    const unlockChain = (ids: string[]) => {
      grantCinders(meta, 40);
      for (const id of ids) unlockNode(meta, id);
    };
    switch (cmd) {
      case 'dump': {
        const w = p.loadout.weapon;
        const stolen = this.mgr.living().filter((n) => n.stolen.length).map((n) => `${n.name}:${n.stolen.map((s) => s.name).join(',')}`);
        return [
          `cinders ${p.cinders}`,
          `nodes ${p.skillNodes.join(',') || '—'}`,
          `weapon ${w ?? '—'} ${meta.equipped}`,
          `pack ${p.inventory.length}`,
          `stolen ${stolen.join(' | ') || '—'}`,
          `powers ${this.player.stats.powers.ids().join(',')}`,
        ].join('\n');
      }
      case 'hammer':
        return give('pit_hammer');
      case 'spear':
        return give('ash_spear');
      case 'sunspear':
        return give('sunspear');
      case 'randWeapon':
        return give(['duelist_blade', 'breaker_maul', 'long_needle', 'cinder_sword', 'toxic_spear'][Math.floor(Math.random() * 5)]);
      case 'randArmor':
        return give(['light_chest', 'heavy_chest', 'toxic_chest', 'toxic_helm', 'hunter_legs'][Math.floor(Math.random() * 5)]);
      case 'anvil':
        return give('pit_anvil');
      case 'lens':
        return give('toxic_lens');
      case 'cinders':
        grantCinders(meta, 20);
        this.mgr.persist();
        return String(p.cinders);
      case 'respec':
        respecTree(meta);
        this.mgr.persist();
        return 'tree cleared';
      case 'mastery':
        p.mastery = { sword: 3, hammer: 3, spear: 3 };
        this.mgr.persist();
        return 'mastery 3';
      case 'buildA':
        unlockChain(['dash_strike', 'heavy_breaker', 'riposte']);
        give('pit_hammer');
        give('heavy_chest');
        give('pit_anvil');
        this.applyPlayerBuild();
        return 'BUILD A — hammer / heavy / breaker / riposte / anvil';
      case 'buildB':
        unlockChain(['crippling_bolt', 'piercing_shot', 'multishot']);
        give('ash_spear');
        give('light_chest');
        give('toxic_lens');
        this.applyPlayerBuild();
        return 'BUILD B — spear / light / cripple / multishot / toxic lens';
      case 'buildC':
        unlockChain(['dash_strike', 'heavy_breaker', 'riposte', 'combo_finisher', 'execution_flow']);
        give('iron_sword');
        give('light_chest');
        this.player.stats.addPower('execution_surge');
        this.applyPlayerBuild();
        return 'BUILD C — sword / riposte / dash / execution surge';
      case 'vark': {
        let n = this.mgr.living().find((x) => x.name.toUpperCase() === 'VARK');
        if (!n) {
          n = this.mgr.recruit('captain', true);
          n.name = 'Vark';
          n.title = 'THE THIEF';
        }
        n.territory = this.world.currentArea.id;
        n.alive = true;
        n.diedOnTurn = null;
        if (this.mode === 'playing') this.world.spawnNamed(n, this.player, true);
        this.mgr.persist();
        return n.id;
      }
      case 'forceSteal': {
        const e = this.world.enemies.find((x) => x.alive && x.named);
        const n = e?.nemesis ?? this.mgr.living().find((x) => x.name.toUpperCase() === 'VARK') ?? this.mgr.living()[0];
        if (!n) return 'no named enemy';
        const stolen = this.world.forceStealFrom(n);
        this.applyPlayerBuild();
        this.mgr.persist();
        return stolen ? `${n.name} carries ${stolen.name} (${stolen.weaponId})` : 'nothing to steal';
      }
      case 'trophy': {
        const e = this.world.enemies.find((x) => x.named);
        const n = e?.nemesis ?? this.mgr.living()[0];
        if (!n) return 'no nemesis';
        const it = mint(p, 'vark_mask');
        it.history.push({ type: 'trophy', nemesisId: n.id, nemesisName: n.name, turn: this.mgr.turn });
        p.inventory.push(it);
        this.mgr.persist();
        return it.name;
      }
      case 'runLoot': {
        this.world.run.runLoot.push('run_posture', 'run_proj', 'run_toxic_shot');
        this.applyPlayerBuild();
        return this.world.run.runLoot.join(',');
      }
      case 'procs':
        return this.combat.effects.dump();
      case 'effects':
        return [
          ...this.player.stats.powers.list().map((x) => `${x.def.name}${x.count > 1 ? ' x' + x.count : ''}`),
          `armorIncoming ${this.player.stats.armorIncomingMul}`,
          `weapon ${this.player.stats.weaponId}`,
        ].join('\n');
      default:
        if (cmd.startsWith('unlock:')) {
          grantCinders(meta, 10);
          const id = cmd.slice(7);
          const r = unlockNode(meta, id);
          if (SKILL_NODE_MAP.get(id) && this.world.runActive) this.applyPlayerBuild();
          this.mgr.persist();
          return r;
        }
        void arg;
        return 'unknown';
    }
  }

  __grantPower(id: PowerId): void {
    this.player.stats.addPower(id);
    this.refreshPowerChips();
  }

  __sim(cmd: string, arg?: string): Record<string, unknown> {
    const run = this.world.run;
    switch (cmd) {
      case 'heat+':
        addHeat(run, 20);
        break;
      case 'heatmax':
        addHeat(run, 100);
        break;
      case 'setHeat':
        run.heat = Math.max(0, Number(arg) || 0);
        break;
      case 'remnants':
        run.remnants = Math.min(6, run.remnants + 3);
        break;
      case 'extract':
        run.extraction.unlocked = true;
        this.beginExtraction(this.world.extractSites[0]?.id ?? 'ex');
        break;
      case 'vendetta':
        this.maybeOfferVendetta();
        if (run.vendetta) run.vendetta.committed = true;
        break;
      case 'vendettaDone':
        if (run.vendetta) {
          run.vendetta.complete = true;
          run.vendetta.progress = run.vendetta.goal;
        }
        break;
      case 'tech': {
        const wid = this.player.stats.weaponId;
        const list = this.mgr.data.playerMeta.techniques[wid] ?? [];
        if (!list.includes('sword_riposte_drive')) list.push('sword_riposte_drive');
        this.mgr.data.playerMeta.techniques[wid] = list;
        this.player.stats.techniques = list;
        break;
      }
      case 'liberate':
        this.world.liberateCurrent('heal_site');
        break;
      case 'fakedeath':
        run.blockFakeDeath = true;
        break;
      case 'verticalSlice':
        return applyVerticalSlice({ mgr: this.mgr, world: this.world, player: this.player, rng: this.rng, arena: this.arena });
      case 'procStress': {
        const channels = ['primary', 'secondary', 'dot', 'reflect', 'eve', 'area', 'afterimage'] as const;
        const kinds = ['cooldownRefund', 'remnant', 'killCredit', 'surge', 'reaction'] as const;
        let blocked = 0;
        let allowed = 0;
        for (const ch of channels) {
          for (const k of kinds) {
            if (canProc({ channel: ch } as DamageInfo, k)) allowed++;
            else blocked++;
          }
        }
        return { blocked, allowed, secondaryNoCd: !canProc({ channel: 'secondary' } as DamageInfo, 'cooldownRefund') };
      }
      case 'tutorialReplay':
        this.tutorial.replay(this.mgr.data.settings, (arg as TutorialId) || undefined);
        break;
      case 'surrender': {
        const e = this.world.enemies.find((x) => x.alive && x.named);
        if (e) this.maybeOpenOutcome(e, true);
        break;
      }
      case 'reward': {
        const e = this.world.enemies.find((x) => x.named);
        if (e) this.offerNemesisReward(e.nemesis, true);
        break;
      }
      case 'comicSlice':
        return this.__comicSlice(arg);
      case 'comicStatus':
        return this.comic?.status() ?? { ok: false };
      case 'comicQuality': {
        const q = (arg as ComicQualityProfileId) || 'potato';
        this.comic?.setQuality(q);
        return { quality: this.comic?.quality ?? q };
      }
      default:
        break;
    }
    return {
      heat: run.heat,
      remnants: run.remnants,
      vendetta: run.vendetta,
      extraction: run.extraction,
      lastProc: run.lastProcNote,
      saveVersion: this.mgr.data.saveVersion,
      aiMode: this.mgr.data.settings.ai.mode,
      channel: this.combat.lastKillChannel,
      playerCredit: this.combat.lastKillPlayerCredit,
    };
  }

  /**
   * Test hook for THE LONG GAME. The god layer is almost entirely invisible
   * from the DOM — a hundred cycles of simulation leave no pixels behind — so
   * the harness drives it through here and asserts on the returned state.
   */
  __god(cmd: string, arg?: string, arg2?: string, arg3?: string): Record<string, unknown> {
    const run = this.godRun;
    switch (cmd) {
      case 'start': {
        this.openLongGame();
        return this.__god('state');
      }
      case 'state': {
        if (!this.godRun) return { active: false, mode: this.mode };
        const g = this.godRun.god;
        return {
          active: true,
          mode: this.mode,
          run: g.run,
          cycle: g.cycle,
          act: g.act,
          phase: g.phase,
          influence: g.influence,
          influenceMax: g.influenceMax,
          chaos: g.chaos,
          chaosPeak: g.chaosPeak,
          living: this.mgr.living().length,
          dead: this.mgr.dead().length,
          factions: this.godRun.god.factions.filter((f) => !f.destroyedCycle).length,
          conditions: g.conditions.length,
          godConditions: g.conditions.filter((c) => c.source === 'god').length,
          crisis: g.crisis ? { kind: g.crisis.kind, title: g.crisis.title, body: this.mgr.byId(g.crisis.bodyId)?.name ?? '', resolved: g.crisis.resolved, power: Math.round(g.crisis.power) } : null,
          ended: g.ended,
          outcome: g.outcome,
          feed: g.feed.length,
          situations: g.situations.length,
          interventions: g.interventionsUsed,
          descents: g.descents,
          championId: g.championId,
          legends: (this.mgr.data.legends ?? []).length,
          unlocks: this.mgr.data.godUnlocks ?? [],
          openingDone: g.openingDone,
          boardUnlocked: g.boardUnlocked,
          focusSituationId: g.focusSituationId,
          towerScenario: !!g.scenarioFlags?.towerCommander,
          hasAftermath: !!g.lastAftermath,
          aftermathIntention: g.lastAftermath?.intention ?? null,
          hasDescentReport: !!g.lastDescentReport,
          guideStep: this.godGuide.step,
          teachShowing: this.ui.god.teach.showing,
        };
      }
      case 'advance': {
        if (!run) return { ok: false };
        const n = Math.max(1, parseInt(arg ?? '1', 10) || 1);
        const t0 = performance.now();
        if (this.mode === 'god') this.godAdvance(n);
        else run.advanceMany(n);
        return { ok: true, ms: Math.round(performance.now() - t0), ...this.__god('state') };
      }
      case 'situations': {
        if (!run) return { list: [] };
        return {
          list: run.situations.map((s) => ({
            id: s.id,
            kind: s.kind,
            headline: s.headline,
            detail: s.detail,
            actors: s.actors,
            urgency: Math.round(s.urgency * 100) / 100,
            suggest: s.suggest,
          })),
        };
      }
      case 'interventions': {
        if (!run) return { list: [] };
        return {
          list: run.interventions().map((i) => ({
            id: i.def.id,
            name: i.def.name,
            cost: i.def.cost,
            chaos: i.def.chaos,
            targeting: i.def.targeting,
            affordable: i.affordable,
          })),
        };
      }
      case 'intervene': {
        if (!run) return { ok: false, reason: 'no run' };
        const res = this.godIntervene(arg ?? '', arg2 ?? null, arg3 ?? null, null);
        return { ok: res.ok, reason: res.reason ?? '', headline: res.effect?.headline ?? '', ...this.__god('state') };
      }
      case 'interveneArea': {
        if (!run) return { ok: false, reason: 'no run' };
        const res = this.godIntervene(arg ?? '', null, null, arg2 ?? null);
        return { ok: res.ok, reason: res.reason ?? '', headline: res.effect?.headline ?? '' };
      }
      case 'feed': {
        if (!run) return { list: [] };
        const floor = arg ?? 'notable';
        return {
          list: run.god.feed
            .filter((b) => BEAT_RANK[b.priority] >= BEAT_RANK[floor as keyof typeof BEAT_RANK])
            .slice(-60)
            .map((b) => ({ cycle: b.cycle, priority: b.priority, kind: b.kind, headline: b.headline, detail: b.detail, actors: b.actors })),
        };
      }
      case 'decisions': {
        if (!run) return { list: [] };
        return {
          list: run.god.decisions.slice(0, 12).map((d) => ({
            actor: d.actorName,
            chosen: d.chosen?.actionId ?? '',
            total: d.chosen?.total ?? 0,
            parts: d.chosen?.parts ?? null,
            considered: d.considered.map((c) => ({ action: c.actionId, target: c.targetName, total: c.total })),
          })),
        };
      }
      case 'roster': {
        return {
          list: this.mgr.roster.map((n) => {
            const s = simOf(n);
            return {
              id: n.id,
              name: n.name,
              title: n.title,
              rank: n.rank,
              alive: n.alive,
              power: n.power,
              territory: n.territory,
              fear: Math.round(s.fear),
              confidence: Math.round(s.confidence),
              ambition: Math.round(s.ambition),
              loyalty: Math.round(s.loyalty),
              injury: Math.round(s.injury),
              goal: s.goal,
              goalTarget: s.goalTargetId,
              revenge: s.revengeTargets.slice(),
              escapedFrom: s.escapedFrom.slice(),
              kills: s.kills.length,
              wins: s.wins,
              losses: s.losses,
              deeds: s.deeds.map((d) => d.text),
              heretic: s.heretic,
              standing: n.playerRelationship,
              faction: s.factionId,
              memoryTypes: n.memory.map((m) => m.type),
            };
          }),
        };
      }
      case 'book': {
        return { list: (this.mgr.data.legends ?? []).map((l) => ({ ...l })) };
      }
      case 'forceCrisis':
        return { note: this.forceGodCrisis(), ...this.__god('state') };
      case 'abandon': {
        if (!run) return { ok: false };
        this.abandonGodRun();
        return { ok: true, outcome: run.outcome };
      }
      case 'next': {
        // Dismiss the end screen and start the following run in a new world.
        this.ui.godEnd.hide();
        this.godRun = null;
        this.mgr.data.god = null;
        this.mgr.reseedWorld(randomSeed());
        this.rebuildArena();
        this.openLongGame();
        return this.__god('state');
      }
      case 'descend': {
        if (!run) return { ok: false };
        const res = this.godIntervene('descend', arg ?? null, null, null);
        return { ok: res.ok, reason: res.reason ?? '', mode: this.mode };
      }
      case 'forceReturn': {
        if (!this.descent || !this.godRun) return { ok: false, reason: 'no descent' };
        this.world.endRun();
        this.afterRunEnds();
        return { ok: true, mode: this.mode, ...this.__god('state') };
      }
      case 'clearBoards': {
        this.godRun?.clearAftermath();
        this.godRun?.clearDescentReport();
        this.ui.god.dismissPauseBeat();
        this.godClock?.dismissBeat();
        if (this.mode === 'god') this.ui.god.refresh();
        return { ok: true, ...this.__god('state') };
      }
      case 'legendsScreen': {
        this.openLegends(this.mode);
        return { mode: this.mode };
      }
      case 'inspect': {
        if (!run) return { ok: false };
        const n = this.mgr.byId(arg ?? '') ?? this.mgr.living()[0];
        if (!n) return { ok: false };
        this.ui.god.inspect(n.id);
        return this.__godAi('inspect', n.id);
      }
      case 'expandFeed': {
        if (!run) return { ok: false };
        const last = [...run.god.feed].reverse().find((b) => BEAT_RANK[b.priority] >= BEAT_RANK.major);
        if (last) this.ui.god.expandBeat(last.id);
        return { ok: !!last, id: last?.id ?? '' };
      }
      case 'snapshot':
        return this.__godAi('snapshot');
      case 'ai':
        return this.__godAi(arg ?? 'scope', arg2);
      default:
        return { error: 'unknown command ' + cmd };
    }
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
    this.damageNumbers.clear();
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
  recap?: import('../story/StoryTypes').RecapBeat[];
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

function clockLabel(state: GodClockState, sec: number, tempo: number): string {
  const t = Math.ceil(sec);
  switch (state) {
    case 'running':
      return `NEXT CYCLE · ${t}S`;
    case 'paused':
      return 'TIME HELD';
    case 'intervening':
      return 'ADVANCE WHEN READY';
    case 'spectating':
      return 'WATCHING';
    case 'modal':
      return 'CONSEQUENCE';
    default:
      return `TEMPO ×${tempo.toFixed(2)}`;
  }
}

function interventionSfx(id: string): string {
  switch (id) {
    case 'bless':
    case 'gift':
    case 'raise':
      return 'god_bless';
    case 'curse':
    case 'sabotage':
    case 'calamity':
      return 'god_curse';
    case 'whisper':
      return 'god_whisper';
    default:
      return 'god_mark';
  }
}

function interventionSfxVolume(id: string): number {
  return id === 'whisper' ? 0.3 : id === 'calamity' ? 0.52 : 0.42;
}

function interventionFlashTone(tone?: string): 'neutral' | 'hot' | 'gold' {
  if (tone === 'bad') return 'hot';
  if (tone === 'good' || tone === 'gold') return 'gold';
  return 'neutral';
}

function interventionJuiceTone(tone?: string): 'good' | 'bad' | 'gold' | 'neutral' {
  if (tone === 'good') return 'good';
  if (tone === 'bad') return 'bad';
  if (tone === 'gold') return 'gold';
  return 'neutral';
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

/** Two decimal places, for the debug readouts. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
