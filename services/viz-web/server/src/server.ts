// The viz-web server put together: the record, the HTTP app, the bus behind
// the subscription and the heartbeat (docs/design/viz-backend.md). main.ts
// runs it with the NATS bus; the tests run it with a fake bus.
import { hostname } from 'node:os';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app.ts';
import { startHeartbeat } from './application/heartbeat.ts';
import type { Bus, Logger } from './application/ports.ts';
import { recordLaunchAccepted } from './application/record-launch.ts';
import { AcceptedLaunches } from './domain/accepted-launches.ts';

export interface ServerOptions {
  /** Builds the bus with the server's logger; undefined when NATS is not configured. */
  createBus: (logger: Logger) => Bus | undefined;
  logger?: FastifyServerOptions['logger'];
  version: string;
  instance?: string;
  heartbeatIntervalMs?: number;
  capacity?: number;
}

export interface Server {
  app: FastifyInstance;
  /** Stops the heartbeat, closes the bus and the HTTP server. */
  close(): Promise<void>;
}

export function createServer(options: ServerOptions): Server {
  const acceptedLaunches = new AcceptedLaunches(options.capacity);
  const app = buildApp({
    logger: options.logger,
    acceptedLaunches,
    // the subscription to launches.accepted is the dependency /healthz checks
    healthChecks: [() => bus?.isUp() ?? false],
  });
  // read by the health check above only once the app answers requests
  const bus: Bus | undefined = options.createBus(app.log);

  let stopHeartbeat = () => {};
  if (bus === undefined) {
    app.log.error({}, 'NATS_URL is not set: viz-web stays degraded');
  } else {
    bus.start(recordLaunchAccepted({ record: acceptedLaunches, publisher: bus, logger: app.log }));
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
    },
  };
}
