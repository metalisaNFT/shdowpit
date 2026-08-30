/**
 * Narrative event bus — decouples AI generation from UI-open moments.
 *
 * Simulation owns truth; this observes myth-worthy beats and queues presentation
 * overlays with fact snapshots. Never writes mechanical state.
 */

import type { AIContentService } from '../ai/AIContentService';
import type { MythEventKind } from '../ai/AITypes';
import type { Nemesis } from '../nemesis/Nemesis';
import type { NemesisManager } from '../nemesis/NemesisManager';
import type { WorldEvent } from '../world/WorldEvent';
import type { MemoryType } from '../nemesis/Nemesis';
import type { EncounterKind } from '../nemesis/EncounterKind';
import { encounterLine, encounterHeadline } from '../nemesis/EncounterCopy';
import type { RecapBeat } from '../story/StoryTypes';
import { buildStoryModel } from '../story/StoryModel';
import { buildTimeline } from '../story/StoryTimeline';
import {
  observeArcs,
  observeEncounter,
  observeEncounterLine,
  observeJourney,
  observeRecapBeats,
  observeTimeline,
  type EncounterOverlayContext,
} from '../story/StoryAI';
import type { Beat, GodState } from '../god/GodTypes';
import { observeGodBeats, observeRunStory } from '../god/GodAI';
import type { RunOutcome } from '../god/GodTypes';
import type { RunStorySummary } from '../story/RunStory/RunStoryTypes';

const WORTHY_MEMORY = new Set<MemoryType>([
  'PLAYER_KILLED_ME',
  'PLAYER_EXECUTED_ME',
  'I_KILLED_PLAYER',
  'I_STOLE_PLAYER_WEAPON',
  'I_RETURNED_FROM_DEATH',
  'I_WAS_PROMOTED',
  'PLAYER_BURNED_ME',
  'PLAYER_SPARED_ME',
  'I_ESCAPED_PLAYER',
  'I_BETRAYED_ALLY',
  'I_WAS_BETRAYED',
]);

export interface NarrativeObserverDeps {
  ai: AIContentService;
  mgr: NemesisManager;
  syncWorld(): void;
  god?: () => GodState | null;
}

export class NarrativeObserver {
  private deps: NarrativeObserverDeps | null = null;

  bind(deps: NarrativeObserverDeps): void {
    this.deps = deps;
  }

  /** Myth funnel — identity, chronicle, dialogue refresh. */
  onMyth(n: Nemesis, kind: MythEventKind): void {
    const d = this.deps;
    if (!d) return;
    d.syncWorld();
    d.ai.onMythEvent(n, kind);
  }

  /** World log after offscreen turn — raise myths then story polish. */
  onWorldEvents(events: readonly WorldEvent[]): void {
    const d = this.deps;
    if (!d) return;
    for (const ev of events) {
      const primary = d.mgr.byId(ev.actors[0] ?? null);
      if (!primary) continue;
      switch (ev.type) {
        case 'promotion':
          this.onMyth(
            primary,
            primary.rank === 'overlord'
              ? 'became_overlord'
              : primary.rank === 'warlord'
                ? 'promoted_warlord'
                : 'promoted_captain'
          );
          break;
        case 'resurrection':
          this.onMyth(primary, 'returned_from_death');
          break;
        case 'injury':
        case 'mutation':
          this.onMyth(primary, 'major_scar');
          break;
        case 'weapon_theft':
          this.onMyth(primary, 'stole_weapon');
          break;
        case 'betrayal':
        case 'assassination':
        case 'duel':
          this.onMyth(primary, 'killed_rival');
          break;
        default:
          break;
      }
    }
    if (d.ai.mode === 'off' || !events.length) return;
    const items = buildTimeline(d.mgr.data)
      .filter((i) => events.some((e) => e.id && i.sourceIds.includes(e.id)) || i.turn >= d.mgr.turn - 1)
      .slice(-6);
    if (items.length) observeTimeline(d.ai, d.mgr, items);
  }

  /** New memory worth re-telling — queue journey polish. */
  onRemember(n: Nemesis, type: MemoryType): void {
    if (!WORTHY_MEMORY.has(type)) return;
    const d = this.deps;
    if (!d || d.ai.mode === 'off') return;
    d.syncWorld();
    const beats = n.memory.slice(-3).map((m) => {
      const sub = m.subject ? d.mgr.byId(m.subject) : null;
      return `${m.type}${sub ? ' ' + sub.name : ''}`;
    });
    observeJourney(d.ai, n, beats, { limit: 3 });
  }

  /** Encounter presentation — headline, contextual line, exchange. */
  onEncounterStart(
    n: Nemesis,
    kind: EncounterKind,
    salt: number,
    overlay?: EncounterOverlayContext
  ): void {
    const d = this.deps;
    if (!d || d.ai.mode === 'off') return;
    d.syncWorld();
    const headline = encounterHeadline(kind, n);
    const fallbackLine = encounterLine(n, kind, salt);
    observeEncounter(d.ai, n, kind, headline, undefined, overlay);
    observeEncounterLine(d.ai, d.mgr, n, kind, salt, fallbackLine, overlay);
    d.ai.ensureFor(n, 70);
  }

  /** Death report composed — recap beats and timeline without opening UI. */
  onDeathReport(recap: readonly RecapBeat[]): void {
    const d = this.deps;
    if (!d || d.ai.mode === 'off') return;
    d.syncWorld();
    observeRecapBeats(d.ai, d.mgr, recap);
    const items = buildTimeline(d.mgr.data).filter((i) => i.important || i.witnessed).slice(-10);
    observeTimeline(d.ai, d.mgr, items);
  }

  /** Hierarchy / inspect — arcs and chronicle warm. */
  onInspectNemesis(n: Nemesis): void {
    const d = this.deps;
    if (!d || d.ai.mode === 'off') return;
    d.syncWorld();
    d.ai.ensureFor(n, 88);
    const model = buildStoryModel(d.mgr.data);
    const arcs = model.arcs.filter((a) => a.characters.includes(n.id)).slice(0, 4);
    if (arcs.length) observeArcs(d.ai, d.mgr, arcs);
    const items = buildTimeline(d.mgr.data)
      .filter((i) => i.actors.includes(n.id) || i.important)
      .slice(-8);
    if (items.length) observeTimeline(d.ai, d.mgr, items);
  }

  /** God board beats — optional long-game polish. */
  onGodBeats(beats: readonly Beat[]): void {
    const d = this.deps;
    if (!d || d.ai.mode === 'off') return;
    const god = d.god?.();
    if (!god) return;
    d.syncWorld();
    observeGodBeats(d.ai, d.mgr, god, beats);
  }

  /** End-of-run RND — optional AI polish on derived facts. */
  onRunStory(outcome: RunOutcome, story: RunStorySummary): void {
    const d = this.deps;
    if (!d || d.ai.mode === 'off') return;
    const god = d.god?.();
    if (!god) return;
    d.syncWorld();
    observeRunStory(d.ai, d.mgr, god, outcome, story);
  }
}
