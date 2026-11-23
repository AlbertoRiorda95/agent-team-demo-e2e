// Test doubles of the bus port (src/application/ports.ts) and helpers that
// build the messages of launches.accepted.
import { create, toBinary } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  LaunchAcceptedSchema,
  type LaunchAccepted,
  type PipelineError,
  type ServiceStatus,
} from '@albertoriorda95/trajectory-proto';
import type { Bus, Logger, MessageHandler } from '../src/application/ports.ts';

export class FakeBus implements Bus {
  handler: MessageHandler | undefined;
  up = true;
  connected = true;
  failPublish = false;
  readonly errors: PipelineError[] = [];
  readonly statuses: ServiceStatus[] = [];
  closed = false;

  start(handler: MessageHandler): void {
    this.handler = handler;
  }
  isUp(): boolean {
    return this.up;
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

  /** Delivers one message as the subscription would. */
  async deliver(data: Uint8Array): Promise<void> {
    if (this.handler === undefined) throw new Error('the subscription is not started');
    await this.handler(data);
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
