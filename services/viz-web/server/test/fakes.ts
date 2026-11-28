// Test doubles of the bus port (src/application/ports.ts) and helpers that
// build the messages of launches.accepted and trajectories.computed.
import { create, toBinary } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  LaunchAcceptedSchema,
  Sample_Phase,
  TrajectoryComputedSchema,
  TrajectoryComputed_EndReason,
  type LaunchAccepted,
  type TrajectoryComputed,
  type PipelineError,
  type ServiceStatus,
} from '@albertoriorda95/trajectory-proto';
import type {
  Bus,
  ConnectionListener,
  Logger,
  MessageHandlers,
} from '../src/application/ports.ts';

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
