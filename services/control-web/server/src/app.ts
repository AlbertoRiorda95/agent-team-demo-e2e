// The control-web server's HTTP app: the routes of `server/openapi.yaml`.
// `buildServer()` only builds it; `main.ts` makes it listen.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface Health {
  status: 'ok';
}

const healthSchema = {
  response: {
    200: {
      type: 'object',
      required: ['status'],
      additionalProperties: false,
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
  },
} as const;

export function buildServer(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  // Liveness for the Kubernetes probes: the process is up and serving.
  // The skeleton has no dependency to check yet.
  app.get('/healthz', { schema: healthSchema }, async (): Promise<Health> => ({ status: 'ok' }));

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  return app;
}
