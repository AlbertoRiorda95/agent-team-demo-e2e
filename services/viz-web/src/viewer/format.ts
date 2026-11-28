import { timestampDate } from '@bufbuild/protobuf/wkt';
import { Sample_Phase, TrajectoryComputed_EndReason } from '@albertoriorda95/trajectory-proto';
import type { Timestamp } from '@bufbuild/protobuf/wkt';

export const num = (v: number, digits = 2): string => v.toFixed(digits);

export const shortId = (id: string): string => id.slice(0, 8);

export function phaseLabel(p: Sample_Phase): string {
  if (p === Sample_Phase.BURN) return 'Burn';
  if (p === Sample_Phase.BALLISTIC) return 'Ballistic';
  return 'Unknown';
}

export function endReasonLabel(r: TrajectoryComputed_EndReason): string {
  if (r === TrajectoryComputed_EndReason.GROUND) return 'Landed on the ground';
  if (r === TrajectoryComputed_EndReason.TIME_LIMIT) return 'Propagation time reached, not landed';
  return 'Unknown';
}

export function timeOf(ts: Timestamp | undefined): string {
  if (!ts) return '—';
  return timestampDate(ts).toISOString().slice(11, 19) + ' UTC';
}

export const clock = (d: Date): string => d.toTimeString().slice(0, 8);

export function endReasonShort(r: string): string {
  if (r === 'END_REASON_GROUND') return 'Landed';
  if (r === 'END_REASON_TIME_LIMIT') return 'Time limit';
  return 'Unknown';
}

/** "2026-11-28 10:00:00 UTC" from an RFC 3339 UTC time. */
export const receivedLabel = (iso: string): string => iso.slice(0, 19).replace('T', ' ') + ' UTC';
