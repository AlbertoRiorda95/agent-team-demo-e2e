// The record of accepted launches (domain).
import { describe, expect, it } from 'vitest';
import { AcceptedLaunches } from '../src/domain/accepted-launches.ts';
import { launchAccepted } from './fakes.ts';

function entry(n: number) {
  const message = launchAccepted(n);
  return { launchId: message.launchId, acceptedAt: new Date(0), request: message.request! };
}

describe('AcceptedLaunches', () => {
  it('rejects a capacity that is not a positive integer', () => {
    expect(() => new AcceptedLaunches(0)).toThrow(/capacity/);
    expect(() => new AcceptedLaunches(1.5)).toThrow(/capacity/);
  });

  it('drops the oldest beyond the capacity; a dropped launch can come back as the newest', () => {
    const record = new AcceptedLaunches(2);
    expect(record.add(entry(1))).toBe(true);
    expect(record.add(entry(2))).toBe(true);
    expect(record.add(entry(2))).toBe(false);
    expect(record.add(entry(3))).toBe(true);
    expect(record.size).toBe(2);
    expect(record.list().map((e) => e.launchId)).toEqual([entry(3).launchId, entry(2).launchId]);
    expect(record.add(entry(1))).toBe(true);
    expect(record.list().map((e) => e.launchId)).toEqual([entry(1).launchId, entry(3).launchId]);
  });
});
