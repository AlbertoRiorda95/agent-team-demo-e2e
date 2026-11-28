// The history against a real PostgreSQL and NATS (Testcontainers)
// (docs/design/viewer.md > Test seams: Integration): the store migrations
// V1-V3 applied for two prefixes, the server connected as the read-only
// `viz_web` user (member of `trajectory_reader`), the rows written as store
// writes them (TrajectoryRows), the prefix from `config.store.applied` on the
// CONFIG stream, the SQL and the grants.
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type StreamConfig } from '@nats-io/jetstream';
import { fromJson, toJson, type JsonValue } from '@bufbuild/protobuf';
import { TimestampSchema, timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  Sample_Phase,
  TrajectoryComputedSchema,
  TrajectoryComputed_EndReason,
  type TrajectoryComputed,
} from '@albertoriorda95/trajectory-proto';
import { NatsBus } from '../../src/adapters/nats-bus.ts';
import { PgHistory } from '../../src/adapters/pg-history.ts';
import { STORE_CONFIG_APPLIED } from '../../src/application/track-table-prefix.ts';
import { createServer, type Server } from '../../src/server.ts';
import { storeConfigApplied, trajectoryComputed } from '../fakes.ts';
import { waitFor } from './helpers.ts';

const MIGRATIONS_DIR = new URL('../../../../store/src/main/resources/db/migration/', import.meta.url);
const STREAMS_DIR = new URL('../../../../../proto/nats/streams/', import.meta.url);
const VIZ_WEB_PASSWORD = 'viz-web-test-only';

/** Trajectory `n`, received `n` seconds after a base time, with microseconds. */
function stored(n: number, samples = 2): TrajectoryComputed {
  const receivedAt = timestampFromDate(new Date(Date.UTC(2026, 10, 1, 0, 0, n)));
  receivedAt.nanos = 654_321_000;
  const computedAt = timestampFromDate(new Date(Date.UTC(2026, 10, 1, 0, 0, n)));
  computedAt.nanos = 987_654_000;
  return trajectoryComputed(n, samples, { acceptedAt: receivedAt, computedAt });
}

