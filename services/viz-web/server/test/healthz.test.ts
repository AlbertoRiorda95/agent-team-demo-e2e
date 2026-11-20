// GET /healthz through Fastify's inject (spec foundations > Test seams: web
// servers), against the responses of server/openapi.yaml.
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';

describe('GET /healthz', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers 200 ok with no failing dependency', async () => {
    app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 degraded when a dependency check fails', async () => {
    app = buildApp({ healthChecks: [() => true, () => false] });
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded' });
  });

  it('answers 503 degraded when a dependency check throws', async () => {
    app = buildApp({
      healthChecks: [
        async () => {
          throw new Error('NATS unreachable');
        },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded' });
  });

  it('answers 404 for an unknown route', async () => {
    app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
