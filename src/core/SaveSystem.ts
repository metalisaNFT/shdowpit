/**
 * Versioned persistence. The whole persistent world is one JSON blob in
 * localStorage; it is small (tens of KB at worst) and writing it is cheap
 * because we only save at meaningful beats, never per frame.
 */

import type { Nemesis } from '../nemesis/Nemesis';
import { isPlayerFacingEvent, type WorldEvent } from '../world/WorldEvent';
import { defaultAISettings, emptyAIContent, type AISettings } from '../ai/AITypes';
import { migrateRunState, type RunState } from '../run/RunState';
import type { TerritoryMod } from '../world/TerritoryRules';

export const SAVE_VERSION = 4;
const KEY = 'shdowpit.world.v1';

/** Counters used by the enemy adaptation system. */
export interface PlayerHabits {
  light: number;
  heavy: number;
  parry: number;
  dodge: number;
  fire: number;
  execute: number;
  backstab: number;
  ranged: number;
  flee: number;
}

export function emptyHabits(): PlayerHabits {
  return { light: 0, heavy: 0, parry: 0, dodge: 0, fire: 0, execute: 0, backstab: 0, ranged: 0, flee: 0 };
}

export interface PlayerMeta {
  runs: number;
  deaths: number;
  kills: number;
  namedKills: number;
  overlordsSlain: number;
  /** weapon ids the player owns and can start a run with */
  weapons: string[];
  /** currently equipped weapon id */
  equipped: string;
  /** ids of weapons currently held by a nemesis (recover them by killing) */
  lostWeapons: string[];
  habits: PlayerHabits;
  /** cumulative essence, the light meta currency */
  essence: number;
  /** permanent max-health bonus bought with essence */
  vigour: number;
  /** unlocked weapon techniques by weapon id */
  techniques: Record<string, string[]>;
  unlockedStarting: string[];
  vendettaPatternHistory: string[];
  telemetryOptIn: boolean;
  /** permanently unlocked active skills */
  unlockedSkills: string[];
  /** last equipped pair [skill1, skill2] */
  skillLoadout: [string, string];
}

export type Quality = 'high' | 'medium' | 'low';

export interface Settings {
  quality: Quality;
  /** step quality down automatically when the frame rate cannot keep up */
  autoQuality: boolean;
  masterVolume: number;
  mouseSensitivity: number;
  invertY: boolean;
  cameraShake: number;
  showMinimap: boolean;
  softLockOn: boolean;
  reducedMotion: boolean;
  reducedFlash: boolean;

  /**
   * AI preferences ONLY. There is deliberately no API key field here, and
   * there must never be one: this object is serialised into localStorage.
   * The key lives in the local backend's memory — see server/aiHandler.mjs.
   */
  ai: AISettings;
}

export function defaultSettings(): Settings {
  return {
    quality: 'high',
    autoQuality: true,
    masterVolume: 0.7,
    mouseSensitivity: 1,
    invertY: false,
    cameraShake: 1,
    showMinimap: true,
    softLockOn: true,
    reducedMotion: false,
    reducedFlash: false,
    ai: defaultAISettings(),
  };
}

export interface SaveData {
  saveVersion: number;
  createdAt: number;
  updatedAt: number;

  worldSeed: number;
  worldTurn: number;
  worldAge: number;
  /** ids of the active age modifiers */
  ageModifiers: string[];
  ageName: string;

  nemeses: Nemesis[];
  eventLog: WorldEvent[];
  /** territory id -> nemesis id who holds it */
  territories: Record<string, string | null>;

  /** rolling counter so generated nemesis ids never collide */
  nextId: number;
  /** rolling counter for world-event ids */
  nextEventId?: number;
  /** optional pan/zoom for THE WEB; node positions are derived, not stored */
  storyView?: { panX: number; panY: number; zoom: number };
  /** name syllable pairs already used, to keep the roster distinct */
  usedNames: string[];

  playerMeta: PlayerMeta;
  settings: Settings;
  /** mid-run snapshot; null between runs */
  run: RunState | null;
  territoryMods: Record<string, TerritoryMod>;
}

export function defaultPlayerMeta(): PlayerMeta {
  return {
    runs: 0,
    deaths: 0,
    kills: 0,
    namedKills: 0,
    overlordsSlain: 0,
    weapons: ['sword'],
    equipped: 'sword',
    lostWeapons: [],
    habits: emptyHabits(),
    essence: 0,
    vigour: 0,
    techniques: {},
    unlockedStarting: [],
    vendettaPatternHistory: [],
    telemetryOptIn: false,
    unlockedSkills: ['shadow_step', 'ground_rupture'],
    skillLoadout: ['shadow_step', 'ground_rupture'],
  };
}

export class SaveSystem {
  private key: string;

  constructor(key = KEY) {
    this.key = key;
  }

  exists(): boolean {
    try {
      return localStorage.getItem(this.key) !== null;
    } catch {
      return false;
    }
  }

