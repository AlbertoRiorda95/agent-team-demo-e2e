import { create, toJson } from '@bufbuild/protobuf';
import { TrajectoryComputedSchema } from '@albertoriorda95/trajectory-proto';
import { expect, test } from 'vitest';
import type { EventSourceLike } from '../src/api/live';
import { useLiveState } from '../src/viewer/liveState';

class FakeSource implements EventSourceLike {
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, (ev: MessageEvent<string>) => void>();
  addEventListener(type: string, l: (ev: MessageEvent<string>) => void): void {
    this.listeners.set(type, l);
  }
  close(): void {}
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data } as MessageEvent<string>);
  }
}

const traj = (id: string) =>
  JSON.stringify(toJson(TrajectoryComputedSchema, create(TrajectoryComputedSchema, { launchId: id }), { useProtoFieldName: true, alwaysEmitImplicit: true }));

function setup(live = true) {
  const es = new FakeSource();
  let clock = 0;
  const state = useLiveState(() => live, () => es, () => clock);
  return { es, state, tick: (ms: number) => (clock += ms) };
}

test('the replay on connect is shown but not announced', () => {
  const { es, state } = setup();
  es.emit('bus', '{"nats":"connected"}');
  es.emit('trajectory', traj('11111111-aaaa'));
  expect(state.latest.value?.launchId).toBe('11111111-aaaa');
  expect(state.toast.value).toBe('');
  expect(state.announcement.value).toBe('');
  expect(state.disconnected.value).toBe(false);
});

test('a new trajectory replaces the latest and is announced', () => {
  const { es, state, tick } = setup();
  es.emit('bus', '{"nats":"connected"}');
  es.emit('trajectory', traj('11111111-aaaa'));
  tick(1000);
  es.emit('trajectory', traj('22222222-bbbb'));
  expect(state.latest.value?.launchId).toBe('22222222-bbbb');
  expect(state.toast.value).toMatch(/^New trajectory 22222222 at \d\d:\d\d:\d\d: playback reset to 0$/);
  expect(state.announcement.value).toBe(state.toast.value);
  state.dismissToast();
  expect(state.toast.value).toBe('');
});

test('in History a new trajectory only marks Live as new', () => {
  const { es, state, tick } = setup(false);
  es.emit('bus', '{"nats":"connected"}');
  tick(1000);
  es.emit('trajectory', traj('33333333-cccc'));
  expect(state.hasNew.value).toBe(true);
  expect(state.toast.value).toBe('New live trajectory available');
});

test('disconnected on SSE error or bus disconnected, cleared on connected', () => {
  const { es, state } = setup();
  es.emit('bus', '{"nats":"connected"}');
  es.onerror?.(new Event('error'));
  expect(state.disconnected.value).toBe(true);
  es.emit('bus', '{"nats":"connected"}');
  expect(state.disconnected.value).toBe(false);
  es.emit('bus', '{"nats":"disconnected"}');
  expect(state.disconnected.value).toBe(true);
});
