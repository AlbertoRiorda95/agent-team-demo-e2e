// The ports of the viz-web server's use cases: what they need from the
// outside (the message bus, a logger, a clock). The NATS adapter
// (adapters/nats-bus.ts) implements the bus; the tests use a fake.
import type { PipelineError, ServiceStatus } from '@albertoriorda95/trajectory-proto';

/** Receives the payload of one message (binary Protobuf). */
export type MessageHandler = (data: Uint8Array) => Promise<void>;

/** The subscription to `launches.accepted`, replayed from the start of the stream. */
export interface LaunchesAcceptedSubscription {
  /** Starts consuming in the background; returns at once. Call once. */
  start(handler: MessageHandler): void;
  /** True while the subscription is up (connected and consuming). */
  isUp(): boolean;
}

/** What the use cases publish. */
export interface Publisher {
  /** True while a message can be published (connected). */
  canPublish(): boolean;
  /** On `pipeline.errors`. */
  publishPipelineError(error: PipelineError): Promise<void>;
  /** On `status.viz-web`. */
  publishStatus(status: ServiceStatus): Promise<void>;
}

export interface Bus extends LaunchesAcceptedSubscription, Publisher {
  /** Stops consuming and closes the connection. */
  close(): Promise<void>;
}

/** The subset of the pino logger the use cases use. */
export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export type Clock = () => Date;
