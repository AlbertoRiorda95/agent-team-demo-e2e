import { create } from '@bufbuild/protobuf';
import { LaunchRequestSchema, TrajectoryComputedSchema } from '@albertoriorda95/trajectory-proto';
import { expect, test } from 'vitest';
import { HistoryError, fetchLaunches, fetchTrajectory, toRow, type LaunchPage } from '../src/api/history';
import { useHistoryState, type HistoryApi } from '../src/viewer/historyState';

const row = (id: string) =>
  toRow({
    launch_id: id,
    received_at: '2026-11-28T10:00:00.123456Z',
    computed_at: '2026-11-28T10:00:00.180Z',
    request: { mass_kg: 2, force_n: 100, elevation_deg: 60, azimuth_deg: 45, burn_duration_s: 0.5 },
    end_reason: 'END_REASON_GROUND',
    flight_time_s: 8.8,
    max_height_m: 95,
    range_m: 220,
    sample_count: 10,
  });

function fakeApi(pages: LaunchPage[]): HistoryApi & { calls: Array<string | null> } {
  const calls: Array<string | null> = [];
  return {
    calls,
    list: async c => {
      calls.push(c);
      const p = pages.shift();
      if (!p) throw new HistoryError('PostgreSQL is unreachable', 503);
      return p;
    },
    trajectory: async id => {
      if (id === 'missing') throw new HistoryError('No stored launch', 404);
      return create(TrajectoryComputedSchema, { launchId: id });
    },
  };
}

test('toRow decodes the request with the library', () => {
  expect(row('a').request.massKg).toBe(2);
  expect(create(LaunchRequestSchema).massKg).toBe(0);
});

test('load, then Load more appends and ends on a null cursor', async () => {
  const api = fakeApi([
    { items: [row('a')], nextCursor: 'c1' },
    { items: [row('b')], nextCursor: null },
  ]);
  const h = useHistoryState(api);
  await h.load();
  expect(h.hasMore.value).toBe(true);
  await h.loadMore();
  expect(h.rows.value.map(r => r.launchId)).toEqual(['a', 'b']);
  expect(h.hasMore.value).toBe(false);
  expect(api.calls).toEqual([null, 'c1']);
});

test('empty and error states, Retry', async () => {
  const h = useHistoryState(fakeApi([{ items: [], nextCursor: null }]));
  await h.load();
  expect(h.rows.value).toEqual([]);
  expect(h.error.value).toBe('');
  await h.load();
  expect(h.error.value).toBe('PostgreSQL is unreachable');
});

test('select loads the trajectory; an unknown id sets the error and Back clears it', async () => {
  const h = useHistoryState(fakeApi([]));
  await h.select('x');
  expect(h.trajectory.value?.launchId).toBe('x');
  await h.select('missing');
  expect(h.trajectory.value).toBeNull();
  expect(h.trajectoryError.value).toBe('No stored launch');
  h.clearSelection();
  expect(h.trajectoryError.value).toBe('');
  expect(h.selectedId.value).toBe('');
});

test('the HTTP layer maps problem+json and network failures', async () => {
  const problem = new Response(JSON.stringify({ detail: 'id must be a UUID' }), { status: 400 });
  await expect(fetchTrajectory('x', async () => problem)).rejects.toMatchObject({ message: 'id must be a UUID', status: 400 });
  await expect(
    fetchLaunches(null, 50, async () => {
      throw new TypeError('network');
    }),
  ).rejects.toMatchObject({ status: 0 });
  let url = '';
  await fetchLaunches('abc', 10, async u => {
    url = u;
    return new Response(JSON.stringify({ items: [], next_cursor: null }));
  });
  expect(url).toBe('/api/launches?limit=10&cursor=abc');
});
