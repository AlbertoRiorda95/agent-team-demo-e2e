import { fromJson } from '@bufbuild/protobuf';
import { TrajectoryComputedSchema, type TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import type { components } from './schema';

export type BusState = components['schemas']['BusState'];

/** Decode the data of a `trajectory` event of GET /api/live. */
export function decodeTrajectory(data: string): TrajectoryComputed {
  return fromJson(TrajectoryComputedSchema, JSON.parse(data) as never);
}

export function decodeBus(data: string): BusState {
  return JSON.parse(data) as BusState;
}

/** The minimal EventSource surface the client uses (a fake in the tests). */
export interface EventSourceLike {
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}

export type LiveEvents = {
  onOpen(): void;
  onError(): void;
  onBus(state: BusState): void;
  onTrajectory(t: TrajectoryComputed): void;
};

export function openLive(events: LiveEvents, make: (url: string) => EventSourceLike = u => new EventSource(u)): () => void {
  const es = make('/api/live');
  es.onopen = () => events.onOpen();
  es.onerror = () => events.onError();
  es.addEventListener('bus', ev => events.onBus(decodeBus(ev.data)));
  es.addEventListener('trajectory', ev => {
    try {
      events.onTrajectory(decodeTrajectory(ev.data));
    } catch {
      // a message that does not decode is ignored: the next one replaces it
    }
  });
  return () => es.close();
}
