// The status.viz-web heartbeat with a fake bus.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { ServiceStatus_State } from '@albertoriorda95/trajectory-proto';
import { sendHeartbeat, startHeartbeat, type HeartbeatDeps } from '../src/application/heartbeat.ts';
import { FakeBus, silentLogger } from './fakes.ts';

function deps(bus: FakeBus, overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps {
  return {
    publisher: bus,
    subscription: bus,
    logger: silentLogger,
    instance: 'pod-1',
    version: '1.2.3',
    clock: () => new Date('2026-11-23T10:00:00Z'),
    ...overrides,
  };
}

describe('heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ok while the subscription is up', async () => {
    const bus = new FakeBus();
    await sendHeartbeat(deps(bus));
    expect(bus.statuses).toHaveLength(1);
    const [status] = bus.statuses;
    expect(status?.service).toBe('viz-web');
    expect(status?.instance).toBe('pod-1');
    expect(status?.version).toBe('1.2.3');
    expect(status?.state).toBe(ServiceStatus_State.OK);
    expect(status?.configVersion).toBe(0n);
    expect(timestampDate(status!.sentAt!).toISOString()).toBe('2026-11-23T10:00:00.000Z');
  });

  it('reports degraded with a detail while the subscription is down', async () => {
    const bus = new FakeBus();
    bus.up = false;
    await sendHeartbeat(deps(bus));
    expect(bus.statuses[0]?.state).toBe(ServiceStatus_State.DEGRADED);
    expect(bus.statuses[0]?.detail).toMatch(/launches.accepted/);
  });

  it('sends nothing while it cannot publish, and does not throw when publishing fails', async () => {
    const bus = new FakeBus();
    bus.connected = false;
    await sendHeartbeat(deps(bus));
    expect(bus.statuses).toEqual([]);

    bus.connected = true;
    bus.failPublish = true;
    await expect(sendHeartbeat(deps(bus))).resolves.toBeUndefined();
  });

  it('sends one right away and then one every 5 s until stopped', async () => {
    vi.useFakeTimers();
    const bus = new FakeBus();
    const stop = startHeartbeat(deps(bus));
    await vi.advanceTimersByTimeAsync(0);
    expect(bus.statuses).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(bus.statuses).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bus.statuses).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(bus.statuses).toHaveLength(3);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(bus.statuses).toHaveLength(3);
  });
});
