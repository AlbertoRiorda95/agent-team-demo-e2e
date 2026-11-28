// The ports of the viz-web server's use cases: what they need from the
// outside (the message bus, a logger, a clock). The NATS adapter
// (adapters/nats-bus.ts) implements the bus; the tests use a fake.
import type { PipelineError, ServiceStatus } from '@albertoriorda95/trajectory-proto';

/** Receives the payload of one message (binary Protobuf). */
export type MessageHandler = (data: Uint8Array) => Promise<void>;

/** The handlers of the subscriptions, one per subject. */
export interface MessageHandlers {
  /** `launches.accepted`, replayed from the start of the stream. */
  launchesAccepted: MessageHandler;
  /** `trajectories.computed`, from the last message of the stream on. */
  trajectoriesComputed: MessageHandler;
}

/** Called with true when the NATS connection is (re)established, false when it drops. */
export type ConnectionListener = (connected: boolean) => void;

/** The subscriptions of the server. */
export interface Subscriptions {
  /** Starts consuming in the background; returns at once. Call once. */
  start(handlers: MessageHandlers): void;
  /** True while every subscription is up (connected and consuming). */
  isUp(): boolean;
  /** True while the NATS connection is up. */
  isConnected(): boolean;
  /** Registers a listener of the connection state; returns the function that removes it. */
  onConnectionChange(listener: ConnectionListener): () => void;
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

export interface Bus extends Subscriptions, Publisher {
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
