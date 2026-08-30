/**
 * WebGL renderer, post-FX, camera, and quality scaling — extracted from Game.ts.
 */

import * as THREE from 'three';
import type { Quality } from './SaveSystem';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { PostFX } from '../fx/PostFX';
import type { Arena } from '../world/Arena';

export function pixelRatioFor(q: Quality): number {
  if (q === 'high') return Math.min(window.devicePixelRatio, 2);
  if (q === 'medium') return 1;
  return 0.6;
}

/** Quality chosen before the renderer exists: URL param wins, then the save. */
export function readBootQuality(): Quality {
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

export class RenderHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: ThirdPersonCamera;
  readonly post: PostFX;
  private quality: Quality;
  private lowFpsTime = 0;

  constructor(canvas: HTMLCanvasElement, arena: Arena, bootQuality = readBootQuality()) {
    this.quality = bootQuality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: bootQuality === 'high',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatioFor(bootQuality));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.camera.setArena(arena);
    this.post = new PostFX(this.renderer, arena.scene, this.camera.camera);
    this.post.configure(bootQuality, window.innerWidth, window.innerHeight);
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  applyQuality(q: Quality, arena: Arena, rebuildArena?: () => void): void {
    this.quality = q;
    const shadow = q === 'high' ? 2048 : q === 'medium' ? 1024 : 0;
    this.renderer.setPixelRatio(pixelRatioFor(q));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = shadow > 0;
    this.post.configure(q, window.innerWidth, window.innerHeight);
    arena.setShadowQuality(shadow);
    if (rebuildArena) rebuildArena();
  }

  autoQuality(rdt: number, fps: number, autoEnabled: boolean, onStepDown: (next: Quality) => void): void {
    if (!autoEnabled || this.quality === 'low') return;
    if (fps > 45) {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - rdt);
      return;
    }
    this.lowFpsTime += rdt;
    if (this.lowFpsTime < 4) return;
    this.lowFpsTime = 0;
    const next: Quality = this.quality === 'high' ? 'medium' : 'low';
    onStepDown(next);
  }

  onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.resize(w / h);
  }

  render(): void {
    this.post.render();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
