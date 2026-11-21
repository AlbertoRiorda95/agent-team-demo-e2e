import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

describe('GET /healthz', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 200 {"status":"ok"} as server/openapi.yaml says', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('answers 404 with the error shape for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route GET /nope not found',
    });
  });

  it('answers 404 for a method the route does not have', async () => {
    const res = await app.inject({ method: 'POST', url: '/healthz' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });
});

describe('the server over a real socket', () => {
  it('serves /healthz on a random port', async () => {
    const app = buildServer();
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const res = await fetch(`${address}/healthz`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});

describe('loadConfig', () => {
  it('defaults to port 5174', () => {
    expect(loadConfig({})).toEqual({ host: '0.0.0.0', port: 5174 });
  });

  it('reads CONTROL_WEB_PORT', () => {
    expect(loadConfig({ CONTROL_WEB_PORT: '8080' }).port).toBe(8080);
  });

  it.each(['abc', '0', '70000', '80.5'])('rejects CONTROL_WEB_PORT=%s', (value) => {
    expect(() => loadConfig({ CONTROL_WEB_PORT: value })).toThrow(/CONTROL_WEB_PORT/);
  });
});
