// GET /api/live and the built UI at / through Fastify listening on a random
// port, with a fake bus (docs/design/viewer.md > Test seams: Server): the SSE
// format, the replay, Last-Event-ID, the fan-out, the keep-alive, the bus
// events and the slow-client cap.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect as connectTcp } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { TrajectoryComputedSchema } from '@albertoriorda95/trajectory-proto';
import { KEEP_ALIVE_INTERVAL_MS, MAX_PENDING_BYTES } from '../src/http/live-stream.ts';
import { createServer, type Server, type ServerOptions } from '../src/server.ts';
import { FakeBus, encodeTrajectory, trajectoryComputed } from './fakes.ts';
import { openLive, type LiveClient } from './sse.ts';

describe('GET /api/live with a fake bus', () => {
  let server: Server | undefined;
  let bus: FakeBus;
  let baseUrl: string;
  const clients: LiveClient[] = [];

  async function start(options: Partial<ServerOptions> & { withBus?: boolean } = {}): Promise<void> {
    bus = new FakeBus();
    server = createServer({
      createBus: () => (options.withBus === false ? undefined : bus),
      version: '0.0.0-test',
      instance: 'test',
      heartbeatIntervalMs: 60_000,
      ...options,
    });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function live(lastEventId?: string): Promise<LiveClient> {
    const client = await openLive(baseUrl, lastEventId);
    clients.push(client);
    return client;
  }

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await server?.close();
    server = undefined;
  });

  it('answers text/event-stream with only the bus event when there is no trajectory yet', async () => {
    await start();
    const client = await live();
    expect(client.response.status).toBe(200);
    expect(client.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(client.response.headers.get('cache-control')).toMatch(/no-cache/);

    const bus = await client.nextEvent();
    expect(bus).toMatchObject({ event: 'bus', id: undefined });
    expect(JSON.parse(bus.data!)).toEqual({ nats: 'connected' });
    expect(await client.quietFor(200)).toBe(true);
  });

  it('replays the latest trajectory after the bus event, with id = launch_id, in proto3 JSON', async () => {
    await start();
    const message = trajectoryComputed(1);
    await bus.deliverTrajectory(encodeTrajectory(message));

    const client = await live();
    expect((await client.nextEvent()).event).toBe('bus');
    const event = await client.nextEvent();
    expect(event.event).toBe('trajectory');
    expect(event.id).toBe(message.launchId);
    const json = JSON.parse(event.data!) as Record<string, unknown>;
    // proto field names, enums as names, every field present
    expect(json.launch_id).toBe(message.launchId);
    expect(json.end_reason).toBe('END_REASON_GROUND');
    expect(json.flight_time_s).toBeCloseTo(0.02, 12);
    expect((json.samples as Record<string, unknown>[])[0]).toMatchObject({ seq: 0, phase: 'PHASE_BURN' });
    expect(fromJson(TrajectoryComputedSchema, json as JsonValue)).toEqual(message);
    expect(bus.errors).toEqual([]);
  });

  it('sends a new trajectory to every connected client', async () => {
    await start();
    const first = await live();
    const second = await live();
    for (const client of [first, second]) expect((await client.nextEvent()).event).toBe('bus');

    const message = trajectoryComputed(2);
    const sentAt = Date.now();
    await bus.deliverTrajectory(encodeTrajectory(message));
    for (const client of [first, second]) {
      const event = await client.nextEvent(500);
      expect(event).toMatchObject({ event: 'trajectory', id: message.launchId });
      expect(fromJson(TrajectoryComputedSchema, JSON.parse(event.data!) as JsonValue)).toEqual(message);
    }
    expect(Date.now() - sentAt).toBeLessThan(500);
  });

  it('does not send the latest again to a client whose Last-Event-ID names it', async () => {
    await start();
    const message = trajectoryComputed(3);
    await bus.deliverTrajectory(encodeTrajectory(message));

    const client = await live(message.launchId);
    expect((await client.nextEvent()).event).toBe('bus');
    expect(await client.quietFor(200)).toBe(true);

    // and it still gets the next one
    const next = trajectoryComputed(4);
    await bus.deliverTrajectory(encodeTrajectory(next));
    expect((await client.nextEvent()).id).toBe(next.launchId);
  });

  it('sends the latest to a client whose Last-Event-ID names another trajectory', async () => {
    await start();
    await bus.deliverTrajectory(encodeTrajectory(trajectoryComputed(5)));
    const latest = trajectoryComputed(6);
    await bus.deliverTrajectory(encodeTrajectory(latest));

    const client = await live(trajectoryComputed(5).launchId);
    expect((await client.nextEvent()).event).toBe('bus');
    expect(await client.nextEvent()).toMatchObject({ event: 'trajectory', id: latest.launchId });
  });

  it('sends the same trajectory delivered twice once', async () => {
    await start();
    const client = await live();
    await client.nextEvent();
    const message = trajectoryComputed(7);
    await bus.deliverTrajectory(encodeTrajectory(message));
    await bus.deliverTrajectory(encodeTrajectory(message));

    expect((await client.nextEvent()).id).toBe(message.launchId);
    expect(await client.quietFor(200)).toBe(true);
    expect(bus.errors).toEqual([]);
  });

  it.each([
    ['a message that does not decode', new Uint8Array([0xff, 0xff, 0xff]), '', /does not decode/],
    [
      'a message with no launch_id',
      encodeTrajectory(trajectoryComputed(8, 3, { launchId: '' })),
      '',
      /no launch_id/,
    ],
    [
      'a launch_id that is not a UUID',
      encodeTrajectory(trajectoryComputed(8, 3, { launchId: 'not-a-uuid' })),
      'not-a-uuid',
      /not a UUID/,
    ],
  ])('does not push %s and reports one PipelineError', async (_name, data, launchId, reason) => {
    await start();
    const client = await live();
    await client.nextEvent();
    await bus.deliverTrajectory(data);

    expect(await client.quietFor(200)).toBe(true);
    expect(bus.errors).toHaveLength(1);
    const [error] = bus.errors;
    expect(error?.service).toBe('viz-web');
    expect(error?.subject).toBe('trajectories.computed');
    expect(error?.launchId).toBe(launchId);
    expect(error?.message).toMatch(reason);

    // a new client gets no trajectory either
    const other = await live();
    await other.nextEvent();
    expect(await other.quietFor(200)).toBe(true);
  });

  it('keeps the latest when an invalid message follows it', async () => {
    await start();
    const message = trajectoryComputed(9);
    await bus.deliverTrajectory(encodeTrajectory(message));
    await bus.deliverTrajectory(new Uint8Array([0xff]));
    const client = await live();
    await client.nextEvent();
    expect((await client.nextEvent()).id).toBe(message.launchId);
  });

  it('sends bus disconnected and connected to every client, and keeps the latest meanwhile', async () => {
    await start();
    const message = trajectoryComputed(10);
    await bus.deliverTrajectory(encodeTrajectory(message));
    const client = await live();
    await client.nextEvent();
    await client.nextEvent();

    bus.setConnected(false);
    const down = await client.nextEvent();
    expect(down.event).toBe('bus');
    expect(JSON.parse(down.data!)).toEqual({ nats: 'disconnected' });

    // a client that connects meanwhile gets the state and the latest
    const meanwhile = await live();
    expect(JSON.parse((await meanwhile.nextEvent()).data!)).toEqual({ nats: 'disconnected' });
    expect((await meanwhile.nextEvent()).id).toBe(message.launchId);

    bus.setConnected(true);
    expect(JSON.parse((await client.nextEvent()).data!)).toEqual({ nats: 'connected' });
    expect(JSON.parse((await meanwhile.nextEvent()).data!)).toEqual({ nats: 'connected' });
  });

  it('sends bus disconnected without NATS configured', async () => {
    await start({ withBus: false });
    const client = await live();
    expect(JSON.parse((await client.nextEvent()).data!)).toEqual({ nats: 'disconnected' });
  });

  it('sends a comment line on an idle connection every keep-alive interval', async () => {
    expect(KEEP_ALIVE_INTERVAL_MS).toBe(15_000);
    await start({ keepAliveIntervalMs: 100 });
    const client = await live();
    await client.next();
    const startedAt = Date.now();
    const first = await client.next(1000);
    const second = await client.next(1000);
    expect(first).toMatchObject({ event: undefined, comment: 'keep-alive' });
    expect(second).toMatchObject({ event: undefined, comment: 'keep-alive' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
  });

  it('closes a client whose pending bytes pass the cap, and keeps serving the others', async () => {
    expect(MAX_PENDING_BYTES).toBe(32 * 1024 * 1024);
    // above one trajectory of the test (about 1.5 MB), so that a client that reads keeps up
    await start({ maxPendingBytes: 4 * 1024 * 1024 });
    const { port } = new URL(baseUrl);

    // a client that never reads
    const slow = connectTcp({ host: '127.0.0.1', port: Number(port) });
    await new Promise<void>((resolve) => slow.once('connect', () => resolve()));
    slow.write(`GET /api/live HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    slow.pause();
    const ended = new Promise<number>((resolve) => {
      let received = 0;
      slow.on('data', (chunk: Buffer) => (received += chunk.length));
      slow.once('end', () => resolve(received));
    });
    const healthy = await live();
    await healthy.nextEvent();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // about 1.5 MB of JSON each, far beyond the socket buffers after a few
    let sent = 0;
    for (let n = 0; n < 20; n++) {
      const message = trajectoryComputed(100 + n, 10_000);
      await bus.deliverTrajectory(encodeTrajectory(message));
      const event = await healthy.nextEvent(5000);
      expect(event.id).toBe(message.launchId);
      sent += event.data!.length;
    }

    // once it reads again, the slow client gets what was already sent, then the end
    slow.resume();
    const received = await ended;
    expect(received).toBeLessThan(sent);
    slow.destroy();
  }, 30_000);

  it('ends the open streams on close', async () => {
    await start();
    const client = await live();
    await client.nextEvent();
    await server?.close();
    server = undefined;
    await expect(client.next(1000)).rejects.toThrow(/no SSE frame/);
  });
});

describe('the built UI at /', () => {
  let server: Server | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function start(uiDir: string): Promise<string> {
    server = createServer({ createBus: () => new FakeBus(), version: '0.0.0-test', uiDir });
    return server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  it('serves index.html at / and the assets, next to the API', async () => {
    dir = mkdtempSync(join(tmpdir(), 'viz-web-ui-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Trajectory viewer</title>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1);');
    const baseUrl = await start(dir);

    const index = await fetch(`${baseUrl}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await index.text()).toContain('Trajectory viewer');
    const asset = await fetch(`${baseUrl}/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(`${baseUrl}/api/accepted-launches`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/missing.js`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/../package.json`)).status).toBe(404);
  });

  it('answers 404 at / when the UI is not built, and still serves the API', async () => {
    const baseUrl = await start(join(tmpdir(), 'viz-web-ui-does-not-exist'));
    expect((await fetch(`${baseUrl}/`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  });
});
