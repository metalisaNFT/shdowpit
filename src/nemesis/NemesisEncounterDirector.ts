/**
 * Presentation-only director for named NPC meetings.
 *
 * It classifies an encounter from stored history, then plays a short beat
 * clock: audio, camera, pose, text, portrait, VFX. It never writes combat
 * stats, never steals loot, and never decides who attacks.
 */

import type { Enemy } from '../enemy/Enemy';
import type { Player } from '../player/Player';
import type { Nemesis } from './Nemesis';
import { classifyEncounter, isIntroKind, type ClassifyContext, type EncounterKind } from './EncounterKind';
import { beatsFor, isCalloutKind, isFocusKind, sequenceDuration, type BeatAction } from './EncounterBeats';
import {
  celebrateClip,
  encounterHeadline,
  encounterLine,
  factAllowsLine,
  introPoseFor,
  lastEventChip,
  lastWords,
  stingFor,
  type IntroPose,
} from './EncounterCopy';
import { rankName } from './NemesisManager';
import { accentColorFor } from './NemesisAppearance';

export interface EncounterSafety {
  playerHpFrac: number;
  playerStaggered: boolean;
  incomingActive: boolean;
  projectileClose: boolean;
}

export interface EncounterSnapshot {
  kind: EncounterKind;
  nemesisId: string;
  name: string;
  title: string;
  rank: string;
  line: string;
  headline: string;
  chip: string;
  duration: number;
  portrait: boolean;
  beats: BeatAction[];
  salt: number;
  shortened: boolean;
  memoryTypes: string[];
}

export interface IntroCardPayload {
  name: string;
  title: string;
  rank: string;
  line: string;
  chip: string;
  headline?: string;
  portraitSrc: string;
  accent: string;
  variant: 'intro' | 'return' | 'death' | 'escape';
  duration: number;
  stole?: string;
}

export interface EncounterDirectorDeps {
  presentCard(p: IntroCardPayload): void;
  revealCard(part: 'line' | 'portrait' | 'chip'): void;
  hideCard(): void;
  callout(text: string, tone?: 'neutral' | 'hot' | 'gold' | 'good'): void;
  playSfx(name: string, volume?: number): void;
  duckAudio(seconds: number): void;
  cameraEmphasis(x: number, y: number, z: number, amount: number): void;
  storyVfx(kind: EncounterKind, e: Enemy, accent: number): void;
  playPose(e: Enemy, pose: IntroPose): void;
  shake(amount: number): void;
  slowMo(seconds: number, scale: number): void;
  hitStop(seconds: number): void;
  clearSlowMo(): void;
  portraitFor(n: Nemesis): string;
  titleFor(n: Nemesis): string;
  tauntFor(n: Nemesis, salt: number): string;
  observeEncounter?(n: Nemesis, kind: EncounterKind, headline: string, chip: string): void;
  headlineFor?(n: Nemesis, kind: EncounterKind, fallback: string): string;
  contextualLineFor?(n: Nemesis, kind: EncounterKind, salt: number, fallback: string): string;
  lastWordsFor?(n: Nemesis, salt: number): string;
}

interface ActiveSeq {
  enemy: Enemy;
  kind: EncounterKind;
  salt: number;
  beats: ReturnType<typeof beatsFor>;
  cursor: number;
  t: number;
  duration: number;
  shortened: boolean;
  line: string;
  headline: string;
  chip: string;
  title: string;
  portraitSrc: string;
  accentCss: string;
  accentHex: number;
  cardShown: boolean;
  focusing: boolean;
}

interface QueuedIntro {
  enemy: Enemy;
  kind: EncounterKind;
  salt: number;
  ctx: ClassifyContext;
  /** seconds this intro has been waiting for a safe beat */
  waiting: number;
}

/**
 * A deferred intro may wait this long for calm. Past it the meeting plays in
 * its shortened form anyway: a named NPC who walks in with no presentation at
 * all is indistinguishable from a grunt with a nameplate, which is the one
 * thing the nemesis layer must never be.
 */
const QUEUE_DEADLINE = 3.5;

