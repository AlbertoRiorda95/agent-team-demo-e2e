import type { Sample, Sample_Phase } from '@albertoriorda95/trajectory-proto';
import { sampleIndexAt } from './playback';

/** The state at a playback time: linearly interpolated between samples `index` and `index + 1`. */
export interface PlaybackState {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: Sample_Phase;
  /** The last sample at or before t. */
  index: number;
  /** True when t is strictly between sample `index` and `index + 1`. */
  between: boolean;
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/**
 * State at `t`, clamped to the samples' time range. On a sample (or on duplicate
 * sample times, where the later one is used) it is exactly that sample.
 */
export function interpolateAt(samples: readonly Sample[], t: number): PlaybackState | undefined {
  const first = samples[0];
  if (!first) return undefined;
  const last = samples[samples.length - 1] ?? first;
  const tc = Math.min(Math.max(t, first.tS), last.tS);
  const index = sampleIndexAt(samples, tc);
  const a = samples[index] ?? first;
  const b = samples[index + 1];
  if (!b || tc <= a.tS) {
    return { t: tc, x: a.xM, y: a.yM, z: a.zM, vx: a.vxMps, vy: a.vyMps, vz: a.vzMps, phase: a.phase, index, between: false };
  }
  // a.tS < tc < b.tS here: sampleIndexAt returned the last sample at or before tc
  const f = (tc - a.tS) / (b.tS - a.tS);
  return {
    t: tc,
    x: lerp(a.xM, b.xM, f),
    y: lerp(a.yM, b.yM, f),
    z: lerp(a.zM, b.zM, f),
    vx: lerp(a.vxMps, b.vxMps, f),
    vy: lerp(a.vyMps, b.vyMps, f),
    vz: lerp(a.vzMps, b.vzMps, f),
    phase: a.phase,
    index,
    between: true,
  };
}
