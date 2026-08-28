/**
 * Frame driver.
 *
 * Variable delta with a hard clamp (so a background tab doesn't teleport
 * everything), plus a global time scale used for hit-stop and slow motion.
 * Two clocks are exposed: scaled `dt` for simulation, unscaled `rdt` for UI,
 * camera shake decay and the hit-stop timer itself.
 */

export type TickFn = (dt: number, rdt: number) => void;

export class GameLoop {
  private raf = 0;
  private last = 0;
  private running = false;
  private tick: TickFn;

  /** frames-per-second, smoothed */
  fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;

  /** 1 = normal. Set below 1 for slow motion. */
  timeScale = 1;

  private hitStopRemaining = 0;
  private slowMoRemaining = 0;
  private slowMoScale = 1;

  paused = false;

  /** total scaled seconds since start — handy for shader-ish effects */
  elapsed = 0;

  constructor(tick: TickFn) {
    this.tick = tick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const rawDt = Math.max(0, (now - this.last) / 1000);
      this.last = now;
      // Clamp what the simulation sees, but measure fps from the real delta so
      // a stalling machine reports the truth.
      let rdt = rawDt > 0.05 ? 0.05 : rawDt;

      this.fpsAccum += rawDt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.4) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }

      let scale = this.timeScale;

      if (this.hitStopRemaining > 0) {
        this.hitStopRemaining -= rdt;
        // Keep a little time moving so hit-stop reads as impact, not a freeze
        // that makes buffered inputs feel dropped.
        scale = 0.14;
      } else if (this.slowMoRemaining > 0) {
        this.slowMoRemaining -= rdt;
        scale *= this.slowMoScale;
      }

      if (this.paused) scale = 0;

      const dt = rdt * scale;
      this.elapsed += dt;
      this.tick(dt, rdt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Freeze the world briefly. The single most important juice primitive. */
  hitStopScale = 1;

  hitStop(seconds: number): void {
    this.hitStopRemaining = Math.min(0.2, Math.max(this.hitStopRemaining, seconds * this.hitStopScale));
  }

  slowMo(seconds: number, scale = 0.3): void {
    this.slowMoRemaining = Math.max(this.slowMoRemaining, seconds);
    this.slowMoScale = scale;
  }

  clearSlowMo(): void {
    this.slowMoRemaining = 0;
  }

  clearTimeEffects(): void {
    this.hitStopRemaining = 0;
    this.slowMoRemaining = 0;
  }
}
