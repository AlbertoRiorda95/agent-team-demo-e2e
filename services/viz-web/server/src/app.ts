// The Fastify application of the viz-web server, without listening: server.ts
// wires it to the bus and main.ts starts it; the tests drive it through
// `inject` or a random port. Routes follow server/openapi.yaml.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { toJson } from '@bufbuild/protobuf';
import { LaunchRequestSchema } from '@albertoriorda95/trajectory-proto';
import { AcceptedLaunches, type AcceptedLaunch } from './domain/accepted-launches.ts';
import { type HealthCheck, healthStatus } from './health.ts';

export interface AppOptions {
  /** Dependency checks behind `GET /healthz`. */
  healthChecks?: readonly HealthCheck[];
  /** The record behind `GET /api/accepted-launches`; an empty one by default. */
  acceptedLaunches?: AcceptedLaunches;
  /** Fastify logger option: JSON logs in production, off in the tests. */
  logger?: FastifyServerOptions['logger'];
}

const healthResponse = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: { status: { type: 'string', enum: ['ok', 'degraded'] } },
} as const;

const acceptedLaunchesResponse = {
  type: 'array',
  items: {
    type: 'object',
    required: ['launch_id', 'accepted_at', 'request'],
    additionalProperties: false,
    properties: {
      launch_id: { type: 'string' },
      accepted_at: { type: 'string' },
      request: { type: 'object', additionalProperties: true },
    },
  },
} as const;

/** One entry of `GET /api/accepted-launches` (schema AcceptedLaunch). */
function toResponse(launch: AcceptedLaunch) {
  return {
    launch_id: launch.launchId,
    accepted_at: launch.acceptedAt.toISOString(),
    request: toJson(LaunchRequestSchema, launch.request, {
      useProtoFieldName: true,
      alwaysEmitImplicit: true,
    }),
  };
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const healthChecks = options.healthChecks ?? [];
  const acceptedLaunches = options.acceptedLaunches ?? new AcceptedLaunches();
  const app = Fastify({ logger: options.logger ?? false });

  app.get(
    '/healthz',
    { schema: { response: { 200: healthResponse, 503: healthResponse } } },
    async (_request, reply) => {
      const status = await healthStatus(healthChecks);
      return reply.code(status === 'ok' ? 200 : 503).send({ status });
    },
  );

  app.get(
    '/api/accepted-launches',
    { schema: { response: { 200: acceptedLaunchesResponse } } },
    async () => acceptedLaunches.list().map(toResponse),
  );

  return app;
}
