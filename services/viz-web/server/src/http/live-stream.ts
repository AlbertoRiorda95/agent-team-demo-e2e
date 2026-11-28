// The live stream `GET /api/live` (server/openapi.yaml, docs/design/viewer.md
// > User flows, Live stream): Server-Sent Events written on the raw Node
// response, no plugin.
// - On connect: a `bus` event with the NATS state, then the latest trajectory
//   (`event: trajectory`, `id: <launch_id>`) unless the client's
//   Last-Event-ID already names it.
// - Then every new trajectory and every change of the NATS state, to every
//   client; a comment line every 15 s keeps proxies from closing an idle
//   connection.
// - A slow client: when its pending (unsent) bytes pass the cap, the server
//   closes it; the browser's EventSource reconnects with Last-Event-ID.
import type { ServerResponse } from 'node:http';
import { toJson } from '@bufbuild/protobuf';
import { TrajectoryComputedSchema, type TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import type { Logger } from '../application/ports.ts';

/** The keep-alive interval of the spec. */
export const KEEP_ALIVE_INTERVAL_MS = 15_000;

/**
 * The cap on a client's pending bytes: two trajectories at the contract's cap
 * (100000 samples, about 15 MB of JSON each) still fit.
 */
export const MAX_PENDING_BYTES = 32 * 1024 * 1024;

export interface LiveStreamOptions {
  /** The NATS state sent in the first `bus` event. */
  isConnected: () => boolean;
  /** The latest trajectory, replayed on connect. */
  latest: () => TrajectoryComputed | undefined;
  logger: Logger;
  keepAliveIntervalMs?: number;
  maxPendingBytes?: number;
}

/** One SSE frame: `event`, optional `id`, and the data on one line. */
function frame(event: string, data: string, id?: string): string {
  return `event: ${event}\n${id === undefined ? '' : `id: ${id}\n`}data: ${data}\n\n`;
}

function busFrame(connected: boolean): string {
  return frame('bus', JSON.stringify({ nats: connected ? 'connected' : 'disconnected' }));
}

/** The `trajectory` event: proto3 JSON, proto field names, enums as names. */
function trajectoryFrame(trajectory: TrajectoryComputed): string {
  const json = toJson(TrajectoryComputedSchema, trajectory, {
    useProtoFieldName: true,
    alwaysEmitImplicit: true,
  });
  return frame('trajectory', JSON.stringify(json), trajectory.launchId);
}

export class LiveStream {
  readonly #clients = new Set<ServerResponse>();
  readonly #options: Required<LiveStreamOptions>;
  readonly #timer: NodeJS.Timeout;
  /** The latest trajectory's frame, serialized once for every client. */
  #latestFrame: { launchId: string; frame: string } | undefined;
  #closed = false;

  constructor(options: LiveStreamOptions) {
    this.#options = {
      ...options,
      keepAliveIntervalMs: options.keepAliveIntervalMs ?? KEEP_ALIVE_INTERVAL_MS,
      maxPendingBytes: options.maxPendingBytes ?? MAX_PENDING_BYTES,
    };
    this.#timer = setInterval(() => this.#broadcast(': keep-alive\n\n'), this.#options.keepAliveIntervalMs);
    this.#timer.unref();
  }

  /** The number of connected clients. */
  get size(): number {
    return this.#clients.size;
  }

  /** Takes over the response of a `GET /api/live`; `lastEventId` is the Last-Event-ID header, if any. */
  attach(response: ServerResponse, lastEventId: string | undefined): void {
    if (this.#closed) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // no buffering in an nginx proxy
    });
    response.flushHeaders();
    this.#clients.add(response);
    response.once('close', () => this.#clients.delete(response));

    this.#write(response, busFrame(this.#options.isConnected()));
    const latest = this.#latest();
    if (latest !== undefined && latest.launchId !== lastEventId) this.#write(response, latest.frame);
  }

  /** Sends a new latest trajectory to every client. */
  publishTrajectory(trajectory: TrajectoryComputed): void {
    this.#latestFrame = { launchId: trajectory.launchId, frame: trajectoryFrame(trajectory) };
    this.#broadcast(this.#latestFrame.frame);
  }

  /** Sends the NATS state to every client. */
  publishBus(connected: boolean): void {
    this.#broadcast(busFrame(connected));
  }

  /** Ends every client and stops the keep-alive. */
  close(): void {
    this.#closed = true;
    clearInterval(this.#timer);
    for (const response of this.#clients) response.end();
    this.#clients.clear();
  }

  #latest(): { launchId: string; frame: string } | undefined {
    const trajectory = this.#options.latest();
    if (trajectory === undefined) return undefined;
    if (this.#latestFrame?.launchId !== trajectory.launchId) {
      this.#latestFrame = { launchId: trajectory.launchId, frame: trajectoryFrame(trajectory) };
    }
    return this.#latestFrame;
  }

  #broadcast(chunk: string): void {
    for (const response of this.#clients) this.#write(response, chunk);
  }

  #write(response: ServerResponse, chunk: string): void {
    if (response.destroyed || response.writableEnded) return;
    response.write(chunk);
    if (response.writableLength > this.#options.maxPendingBytes) {
      this.#options.logger.warn(
        { pending_bytes: response.writableLength, max_pending_bytes: this.#options.maxPendingBytes },
        'slow live client closed',
      );
      this.#clients.delete(response);
      response.destroy();
    }
  }
}
