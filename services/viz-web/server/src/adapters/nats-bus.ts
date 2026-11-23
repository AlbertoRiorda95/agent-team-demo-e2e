// The NATS adapter of the bus port (application/ports.ts), with nats.js v3.
// - The subscription is an ordered, ephemeral JetStream consumer on
//   `launches.accepted`, deliver policy "all", on the stream that holds the
//   subject (`LAUNCHES`, proto/README.md): every start replays the stream, and
//   the ordered consumer resumes after a reconnect with no gaps.
// - The server never crashes because NATS is down: the connection is retried
//   for ever, and the subscription is set up again (with a backoff) when it
//   fails, for example while the stream does not exist yet.
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  DeliverPolicy,
  jetstream,
  jetstreamManager,
  type ConsumerMessages,
} from '@nats-io/jetstream';
import { toBinary } from '@bufbuild/protobuf';
import {
  LAUNCHES_ACCEPTED,
  PIPELINE_ERRORS,
  PipelineErrorSchema,
  ServiceStatusSchema,
  statusSubject,
  type PipelineError,
  type ServiceStatus,
} from '@albertoriorda95/trajectory-proto';
import type { Bus, Logger, MessageHandler } from '../application/ports.ts';

export interface NatsBusOptions {
  /** NATS_URL, for example nats://nats:4222. */
  url: string;
  logger: Logger;
  /** Connection name shown by the NATS server. */
  name?: string;
  /** Time between two reconnect attempts, in ms. */
  reconnectTimeWaitMs?: number;
  /** Backoff before setting the subscription up again, in ms. */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export class NatsBus implements Bus {
  readonly #options: Required<NatsBusOptions>;
  readonly #log: Logger;
  #nc: NatsConnection | undefined;
  #connecting: Promise<NatsConnection> | undefined;
  #messages: ConsumerMessages | undefined;
  #connected = false;
  #consuming = false;
  #closed = false;
  #started = false;
  #wakeUp: (() => void) | undefined;

  constructor(options: NatsBusOptions) {
    this.#options = {
      name: 'viz-web',
      reconnectTimeWaitMs: 1000,
      initialBackoffMs: 500,
      maxBackoffMs: 10_000,
      ...options,
    };
    this.#log = options.logger;
  }

  start(handler: MessageHandler): void {
    if (this.#started) throw new Error('the subscription is already started');
    this.#started = true;
    void this.#run(handler);
  }

  isUp(): boolean {
    return !this.#closed && this.#connected && this.#consuming;
  }

  canPublish(): boolean {
    return !this.#closed && this.#connected;
  }

  async publishPipelineError(error: PipelineError): Promise<void> {
    const nc = this.#requireConnection();
    // through JetStream: the publish is acknowledged by the ERRORS stream
    await jetstream(nc).publish(PIPELINE_ERRORS, toBinary(PipelineErrorSchema, error));
  }

  async publishStatus(status: ServiceStatus): Promise<void> {
    // core NATS, no stream (proto/README.md > Streams)
    this.#requireConnection().publish(statusSubject('viz-web'), toBinary(ServiceStatusSchema, status));
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#wakeUp?.();
    try {
      await this.#messages?.close();
    } catch {
      // already closed
    }
    const nc = this.#nc ?? (await this.#connecting?.catch(() => undefined));
    if (nc !== undefined && !nc.isClosed()) await nc.close();
  }

  #requireConnection(): NatsConnection {
    if (this.#nc === undefined || !this.canPublish()) throw new Error('NATS is not connected');
    return this.#nc;
  }

  async #run(handler: MessageHandler): Promise<void> {
    let nc: NatsConnection;
    try {
      this.#connecting = connect({
        servers: this.#options.url,
        name: this.#options.name,
        waitOnFirstConnect: true, // retry the first connection too
        maxReconnectAttempts: -1,
        reconnectTimeWait: this.#options.reconnectTimeWaitMs,
      });
      nc = await this.#connecting;
    } catch (error) {
      if (!this.#closed) this.#log.error({ err: error }, 'cannot connect to NATS');
      return;
    }
    if (this.#closed) {
      await nc.close();
      return;
    }
    this.#nc = nc;
    this.#connected = true;
    this.#log.info({ server: nc.getServer() }, 'connected to NATS');
    void this.#watchConnection(nc);

    let backoffMs = this.#options.initialBackoffMs;
    while (!this.#closed) {
      try {
        await this.#consume(nc, handler);
        backoffMs = this.#options.initialBackoffMs;
      } catch (error) {
        if (this.#closed) break;
        this.#log.warn(
          { err: error, subject: LAUNCHES_ACCEPTED, retry_in_ms: backoffMs },
          'subscription to launches.accepted failed, retrying',
        );
      } finally {
        this.#consuming = false;
        this.#messages = undefined;
      }
      if (this.#closed) break;
      await this.#sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, this.#options.maxBackoffMs);
    }
  }

  async #consume(nc: NatsConnection, handler: MessageHandler): Promise<void> {
    const jsm = await jetstreamManager(nc);
    const stream = await jsm.streams.find(LAUNCHES_ACCEPTED);
    const consumer = await jetstream(nc).consumers.get(stream, {
      filter_subjects: LAUNCHES_ACCEPTED,
      deliver_policy: DeliverPolicy.All,
    });
    const messages = await consumer.consume();
    this.#messages = messages;
    this.#consuming = true;
    this.#log.info({ stream, subject: LAUNCHES_ACCEPTED }, 'consuming launches.accepted');
    void this.#watchConsumer(messages);
    // PERF: one message at a time keeps the stream order of the record.
    for await (const message of messages) {
      // ordered consumers have no acks: a rejected message is simply not kept
      await handler(message.data);
    }
  }

  async #watchConnection(nc: NatsConnection): Promise<void> {
    for await (const status of nc.status()) {
      switch (status.type) {
        case 'disconnect':
          this.#connected = false;
          this.#log.warn({ server: status.server }, 'disconnected from NATS');
          break;
        case 'reconnect':
          this.#connected = true;
          this.#log.info({ server: status.server }, 'reconnected to NATS');
          break;
        default:
          break;
      }
    }
  }

  async #watchConsumer(messages: ConsumerMessages): Promise<void> {
    for await (const status of messages.status()) {
      if (status.type === 'heartbeats_missed' || status.type === 'ordered_consumer_recreated') {
        this.#log.info({ event: status.type }, 'ordered consumer of launches.accepted');
      }
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.#wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