/** Writes the trajectory into the tables of `prefix` as store does (services/store TrajectoryRows). */
async function insert(db: pg.Client, prefix: string, t: TrajectoryComputed): Promise<void> {
  const r = t.request!;
  const c = t.config!;
  await db.query(
    `INSERT INTO ${prefix}launches (id, received_at, computed_at, mass_kg, x_m, y_m, z_m, azimuth_deg,
       elevation_deg, force_n, burn_duration_s, propagation_time_s, sample_step_s, gravity_mps2,
       config_version, status, end_reason, flight_time_s, max_height_m, range_m, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'stored', $16, $17, $18, $19, $20)`,
    [
      t.launchId,
      toJson(TimestampSchema, t.acceptedAt!),
      toJson(TimestampSchema, t.computedAt!),
      r.massKg,
      r.position!.xM,
      r.position!.yM,
      r.position!.zM,
      r.azimuthDeg,
      r.elevationDeg,
      r.forceN,
      r.burnDurationS,
      c.propagationTimeS,
      c.sampleStepS,
      c.gravityMps2,
      c.configVersion.toString(),
      t.endReason === TrajectoryComputed_EndReason.GROUND ? 'ground' : 'time_limit',
      t.flightTimeS,
      t.maxHeightM,
      t.rangeM,
      t.samples.length,
    ],
  );
  for (const s of t.samples) {
    await db.query(
      `INSERT INTO ${prefix}trajectory_samples (launch_id, seq, t_s, x_m, y_m, z_m, vx_mps, vy_mps, vz_mps, phase)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [t.launchId, s.seq, s.tS, s.xM, s.yM, s.zM, s.vxMps, s.vyMps, s.vzMps, s.phase === Sample_Phase.BURN ? 'burn' : 'ballistic'],
    );
  }
}

describe('the history on a real PostgreSQL and NATS', () => {
  let postgres: StartedPostgreSqlContainer;
  let nats: StartedTestContainer;
  let admin: pg.Client;
  let client: NatsConnection;
  let server: Server | undefined;
  let baseUrl: string;

  function readerConfig() {
    return {
      host: postgres.getHost(),
      port: postgres.getPort(),
      database: postgres.getDatabase(),
      user: 'viz_web',
      password: VIZ_WEB_PASSWORD,
    };
  }

  async function startServer(): Promise<void> {
    const natsUrl = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;
    server = createServer({
      createBus: (logger) => new NatsBus({ url: natsUrl, logger, reconnectTimeWaitMs: 250 }),
      createHistory: (logger) => new PgHistory({ database: readerConfig(), logger, connectTimeoutMs: 1000 }),
      version: '0.0.0-test',
      instance: 'integration-history',
    });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function stopServer(): Promise<void> {
    await server?.close();
    server = undefined;
  }

  async function firstLaunchId(): Promise<string | undefined> {
    const response = await fetch(`${baseUrl}/api/launches?limit=1`);
    if (response.status !== 200) return undefined;
    const body = (await response.json()) as { items: { launch_id: string }[] };
    return body.items[0]?.launch_id;
  }

  beforeAll(async () => {
    [postgres, nats] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new GenericContainer('nats:2-alpine')
        .withCommand(['-js'])
        .withExposedPorts(4222)
        .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
        .start(),
    ]);

    admin = new pg.Client({ connectionString: postgres.getConnectionUri() });
    await admin.connect();
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^V\d+__.*\.sql$/.test(name))
      .sort((a, b) => Number(a.slice(1, a.indexOf('__'))) - Number(b.slice(1, b.indexOf('__'))));
    expect(migrations).toContain('V3__trajectory_reader_role.sql');
    for (const prefix of ['', 'demo_']) {
      for (const file of migrations) {
        const sql = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8').replaceAll('${prefix}', prefix);
        await admin.query(sql);
      }
    }
    // what the compose db-init does (viewer.md task 4)
    await admin.query(`CREATE ROLE viz_web LOGIN PASSWORD '${VIZ_WEB_PASSWORD}' IN ROLE trajectory_reader`);

    for (let n = 1; n <= 120; n++) await insert(admin, '', stored(n));
    await insert(admin, 'demo_', stored(500, 4));

    const natsUrl = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;
    client = await connect({ servers: natsUrl });
    const jsm = await jetstreamManager(client);
    for (const file of readdirSync(STREAMS_DIR).filter((name) => name.endsWith('.json'))) {
      const config = JSON.parse(readFileSync(new URL(file, STREAMS_DIR), 'utf8')) as StreamConfig;
      await jsm.streams.add(config);
    }
    await startServer();
  }, 180_000);

  afterAll(async () => {
    await stopServer();
    await client?.close();
    await admin?.end().catch(() => undefined);
    await Promise.all([postgres?.stop().catch(() => undefined), nats?.stop()]);
  });

  it('returns the 120 stored launches 50 at a time, newest first, each once', async () => {
    const seen: string[] = [];
    const pages: number[] = [];
    let path = '/api/launches';
    for (;;) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        items: { launch_id: string; received_at: string; sample_count: number }[];
        next_cursor: string | null;
      };
      pages.push(body.items.length);
      seen.push(...body.items.map((item) => item.launch_id));
      if (seen.length === 1) {
        expect(body.items[0]).toMatchObject({ received_at: '2026-11-01T00:02:00.654321Z', sample_count: 2 });
      }
      if (body.next_cursor === null) break;
      path = `/api/launches?cursor=${body.next_cursor}`;
    }
    expect(pages).toEqual([50, 50, 20]);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => stored(120 - i).launchId));
  }, 30_000);

  it('returns a stored trajectory that equals the TrajectoryComputed store consumed, to the microsecond', async () => {
    const response = await fetch(`${baseUrl}/api/launches/${stored(42).launchId}/trajectory`);
    expect(response.status).toBe(200);
    const decoded = fromJson(TrajectoryComputedSchema, (await response.json()) as JsonValue);
    expect(decoded).toEqual(stored(42));
    expect(decoded.samples.map((s) => s.seq)).toEqual([0, 1]);
  });

  it('answers 404 for an unknown id and 400 for a bad cursor', async () => {
    const unknown = await fetch(`${baseUrl}/api/launches/${trajectoryComputed(9999).launchId}/trajectory`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect((await fetch(`${baseUrl}/api/launches?cursor=garbage`)).status).toBe(400);
  });

  it('reads demo_launches after a config.store.applied with prefix demo_, without a restart', async () => {
    expect(await firstLaunchId()).toBe(stored(120).launchId);
    await jetstream(client).publish(STORE_CONFIG_APPLIED, storeConfigApplied('demo_'));
    expect(
      await waitFor(
        async () => ((await firstLaunchId()) === stored(500).launchId ? true : undefined),
        10_000,
        'the history to read demo_launches',
      ),
    ).toBe(true);
    const response = await fetch(`${baseUrl}/api/launches/${stored(500).launchId}/trajectory`);
    expect(fromJson(TrajectoryComputedSchema, (await response.json()) as JsonValue)).toEqual(stored(500, 4));
  }, 30_000);

  it('keeps the prefix in force across a server restart (last message of the subject)', async () => {
    await stopServer();
    await startServer();
    expect(
      await waitFor(
        async () => ((await firstLaunchId()) === stored(500).launchId ? true : undefined),
        10_000,
        'the restarted server to read demo_launches',
      ),
    ).toBe(true);
  }, 30_000);

  it('denies INSERT, UPDATE and DELETE to the viz_web user on both tables of both prefixes', async () => {
    const reader = new pg.Client(readerConfig());
    await reader.connect();
    try {
      const id = stored(1).launchId;
      for (const prefix of ['', 'demo_']) {
        expect((await reader.query(`SELECT count(*)::int AS n FROM ${prefix}launches`)).rows[0].n).toBeGreaterThan(0);
        const writes = [
          `INSERT INTO ${prefix}launches (id) VALUES ('${trajectoryComputed(7777).launchId}')`,
          `UPDATE ${prefix}launches SET mass_kg = 2 WHERE id = '${id}'`,
          `DELETE FROM ${prefix}launches WHERE id = '${id}'`,
          `INSERT INTO ${prefix}trajectory_samples (launch_id, seq) VALUES ('${id}', 99)`,
          `UPDATE ${prefix}trajectory_samples SET t_s = 0 WHERE launch_id = '${id}'`,
          `DELETE FROM ${prefix}trajectory_samples WHERE launch_id = '${id}'`,
        ];
        for (const sql of writes) {
          await expect(reader.query(sql), sql).rejects.toMatchObject({ code: '42501' });
        }
      }
    } finally {
      await reader.end();
    }
  });

  it('answers 503 problem+json while PostgreSQL is stopped and keeps running', async () => {
    await admin.end();
    await postgres.stop();
    const response = await fetch(`${baseUrl}/api/launches`);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await response.json()).toMatchObject({ type: 'about:blank', status: 503 });
    const trajectory = await fetch(`${baseUrl}/api/launches/${stored(1).launchId}/trajectory`);
    expect(trajectory.status).toBe(503);
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  }, 60_000);
});
