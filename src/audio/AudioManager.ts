/**
 * All audio is synthesised at runtime — no asset pipeline, no loading, and it
 * keeps the whole game one download. Everything is short, dry and percussive
 * to match the visual language.
 */

type Voice = (t: number, gain: GainNode, ctx: AudioContext, pitch: number) => void;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private voices = new Map<string, Voice>();
  private lastPlayed = new Map<string, number>();

  volume = 0.7;
  muted = false;

  constructor() {
    this.registerVoices();
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise(1.2);
    } catch (err) {
      console.warn('[Audio] unavailable', err);
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noise(dur: number, gain: GainNode, filterType: BiquadFilterType, freq: number, q = 1): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f);
    f.connect(gain);
    src.start();
    src.stop(ctx.currentTime + dur);
    return src;
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: GainNode,
    delay = 0
  ): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(gain);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }

  /** per-shot volume multiplier, set by play() */
  private shot = 1;

  private env(attack: number, decay: number, peak: number, delay = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak * this.shot), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private registerVoices(): void {
    const V = this.voices;

    V.set('swing', (_t, _g, _c, pitch) => {
      const g = this.env(0.005, 0.13, 0.16);
      this.noise(0.16, g, 'bandpass', 900 * pitch, 1.2);
    });

    V.set('footstep', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.05, 0.18);
      this.noise(0.07, g, 'bandpass', 380 * pitch, 1.2);
    });

    V.set('light_hit', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.11, 0.5);
      this.noise(0.12, g, 'bandpass', 1800 * pitch, 2.4);
      const g2 = this.env(0.001, 0.09, 0.32);
      this.tone('square', 420 * pitch, 130 * pitch, 0.09, g2);
    });

    V.set('heavy_hit', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.28, 0.62);
      this.noise(0.3, g, 'lowpass', 900 * pitch, 1);
      const g2 = this.env(0.001, 0.24, 0.6);
      this.tone('sawtooth', 190 * pitch, 42 * pitch, 0.24, g2);
    });

    // CRITICAL — a bright metallic overtone layered on the base hit, so a crit
    // is audible as "that one landed properly" without reading the number.
    V.set('crit', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.2, 0.42);
      this.tone('square', 1500 * pitch, 620 * pitch, 0.19, g);
      const g2 = this.env(0.001, 0.1, 0.3);
      this.noise(0.1, g2, 'highpass', 3600 * pitch, 1.2);
      const g3 = this.env(0.002, 0.34, 0.2, 0.02);
      this.tone('sine', 900 * pitch, 700 * pitch, 0.34, g3, 0.02);
    });

    // POISON — a wet, low hiss. Acid green has a sound now, not just a colour.
    V.set('poison', (_t, _g, _c, pitch) => {
      const g = this.env(0.02, 0.4, 0.26);
      this.noise(0.42, g, 'bandpass', 480 * pitch, 0.8);
      const g2 = this.env(0.03, 0.34, 0.16);
      this.tone('sine', 150 * pitch, 84 * pitch, 0.34, g2);
    });

    V.set('parry', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.5, 0.42);
      this.tone('square', 2400 * pitch, 900 * pitch, 0.42, g);
      const g2 = this.env(0.001, 0.16, 0.4);
      this.noise(0.16, g2, 'highpass', 3200, 1);
      const g3 = this.env(0.002, 0.7, 0.2, 0.03);
      this.tone('sine', 1600 * pitch, 1180 * pitch, 0.66, g3, 0.03);
    });

    V.set('block', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.18, 0.34);
      this.noise(0.2, g, 'bandpass', 600 * pitch, 3);
    });

    V.set('dodge', (_t, _g, _c, pitch) => {
      const g = this.env(0.01, 0.2, 0.2);
      this.noise(0.22, g, 'highpass', 1400 * pitch, 0.7);
    });

    V.set('player_hurt', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.3, 0.5);
      this.tone('sawtooth', 260 * pitch, 70, 0.28, g);
      const g2 = this.env(0.001, 0.16, 0.35);
      this.noise(0.18, g2, 'lowpass', 500, 1);
    });

    V.set('enemy_death', (_t, _g, _c, pitch) => {
      const g = this.env(0.002, 0.42, 0.5);
      this.tone('sawtooth', 300 * pitch, 48, 0.4, g);
      const g2 = this.env(0.001, 0.3, 0.38);
      this.noise(0.34, g2, 'lowpass', 1400, 0.6);
    });

    V.set('execute', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.16, 0.7);
      this.noise(0.18, g, 'bandpass', 2600 * pitch, 1.6);
      const g2 = this.env(0.004, 0.8, 0.55, 0.06);
      this.tone('sawtooth', 150 * pitch, 34, 0.8, g2, 0.06);
      const g3 = this.env(0.001, 0.5, 0.3, 0.02);
      this.tone('square', 90, 40, 0.5, g3, 0.02);
    });

    V.set('player_death', (_t, _g, _c) => {
      const g = this.env(0.02, 2.4, 0.6);
      this.tone('sine', 180, 26, 2.4, g);
      const g2 = this.env(0.01, 1.8, 0.34);
      this.tone('sawtooth', 90, 20, 1.8, g2);
      const g3 = this.env(0.3, 2.0, 0.22);
      this.noise(2.2, g3, 'lowpass', 320, 0.7);
    });

    V.set('arrival', (_t, _g, _c) => {
      const g = this.env(0.02, 1.5, 0.5);
      this.tone('sawtooth', 62, 42, 1.5, g);
      const g2 = this.env(0.005, 0.9, 0.36, 0.08);
      this.tone('square', 220, 110, 0.9, g2, 0.08);
      const g3 = this.env(0.4, 1.6, 0.2);
      this.noise(1.8, g3, 'lowpass', 260, 0.9);
    });

    V.set('nemesis_return', (_t, _g, _c) => {
      const g = this.env(0.04, 1.8, 0.55);
      this.tone('sine', 48, 90, 0.9, g);
      const g2 = this.env(0.08, 1.4, 0.32, 0.12);
      this.tone('sawtooth', 90, 36, 1.3, g2, 0.12);
      const g3 = this.env(0.2, 1.6, 0.28);
      this.noise(1.7, g3, 'bandpass', 180, 0.7);
    });

    V.set('nemesis_escape', (_t, _g, _c) => {
      const g = this.env(0.01, 0.7, 0.34);
      this.noise(0.7, g, 'highpass', 900, 0.6);
      const g2 = this.env(0.02, 0.55, 0.28);
      this.tone('triangle', 240, 90, 0.5, g2);
    });

    V.set('nemesis_killed_you', (_t, _g, _c) => {
      const g = this.env(0.01, 1.6, 0.55);
      this.tone('sawtooth', 140, 38, 1.5, g);
      const g2 = this.env(0.02, 1.1, 0.3);
      this.tone('square', 70, 28, 1.0, g2);
    });

    V.set('nemesis_defeated', (_t, _g, _c) => {
      const g = this.env(0.005, 0.9, 0.5);
      this.tone('square', 220, 55, 0.8, g);
      const g2 = this.env(0.02, 1.1, 0.28, 0.08);
      this.tone('sine', 330, 110, 0.9, g2, 0.08);
    });

    V.set('nemesis_promotion', (_t, _g, _c) => {
      const g = this.env(0.01, 0.9, 0.36);
      this.tone('triangle', 330, 660, 0.5, g);
      const g2 = this.env(0.01, 1.1, 0.26, 0.12);
      this.tone('triangle', 494, 988, 0.6, g2, 0.12);
    });

    V.set('nemesis_betrayal', (_t, _g, _c) => {
      const g = this.env(0.004, 0.7, 0.4);
      this.tone('sawtooth', 180, 50, 0.6, g);
      const g2 = this.env(0.01, 0.4, 0.22);
      this.noise(0.4, g2, 'bandpass', 700, 1.4);
    });

    V.set('overlord_arrival', (_t, _g, _c) => {
      const g = this.env(0.04, 2.2, 0.62);
      this.tone('sawtooth', 42, 28, 2.1, g);
      const g2 = this.env(0.01, 1.4, 0.4, 0.1);
      this.tone('square', 110, 48, 1.3, g2, 0.1);
      const g3 = this.env(0.3, 2.0, 0.26);
      this.noise(2.1, g3, 'lowpass', 160, 0.8);
    });

    V.set('promote', (_t, _g, _c) => {
      const g = this.env(0.01, 0.9, 0.32);
      this.tone('triangle', 330, 660, 0.5, g);
      const g2 = this.env(0.01, 1.1, 0.24, 0.12);
      this.tone('triangle', 494, 988, 0.6, g2, 0.12);
    });

    V.set('world_event', (_t, _g, _c) => {
      const g = this.env(0.005, 0.34, 0.24);
      this.tone('square', 880, 660, 0.24, g);
    });

    V.set('pickup', (_t, _g, _c) => {
      const g = this.env(0.005, 0.5, 0.3);
      this.tone('triangle', 520, 1560, 0.4, g);
      const g2 = this.env(0.005, 0.7, 0.2, 0.09);
      this.tone('sine', 780, 2340, 0.5, g2, 0.09);
    });

    V.set('ui', (_t, _g, _c) => {
      const g = this.env(0.002, 0.07, 0.16);
      this.tone('square', 1200, 900, 0.06, g);
    });

    V.set('skill_cast', (_t, _g, _c, pitch) => {
      const g = this.env(0.004, 0.22, 0.28);
      this.noise(0.22, g, 'bandpass', 700 * pitch, 1.1);
      const g2 = this.env(0.003, 0.18, 0.22);
      this.tone('sawtooth', 180 * pitch, 70 * pitch, 0.18, g2);
    });

    V.set('skill_hit', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.2, 0.42);
      this.noise(0.2, g, 'lowpass', 900 * pitch, 1);
      const g2 = this.env(0.001, 0.16, 0.3);
      this.tone('square', 260 * pitch, 80, 0.16, g2);
    });

    V.set('skill_fail', (_t, _g, _c) => {
      const g = this.env(0.001, 0.09, 0.18);
      this.tone('square', 220, 90, 0.08, g);
    });

    V.set('skill_ready', (_t, _g, _c, pitch) => {
      const g = this.env(0.002, 0.16, 0.16);
      this.tone('sine', 880 * pitch, 1320 * pitch, 0.14, g);
    });

    V.set('surge_full', (_t, _g, _c) => {
      const g = this.env(0.01, 0.55, 0.28);
      this.tone('triangle', 220, 660, 0.4, g);
      const g2 = this.env(0.02, 0.7, 0.18, 0.05);
      this.tone('sine', 330, 990, 0.5, g2, 0.05);
    });

    V.set('ultimate', (_t, _g, _c, pitch) => {
      const g = this.env(0.004, 0.55, 0.62);
      this.noise(0.5, g, 'lowpass', 280 * pitch, 0.8);
      const g2 = this.env(0.006, 0.8, 0.5);
      this.tone('sawtooth', 70 * pitch, 28, 0.7, g2);
    });

    V.set('bow', (_t, _g, _c, pitch) => {
      const g = this.env(0.002, 0.14, 0.26);
      this.noise(0.16, g, 'highpass', 2200 * pitch, 1);
      const g2 = this.env(0.001, 0.1, 0.2);
      this.tone('triangle', 900 * pitch, 300, 0.1, g2);
    });

    V.set('arrow_hit', (_t, _g, _c, pitch) => {
      const g = this.env(0.001, 0.1, 0.36);
      this.noise(0.1, g, 'bandpass', 1400 * pitch, 3);
    });

    V.set('shockwave', (_t, _g, _c) => {
      const g = this.env(0.002, 0.55, 0.62);
      this.tone('sine', 140, 30, 0.55, g);
      const g2 = this.env(0.001, 0.34, 0.42);
      this.noise(0.38, g2, 'lowpass', 1100, 0.8);
    });

    V.set('fire', (_t, _g, _c) => {
      const g = this.env(0.02, 0.5, 0.2);
      this.noise(0.5, g, 'bandpass', 700, 0.8);
    });

    V.set('stagger', (_t, _g, _c, pitch) => {
      const g = this.env(0.002, 0.22, 0.3);
      this.tone('square', 160 * pitch, 60, 0.2, g);
    });

    V.set('heal', (_t, _g, _c) => {
      const g = this.env(0.02, 0.7, 0.24);
      this.tone('sine', 440, 880, 0.6, g);
    });
  }

  /** Brief master-volume dip for named arrivals. Never mutes combat. */
  duck(seconds = 0.5, amount = 0.45): void {
    if (!this.ctx || !this.master || this.muted) return;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    const now = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(now, t);
    g.linearRampToValueAtTime(this.volume * amount, t + 0.05);
    g.linearRampToValueAtTime(this.muted ? 0 : this.volume, t + seconds);
  }

  play(name: string, opts: { volume?: number; pitch?: number; minGap?: number } = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const gap = opts.minGap ?? 0.03;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -10;
    if (now - last < gap) return;
    this.lastPlayed.set(name, now);
    const v = this.voices.get(name);
    if (!v) return;
    this.shot = opts.volume ?? 1;
    try {
      v(now, this.master, this.ctx, opts.pitch ?? 1);
    } catch (err) {
      console.warn('[Audio] voice failed', name, err);
    }
  }
}
