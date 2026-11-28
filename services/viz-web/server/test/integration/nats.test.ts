// The viz-web server against a real NATS (Testcontainers) with the streams of
// proto/nats/streams/ (docs/design/viz-backend.md > Test seams: Integration):
// the consumer settings (ordered, deliver "all"), the rebuild after a restart,
// the reconnection, the PipelineError publication and the heartbeat.
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { connect, headers, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type StreamConfig } from '@nats-io/jetstream';
import { fromBinary } from '@bufbuild/protobuf';
import {
  LAUNCHES_ACCEPTED,
  PIPELINE_ERRORS,
  PipelineErrorSchema,
  ServiceStatusSchema,
  ServiceStatus_State,
  statusSubject,
  type LaunchAccepted,
  type PipelineError,
  type ServiceStatus,
} from '@albertoriorda95/trajectory-proto';
import { NatsBus } from '../../src/adapters/nats-bus.ts';
import { createServer, type Server } from '../../src/server.ts';
import { encode, launchAccepted } from '../fakes.ts';
import { freePort, waitFor } from './helpers.ts';

const STREAMS_DIR = new URL('../../../../../proto/nats/streams/', import.meta.url);
const run = promisify(execFile);

interface Entry {
  launch_id: string;
}

describe('viz-web server on a real NATS', () => {
  let container: StartedTestContainer;
  let natsUrl: string;
  let client: NatsConnection;
  let server: Server | undefined;
  let baseUrl: string;
  const errors: PipelineError[] = [];
  const statuses: { at: number; status: ServiceStatus }[] = [];

  async function startServer(): Promise<void> {
    server = createServer({
      createBus: (logger) => new NatsBus({ url: natsUrl, logger, reconnectTimeWaitMs: 250 }),
      version: '0.0.0-test',
      instance: 'integration',
    });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function stopServer(): Promise<void> {
    await server?.close();
    server = undefined;
  }

  async function listIds(): Promise<string[]> {
    const response = await fetch(`${baseUrl}/api/accepted-launches`);
    expect(response.status).toBe(200);
    return ((await response.json()) as Entry[]).map((entry) => entry.launch_id);
  }

  async function publish(message: LaunchAccepted, msgId = true): Promise<void> {
    const options = msgId ? { headers: withMsgId(message.launchId) } : {};
    await jetstream(client).publish(LAUNCHES_ACCEPTED, encode(message), options);
  }

  function withMsgId(id: string) {
    const h = headers();
    h.set('Nats-Msg-Id', id);
    return h;
  }

  async function listedWithin(ids: string[], timeoutMs: number): Promise<string[]> {
    return waitFor(
      async () => {
        const listed = await listIds();
        return ids.every((id) => listed.includes(id)) ? listed : undefined;
      },
      timeoutMs,
      `launches ${ids.join(', ')} to be listed`,
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
    const statusSub = client.subscribe(statusSubject('viz-web'));
    void (async () => {
      for await (const message of statusSub) {
        statuses.push({ at: Date.now(), status: fromBinary(ServiceStatusSchema, message.data) });
      }
    })();
  }, 120_000);

  afterAll(async () => {
    await stopServer();
    await client?.close();
    await container?.stop();
  });

  it('replays the stream at start-up and lists new launches within 1 s', async () => {
    const before = [launchAccepted(101), launchAccepted(102)];
    for (const message of before) await publish(message);

    await startServer();
    const listed = await listedWithin(
      before.map((m) => m.launchId),
      5000,
    );
    expect(listed).toEqual([before[1]!.launchId, before[0]!.launchId]);

    const after = launchAccepted(103);
    const publishedAt = Date.now();
    await publish(after);
    await listedWithin([after.launchId], 1000);
    expect(Date.now() - publishedAt).toBeLessThan(1000);
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  }, 30_000);

  it('lists a launch delivered twice once', async () => {
    const twice = launchAccepted(104);
    // no Nats-Msg-Id: JetStream keeps both copies, the server must dedupe
    await publish(twice, false);
    await publish(twice, false);
    const marker = launchAccepted(105);
    await publish(marker);
    const listed = await listedWithin([marker.launchId], 2000);
    expect(listed.filter((id) => id === twice.launchId)).toHaveLength(1);
  }, 30_000);

  it('rejects a message that does not decode with one PipelineError on pipeline.errors', async () => {
    const before = errors.length;
    await jetstream(client).publish(LAUNCHES_ACCEPTED, new Uint8Array([0xff, 0xff, 0xff]));
    await jetstream(client).publish(LAUNCHES_ACCEPTED, encode(launchAccepted(106, { launchId: '' })));
    const marker = launchAccepted(107);
    await publish(marker);
    const listed = await listedWithin([marker.launchId], 2000);
    await waitFor(() => (errors.length >= before + 2 ? true : undefined), 2000, 'two PipelineErrors');

    const newErrors = errors.slice(before);
    expect(newErrors).toHaveLength(2);
    for (const error of newErrors) {
      expect(error.service).toBe('viz-web');
      expect(error.subject).toBe('launches.accepted');
      expect(error.launchId).toBe('');
    }
    expect(listed).toHaveLength(6); // 101..105 and 107; no entry for the rejected ones
  }, 30_000);

  it('rebuilds the same record after a restart, with no duplicates, within 5 s', async () => {
    const before = await listIds();
    await stopServer();
    await startServer();
    const startedAt = Date.now();
    const after = await listedWithin(before, 5000);
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(after).toEqual(before);
  }, 30_000);

  it('sends a status.viz-web heartbeat every 5 s (± 1 s)', async () => {
    const from = statuses.length;
    await waitFor(() => (statuses.length >= from + 3 ? true : undefined), 15_000, 'three heartbeats');
    const beats = statuses.slice(from).filter((beat) => beat.status.instance === 'integration');
    expect(beats.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < beats.length; i++) {
      const gap = beats[i]!.at - beats[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(4000);
      expect(gap).toBeLessThanOrEqual(6000);
    }
    expect(beats.at(-1)?.status.state).toBe(ServiceStatus_State.OK);
    expect(beats.at(-1)?.status.service).toBe('viz-web');
  }, 30_000);

  it('degrades without NATS, keeps serving the record and recovers without a restart', async () => {
    const before = await listIds();
    await run('docker', ['stop', '-t', '2', container.getId()]);

    await waitFor(
      async () => ((await fetch(`${baseUrl}/healthz`)).status === 503 ? true : undefined),
      10_000,
      '/healthz to answer 503',
    );
    expect(await listIds()).toEqual(before);

    await run('docker', ['start', container.getId()]);
    await waitFor(
      async () => ((await fetch(`${baseUrl}/healthz`)).status === 200 ? true : undefined),
      20_000,
      '/healthz to answer 200 again',
    );

    const after = launchAccepted(108);
    await waitFor(
      async () => {
        await publish(after);
        return true;
      },
      10_000,
      'the test client to publish again',
    );
    const listed = await listedWithin([after.launchId], 5000);
    expect(listed[0]).toBe(after.launchId);
    expect(listed.slice(1)).toEqual(before);
  }, 60_000);
});
