/**
 * Comic Combat service — orchestration.
 *
 * Simulation creates EncounterStory facts; this layer captures, stylizes,
 * optionally illustrates via the existing AI backend, and presents panels.
 * Nothing here writes mechanical game state.
 */

import * as THREE from 'three';
import type { AIBackend } from '../ai/AIBackend';
import { CharacterRefStore } from './CharacterRefs';
import { capturePanel } from './Capture';
import type { CineSubjects } from './Cinematographer';
import { selectPanels, SLICE_ROLES } from './Director';
import { stylizeCapture } from './PostProcess';
import { composePanelPrompt } from './PromptComposer';
import { qualityProfile } from './QualityProfiles';
import { ComicQueue } from './Queue';
import { styleProfile } from './StyleProfiles';
import {
  addAttackBeat,
  addImpactBeat,
  addIntroBeat,
  addOutcomeBeat,
  addPlayerImpactBeat,
  buildForceSliceStory,
  createStory,
  type StorySeed,
} from './StoryBuilder';
import type {
  ComicOutcomeKind,
  ComicPanel,
  ComicQualityProfileId,
  ComicSequence,
  ComicStrikeInfo,
  EncounterStory,
  StoryBeat,
} from './Types';

export interface ComicWorldHook {
  getSubjects(nemesisId: string): CineSubjects | null;
  getSeed(nemesisId: string): StorySeed | null;
  /** Optional: live HP fractions */
  hpFracs(nemesisId: string): { player: number; enemy: number };
}

export interface ComicServiceOpts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  backend?: AIBackend | null;
  world: ComicWorldHook;
  /** When a full sequence is ready to show (intro/death/victory/lull). */
  onSequenceReady?: (seq: ComicSequence) => void;
  onPanelReady?: (panel: ComicPanel, seq: ComicSequence) => void;
}

let panelSeq = 1;

function makePanel(beat: StoryBeat): ComicPanel {
  return {
    id: `panel_${panelSeq++}`,
    beat,
    shot: beat.preferredShot,
    state: 'pending',
    imageDataUrl: '',
    captureRgb: '',
    captureDepth: '',
    prompt: '',
    usedAi: false,
    error: '',
    anim: {
      shake: beat.role === 'impact' ? 0.7 : beat.role === 'attack' ? 0.35 : 0.1,
      pushIn: beat.role === 'intro' || beat.role === 'impact' ? 0.45 : 0.15,
      parallax: beat.role === 'outcome' || beat.role === 'intro' ? 0.4 : 0.25,
    },
  };
}

export class ComicService {
  readonly refs = new CharacterRefStore();
  readonly queue = new ComicQueue();

  private qualityId: ComicQualityProfileId = 'potato';
  private styleId = 'ink_pit';
  private active: ComicSequence | null = null;
  private enabled = true;
  /** Cooldown so we don't spam comics mid-fight. */
  private lastShowAt = 0;
  private pendingShow: ComicSequence | null = null;

  constructor(private opts: ComicServiceOpts) {
    this.queue.onChange = () => void 0;
  }

  setQuality(id: ComicQualityProfileId): void {
    this.qualityId = id;
    this.queue.maxConcurrent = qualityProfile(id).maxConcurrent;
  }

  setStyle(id: string): void {
    this.styleId = id;
  }

  get quality(): ComicQualityProfileId {
    return this.qualityId;
  }

  get style(): string {
    return this.styleId;
  }

  get sequence(): ComicSequence | null {
    return this.active;
  }

