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
  /** 1 = body solid, 0 = fully dissolved by the close-camera fade */
  playerFade: number;

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

export interface KitCounters {
  surgeBySource: Record<string, number>;
  skillUses: Record<string, number>;
  skillHits: Record<string, number>;
  skillDamage: Record<string, number>;
  skillPosture: Record<string, number>;
  failReasons: Record<string, number>;
  ttk: Array<{ rank: string; seconds: number; named: boolean }>;
  idleCombatSeconds: number;
  ultimateUses: number;
}

export class Telemetry {
  enabled = false;
  private frames: FrameSample[] = [];
  private enemyFrames: EnemySample[] = [];
  private hits: HitRecord[] = [];
  private deaths: DeathRecord[] = [];
  private t0 = 0;
  private clock = 0;

  /** Always-on cheap combat kit counters (skills, Surge, TTK). */
  kit: KitCounters = emptyKit();
  private firstHitAt = new Map<number, number>();
  private lastPlayerVerb = 0;
  verbIdle = 0;

  start(): void {
    this.frames = [];
    this.enemyFrames = [];
    this.hits = [];
    this.deaths = [];
    this.clock = 0;
    this.t0 = performance.now();
    this.enabled = true;
    this.kit = emptyKit();
    this.firstHitAt.clear();
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
    kit: KitCounters;
    run?: Record<string, unknown>;
  } {
    return {
      frames: this.frames,
      enemies: this.enemyFrames,
      hits: this.hits,
      deaths: this.deaths,
      wallSeconds: (performance.now() - this.t0) / 1000,
      kit: this.kit,
    };
  }

  noteSurge(source: string, amount: number): void {
    if (amount <= 0) return;
    this.kit.surgeBySource[source] = (this.kit.surgeBySource[source] ?? 0) + amount;
  }

  noteSkillUse(id: string): void {
    this.kit.skillUses[id] = (this.kit.skillUses[id] ?? 0) + 1;
    if (id === 'pit_eruption') this.kit.ultimateUses++;
  }

  noteSkillHit(id: string, damage: number, posture: number): void {
    this.kit.skillHits[id] = (this.kit.skillHits[id] ?? 0) + 1;
    this.kit.skillDamage[id] = (this.kit.skillDamage[id] ?? 0) + damage;
    this.kit.skillPosture[id] = (this.kit.skillPosture[id] ?? 0) + posture;
  }

  noteFail(reason: string): void {
    this.kit.failReasons[reason] = (this.kit.failReasons[reason] ?? 0) + 1;
  }

  notePlayerVerb(): void {
    const gap = this.clock - this.lastPlayerVerb;
    if (this.lastPlayerVerb > 0 && gap > 0.4) this.kit.idleCombatSeconds += gap;
    this.lastPlayerVerb = this.clock;
  }

  noteEnemyHurt(uid: number): void {
    if (!this.firstHitAt.has(uid)) this.firstHitAt.set(uid, this.clock);
  }

  noteEnemyDown(uid: number, rank: string, named: boolean): void {
    const t0 = this.firstHitAt.get(uid);
    if (t0 !== undefined) {
      this.kit.ttk.push({ rank, named, seconds: Math.round((this.clock - t0) * 100) / 100 });
      this.firstHitAt.delete(uid);
    }
  }

  get deathLog(): DeathRecord[] {
    return this.deaths;
  }
}

function emptyKit(): KitCounters {
  return {
    surgeBySource: {},
    skillUses: {},
    skillHits: {},
    skillDamage: {},
    skillPosture: {},
    failReasons: {},
    ttk: [],
    idleCombatSeconds: 0,
    ultimateUses: 0,
  };
}

/** Presentation-free spawn lean derived from how the player is actually fighting. */
export interface EncounterTuning {
  gruntLevelDelta: number;
  gruntPopDelta: number;
  /** Same order as ARCHETYPES: fighter, heavy, archer, duelist, commander */
  archetypeWeights: number[];
  counterNote?: string;
}

const BASE_ARCHETYPE_WEIGHTS = [0.4, 0.2, 0.16, 0.14, 0.1];

/** Skill id → grunt archetype the pit should send to counter overuse. */
const SKILL_COUNTER_ARCHETYPE: Record<string, number> = {
  shadow_step: 2,
  hunters_brand: 2,
  shadow_snare: 2,
  ground_rupture: 3,
  pit_eruption: 3,
  living_weapon: 3,
  void_grasp: 1,
  spectral_guard: 1,
  last_defiance: 4,
};

const ARCHETYPE_NAMES = ['fighter', 'heavy', 'archer', 'duelist', 'commander'];

function topSkill(kit: KitCounters): string | null {
  let best: string | null = null;
  let score = 0;
  for (const [id, uses] of Object.entries(kit.skillUses)) {
    const hits = kit.skillHits[id] ?? 0;
    const s = uses * 2 + hits;
    if (s > score) {
      score = s;
      best = id;
    }
  }
  return score >= 3 ? best : null;
}

/** Kit counters → subtle spawn difficulty and archetype counter-pressure. */
export function encounterTuningFromKit(kit: KitCounters): EncounterTuning {
  const weights = BASE_ARCHETYPE_WEIGHTS.slice();
  let gruntLevelDelta = 0;
  let gruntPopDelta = 0;
  let counterNote: string | undefined;

  const namedTtk = kit.ttk.filter((t) => t.named).slice(-4);
  if (namedTtk.length >= 2) {
    const avg = namedTtk.reduce((s, t) => s + t.seconds, 0) / namedTtk.length;
    if (avg < 7) {
      gruntLevelDelta += 1;
      gruntPopDelta += 1;
      counterNote = 'FAST KILLS — THE PIT SENDS MORE';
    } else if (avg > 22) {
      gruntLevelDelta -= 1;
      counterNote = 'LONG FIGHTS — PRESSURE EASES';
    }
  }

  const fails = Object.values(kit.failReasons).reduce((a, b) => a + b, 0);
  if (fails >= 6 && kit.idleCombatSeconds > 12) {
    gruntLevelDelta -= 1;
    gruntPopDelta -= 1;
    counterNote = counterNote ?? 'STALLED COMBAT — FEWER GRUNTS';
  }

  const skill = topSkill(kit);
  if (skill) {
    const idx = SKILL_COUNTER_ARCHETYPE[skill];
    if (idx !== undefined) {
      weights[idx] *= 1.55;
      counterNote = counterNote ?? `COUNTERS YOUR ${skill.replace(/_/g, ' ').toUpperCase()}`;
    }
  }

  if (kit.ultimateUses >= 2) {
    weights[1] *= 1.25;
    weights[4] *= 1.2;
  }

  return { gruntLevelDelta, gruntPopDelta, archetypeWeights: weights, counterNote };
}

export { ARCHETYPE_NAMES as TUNING_ARCHETYPE_ORDER };
