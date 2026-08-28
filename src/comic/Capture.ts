/**
 * AI-independent capture layer — RGB (+ depth when feasible).
 * Depth uses MeshDepthMaterial override into a color buffer (portable WebGL).
 */

import * as THREE from 'three';
import { applyCamera, pickBestCamera, type CineSubjects } from './Cinematographer';
import type { CaptureBundle, ComicPanelRole, ComicShotKind } from './Types';

export interface CaptureContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  width: number;
  height: number;
  wantDepth: boolean;
}

let sharedCam: THREE.PerspectiveCamera | null = null;
let rgbTarget: THREE.WebGLRenderTarget | null = null;
let depthTarget: THREE.WebGLRenderTarget | null = null;
let depthMaterial: THREE.MeshDepthMaterial | null = null;
let lastW = 0;
let lastH = 0;

function ensureTargets(w: number, h: number, wantDepth: boolean): void {
  if (!sharedCam) sharedCam = new THREE.PerspectiveCamera(55, w / h, 0.15, 400);
  if (!rgbTarget || lastW !== w || lastH !== h) {
    rgbTarget?.dispose();
    rgbTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
    });
    lastW = w;
    lastH = h;
  }
  if (wantDepth) {
    if (!depthTarget || depthTarget.width !== w || depthTarget.height !== h) {
      depthTarget?.dispose();
      depthTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.UnsignedByteType,
      });
    }
    if (!depthMaterial) {
      depthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.BasicDepthPacking,
      });
    }
  }
}

function targetToDataUrl(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, w: number, h: number): string {
  const prev = renderer.getRenderTarget();
  const pixels = new Uint8Array(w * h * 4);
  renderer.setRenderTarget(target);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  renderer.setRenderTarget(prev);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    img.data.set(pixels.subarray(src, src + w * 4), dst);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Capture one panel. Restores the previous render target. Sync.
 */
export function capturePanel(
  ctx: CaptureContext,
  role: ComicPanelRole,
  subjects: CineSubjects,
  preferred?: ComicShotKind
): CaptureBundle {
  const { renderer, scene, width, height, wantDepth } = ctx;
  ensureTargets(width, height, wantDepth);
  const cam = sharedCam!;
  const best = pickBestCamera(role, subjects, preferred);
  applyCamera(cam, best, width / height);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;

  renderer.autoClear = true;
  renderer.setRenderTarget(rgbTarget);
  renderer.clear();
  renderer.render(scene, cam);
  const rgbDataUrl = targetToDataUrl(renderer, rgbTarget!, width, height);

  let depthDataUrl = '';
  if (wantDepth && depthTarget && depthMaterial) {
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = depthMaterial;
    renderer.setRenderTarget(depthTarget);
    renderer.clear();
    renderer.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    depthDataUrl = targetToDataUrl(renderer, depthTarget, width, height);
  }

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;

  return {
    rgbDataUrl,
    depthDataUrl,
    width,
    height,
    shot: best.kind,
    score: best.score,
  };
}

export function disposeCaptureResources(): void {
  rgbTarget?.dispose();
  depthTarget?.dispose();
  depthMaterial?.dispose();
  rgbTarget = null;
  depthTarget = null;
  depthMaterial = null;
  sharedCam = null;
  lastW = 0;
  lastH = 0;
}
