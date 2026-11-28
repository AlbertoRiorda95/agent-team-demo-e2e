// Test doubles of the bus port (src/application/ports.ts) and helpers that
// build the messages of launches.accepted and trajectories.computed.
import { create, toBinary } from '@bufbuild/protobuf';
import { timestampFromDate, type Timestamp } from '@bufbuild/protobuf/wkt';
import {
  ConfigAppliedSchema,
  LaunchAcceptedSchema,
  Sample_Phase,
  TrajectoryComputedSchema,
  TrajectoryComputed_EndReason,
  type ConfigApplied,
  type LaunchAccepted,
  type TrajectoryComputed,
  type PipelineError,
  type ServiceStatus,
} from '@albertoriorda95/trajectory-proto';
import {
  HistoryUnavailable,
  type Bus,
  type ConnectionListener,
  type HistoryRepository,
  type Logger,
  type MessageHandlers,
} from '../src/application/ports.ts';
import type { HistoryCursor, LaunchSummary } from '../src/domain/history.ts';

export class FakeBus implements Bus {
  handlers: MessageHandlers | undefined;
  up = true;
  connected = true;
  readonly listeners = new Set<ConnectionListener>();
  failPublish = false;
  readonly errors: PipelineError[] = [];
  readonly statuses: ServiceStatus[] = [];
  closed = false;

