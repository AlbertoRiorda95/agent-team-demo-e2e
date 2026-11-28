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

/** The playback clock at 1x: the new time after `dtSeconds`, stopping at `tLast`. */
export function advance(t: number, dtSeconds: number, tLast: number): { t: number; ended: boolean } {
  const next = t + dtSeconds;
  return next >= tLast ? { t: tLast, ended: true } : { t: next, ended: false };
}

/** Time of the sample `delta` steps from the one at or before `t`, clamped. */
export function stepTime(samples: readonly Sample[], t: number, delta: number): number {
  if (samples.length === 0) return 0;
  const i = Math.min(samples.length - 1, Math.max(0, sampleIndexAt(samples, t) + delta));
  return samples[i]?.tS ?? 0;
}

/** Rows `[start, end)` of page `page` (0-based) of a table paged by `pageSize`. */
export function pageRange(total: number, page: number, pageSize: number): { start: number; end: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { start: p * pageSize, end: Math.min(total, (p + 1) * pageSize), pages };
}