export class NemesisEncounterDirector {
  private active: ActiveSeq | null = null;
  private queued: QueuedIntro | null = null;
  last: EncounterSnapshot | null = null;
  private deps: EncounterDirectorDeps | null = null;

  bind(deps: EncounterDirectorDeps): void {
    this.deps = deps;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  get holdingUid(): number | null {
    return this.active?.enemy.uid ?? this.queued?.enemy.uid ?? null;
  }

  /** Named enemy the camera should look at this frame, if any. */
  get focusEnemy(): Enemy | null {
    const seq = this.active;
    if (!seq?.focusing || !seq.enemy.alive) return null;
    return seq.enemy;
  }

  reset(): void {
    if (this.active) this.active.enemy.introHold = false;
    if (this.queued) this.queued.enemy.introHold = false;
    this.deps?.clearSlowMo();
    this.active = null;
    this.queued = null;
    this.last = null;
  }

  /**
   * Classify and start (or queue) a named-NPC presentation.
   * `forced` skips classification — used by debug playEncounter.
   */
  begin(e: Enemy, salt: number, ctx: ClassifyContext = {}, forced?: EncounterKind): EncounterKind | null {
    if (!e.named || !this.deps) return null;
    const kind = forced ?? classifyEncounter(e.nemesis, ctx);

    if (isIntroKind(kind) && this.active && isIntroKind(this.active.kind)) {
      e.introHold = false;
      this.deps.callout(`${e.nemesis.name.toUpperCase()} HAS FOUND YOU`, 'hot');
      return kind;
    }

    if (isIntroKind(kind) && !this.isSafe(this.lastSafety) && e.entranceKind !== 'immediate') {
      if (this.queued) this.queued.enemy.introHold = false;
      e.introHold = true;
      this.queued = { enemy: e, kind, salt, ctx, waiting: 0 };
      return kind;
    }

    this.start(e, kind, salt, false);
    return kind;
  }

  playKind(e: Enemy, kind: EncounterKind, salt: number): void {
    if (!e.named || !this.deps) return;
    this.start(e, kind, salt, false);
  }

  private lastSafety: EncounterSafety = {
    playerHpFrac: 1,
    playerStaggered: false,
    incomingActive: false,
    projectileClose: false,
  };

  update(dt: number, safety: EncounterSafety, _player: Player): void {
    this.lastSafety = safety;
    if (this.queued) {
      this.queued.waiting += dt;
      if (!this.queued.enemy.alive) {
        // They died before the meeting could play; drop it rather than
        // presenting an arrival for a corpse.
        this.queued.enemy.introHold = false;
        this.queued = null;
      } else if (!this.active || this.active.t >= this.active.duration) {
        const q = this.queued;
        if (this.isSafe(safety) || q.waiting >= QUEUE_DEADLINE) {
          this.queued = null;
          this.start(q.enemy, q.kind, q.salt, true);
        }
      }
    }

    const seq = this.active;
    if (!seq) return;
    if (!seq.enemy.alive && seq.kind !== 'NEMESIS_DEFEATED' && seq.kind !== 'PLAYER_DEFEATED') {
      seq.enemy.introHold = false;
      this.deps?.hideCard();
      this.deps?.clearSlowMo();
      this.active = null;
      return;
    }
    seq.t += dt;
    while (seq.cursor < seq.beats.length && seq.t >= seq.beats[seq.cursor].t) {
      this.fire(seq, seq.beats[seq.cursor].action);
      seq.cursor++;
    }
    if (seq.t >= seq.duration) {
      seq.enemy.introHold = false;
      seq.focusing = false;
      this.deps?.clearSlowMo();
      this.active = null;
    }
  }

  /** Clear introHold on named enemies the director is no longer presenting. */
  watchIntroHolds(enemies: Enemy[]): void {
    const held = new Set<number>();
    if (this.active?.enemy.alive) held.add(this.active.enemy.uid);
    if (this.queued?.enemy.alive) held.add(this.queued.enemy.uid);
    for (const e of enemies) {
      if (e.named && e.introHold && !held.has(e.uid)) e.introHold = false;
    }
  }

  private isSafe(s: EncounterSafety): boolean {
    if (s.playerHpFrac < 0.35) return false;
    if (s.playerStaggered) return false;
    if (s.incomingActive) return false;
    if (s.projectileClose) return false;
    return true;
  }

  private start(e: Enemy, kind: EncounterKind, salt: number, shortened: boolean): void {
    const d = this.deps;
    if (!d) return;
    if (this.active && this.active.enemy !== e) {
      this.active.enemy.introHold = false;
      this.active = null;
    }
    const n = e.nemesis;
    const overlay = d.tauntFor(n, salt);
    const rawFallback = encounterLine(n, kind, salt, overlay);
    let line = d.contextualLineFor?.(n, kind, salt, rawFallback) ?? rawFallback;
    if (overlay && !factAllowsLine(n, overlay) && line === rawFallback) {
      line = encounterLine(n, kind, salt);
    } else if (line !== rawFallback && !factAllowsLine(n, line)) {
      line = encounterLine(n, kind, salt);
    }
    const title = d.titleFor(n);
    const rawHeadline = encounterHeadline(kind, n);
    const chip = lastEventChip(n);
    d.observeEncounter?.(n, kind, rawHeadline, chip);
    const headline = d.headlineFor?.(n, kind, rawHeadline) ?? rawHeadline;
    const portraitSrc = d.portraitFor(n);
    const beats = beatsFor(kind, shortened);
    const duration = sequenceDuration(kind, shortened);

    if (isIntroKind(kind) || kind === 'PLAYER_DEFEATED' || kind === 'NEMESIS_DEFEATED') {
      e.introHold = isIntroKind(kind);
    }

    this.active = {
      enemy: e,
      kind,
      salt,
      beats,
      cursor: 0,
      t: 0,
      duration,
      shortened,
      line,
      headline,
      chip,
      title,
      portraitSrc,
      accentCss: accentColorFor(n),
      accentHex: parseAccent(accentColorFor(n)),
      cardShown: false,
      focusing: false,
    };
    this.ensureCard(this.active);

    this.last = {
      kind,
      nemesisId: n.id,
      name: n.name,
      title,
      rank: rankName(n.rank),
      line,
      headline,
      chip,
      duration,
      portrait: Boolean(portraitSrc),
      beats: beats.map((b) => b.action),
      salt,
      shortened,
      memoryTypes: n.memory.slice(-8).map((m) => m.type),
    };
  }

  private fire(seq: ActiveSeq, action: BeatAction): void {
    const d = this.deps;
    if (!d) return;
    const e = seq.enemy;
    const n = e.nemesis;
    const pos = e.position;

    switch (action) {
      case 'audio_duck':
        d.duckAudio(0.55);
        break;
      case 'audio_sting':
        d.playSfx(stingFor(seq.kind), seq.kind === 'OVERLORD_ENCOUNTER' || seq.kind === 'RESURRECTION_RETURN' ? 1 : 0.9);
        break;
      case 'camera':
        d.cameraEmphasis(pos.x, 1.4, pos.z, seq.kind === 'OVERLORD_ENCOUNTER' || seq.kind === 'RESURRECTION_RETURN' ? 0.55 : 0.35);
        break;
      case 'focus': {
        if (seq.shortened || !isFocusKind(seq.kind)) break;
        seq.focusing = true;
        d.duckAudio(seq.kind === 'OVERLORD_ENCOUNTER' || seq.kind === 'RESURRECTION_RETURN' ? 1.1 : 0.85);
        const ceremonial =
          seq.kind !== 'AMBUSH' && seq.kind !== 'PLAYER_DEFEATED' && this.isSafe(this.lastSafety);
        if (ceremonial) {
          const heavy = seq.kind === 'OVERLORD_ENCOUNTER' || seq.kind === 'RESURRECTION_RETURN' || seq.kind === 'REVENGE_ENCOUNTER';
          d.hitStop(heavy ? 0.12 : 0.09);
          d.slowMo(heavy ? 0.85 : 0.65, heavy ? 0.22 : 0.28);
        }
        break;
      }
      case 'pose':
        if (seq.kind === 'RESURRECTION_RETURN') d.playPose(e, { clip: 'GetUp', rate: 1.0, proudWalk: false });
        else d.playPose(e, introPoseFor(n));
        break;
      case 'vfx':
        d.storyVfx(seq.kind, e, seq.accentHex);
        break;
      case 'show_name':
        if (isCalloutKind(seq.kind)) {
          d.callout(seq.headline, seq.kind === 'FAKE_DEATH' || seq.kind === 'ESCAPE' || seq.kind === 'INTERRUPTION' ? 'hot' : 'gold');
          break;
        }
        this.ensureCard(seq);
        break;
      case 'show_line':
        if (isCalloutKind(seq.kind)) {
          if (seq.line) d.callout(`"${seq.line}"`, 'neutral');
          break;
        }
        this.ensureCard(seq);
        if (seq.line) d.revealCard('line');
        break;
      case 'show_portrait':
        if (isCalloutKind(seq.kind)) break;
        this.ensureCard(seq);
        d.revealCard('portrait');
        break;
      case 'show_chip':
        if (isCalloutKind(seq.kind)) break;
        this.ensureCard(seq);
        d.revealCard('chip');
        break;
      case 'callout':
        d.callout(seq.headline, seq.kind === 'FAKE_DEATH' || seq.kind === 'ESCAPE' || seq.kind === 'INTERRUPTION' ? 'hot' : 'gold');
        break;
      case 'celebrate':
        d.playPose(e, celebrateClip(n));
        break;
      case 'last_words': {
        const words = d.lastWordsFor?.(n, seq.salt) ?? lastWords(n, seq.salt);
        if (words) {
          seq.line = words;
          d.callout(`"${words}"`, 'neutral');
        }
        break;
      }
      case 'slowmo':
        if (seq.kind === 'PLAYER_DEFEATED' || seq.kind === 'NEMESIS_DEFEATED' || this.isSafe(this.lastSafety)) {
          d.slowMo(seq.kind === 'PLAYER_DEFEATED' ? 0.6 : 0.35, 0.4);
        }
        break;
      case 'shake':
        d.shake(seq.kind === 'PLAYER_DEFEATED' ? 0.55 : 0.28);
        break;
      case 'resume':
        e.introHold = false;
        seq.focusing = false;
        d.clearSlowMo();
        break;
    }
  }

  private ensureCard(seq: ActiveSeq): void {
    if (seq.cardShown || !this.deps) return;
    seq.cardShown = true;
    const n = seq.enemy.nemesis;
    const variant =
      seq.kind === 'PLAYER_DEFEATED' ? 'death' : seq.kind === 'ESCAPE' || seq.kind === 'FAKE_DEATH' ? 'escape' : seq.kind === 'FIRST_MEETING' ? 'intro' : 'return';
    this.deps.presentCard({
      name: n.name.toUpperCase(),
      title: seq.title,
      rank: rankName(n.rank) + (n.returns > 0 && seq.kind === 'RESURRECTION_RETURN' ? '  ·  RETURNED' : ''),
      line: seq.line,
      chip: seq.chip,
      headline: seq.headline,
      portraitSrc: seq.portraitSrc,
      accent: seq.accentCss,
      variant,
      duration: Math.max(1.4, seq.duration + 0.4),
      stole: n.stolen[0]?.name,
    });
  }
}

export function duelCallout(a: Nemesis, b: Nemesis): string {
  return `${a.name.toUpperCase()} VS ${b.name.toUpperCase()}`;
}

export function aidCallout(guard: Nemesis, master: Nemesis): string {
  return `${guard.name.toUpperCase()} HAS COME TO ${master.name.toUpperCase()}'S AID`;
}

export function betrayalCallout(a: Nemesis, b: Nemesis): string {
  return `${a.name.toUpperCase()} BETRAYED ${b.name.toUpperCase()}`;
}

function parseAccent(css: string): number {
  const h = css.replace('#', '');
  const n = Number.parseInt(h, 16);
  return Number.isFinite(n) ? n : 0xc4ff2e;
}