  start(handlers: MessageHandlers): void {
    this.handlers = handlers;
  }
  isUp(): boolean {
    return this.up;
  }
  isConnected(): boolean {
    return this.connected;
  }
  onConnectionChange(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  canPublish(): boolean {
    return this.connected;
  }
  async publishPipelineError(error: PipelineError): Promise<void> {
    if (this.failPublish) throw new Error('publish failed');
    this.errors.push(error);
  }
  async publishStatus(status: ServiceStatus): Promise<void> {
    if (this.failPublish) throw new Error('publish failed');
    this.statuses.push(status);
  }
  async close(): Promise<void> {
    this.closed = true;
  }

  /** Delivers one message of launches.accepted as the subscription would. */
  async deliver(data: Uint8Array): Promise<void> {
    if (this.handlers === undefined) throw new Error('the subscriptions are not started');
    await this.handlers.launchesAccepted(data);
  }

  /** Delivers one message of trajectories.computed as the subscription would. */
  async deliverTrajectory(data: Uint8Array): Promise<void> {
    if (this.handlers === undefined) throw new Error('the subscriptions are not started');
    await this.handlers.trajectoriesComputed(data);
  }

  /** Delivers one message of config.store.applied as the subscription would. */
  async deliverConfigApplied(data: Uint8Array): Promise<void> {
    if (this.handlers === undefined) throw new Error('the subscriptions are not started');
    await this.handlers.storeConfigApplied(data);
  }

  /** The connection drops (false) or comes back (true). */
  setConnected(connected: boolean): void {
    this.connected = connected;
    for (const listener of this.listeners) listener(connected);
  }
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** A valid LaunchAccepted; `n` makes launch_id and the request distinct. */
export function launchAccepted(n: number, overrides: Partial<LaunchAccepted> = {}): LaunchAccepted {
  const message = create(LaunchAcceptedSchema, {
    launchId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    acceptedAt: timestampFromDate(new Date(Date.UTC(2026, 10, 23, 10, 0, 0, n % 1000))),
    request: {
      massKg: 1 + n,
      position: { xM: 1, yM: 2, zM: 0 },
      azimuthDeg: 45,
      elevationDeg: 60,
      forceN: 100,
      burnDurationS: 0.5,
    },
    config: { propagationTimeS: 60, sampleStepS: 0.01, gravityMps2: 9.81, configVersion: 0n },
  });
  return Object.assign(message, overrides);
}

export function encode(message: LaunchAccepted): Uint8Array {
  return toBinary(LaunchAcceptedSchema, message);
}

/** A valid TrajectoryComputed with `samples` samples; `n` makes launch_id distinct. */
export function trajectoryComputed(
  n: number,
  samples = 3,
  overrides: Partial<TrajectoryComputed> = {},
): TrajectoryComputed {
  const message = create(TrajectoryComputedSchema, {
    launchId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    acceptedAt: timestampFromDate(new Date(Date.UTC(2026, 10, 28, 10, 0, 0, 123))),
    computedAt: timestampFromDate(new Date(Date.UTC(2026, 10, 28, 10, 0, 0, 456))),
    request: {
      massKg: 1,
      position: { xM: 0, yM: 0, zM: 0 },
      azimuthDeg: 45,
      elevationDeg: 60,
      forceN: 100,
      burnDurationS: 0.5,
    },
    config: { propagationTimeS: 60, sampleStepS: 0.01, gravityMps2: 9.81, configVersion: 0n },
    endReason: TrajectoryComputed_EndReason.GROUND,
    flightTimeS: 0.01 * (samples - 1),
    maxHeightM: 10 + n,
    rangeM: 20,
    samples: Array.from({ length: samples }, (_, seq) => ({
      seq,
      tS: 0.01 * seq,
      xM: seq,
      yM: seq,
      zM: seq,
      vxMps: 1,
      vyMps: 1,
      vzMps: 1,
      phase: seq === 0 ? Sample_Phase.BURN : Sample_Phase.BALLISTIC,
    })),
  });
  return Object.assign(message, overrides);
}

export function encodeTrajectory(message: TrajectoryComputed): Uint8Array {
  return toBinary(TrajectoryComputedSchema, message);
}

/** A store ConfigApplied with the table prefix in force. */
export function storeConfigApplied(tablePrefix: string, overrides: Partial<ConfigApplied> = {}): Uint8Array {
  const message = create(ConfigAppliedSchema, {
    service: 'store',
    instance: 'store-0',
    configVersion: 3n,
    ok: true,
    appliedAt: timestampFromDate(new Date(Date.UTC(2026, 10, 28, 9, 0, 0))),
    payload: { case: 'store', value: { tablePrefix } },
  });
  return toBinary(ConfigAppliedSchema, Object.assign(message, overrides));
}

function compareTimestamps(a: Timestamp, b: Timestamp): number {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  return a.nanos - b.nanos;
}

/** Newest first by (received_at, id), as the SQL of the PostgreSQL adapter. */
function newestFirst(a: { receivedAt: Timestamp; launchId: string }, b: { receivedAt: Timestamp; launchId: string }) {
  return compareTimestamps(b.receivedAt, a.receivedAt) || (a.launchId < b.launchId ? 1 : a.launchId > b.launchId ? -1 : 0);
}

/** An in-memory history: the stored trajectories per table prefix. */
export class FakeHistory implements HistoryRepository {
  readonly tables = new Map<string, TrajectoryComputed[]>();
  /** The prefixes the reads were made with, in order. */
  readonly prefixes: string[] = [];
  unavailable = false;
  closed = false;

  store(prefix: string, trajectory: TrajectoryComputed): void {
    const rows = this.tables.get(prefix) ?? [];
    rows.push(trajectory);
    this.tables.set(prefix, rows);
  }

  async listLaunches(prefix: string, after: HistoryCursor | undefined, limit: number): Promise<LaunchSummary[]> {
    this.#read(prefix);
    const rows = (this.tables.get(prefix) ?? []).map(toSummary).sort(newestFirst);
    const start = after === undefined ? 0 : rows.findIndex((row) => newestFirst(row, after) > 0);
    return start < 0 ? [] : rows.slice(start, start + limit);
  }

  async findTrajectory(prefix: string, launchId: string): Promise<TrajectoryComputed | undefined> {
    this.#read(prefix);
    return (this.tables.get(prefix) ?? []).find((t) => t.launchId === launchId);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  #read(prefix: string): void {
    this.prefixes.push(prefix);
    if (this.unavailable) throw new HistoryUnavailable('database unavailable: connection refused');
  }
}

function toSummary(t: TrajectoryComputed): LaunchSummary {
  return {
    launchId: t.launchId,
    receivedAt: t.acceptedAt!,
    computedAt: t.computedAt!,
    request: t.request!,
    endReason: t.endReason,
    flightTimeS: t.flightTimeS,
    maxHeightM: t.maxHeightM,
    rangeM: t.rangeM,
    sampleCount: t.samples.length,
  };
}