  load(): SaveData | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch (err) {
      console.warn('[Save] localStorage unavailable', err);
      return null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SaveData;
      return this.migrate(data);
    } catch (err) {
      console.error('[Save] corrupt save, archiving and starting fresh', err);
      try {
        localStorage.setItem(this.key + '.corrupt.' + Date.now(), raw);
        localStorage.removeItem(this.key);
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  save(data: SaveData): boolean {
    data.updatedAt = Date.now();
    data.saveVersion = SAVE_VERSION;
    // Last line of defence before anything touches localStorage.
    scrubSecrets(data.settings as unknown as Record<string, unknown>);
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[Save] write failed', err);
      // Most likely quota: trim history and retry once.
      if (data.eventLog.length > 300) {
        data.eventLog = data.eventLog.slice(-300);
        try {
          localStorage.setItem(this.key, JSON.stringify(data));
          return true;
        } catch {
          /* give up */
        }
      }
      return false;
    }
  }

  wipe(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Bring older saves up to the current shape. Every field added in a future
   * version gets a default here rather than a crash.
   */
  private migrate(data: SaveData): SaveData {
    if (typeof data !== 'object' || data === null) throw new Error('not an object');
    const v = data.saveVersion ?? 0;
    if (v > SAVE_VERSION) {
      console.warn('[Save] save is from a newer build; loading defensively');
    }

    data.saveVersion = SAVE_VERSION;
    data.worldSeed ??= 1;
    data.worldTurn ??= 0;
    data.worldAge ??= 1;
    data.ageModifiers ??= [];
    data.ageName ??= 'THE WASTES';
    data.nemeses ??= [];
    data.eventLog ??= [];
    data.territories ??= {};
    data.nextId ??= 1;
    data.usedNames ??= [];
    data.settings = { ...defaultSettings(), ...(data.settings ?? {}) };
    data.settings.ai = { ...defaultAISettings(), ...(data.settings.ai ?? {}) };
    data.playerMeta = { ...defaultPlayerMeta(), ...(data.playerMeta ?? {}) };
    data.playerMeta.habits = { ...emptyHabits(), ...(data.playerMeta.habits ?? {}) };
    data.playerMeta.techniques = data.playerMeta.techniques ?? {};
    data.playerMeta.unlockedStarting = data.playerMeta.unlockedStarting ?? [];
    data.playerMeta.vendettaPatternHistory = data.playerMeta.vendettaPatternHistory ?? [];
    data.playerMeta.telemetryOptIn = data.playerMeta.telemetryOptIn ?? false;
    data.playerMeta.unlockedSkills =
      data.playerMeta.unlockedSkills && data.playerMeta.unlockedSkills.length
        ? data.playerMeta.unlockedSkills
        : ['shadow_step', 'ground_rupture'];
    data.playerMeta.skillLoadout = (data.playerMeta.skillLoadout as [string, string] | undefined) ?? [
      'shadow_step',
      'ground_rupture',
    ];
    data.territoryMods = data.territoryMods ?? {};
    data.run = data.run ? migrateRunState(data.run, data.worldSeed) : null;
    data.settings.reducedMotion = data.settings.reducedMotion ?? false;
    data.settings.reducedFlash = data.settings.reducedFlash ?? false;
    data.storyView = data.storyView ?? { panX: 0, panY: 0, zoom: 1 };
    migrateEventLog(data);

    // Defence in depth. A key should never be able to reach this object, but if
    // a future edit ever puts one here, strip it on the way in and out rather
    // than let it live in localStorage.
    scrubSecrets(data.settings as unknown as Record<string, unknown>);

    for (const n of data.nemeses) {
      n.scars ??= [];
      n.memory ??= [];
      n.rivalries ??= [];
      n.allies ??= [];
      n.adaptations ??= [];
      n.stolen ??= [];
      n.title ??= '';
      n.master ??= null;
      n.diedOnTurn ??= null;
      n.returns ??= 0;
      n.bornTurn ??= 0;
      n.persistent ??= true;
      n.territory ??= 'pit';
      n.ai ??= emptyAIContent();
      n.ai.generatedAt ??= {};
      n.playerRewardFarms ??= 0;
      n.informant ??= false;
      n.humiliations ??= 0;
      n.branded ??= false;
      n.abandonedTerritoryTurn ??= null;
      n.stolenFromThem ??= [];
      n.fakeDeathPenalty ??= 0;
    }
    return data;
  }
}

/** Conservative: old chronicle lines become known facts with stable ids. */
export function migrateEventLog(data: SaveData): void {
  let next = data.nextEventId ?? 1;
  for (const ev of data.eventLog) {
    if (!ev.id) {
      ev.id = 'e' + next.toString(36);
      next++;
    }
    if (ev.witnessed === undefined) ev.witnessed = isPlayerFacingEvent(ev.type);
    // Old worlds already showed every line in the chronicle.
    if (ev.known === undefined) ev.known = true;
    ev.payload ??= {};
  }
  data.nextEventId = Math.max(next, data.nextEventId ?? 1);
}

const SECRET_KEYS = ['apiKey', 'openaiKey', 'key', 'token', 'secret'];

/**
 * Remove anything that looks like a credential before it can be written to
 * localStorage. Nothing should ever match; this exists so that a future
 * refactor cannot quietly start persisting a key.
 */
function scrubSecrets(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (SECRET_KEYS.includes(k) || (typeof v === 'string' && /^sk-[A-Za-z0-9_-]{16,}/.test(v))) {
      delete obj[k];
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      scrubSecrets(v as Record<string, unknown>);
    }
  }
}
