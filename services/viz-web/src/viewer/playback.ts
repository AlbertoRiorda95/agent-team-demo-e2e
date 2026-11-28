import type { Sample } from '@albertoriorda95/trajectory-proto';

/** Index of the last sample whose time is at or before `t` (0 when none is). */
export function sampleIndexAt(samples: readonly Sample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((samples[mid]?.tS ?? 0) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const SPEEDS = [0.25, 1, 4] as const;

/** The playback clock: the new time after `dtSeconds` of wall time at `speed`, stopping at `tLast`. */
export function advance(t: number, dtSeconds: number, tLast: number, speed = 1): { t: number; ended: boolean } {
  const next = t + dtSeconds * speed;
  return next >= tLast ? { t: tLast, ended: true } : { t: next, ended: false };
}

/**
 * Time of the sample `delta` steps from t: forward goes to the next sample after t,
 * backward to the last sample before t (the current one when t is between samples).
 */
export function stepTime(samples: readonly Sample[], t: number, delta: number): number {
  if (samples.length === 0) return 0;
  const i0 = sampleIndexAt(samples, t);
  const onSample = (samples[i0]?.tS ?? 0) >= t;
  const base = delta < 0 && !onSample ? i0 + 1 : i0;
  const i = Math.min(samples.length - 1, Math.max(0, base + delta));
  return samples[i]?.tS ?? 0;
}

/** Rows `[start, end)` of page `page` (0-based) of a table paged by `pageSize`. */
export function pageRange(total: number, page: number, pageSize: number): { start: number; end: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { start: p * pageSize, end: Math.min(total, (p + 1) * pageSize), pages };
}
