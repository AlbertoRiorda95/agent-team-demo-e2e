// GET /api/accepted-launches and GET /healthz through Fastify listening on a
// random port, with a fake bus behind the subscription port
// (docs/design/viz-backend.md > Test seams: Server).
import { afterEach, describe, expect, it } from 'vitest';
import { fromJson } from '@bufbuild/protobuf';
import { LaunchRequestSchema } from '@albertoriorda95/trajectory-proto';
import { createServer, type Server } from '../src/server.ts';
import { FakeBus, encode, launchAccepted } from './fakes.ts';

interface Entry {
  launch_id: string;
  accepted_at: string;
  request: Record<string, unknown>;
}

describe('viz-web server with a fake bus', () => {
  let server: Server | undefined;
  let bus: FakeBus;
  let baseUrl: string;

  async function start(options: { capacity?: number; withBus?: boolean } = {}): Promise<void> {
    bus = new FakeBus();
    server = createServer({
      createBus: () => (options.withBus === false ? undefined : bus),
      version: '0.0.0-test',
      instance: 'test',
      capacity: options.capacity,
      heartbeatIntervalMs: 60_000,
    });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function list(): Promise<Entry[]> {
    const response = await fetch(`${baseUrl}/api/accepted-launches`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    return (await response.json()) as Entry[];
  }

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('returns [] when no launch was accepted', async () => {
    await start();
    expect(await list()).toEqual([]);
  });

  it('lists an accepted launch with its launch_id, accepted_at and request', async () => {
    await start();
    const message = launchAccepted(1);
    await bus.deliver(encode(message));

    const entries = await list();
    expect(entries).toHaveLength(1);
    const [entry] = entries as [Entry];
    expect(entry.launch_id).toBe(message.launchId);
    expect(entry.accepted_at).toBe('2026-11-23T10:00:00.001Z');
    // proto3 JSON with the proto field names, every field present
    expect(Object.keys(entry.request).sort()).toEqual(
      ['azimuth_deg', 'burn_duration_s', 'elevation_deg', 'force_n', 'mass_kg', 'position'].sort(),
    );
    expect(fromJson(LaunchRequestSchema, entry.request as never)).toEqual(message.request);
    expect(bus.errors).toEqual([]);
  });

  it('lists the launches newest first', async () => {
    await start();
    for (const n of [1, 2, 3]) await bus.deliver(encode(launchAccepted(n)));
    const ids = (await list()).map((entry) => entry.launch_id);
    expect(ids).toEqual([3, 2, 1].map((n) => launchAccepted(n).launchId));
  });

  it('records the same launch once, keeping the first one', async () => {
    await start();
    const first = launchAccepted(7);
    const again = launchAccepted(7, { request: { ...first.request!, massKg: 99 } });
    await bus.deliver(encode(first));
    await bus.deliver(encode(again));

    const entries = await list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.request.mass_kg).toBe(first.request?.massKg);
  });

  it('keeps the latest 1000 launches and drops the oldest', async () => {
    await start();
    for (let n = 1; n <= 1001; n++) await bus.deliver(encode(launchAccepted(n)));

    const ids = (await list()).map((entry) => entry.launch_id);
    expect(ids).toHaveLength(1000);
    expect(ids[0]).toBe(launchAccepted(1001).launchId);
    expect(ids[999]).toBe(launchAccepted(2).launchId);
    expect(ids).not.toContain(launchAccepted(1).launchId);
  });

  it.each([
    ['a message that does not decode', new Uint8Array([0xff, 0xff, 0xff]), '', /does not decode/],
    ['a message with no launch_id', encode(launchAccepted(1, { launchId: '' })), '', /no launch_id/],
    [
      'a launch_id that is not a UUID',
      encode(launchAccepted(1, { launchId: 'not-a-uuid' })),
      'not-a-uuid',
      /not a UUID/,
    ],
    [
      'a message with no accepted_at',
      encode(launchAccepted(1, { acceptedAt: undefined })),
      launchAccepted(1).launchId,
      /no accepted_at/,
    ],
    [
      'a message with no request',
      encode(launchAccepted(1, { request: undefined })),
      launchAccepted(1).launchId,
      /no request/,
    ],
  ])('rejects %s with one PipelineError and does not list it', async (_name, data, launchId, reason) => {
    await start();
    await bus.deliver(data);

    expect(await list()).toEqual([]);
    expect(bus.errors).toHaveLength(1);
    const [error] = bus.errors;
    expect(error?.service).toBe('viz-web');
    expect(error?.subject).toBe('launches.accepted');
    expect(error?.launchId).toBe(launchId);
    expect(error?.message).toMatch(reason);
    expect(error?.occurredAt).toBeDefined();
  });

  it('records a message that carries unknown fields (dropped at decode)', async () => {
    await start();
    const message = launchAccepted(1);
    // field 15, wire type 2 (length-delimited), 4 bytes: unknown to LaunchAccepted
    const padded = new Uint8Array([...encode(message), 0x7a, 0x04, 1, 2, 3, 4]);
    await bus.deliver(padded);
    expect(await list()).toHaveLength(1);
    expect(bus.errors).toEqual([]);
  });

  it('keeps going when the PipelineError cannot be published', async () => {
    await start();
    bus.failPublish = true;
    await expect(bus.deliver(new Uint8Array([0xff]))).resolves.toBeUndefined();
    await bus.deliver(encode(launchAccepted(1)));
    expect(await list()).toHaveLength(1);
  });

  it('answers /healthz 200 while the subscription is up', async () => {
    await start();
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers /healthz 503 while the subscription is down and keeps serving the record', async () => {
    await start();
    await bus.deliver(encode(launchAccepted(1)));
    bus.up = false;

    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ status: 'degraded' });
    expect(await list()).toHaveLength(1);

    bus.up = true;
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  });

  it('stays degraded without NATS configured', async () => {
    await start({ withBus: false });
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(503);
    expect(await list()).toEqual([]);
  });

  it('closes the bus on close', async () => {
    await start();
    await server?.close();
    server = undefined;
    expect(bus.closed).toBe(true);
  });
});
