import { create } from '@bufbuild/protobuf';
import { SampleSchema, type Sample } from '@albertoriorda95/trajectory-proto';
import { expect, test } from 'vitest';
import { advance, pageRange, sampleIndexAt, stepTime } from '../src/viewer/playback';

const samples: Sample[] = [0, 0.1, 0.2, 0.5].map((tS, seq) => create(SampleSchema, { seq, tS }));

test('the sample at or before t', () => {
  expect(sampleIndexAt(samples, 0)).toBe(0);
  expect(sampleIndexAt(samples, 0.15)).toBe(1);
  expect(sampleIndexAt(samples, 0.2)).toBe(2);
  expect(sampleIndexAt(samples, 99)).toBe(3);
  expect(sampleIndexAt([], 1)).toBe(0);
});

test('the clock advances at 1x and stops at the end', () => {
  expect(advance(0, 0.25, 1)).toEqual({ t: 0.25, ended: false });
  expect(advance(0.9, 0.25, 1)).toEqual({ t: 1, ended: true });
});

test('stepping moves one sample and clamps', () => {
  expect(stepTime(samples, 0.1, 1)).toBe(0.2);
  expect(stepTime(samples, 0, -1)).toBe(0);
  expect(stepTime(samples, 0.5, 1)).toBe(0.5);
});

test('paging', () => {
  expect(pageRange(250, 2, 100)).toEqual({ start: 200, end: 250, pages: 3 });
  expect(pageRange(0, 0, 100)).toEqual({ start: 0, end: 0, pages: 1 });
  expect(pageRange(250, 9, 100).start).toBe(200);
});
