import { fromJson } from '@bufbuild/protobuf';
import { LaunchRequestSchema, TrajectoryComputedSchema, type LaunchRequest, type TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import type { components } from './schema';

type RawSummary = components['schemas']['LaunchSummary'];
export type LaunchPageRaw = components['schemas']['LaunchPage'];

export interface LaunchRow {
  launchId: string;
  receivedAt: string;
  request: LaunchRequest;
  endReason: RawSummary['end_reason'];
  flightTimeS: number;
  maxHeightM: number;
  rangeM: number;
}

export interface LaunchPage {
  items: LaunchRow[];
  nextCursor: string | null;
}

/** An error of the history API: the `detail` of the problem+json when there is one. */
export class HistoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = (url: string) => Promise<Response>;

async function failure(res: Response): Promise<HistoryError> {
  let detail = '';
  try {
    detail = ((await res.json()) as Partial<components['schemas']['Problem']>).detail ?? '';
  } catch {
    // not a problem body
  }
  return new HistoryError(detail || `Request failed (${res.status})`, res.status);
}

export function toRow(raw: RawSummary): LaunchRow {
  return {
    launchId: raw.launch_id,
    receivedAt: raw.received_at,
    request: fromJson(LaunchRequestSchema, raw.request as never),
    endReason: raw.end_reason,
    flightTimeS: raw.flight_time_s,
    maxHeightM: raw.max_height_m,
    rangeM: raw.range_m,
  };
}

export async function fetchLaunches(cursor: string | null, limit = 50, f: Fetch = u => fetch(u)): Promise<LaunchPage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  let res: Response;
  try {
    res = await f(`/api/launches?${q}`);
  } catch {
    throw new HistoryError('The history cannot be reached', 0);
  }
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as LaunchPageRaw;
  return { items: body.items.map(toRow), nextCursor: body.next_cursor };
}

export async function fetchTrajectory(id: string, f: Fetch = u => fetch(u)): Promise<TrajectoryComputed> {
  let res: Response;
  try {
    res = await f(`/api/launches/${encodeURIComponent(id)}/trajectory`);
  } catch {
    throw new HistoryError('The history cannot be reached', 0);
  }
  if (!res.ok) throw await failure(res);
  return fromJson(TrajectoryComputedSchema, (await res.json()) as never);
}
