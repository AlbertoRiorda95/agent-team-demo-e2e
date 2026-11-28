// The NATS adapter of the bus port (application/ports.ts), with nats.js v3.
// - Two ordered, ephemeral JetStream consumers, each on the stream that holds
//   its subject (proto/README.md); an ordered consumer resumes after a
//   reconnect with no gaps:
//   - `launches.accepted` (`LAUNCHES`), deliver policy "all": every start
//     replays the stream;
//   - `trajectories.computed` (`TRAJECTORIES`), deliver policy "last": every
//     start reads the latest trajectory, then the new ones
//     (docs/design/viewer.md > Data and API).
// - The connection state goes to the listeners of `onConnectionChange`.
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
  TRAJECTORIES_COMPUTED,
  PipelineErrorSchema,
  ServiceStatusSchema,
  statusSubject,
  type PipelineError,
  type ServiceStatus,
} from '@albertoriorda95/trajectory-proto';
import type {
  Bus,
  ConnectionListener,
  Logger,
  MessageHandler,
  MessageHandlers,
} from '../application/ports.ts';

/** One subscription: its subject, its deliver policy and its state. */
interface Consumption {
  subject: string;
  deliverPolicy: DeliverPolicy;
  handler: MessageHandler;
  messages: ConsumerMessages | undefined;
  consuming: boolean;
}

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
  #consumptions: Consumption[] = [];
  readonly #listeners = new Set<ConnectionListener>();
  #connected = false;
  #closed = false;
  #started = false;
  readonly #wakeUps = new Set<() => void>();

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

  start(handlers: MessageHandlers): void {
    if (this.#started) throw new Error('the subscriptions are already started');
    this.#started = true;
    this.#consumptions = [
      consumption(LAUNCHES_ACCEPTED, DeliverPolicy.All, handlers.launchesAccepted),
      consumption(TRAJECTORIES_COMPUTED, DeliverPolicy.Last, handlers.trajectoriesComputed),
    ];
    void this.#run();
  }

  isUp(): boolean {
    return (
      !this.#closed &&
      this.#connected &&
      this.#consumptions.length > 0 &&
      this.#consumptions.every((c) => c.consuming)
    );
  }

  isConnected(): boolean {
    return !this.#closed && this.#connected;
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
    for (const wakeUp of this.#wakeUps) wakeUp();
    for (const c of this.#consumptions) {
      try {
        await c.messages?.close();
      } catch {
        // already closed
      }
    }
    const nc = this.#nc ?? (await this.#connecting?.catch(() => undefined));
    if (nc !== undefined && !nc.isClosed()) await nc.close();
  }

  #requireConnection(): NatsConnection {
    if (this.#nc === undefined || !this.canPublish()) throw new Error('NATS is not connected');
    return this.#nc;
  }

  async #run(): Promise<void> {
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
    this.#log.info({ server: nc.getServer() }, 'connected to NATS');
    this.#setConnected(true);
    void this.#watchConnection(nc);
    await Promise.all(this.#consumptions.map((c) => this.#keepConsuming(nc, c)));
  }

  /** Consumes the subject until the bus is closed, setting it up again when it fails. */
  async #keepConsuming(nc: NatsConnection, c: Consumption): Promise<void> {
    let backoffMs = this.#options.initialBackoffMs;
    while (!this.#closed) {
      try {
        await this.#consume(nc, c);
        backoffMs = this.#options.initialBackoffMs;
      } catch (error) {
        if (this.#closed) break;
        this.#log.warn(
          { err: error, subject: c.subject, retry_in_ms: backoffMs },
          `subscription to ${c.subject} failed, retrying`,
        );
      } finally {
        c.consuming = false;
        c.messages = undefined;
      }
      if (this.#closed) break;
      await this.#sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, this.#options.maxBackoffMs);
    }
  }

  async #consume(nc: NatsConnection, c: Consumption): Promise<void> {
    const jsm = await jetstreamManager(nc);
    const stream = await jsm.streams.find(c.subject);
    const consumer = await jetstream(nc).consumers.get(stream, {
      filter_subjects: c.subject,
      deliver_policy: c.deliverPolicy,
    });
    const messages = await consumer.consume();
    c.messages = messages;
    c.consuming = true;
    this.#log.info({ stream, subject: c.subject }, `consuming ${c.subject}`);
    void this.#watchConsumer(c.subject, messages);
    // PERF: one message at a time keeps the stream order.
    for await (const message of messages) {
      // ordered consumers have no acks: a rejected message is simply not kept
      await c.handler(message.data);
    }
  }

  #setConnected(connected: boolean): void {
    if (this.#connected === connected) return;
    this.#connected = connected;
    for (const listener of this.#listeners) {
      try {
        listener(connected);
      } catch (error) {
        this.#log.error({ err: error }, 'a connection listener failed');
      }
    }
  }

  async #watchConnection(nc: NatsConnection): Promise<void> {
    for await (const status of nc.status()) {
      switch (status.type) {
        case 'disconnect':
          this.#log.warn({ server: status.server }, 'disconnected from NATS');
          this.#setConnected(false);
          break;
        case 'reconnect':
          this.#log.info({ server: status.server }, 'reconnected to NATS');
          this.#setConnected(true);
          break;
        default:
          break;
      }
    }
  }

  async #watchConsumer(subject: string, messages: ConsumerMessages): Promise<void> {
    for await (const status of messages.status()) {
      if (status.type === 'heartbeats_missed' || status.type === 'ordered_consumer_recreated') {
        this.#log.info({ event: status.type, subject }, `ordered consumer of ${subject}`);
      }
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wakeUp = () => {
        clearTimeout(timer);
        this.#wakeUps.delete(wakeUp);
        resolve();
      };
      const timer = setTimeout(wakeUp, ms);
      this.#wakeUps.add(wakeUp);
    });
  }
}

function consumption(subject: string, deliverPolicy: DeliverPolicy, handler: MessageHandler): Consumption {
  return { subject, deliverPolicy, handler, messages: undefined, consuming: false };
}
