// The viz-web server put together: the record, the latest trajectory and its
// live stream, the table prefix and the history, the HTTP app, the bus behind
// the subscriptions and the heartbeat (docs/design/viz-backend.md,
// docs/design/viewer.md). main.ts runs it with the NATS bus and PostgreSQL;
// the tests run it with fakes.
import { hostname } from 'node:os';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app.ts';
import { startHeartbeat } from './application/heartbeat.ts';
import { browseHistory } from './application/browse-history.ts';
import type { Bus, HistoryRepository, Logger } from './application/ports.ts';
import { recordLaunchAccepted } from './application/record-launch.ts';
import { trackTablePrefix } from './application/track-table-prefix.ts';
import { trackTrajectoryComputed } from './application/track-trajectory.ts';
import { AcceptedLaunches } from './domain/accepted-launches.ts';
import { LatestTrajectory } from './domain/latest-trajectory.ts';
import { TablePrefix } from './domain/table-prefix.ts';
import { LiveStream } from './http/live-stream.ts';

export interface ServerOptions {
  /** Builds the bus with the server's logger; undefined when NATS is not configured. */
  createBus: (logger: Logger) => Bus | undefined;
  /** Builds the history repository with the server's logger; undefined when the database is not configured. */
  createHistory?: (logger: Logger) => HistoryRepository | undefined;
  logger?: FastifyServerOptions['logger'];
  version: string;
  instance?: string;
  heartbeatIntervalMs?: number;
  capacity?: number;
  /** The built UI served at `/` (main.ts passes `services/viz-web/dist`). */
  uiDir?: string;
  /** The keep-alive interval of `/api/live` (15 s by default). */
  keepAliveIntervalMs?: number;
  /** The cap on a live client's pending bytes (32 MiB by default). */
  maxPendingBytes?: number;
}

export interface Server {
  app: FastifyInstance;
  /** Stops the heartbeat, closes the bus, the database pool and the HTTP server. */
  close(): Promise<void>;
}

export function createServer(options: ServerOptions): Server {
  const acceptedLaunches = new AcceptedLaunches(options.capacity);
  const latest = new LatestTrajectory();
  const prefix = new TablePrefix();
  // `app` and `bus` are read by these callbacks only once the app answers requests
  const liveStream = new LiveStream({
    isConnected: () => bus?.isConnected() ?? false,
    latest: () => latest.current,
    logger: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
    keepAliveIntervalMs: options.keepAliveIntervalMs,
    maxPendingBytes: options.maxPendingBytes,
  });
  const app = buildApp({
    logger: options.logger,
    acceptedLaunches,
    liveStream,
    // `history` is read only once the app answers requests
    history: browseHistory({
      get repository() {
        return history;
      },
      prefix,
    }),
    uiDir: options.uiDir,
    // the subscriptions are the dependency /healthz checks
    healthChecks: [() => bus?.isUp() ?? false],
  });
  const bus: Bus | undefined = options.createBus(app.log);
  const history: HistoryRepository | undefined = options.createHistory?.(app.log);
  if (history === undefined) {
    app.log.error({}, 'DATABASE_URL is not set: the history answers 503');
  }

  let stopHeartbeat = () => {};
  if (bus === undefined) {
    app.log.error({}, 'NATS_URL is not set: viz-web stays degraded');
  } else {
    bus.onConnectionChange((connected) => liveStream.publishBus(connected));
    bus.start({
      launchesAccepted: recordLaunchAccepted({ record: acceptedLaunches, publisher: bus, logger: app.log }),
      trajectoriesComputed: trackTrajectoryComputed({
        latest,
        onNewTrajectory: (trajectory) => liveStream.publishTrajectory(trajectory),
        publisher: bus,
        logger: app.log,
      }),
      storeConfigApplied: trackTablePrefix({ prefix, publisher: bus, logger: app.log }),
    });
    stopHeartbeat = startHeartbeat({
      publisher: bus,
      subscription: bus,
      logger: app.log,
      instance: options.instance ?? hostname(),
      version: options.version,
      intervalMs: options.heartbeatIntervalMs,
    });
  }

  return {
    app,
    async close() {
      stopHeartbeat();
      await bus?.close();
      await app.close();
      await history?.close();
    },
  };
}
