// GET /api/launches and GET /api/launches/{id}/trajectory through Fastify
// listening on a random port, with a fake bus and a fake history repository
// (docs/design/viewer.md > Test seams: Server): pagination and cursors, the
// status codes and problem bodies, the prefix from config.store.applied.
import { afterEach, describe, expect, it } from 'vitest';
import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { TrajectoryComputedSchema, TrajectoryComputed_EndReason } from '@albertoriorda95/trajectory-proto';
import { STORE_CONFIG_APPLIED } from '../src/application/track-table-prefix.ts';
import { createServer, type Server } from '../src/server.ts';
import { FakeBus, FakeHistory, storeConfigApplied, trajectoryComputed } from './fakes.ts';

/** A stored trajectory `n` received `n` seconds after a base time, with microseconds. */
function stored(n: number, samples = 3) {
  const receivedAt = timestampFromDate(new Date(Date.UTC(2026, 10, 1, 0, 0, n)));
  receivedAt.nanos = 123_456_000;
  return trajectoryComputed(n, samples, { acceptedAt: receivedAt });
}

interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
}

describe('the history routes with a fake repository', () => {
  let server: Server | undefined;
  let bus: FakeBus;
  let history: FakeHistory;
  let baseUrl: string;

  async function start(withHistory = true): Promise<void> {
    bus = new FakeBus();
    history = new FakeHistory();
    server = createServer({
      createBus: () => bus,
      createHistory: () => (withHistory ? history : undefined),
      version: '0.0.0-test',
      instance: 'test',
      heartbeatIntervalMs: 60_000,
    });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function get(path: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`);
  }

  async function expectProblem(response: Response, status: number): Promise<Problem> {
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    const body = (await response.json()) as Problem;
    expect(body).toMatchObject({ type: 'about:blank', status });
    expect(body.title).toEqual(expect.any(String));
    expect(body.detail).toEqual(expect.any(String));
    return body;
  }

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe('GET /api/launches', () => {
    it('returns 50 newest first and follows the cursors through all 120 once', async () => {
      await start();
      for (let n = 1; n <= 120; n++) history.store('', stored(n));

      const seen: string[] = [];
      const pages: number[] = [];
      let path = '/api/launches';
      for (;;) {
        const response = await get(path);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(/^application\/json/);
        const body = (await response.json()) as { items: { launch_id: string }[]; next_cursor: string | null };
        pages.push(body.items.length);
        seen.push(...body.items.map((item) => item.launch_id));
        if (body.next_cursor === null) break;
        path = `/api/launches?cursor=${encodeURIComponent(body.next_cursor)}`;
      }

      expect(pages).toEqual([50, 50, 20]);
      expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => stored(120 - i).launchId));
    });

    it('describes each launch as a LaunchSummary', async () => {
      await start();
      history.store('', stored(7, 4));
      const body = (await (await get('/api/launches')).json()) as { items: unknown[]; next_cursor: null };
      expect(body.next_cursor).toBeNull();
      expect(body.items).toEqual([
        {
          launch_id: stored(7).launchId,
          received_at: '2026-11-01T00:00:07.123456Z',
          computed_at: '2026-11-28T10:00:00.456Z',
          request: {
            mass_kg: 1,
            position: { x_m: 0, y_m: 0, z_m: 0 },
            azimuth_deg: 45,
            elevation_deg: 60,
            force_n: 100,
            burn_duration_s: 0.5,
          },
          end_reason: 'END_REASON_GROUND',
          flight_time_s: stored(7, 4).flightTimeS,
          max_height_m: 17,
          range_m: 20,
          sample_count: 4,
        },
      ]);
    });

    it('breaks ties on received_at by id and honours limit', async () => {
      await start();
      const same = stored(1);
      for (const n of [3, 1, 2]) history.store('', trajectoryComputed(n, 1, { acceptedAt: same.acceptedAt }));

      const first = (await (await get('/api/launches?limit=2')).json()) as {
        items: { launch_id: string }[];
        next_cursor: string;
      };
      expect(first.items.map((i) => i.launch_id)).toEqual([trajectoryComputed(3).launchId, trajectoryComputed(2).launchId]);
      const second = (await (await get(`/api/launches?limit=2&cursor=${first.next_cursor}`)).json()) as {
        items: { launch_id: string }[];
        next_cursor: string | null;
      };
      expect(second.items.map((i) => i.launch_id)).toEqual([trajectoryComputed(1).launchId]);
      expect(second.next_cursor).toBeNull();
    });

    it('returns an empty page when nothing is stored', async () => {
      await start();
      expect(await (await get('/api/launches')).json()).toEqual({ items: [], next_cursor: null });
    });

    it.each(['0', '201', '-1', '1.5', 'abc', ''])('answers 400 for limit=%s', async (limit) => {
      await start();
      const body = await expectProblem(await get(`/api/launches?limit=${limit}`), 400);
      expect(body.detail).toMatch(/limit/);
    });

    it('answers 400 for a repeated limit', async () => {
      await start();
      await expectProblem(await get('/api/launches?limit=1&limit=2'), 400);
    });

    it.each([
      ['not base64url', 'a+b/c='],
      ['not JSON', Buffer.from('nope').toString('base64url')],
      ['no id', Buffer.from(JSON.stringify({ r: '2026-11-01T00:00:00Z' })).toString('base64url')],
      ['a bad id', Buffer.from(JSON.stringify({ r: '2026-11-01T00:00:00Z', i: 'x' })).toString('base64url')],
      [
        'a bad timestamp',
        Buffer.from(JSON.stringify({ r: 'yesterday', i: trajectoryComputed(1).launchId })).toString('base64url'),
      ],
    ])('answers 400 for a cursor that is %s', async (_what, cursor) => {
      await start();
      const body = await expectProblem(await get(`/api/launches?cursor=${encodeURIComponent(cursor)}`), 400);
      expect(body.detail).toMatch(/cursor/);
    });

    it('answers 503 when the database is unreachable', async () => {
      await start();
      history.unavailable = true;
      const body = await expectProblem(await get('/api/launches'), 503);
      expect(body.detail).not.toMatch(/connection refused/);
    });

    it('answers 503 when the database is not configured', async () => {
      await start(false);
      await expectProblem(await get('/api/launches'), 503);
    });
  });

  describe('GET /api/launches/{id}/trajectory', () => {
    it('returns the stored TrajectoryComputed in proto3 JSON, decoding with fromJson', async () => {
      await start();
      const trajectory = stored(9, 5);
      trajectory.endReason = TrajectoryComputed_EndReason.TIME_LIMIT;
      history.store('', trajectory);

      const response = await get(`/api/launches/${trajectory.launchId.toUpperCase()}/trajectory`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      const json = (await response.json()) as Record<string, unknown>;
      expect(json.end_reason).toBe('END_REASON_TIME_LIMIT');
      expect(json.accepted_at).toBe('2026-11-01T00:00:09.123456Z');
      expect(fromJson(TrajectoryComputedSchema, json as JsonValue)).toEqual(trajectory);
    });

    it('answers 404 for an unknown id', async () => {
      await start();
      await expectProblem(await get(`/api/launches/${trajectoryComputed(404).launchId}/trajectory`), 404);
    });

    it('answers 400 when the id is not a UUID', async () => {
      await start();
      const body = await expectProblem(await get('/api/launches/not-a-uuid/trajectory'), 400);
      expect(body.detail).toMatch(/UUID/);
      expect(history.prefixes).toEqual([]);
    });

    it('answers 503 when the database is unreachable', async () => {
      await start();
      history.unavailable = true;
      await expectProblem(await get(`/api/launches/${trajectoryComputed(1).launchId}/trajectory`), 503);
    });
  });

  describe('the table prefix from config.store.applied', () => {
    it('reads the empty prefix until a ConfigApplied arrives, then the new one without a restart', async () => {
      await start();
      history.store('', stored(1));
      history.store('demo_', stored(2));

      const before = (await (await get('/api/launches')).json()) as { items: { launch_id: string }[] };
      expect(before.items.map((i) => i.launch_id)).toEqual([stored(1).launchId]);

      await bus.deliverConfigApplied(storeConfigApplied('demo_'));
      const after = (await (await get('/api/launches')).json()) as { items: { launch_id: string }[] };
      expect(after.items.map((i) => i.launch_id)).toEqual([stored(2).launchId]);
      expect((await get(`/api/launches/${stored(2).launchId}/trajectory`)).status).toBe(200);
      expect(history.prefixes).toEqual(['', 'demo_', 'demo_']);
    });

    it('takes the prefix in force from a refused ConfigApplied (ok = false)', async () => {
      await start();
      await bus.deliverConfigApplied(storeConfigApplied('kept_', { ok: false, error: 'stale version' }));
      await get('/api/launches');
      expect(history.prefixes).toEqual(['kept_']);
    });

    it.each([
      ['does not decode', new Uint8Array([0xff, 0xff, 0xff])],
      ['is not store\'s', storeConfigApplied('demo_', { service: 'propagator' })],
      ['has no store payload', storeConfigApplied('demo_', { payload: { case: undefined } })],
      ['has a bad prefix', storeConfigApplied('Demo; DROP TABLE launches; --')],
    ])('rejects a ConfigApplied that %s, keeps the prefix and reports one PipelineError', async (_what, data) => {
      await start();
      await bus.deliverConfigApplied(storeConfigApplied('demo_'));
      await bus.deliverConfigApplied(data);
      await get('/api/launches');
      expect(history.prefixes).toEqual(['demo_']);
      expect(bus.errors).toHaveLength(1);
      expect(bus.errors[0]).toMatchObject({ service: 'viz-web', subject: STORE_CONFIG_APPLIED });
    });
  });

  it('closes the repository with the server', async () => {
    await start();
    await server?.close();
    server = undefined;
    expect(history.closed).toBe(true);
  });
});