  get pending(): ComicSequence | null {
    return this.pendingShow;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Begin tracking a named encounter (intro beat). */
  onNamedIntro(nemesisId: string, speech = ''): void {
    if (!this.enabled) return;
    const seed = this.opts.world.getSeed(nemesisId);
    if (!seed) return;
    const story = createStory(seed);
    addIntroBeat(story, speech);
    this.beginSequence(story, false);
  }

  /** Named enemy landed a blow on the player. */
  onNamedStrike(nemesisId: string, info: ComicStrikeInfo): void {
    if (!this.enabled) return;
    let seq = this.active;
    if (!seq || seq.story.nemesisId !== nemesisId) {
      const seed = this.opts.world.getSeed(nemesisId);
      if (!seed) return;
      const story = createStory(seed);
      if (!story.beats.some((b) => b.role === 'intro')) addIntroBeat(story);
      this.beginSequence(story, false);
      seq = this.active!;
    }
    const hp = this.opts.world.hpFracs(nemesisId);
    addAttackBeat(seq.story, {
      attackId: info.attackId,
      attackLabel: info.attackLabel,
      damage: info.amount,
      playerHpFrac: hp.player,
      enemyHpFrac: hp.enemy,
    });
    if (info.critical || info.amount >= 35) {
      addImpactBeat(seq.story, {
        critical: info.critical || info.amount >= 45,
        damage: info.amount,
        playerHpFrac: hp.player,
        enemyHpFrac: hp.enemy,
        attackLabel: info.attackLabel,
      });
    }
    this.enqueueMissingPanels(seq);
  }

  /** Player landed a heavy hit on a named nemesis. */
  onPlayerStrike(nemesisId: string, info: { amount: number; critical: boolean; attackLabel: string }): void {
    if (!this.enabled || info.amount < 12) return;
    let seq = this.active;
    if (!seq || seq.story.nemesisId !== nemesisId) {
      const seed = this.opts.world.getSeed(nemesisId);
      if (!seed) return;
      const story = createStory(seed);
      if (!story.beats.some((b) => b.role === 'intro')) addIntroBeat(story);
      this.beginSequence(story, false);
      seq = this.active!;
    }
    const hp = this.opts.world.hpFracs(nemesisId);
    addPlayerImpactBeat(seq.story, {
      damage: info.amount,
      critical: info.critical,
      playerHpFrac: hp.player,
      enemyHpFrac: hp.enemy,
      attackLabel: info.attackLabel,
    });
    this.enqueueMissingPanels(seq);
  }

  /** Dramatic proc during a named fight — a sudden panel beat. */
  onProcFlourish(nemesisId: string, note: string): void {
    if (!this.enabled) return;
    let seq = this.active;
    if (!seq || seq.story.nemesisId !== nemesisId) {
      const seed = this.opts.world.getSeed(nemesisId);
      if (!seed) return;
      this.beginSequence(createStory(seed), false);
      seq = this.active!;
    }
    const hp = this.opts.world.hpFracs(nemesisId);
    addPlayerImpactBeat(seq.story, {
      damage: 0,
      critical: true,
      playerHpFrac: hp.player,
      enemyHpFrac: hp.enemy,
      narration: note,
    });
    this.enqueueMissingPanels(seq);
  }

  onNamedOutcome(nemesisId: string, outcome: ComicOutcomeKind, speech = ''): void {
    if (!this.enabled) return;
    let seq = this.active;
    if (!seq || seq.story.nemesisId !== nemesisId) {
      const seed = this.opts.world.getSeed(nemesisId);
      if (!seed) return;
      this.beginSequence(createStory(seed), false);
      seq = this.active!;
    }
    const hp = this.opts.world.hpFracs(nemesisId);
    addOutcomeBeat(seq.story, outcome, {
      playerHpFrac: hp.player,
      enemyHpFrac: hp.enemy,
      speech,
    });
    this.enqueueMissingPanels(seq);
    // Outcomes are a natural lull — arm show when ready.
    this.armShowWhenReady(seq);
  }

  /**
   * Force the vertical slice: 4 panels captured now, potato-safe, optional AI.
   * Returns a summary for __sim / tests.
   */
  forceSlice(nemesisId: string): Record<string, unknown> {
    const seed = this.opts.world.getSeed(nemesisId);
    if (!seed) return { ok: false, error: 'no_nemesis' };
    const story = buildForceSliceStory(seed, { critical: true, outcome: 'player_hurt' });
    const seq = this.beginSequence(story, true);
    this.armShowWhenReady(seq);
    return {
      ok: true,
      storyId: story.id,
      nemesisId: seed.nemesisId,
      nemesisName: seed.nemesisName,
      panels: seq.panels.length,
      quality: this.qualityId,
      style: this.styleId,
      roles: seq.panels.map((p) => p.beat.role),
    };
  }

  /** Call from Game during lull / after intro / death to present if armed. */
  tryPresent(force = false): ComicSequence | null {
    const seq = this.pendingShow;
    if (!seq || !seq.ready) return null;
    if (!force && Date.now() - this.lastShowAt < 8000) return null;
    this.pendingShow = null;
    this.lastShowAt = Date.now();
    this.opts.onSequenceReady?.(seq);
    return seq;
  }

  /** Debug / test snapshot. */
  status(): Record<string, unknown> {
    const seq = this.active;
    return {
      enabled: this.enabled,
      quality: this.qualityId,
      style: this.styleId,
      queue: this.queue.queued,
      activeJobs: this.queue.running,
      storyId: seq?.story.id ?? null,
      panels: seq?.panels.map((p) => ({ id: p.id, role: p.beat.role, state: p.state, ai: p.usedAi })) ?? [],
      ready: seq?.ready ?? false,
      pendingShow: !!this.pendingShow,
      refs: this.refs.list().map((r) => ({ id: r.nemesisId, n: r.refs.length })),
    };
  }

  private beginSequence(story: EncounterStory, captureAllNow: boolean): ComicSequence {
    const beats = selectPanels(story, story.selectedRoles.length ? story.selectedRoles : SLICE_ROLES);
    // Ensure story has those beats selected
    story.selectedRoles = beats.map((b) => b.role);
    const panels = beats.map(makePanel);
    const seq: ComicSequence = {
      story,
      panels,
      ready: false,
      profileId: this.qualityId,
      styleId: this.styleId,
    };
    this.active = seq;
    if (captureAllNow) {
      for (const p of panels) this.enqueuePanel(seq, p);
    } else {
      this.enqueueMissingPanels(seq);
    }
    return seq;
  }

  private enqueueMissingPanels(seq: ComicSequence): void {
    const selected = selectPanels(seq.story, SLICE_ROLES);
    for (const beat of selected) {
      if (seq.panels.some((p) => p.beat.id === beat.id)) continue;
      // Replace empty role slots or append
      const existingRole = seq.panels.find((p) => p.beat.role === beat.role && p.state === 'pending' && !p.imageDataUrl);
      if (existingRole) {
        existingRole.beat = beat;
        this.enqueuePanel(seq, existingRole);
      } else if (!seq.panels.some((p) => p.beat.role === beat.role)) {
        const panel = makePanel(beat);
        seq.panels.push(panel);
        seq.panels.sort((a, b) => SLICE_ROLES.indexOf(a.beat.role) - SLICE_ROLES.indexOf(b.beat.role));
        this.enqueuePanel(seq, panel);
      }
    }
    // Capture any still-pending panels that already have beats
    for (const p of seq.panels) {
      if (p.state === 'pending') this.enqueuePanel(seq, p);
    }
  }

  private enqueuePanel(seq: ComicSequence, panel: ComicPanel): void {
    if (panel.state !== 'pending' && panel.state !== 'failed') return;
    panel.state = 'capturing';
    this.queue.enqueue(async () => {
      await this.processPanel(seq, panel);
    });
  }

  private async processPanel(seq: ComicSequence, panel: ComicPanel): Promise<void> {
    const q = qualityProfile(this.qualityId);
    const style = styleProfile(this.styleId);
    const subjects = this.opts.world.getSubjects(seq.story.nemesisId);
    panel.prompt = composePanelPrompt(panel.beat, style);

    try {
      if (!subjects) {
        // Fallback: solid ink card with typography only
        panel.imageDataUrl = this.fallbackCard(panel);
        panel.state = 'ready';
        panel.error = 'no_subjects';
      } else {
        panel.state = 'capturing';
        const cap = capturePanel(
          {
            renderer: this.opts.renderer,
            scene: this.opts.scene,
            width: q.captureWidth,
            height: q.captureHeight,
            wantDepth: q.captureDepth,
          },
          panel.beat.role,
          subjects,
          panel.beat.preferredShot
        );
        panel.captureRgb = cap.rgbDataUrl;
        panel.captureDepth = cap.depthDataUrl;
        panel.shot = cap.shot;
        this.refs.addRef(seq.story.nemesisId, cap.rgbDataUrl, panel.beat.role);

        panel.state = 'stylizing';
        let finalUrl = await stylizeCapture(cap.rgbDataUrl, style);

        if (q.tryAi && this.opts.backend?.imageAvailable) {
          panel.state = 'ai';
          const res = await this.opts.backend.image(panel.prompt);
          if (res.ok && res.dataUrl) {
            finalUrl = res.dataUrl;
            panel.usedAi = true;
          }
        }

        panel.imageDataUrl = finalUrl;
        panel.state = 'ready';
      }
    } catch (err) {
      panel.state = 'failed';
      panel.error = err instanceof Error ? err.message : 'capture_failed';
      panel.imageDataUrl = this.fallbackCard(panel);
      panel.state = 'ready'; // still showable
    }

    seq.ready = seq.panels.length > 0 && seq.panels.every((p) => p.state === 'ready' || p.state === 'failed');
    this.opts.onPanelReady?.(panel, seq);
    if (seq.ready && this.pendingShow === seq) {
      // keep armed
    }
  }

  private armShowWhenReady(seq: ComicSequence): void {
    this.pendingShow = seq;
    // If already ready (sync potato), present on next tryPresent
    if (seq.ready) {
      const delay = qualityProfile(this.qualityId).showDelayMs;
      window.setTimeout(() => this.tryPresent(true), delay);
    } else {
      // Poll lightly via queue completion — onPanelReady path
      const check = (): void => {
        if (this.pendingShow !== seq) return;
        if (seq.ready) {
          const delay = qualityProfile(this.qualityId).showDelayMs;
          window.setTimeout(() => this.tryPresent(true), delay);
        }
      };
      const prev = this.opts.onPanelReady;
      // Lightweight: also check after each panel in processPanel via seq.ready
      void prev;
      const iv = window.setInterval(() => {
        check();
        if (seq.ready || this.pendingShow !== seq) window.clearInterval(iv);
      }, 100);
    }
  }

  private fallbackCard(panel: ComicPanel): string {
    const w = 512;
    const h = 384;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#12100e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8e0d4';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#e8e0d4';
    ctx.font = 'bold 28px monospace';
    ctx.fillText(panel.beat.role.toUpperCase(), 28, 56);
    ctx.font = '22px monospace';
    ctx.fillText(panel.beat.nemesisName.toUpperCase(), 28, 100);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#c44';
    ctx.fillText(panel.beat.sfx || panel.beat.narration || '—', 28, 150);
    return c.toDataURL('image/jpeg', 0.85);
  }
}
