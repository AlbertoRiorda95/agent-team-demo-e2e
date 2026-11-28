// GET /api/live against a real NATS (Testcontainers) with the streams of
// proto/nats/streams/ (docs/design/viewer.md > Test seams: Integration): the
// consumer settings (ordered, deliver "last"), the recovery of the latest
// after a restart, the PipelineError publication and the bus events when NATS
// stops and comes back.
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type StreamConfig } from '@nats-io/jetstream';
import { fromBinary, fromJson, type JsonValue } from '@bufbuild/protobuf';
import {
  PIPELINE_ERRORS,
  PipelineErrorSchema,
  TRAJECTORIES_COMPUTED,
  TrajectoryComputedSchema,
  type PipelineError,
  type TrajectoryComputed,
} from '@albertoriorda95/trajectory-proto';
import { NatsBus } from '../../src/adapters/nats-bus.ts';
import { createServer, type Server } from '../../src/server.ts';
import { encodeTrajectory, trajectoryComputed } from '../fakes.ts';
import { openLive, type LiveClient } from '../sse.ts';
import { freePort, waitFor } from './helpers.ts';

const STREAMS_DIR = new URL('../../../../../proto/nats/streams/', import.meta.url);
const run = promisify(execFile);

describe('GET /api/live on a real NATS', () => {
  let container: StartedTestContainer;
  let natsUrl: string;
  let client: NatsConnection;
  let server: Server | undefined;
  let baseUrl: string;
  const clients: LiveClient[] = [];
  const errors: PipelineError[] = [];

  async function startServer(): Promise<void> {
    server = createServer({
      createBus: (logger) => new NatsBus({ url: natsUrl, logger, reconnectTimeWaitMs: 250 }),
      version: '0.0.0-test',
      instance: 'integration-live',
    });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function stopServer(): Promise<void> {
    for (const live of clients.splice(0)) live.close();
    await server?.close();
    server = undefined;
  }

  async function live(lastEventId?: string): Promise<LiveClient> {
    const opened = await openLive(baseUrl, lastEventId);
    clients.push(opened);
    return opened;
  }

  async function publish(message: TrajectoryComputed): Promise<void> {
    await jetstream(client).publish(TRAJECTORIES_COMPUTED, encodeTrajectory(message));
  }

  /** The bus event `connected`, then the trajectory, as a client that opens now sees them. */
  async function connectedThenLatest(): Promise<string> {
    return waitFor(
      async () => {
        const opened = await live();
        const bus = await opened.nextEvent();
        if (JSON.parse(bus.data!).nats !== 'connected') return undefined;
        const event = await opened.nextEvent(1000);
        return event.event === 'trajectory' ? event.id : undefined;
      },
      10_000,
      'a client to get bus connected and a trajectory',
    );
  }

  beforeAll(async () => {
    const port = await freePort();
    container = await new GenericContainer('nats:2-alpine')
      .withCommand(['-js'])
      // a fixed host port, so that the container keeps it across a docker stop/start
      .withExposedPorts({ container: 4222, host: port })
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
      .start();
    natsUrl = `nats://127.0.0.1:${port}`;
    client = await connect({ servers: natsUrl, maxReconnectAttempts: -1, reconnectTimeWait: 250 });

    const jsm = await jetstreamManager(client);
    for (const file of readdirSync(STREAMS_DIR).filter((name) => name.endsWith('.json'))) {
      const config = JSON.parse(readFileSync(new URL(file, STREAMS_DIR), 'utf8')) as StreamConfig;
      await jsm.streams.add(config);
    }
    const errorSub = client.subscribe(PIPELINE_ERRORS);
    void (async () => {
      for await (const message of errorSub) errors.push(fromBinary(PipelineErrorSchema, message.data));
    })();
  }, 120_000);

  afterEach(async () => {
    for (const opened of clients.splice(0)) opened.close();
  });

  afterAll(async () => {
    await stopServer();
    await client?.close();
    await container?.stop();
  });

  it('starts from the last trajectory of the stream and sends it to a new client within 1 s', async () => {
    await publish(trajectoryComputed(201));
    const latest = trajectoryComputed(202);
    await publish(latest);

    await startServer();
    expect(await connectedThenLatest()).toBe(latest.launchId);

    const opened = await live();
    const connectedAt = Date.now();
    expect((await opened.nextEvent(1000)).event).toBe('bus');
    const event = await opened.nextEvent(1000);
    expect(Date.now() - connectedAt).toBeLessThan(1000);
    expect(event.id).toBe(latest.launchId);
    expect(fromJson(TrajectoryComputedSchema, JSON.parse(event.data!) as JsonValue)).toEqual(latest);
  }, 30_000);

  it('sends a new trajectory to two connected clients within 500 ms', async () => {
    const first = await live(trajectoryComputed(202).launchId);
    const second = await live(trajectoryComputed(202).launchId);
    for (const opened of [first, second]) expect((await opened.nextEvent()).event).toBe('bus');

    const message = trajectoryComputed(203);
    const publishedAt = Date.now();
    await publish(message);
    for (const opened of [first, second]) {
      const event = await opened.nextEvent(500);
      expect(event.id).toBe(message.launchId);
      expect(fromJson(TrajectoryComputedSchema, JSON.parse(event.data!) as JsonValue)).toEqual(message);
    }
    expect(Date.now() - publishedAt).toBeLessThan(500);
  }, 30_000);

  it('keeps the latest across a server restart', async () => {
    await stopServer();
    await startServer();
    expect(await connectedThenLatest()).toBe(trajectoryComputed(203).launchId);
  }, 30_000);

  it('does not push a message that does not decode and reports one PipelineError', async () => {
    const opened = await live(trajectoryComputed(203).launchId);
    await opened.nextEvent();
    const before = errors.length;
    await jetstream(client).publish(TRAJECTORIES_COMPUTED, new Uint8Array([0xff, 0xff, 0xff]));
    await waitFor(() => (errors.length > before ? true : undefined), 2000, 'a PipelineError');
    expect(await opened.quietFor(300)).toBe(true);

    const newErrors = errors.slice(before);
    expect(newErrors).toHaveLength(1);
    expect(newErrors[0]?.service).toBe('viz-web');
    expect(newErrors[0]?.subject).toBe(TRAJECTORIES_COMPUTED);
  }, 30_000);

  it('sends bus disconnected when NATS stops and bus connected when it is back, without a restart', async () => {
    const opened = await live(trajectoryComputed(203).launchId);
    expect(JSON.parse((await opened.nextEvent()).data!)).toEqual({ nats: 'connected' });

    await run('docker', ['stop', '-t', '2', container.getId()]);
    const down = await opened.nextEvent(10_000);
    expect(down.event).toBe('bus');
    expect(JSON.parse(down.data!)).toEqual({ nats: 'disconnected' });

    await run('docker', ['start', container.getId()]);
    const up = await opened.nextEvent(20_000);
    expect(up.event).toBe('bus');
    expect(JSON.parse(up.data!)).toEqual({ nats: 'connected' });

    const after = trajectoryComputed(204);
    await waitFor(
      async () => {
        await publish(after);
        return true;
      },
      10_000,
      'the test client to publish again',
    );
    expect((await opened.nextEvent(5000)).id).toBe(after.launchId);
  }, 60_000);
});
