// The stored history as the viewer browses it (docs/design/viewer.md > Data
// and API, History): the launches of the prefix in force, newest first by
// (received_at, id), in keyset pages. The cursor is opaque to the client: the
// (received_at, id) of the last row of a page, base64url JSON.
import { fromJson, toJson } from '@bufbuild/protobuf';
import { TimestampSchema, type Timestamp } from '@bufbuild/protobuf/wkt';
import type { LaunchRequest, TrajectoryComputed_EndReason } from '@albertoriorda95/trajectory-proto';
import { UUID } from './uuid.ts';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** One row of the history list. */
export interface LaunchSummary {
  launchId: string;
  receivedAt: Timestamp;
  computedAt: Timestamp;
  request: LaunchRequest;
  endReason: TrajectoryComputed_EndReason;
  flightTimeS: number;
  maxHeightM: number;
  rangeM: number;
  sampleCount: number;
}

/** Where a page starts: strictly after this (received_at, id), newest first. */
export interface HistoryCursor {
  receivedAt: Timestamp;
  launchId: string;
}

export interface HistoryPage {
  items: LaunchSummary[];
  /** The cursor of the next page; undefined on the last page. */
  next: HistoryCursor | undefined;
}

/** A request the history rejects (400). */
export class InvalidHistoryRequest extends Error {}

/** The limit query parameter: undefined gives the default; an integer in [1, 200] otherwise. */
export function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_PAGE_LIMIT;
  if (typeof raw !== 'string' || !/^[0-9]{1,4}$/.test(raw)) {
    throw new InvalidHistoryRequest(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`);
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new InvalidHistoryRequest(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`);
  }
  return limit;
}

export function encodeCursor(cursor: HistoryCursor): string {
  const json = JSON.stringify({ r: toJson(TimestampSchema, cursor.receivedAt), i: cursor.launchId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** The cursor query parameter: undefined for the first page; throws InvalidHistoryRequest when it is not one of ours. */
export function parseCursor(raw: unknown): HistoryCursor | undefined {
  if (raw === undefined) return undefined;
  const invalid = new InvalidHistoryRequest('cursor is not a cursor of this API');
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw invalid;
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (typeof value !== 'object' || value === null) throw invalid;
  const { r, i } = value as Record<string, unknown>;
  if (typeof r !== 'string' || typeof i !== 'string' || !UUID.test(i)) throw invalid;
  let receivedAt: Timestamp;
  try {
    receivedAt = fromJson(TimestampSchema, r);
  } catch {
    throw invalid;
  }
  return { receivedAt, launchId: i.toLowerCase() };
}
