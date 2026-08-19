/**
 * Combat telemetry and QA instrumentation.
 *
 * Two jobs:
 *
 *  1. QA. Animation snapping, foot sliding, clipping and unreadable crowds are
 *     all things you can *measure*, and measuring beats squinting at a replay.
 *     When recording is on, every frame appends one small fixed-shape sample to
 *     a ring buffer; the analysis lives in `tools/qa.mjs`, not here.
 *
 *  2. Death analysis. Every blow that lands on the player is recorded with the
 *     full context needed to decide whether it was fair: who threw it, what it
 *     was, whether it could have been parried or dodged, and what the player
 *     was doing at the time.
 *
 * Recording is OFF by default and costs nothing when off — the hot path is a
 * single boolean test. Never leave it on in a shipped build.
 */

export interface FrameSample {
  /** seconds since recording started */
  t: number;

  /* player */
  action: string;
  phase: string;
  /** horizontal speed, m/s */
  speed: number;
  /** world position */
  x: number;
  y: number;
  z: number;
  /** logical facing, radians */
  facing: number;
  /** rig yaw as actually rendered — diverges from `facing` when interpolated */
  rigYaw: number;
  /** rig sample points, for snap detection */
  armR: number;
  bodyX: number;
  bodyY: number;
  /** locomotion cycle phase, for foot-slide detection */
  walkPhase: number;

  /* camera */
  camDist: number;
  camYaw: number;
  camPitch: number;
  camY: number;
  /** distance from camera to player — reveals wall push-in */
  camToPlayer: number;

  /* world */
  enemiesAlive: number;
  /** enemies in windup or active — the crowd-readability number */
  attackers: number;
  /** enemies in windup only */
  winding: number;
  nearestDist: number;
  /** deepest overlap into any enemy's capsule, metres */
  overlap: number;
  /** true if the nearest enemy has line of sight to the player */
  nearestLos: boolean;
  fps: number;
}

export interface EnemySample {
  t: number;
  uid: number;
  state: string;
  combatState: string;
  facing: number;
  x: number;
  z: number;
  speed: number;
  distToPlayer: number;
  /** id of the attack being performed, '' when idle */
  attackId: string;
  /** its telegraph intent */
  intent: string;
  postureFrac: number;
}

export interface HitRecord {
  t: number;
  /** 'player' or the enemy uid */
  attacker: string;
  target: string;
  amount: number;
  source: string;
  /** centre-to-centre distance when the blow resolved */
  dist: number;
  /** the reach the hit was tested with */
  reach: number;
  parried: boolean;
  dodged: boolean;
  blocked: boolean;
  /** what the victim was doing */
  victimAction: string;
  unblockable: boolean;
}

export interface DeathRecord {
  t: number;
  killerName: string;
  killerUid: number;
  attackSource: string;
  damage: number;
  hpBefore: number;
  unblockable: boolean;
  parryable: boolean;
  ranged: boolean;
  playerAction: string;
  playerWasDodging: boolean;
  playerWasParrying: boolean;
  playerWasStaggered: boolean;
  distance: number;
}

const MAX_FRAMES = 7200;
const MAX_EVENTS = 900;

export class Telemetry {
  enabled = false;
  private frames: FrameSample[] = [];
  private enemyFrames: EnemySample[] = [];
  private hits: HitRecord[] = [];
  private deaths: DeathRecord[] = [];
  private t0 = 0;
  private clock = 0;

  start(): void {
    this.frames = [];
    this.enemyFrames = [];
    this.hits = [];
    this.deaths = [];
    this.clock = 0;
    this.t0 = performance.now();
    this.enabled = true;
  }

  stop(): void {
    this.enabled = false;
  }

  get now(): number {
    return this.clock;
  }

  advance(rdt: number): void {
    this.clock += rdt;
  }

  pushFrame(s: FrameSample): void {
    if (!this.enabled) return;
    this.frames.push(s);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  pushEnemy(s: EnemySample): void {
    if (!this.enabled) return;
    this.enemyFrames.push(s);
    if (this.enemyFrames.length > MAX_FRAMES * 3) this.enemyFrames.shift();
  }

  /** Always recorded, even with QA recording off — deaths are cheap and rare. */
  pushHit(h: Omit<HitRecord, 't'>): void {
    if (!this.enabled) return;
    this.hits.push({ ...h, t: this.clock });
    if (this.hits.length > MAX_EVENTS) this.hits.shift();
  }

  pushDeath(d: Omit<DeathRecord, 't'>): void {
    this.deaths.push({ ...d, t: this.clock });
    if (this.deaths.length > 60) this.deaths.shift();
    // Deaths are the one thing worth surfacing during development regardless
    // of whether a harness is attached.
    console.info(
      `[death] ${d.killerName || 'unknown'} — ${d.attackSource} for ${Math.round(d.damage)} ` +
        `(hp was ${Math.round(d.hpBefore)}) ` +
        `${d.unblockable ? 'UNBLOCKABLE ' : ''}${d.parryable ? 'parryable ' : ''}` +
        `player=${d.playerAction} dist=${d.distance.toFixed(1)}`
    );
  }

  dump(): {
    frames: FrameSample[];
    enemies: EnemySample[];
    hits: HitRecord[];
    deaths: DeathRecord[];
    wallSeconds: number;
  } {
    return {
      frames: this.frames,
      enemies: this.enemyFrames,
      hits: this.hits,
      deaths: this.deaths,
      wallSeconds: (performance.now() - this.t0) / 1000,
    };
  }

  get deathLog(): DeathRecord[] {
    return this.deaths;
  }
}
