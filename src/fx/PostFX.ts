/**
 * Post-processing: tone mapping and selective bloom.
 *
 * The toxic-neon look depends on a small number of very bright things sitting
 * in a very dark world. Bloom is what sells that — but it is also the fastest
 * way to destroy readability, so it is deliberately conservative here:
 *
 *  - a high threshold, so only genuinely bright neon blooms and the charcoal
 *    world never lifts off the floor
 *  - a modest strength, so a telegraph glows rather than smears
 *  - a small radius, so bloom stays attached to its source and never obscures
 *    the attack it is meant to communicate
 *
 * Bloom is off at LOW quality. The pass costs two extra full-screen draws plus
 * the mip chain, which is exactly what a machine already struggling cannot
 * afford — and the game must stay readable without it, which it is, because
 * the colour language does the work and bloom only amplifies it.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../core/SaveSystem';

export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private enabled = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera
  ) {}

  /**
   * (Re)build for a quality level. Safe to call repeatedly; disposes the old
   * chain first.
   */
  configure(quality: Quality, width: number, height: number): void {
    this.dispose();

    // ACES everywhere. Note this makes every material's `toneMapped: false`
    // flag inert once we render through the composer, which is what we want:
    // one tone curve for the whole frame means the neon and the world agree.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.75;

    // Bloom is a luxury. Below medium the frame budget is better spent on
    // holding a playable frame rate.
    if (quality === 'low') {
      this.enabled = false;
      return;
    }

    const composer = new EffectComposer(this.renderer);
    composer.setSize(width, height);
    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      quality === 'high' ? 0.5 : 0.42, // strength
      0.26, // radius — tight, so glow stays attached to its source
      0.70 // threshold — the charcoal world is far below this
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    this.composer = composer;
    this.bloom = bloom;
    this.renderPass = renderPass;
    this.enabled = true;
  }

  /** Swap the scene without rebuilding the chain — the arena is rebuilt often. */
  setScene(scene: THREE.Scene): void {
    this.scene = scene;
    if (this.renderPass) this.renderPass.scene = scene;
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    this.bloom?.setSize(width, height);
  }

  render(): void {
    if (this.enabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  get active(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.composer?.dispose();
    this.bloom?.dispose();
    this.composer = null;
    this.bloom = null;
    this.renderPass = null;
    this.enabled = false;
  }
}
