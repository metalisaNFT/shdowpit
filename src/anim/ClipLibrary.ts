/**
 * Decodes the baked animation data (clips.json, produced by
 * tools/bakeclips.mjs from the CC0 KayKit pack — see THIRD_PARTY_ASSETS.md)
 * into shared THREE.AnimationClip instances.
 *
 * Everything is decoded exactly once at module init and shared by every
 * character: clips are immutable, mixers per character bind them by bone
 * name. There is no GLTF loading, no fetch, no async — the animation set is
 * part of the bundle and works offline.
 *
 * Every clip carries a quaternion track for EVERY rig bone (single-key
 * rest-pose tracks are synthesized where the source track was static).
 * That guarantee is what makes crossfades safe: no bone is ever left holding
 * a stale pose from the previous action.
 */

import * as THREE from 'three';
import data from './clips.json';

export interface ClipMeta {
  clip: THREE.AnimationClip;
  duration: number;
  loop: boolean;
  /** the strike frame, seconds — peak main-hand speed, computed at bake */
  impactT?: number;
  /** ground speed (m/s, source units) the locomotion cycle was authored for */
  stride?: number;
  /** optional extracted root displacement curve [x0,z0,x1,z1,...] mm @ fps */
  rootMotion?: number[];
}

interface BakedBone {
  r?: number[];
  r0?: number[];
  p?: number[];
  p0?: number[];
}
interface BakedClip {
  dur: number;
  fps: number;
  loop: boolean;
  bones: Record<string, BakedBone>;
  impactT?: number;
  stride?: number;
  rootMotion?: number[];
}
interface BakedFile {
  measurements: Record<string, number>;
  rest: Record<string, { t: number[]; r: number[] }>;
  clips: Record<string, BakedClip>;
}

const FILE = data as unknown as BakedFile;

export const REST_POSE: Record<string, { t: number[]; r: number[] }> = FILE.rest;
export const RIG_MEASUREMENTS = FILE.measurements;
export const BONE_NAMES = Object.keys(FILE.rest);

const timesCache = new Map<string, Float32Array>();
function uniformTimes(count: number, fps: number, dur: number): Float32Array {
  const key = `${count}/${fps}`;
  let t = timesCache.get(key);
  if (!t) {
    t = new Float32Array(count);
    for (let i = 0; i < count; i++) t[i] = Math.min(dur, i / fps);
    timesCache.set(key, t);
  }
  return t;
}

const INV = 1 / 32767;

function decodeClip(name: string, c: BakedClip): ClipMeta {
  const tracks: THREE.KeyframeTrack[] = [];

  for (const bone of BONE_NAMES) {
    const b = c.bones[bone];
    const restR = REST_POSE[bone].r;

    if (b?.r) {
      const n = b.r.length / 4;
      const vals = new Float32Array(b.r.length);
      for (let i = 0; i < b.r.length; i++) vals[i] = b.r[i] * INV;
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, uniformTimes(n, c.fps, c.dur), vals));
    } else {
      const src = b?.r0 ? b.r0.map((v) => v * INV) : restR;
      tracks.push(
        new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, new Float32Array([0]), new Float32Array(src))
      );
    }

    if (bone === 'Hips') {
      if (b?.p) {
        const n = b.p.length / 3;
        const vals = new Float32Array(b.p.length);
        for (let i = 0; i < b.p.length; i++) vals[i] = b.p[i] * 0.001;
        tracks.push(new THREE.VectorKeyframeTrack('Hips.position', uniformTimes(n, c.fps, c.dur), vals));
      } else {
        const src = b?.p0 ? b.p0.map((v) => v * 0.001) : REST_POSE.Hips.t;
        tracks.push(new THREE.VectorKeyframeTrack('Hips.position', new Float32Array([0]), new Float32Array(src)));
      }
    }
  }

  const clip = new THREE.AnimationClip(name, c.dur, tracks);
  return {
    clip,
    duration: c.dur,
    loop: c.loop,
    impactT: c.impactT,
    stride: c.stride,
    rootMotion: c.rootMotion,
  };
}

/** All baked clips, decoded once and shared by every character in the game. */
export const CLIPS: Record<string, ClipMeta> = {};
for (const [name, c] of Object.entries(FILE.clips)) CLIPS[name] = decodeClip(name, c);

export type ClipName = keyof typeof CLIPS & string;

export function clipMeta(name: string): ClipMeta {
  const m = CLIPS[name];
  if (!m) throw new Error(`unknown clip ${name}`);
  return m;
}
