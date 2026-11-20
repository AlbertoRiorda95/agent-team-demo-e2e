// The Fastify application of the viz-web server, without listening: main.ts
// starts it, the tests drive it through `inject`. Routes follow
// server/openapi.yaml.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { type HealthCheck, healthStatus } from './health.ts';

export interface AppOptions {
  /** Dependency checks behind `GET /healthz`; none in the skeleton. */
  healthChecks?: readonly HealthCheck[];
  /** Fastify logger option: JSON logs in production, off in the tests. */
  logger?: FastifyServerOptions['logger'];
}

const healthResponse = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: { status: { type: 'string', enum: ['ok', 'degraded'] } },
} as const;

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const healthChecks = options.healthChecks ?? [];
  const app = Fastify({ logger: options.logger ?? false });

  app.get(
    '/healthz',
    { schema: { response: { 200: healthResponse, 503: healthResponse } } },
    async (_request, reply) => {
      const status = await healthStatus(healthChecks);
      return reply.code(status === 'ok' ? 200 : 503).send({ status });
    },
  );

  return app;
}
