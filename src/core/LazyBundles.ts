/**
 * Wave E lazy bundle loaders — keeps dynamic import() boundaries out of Game.ts.
 */

import type { GodLayer } from '../lazy/godLayer';
import type { ComicPipeline } from '../lazy/comicPipeline';
import type { AIStatus } from '../ui/AIStatus';
import type { DebugOverlay } from '../ui/DebugOverlay';
import type { ComicViewer } from '../ui/ComicViewer';
import type { GodScreen } from '../ui/GodScreen';
import type { PrimerScreen } from '../ui/GodTutorial';
import type { LegendsScreen, RunEndScreen } from '../ui/LegendsScreen';

let godLayer: GodLayer | null = null;
let godLayerPromise: Promise<GodLayer> | null = null;
let godUiMounted = false;

let comicPipeline: ComicPipeline | null = null;
let comicPipelinePromise: Promise<ComicPipeline> | null = null;
let comicUiMounted = false;

let aiUiMounted = false;
let debugOverlayMounted = false;

export function getGodLayer(): GodLayer | null {
  return godLayer;
}

export function isGodUiMounted(): boolean {
  return godUiMounted;
}

export function isComicUiMounted(): boolean {
  return comicUiMounted;
}

export function isAiUiMounted(): boolean {
  return aiUiMounted;
}

export function isDebugOverlayMounted(): boolean {
  return debugOverlayMounted;
}

export async function ensureGodLayer(): Promise<GodLayer> {
  if (godLayer) return godLayer;
  if (!godLayerPromise) {
    godLayerPromise = import('../lazy/godLayer').then((m) => m.loadGodLayer());
  }
  godLayer = await godLayerPromise;
  return godLayer;
}

export async function mountGodUi(
  uiRoot: HTMLElement,
  ui: {
    god: GodScreen;
    primer: PrimerScreen;
    legends: LegendsScreen;
    godEnd: RunEndScreen;
  }
): Promise<GodLayer> {
  if (godUiMounted && godLayer) return godLayer;
  const L = await ensureGodLayer();
  ui.god = new L.GodScreen();
  ui.primer = new L.PrimerScreen();
  ui.legends = new L.LegendsScreen();
  ui.godEnd = new L.RunEndScreen();
  for (const el of [ui.god.root, ui.primer.root, ui.legends.root, ui.godEnd.root]) {
    uiRoot.append(el);
  }
  godUiMounted = true;
  return L;
}

export async function ensureAiUi(
  uiRoot: HTMLElement,
  ui: { aiStatus: AIStatus }
): Promise<void> {
  if (aiUiMounted) return;
  const mod = await import('../lazy/aiUi').then((m) => m.loadAiUi());
  ui.aiStatus = new mod.AIStatus();
  uiRoot.append(ui.aiStatus.root);
  aiUiMounted = true;
}

export async function ensureDebugOverlay(
  uiRoot: HTMLElement,
  ui: { debug: DebugOverlay }
): Promise<void> {
  if (debugOverlayMounted) return;
  const mod = await import('../lazy/debugOverlay').then((m) => m.loadDebugOverlay());
  ui.debug = new mod.DebugOverlay();
  uiRoot.append(ui.debug.root);
  debugOverlayMounted = true;
}

export async function ensureComicPipeline(
  uiRoot: HTMLElement,
  ui: { comic: ComicViewer }
): Promise<ComicPipeline> {
  if (comicPipeline) return comicPipeline;
  if (!comicPipelinePromise) {
    comicPipelinePromise = import('../lazy/comicPipeline')
      .then((m) => m.loadComicPipeline())
      .then((pipe) => {
        comicPipeline = pipe;
        if (!comicUiMounted) {
          ui.comic = new pipe.ComicViewer();
          uiRoot.append(ui.comic.root);
          comicUiMounted = true;
        }
        return pipe;
      });
  }
  return comicPipelinePromise;
}
