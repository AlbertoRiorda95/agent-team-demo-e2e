import { create } from '@bufbuild/protobuf';
import { SampleSchema, type Sample } from '@albertoriorda95/trajectory-proto';
import { expect, test } from 'vitest';
import { interpolateAt } from '../src/viewer/interpolate';
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

const pt = (seq: number, tS: number, x: number, vx: number) => create(SampleSchema, { seq, tS, xM: x, yM: 2 * x, zM: -x, vxMps: vx, vyMps: 0, vzMps: 1 });

test('interpolation equals the linear blend between the two samples', () => {
  const s = [pt(0, 0, 0, 0), pt(1, 1, 10, 4), pt(2, 2, 14, 8)];
  for (let i = 0; i < 20; i++) {
    const t = Math.random() * 2;
    const st = interpolateAt(s, t)!;
    const k = Math.min(Math.floor(t), 1);
    const f = t - k;
    const a = s[k]!;
    const b = s[k + 1]!;
    expect(st.x).toBeCloseTo(a.xM + (b.xM - a.xM) * f, 12);
    expect(st.vx).toBeCloseTo(a.vxMps + (b.vxMps - a.vxMps) * f, 12);
    expect(st.index).toBe(k);
  }
});

test('on a sample the state is that sample, past the ends it is clamped', () => {
  const s = [pt(0, 0, 0, 0), pt(1, 1, 10, 4)];
  expect(interpolateAt(s, 1)).toMatchObject({ x: 10, vx: 4, index: 1, between: false });
  expect(interpolateAt(s, 0.5)).toMatchObject({ x: 5, between: true });
  expect(interpolateAt(s, 9)).toMatchObject({ t: 1, x: 10 });
  expect(interpolateAt(s, -3)).toMatchObject({ t: 0, x: 0 });
  expect(interpolateAt([], 1)).toBeUndefined();
});

test('one sample and duplicate times do not divide by zero', () => {
  expect(interpolateAt([pt(0, 0, 3, 1)], 5)).toMatchObject({ x: 3, index: 0, between: false });
  const d = [pt(0, 0, 0, 0), pt(1, 1, 10, 4), pt(2, 1, 12, 6), pt(3, 2, 20, 8)];
  expect(interpolateAt(d, 1)).toMatchObject({ x: 12, index: 2, between: false });
  expect(interpolateAt(d, 1.5)).toMatchObject({ x: 16, between: true });
});

test('the clock scales wall time by the speed: 4 s gives 1, 4 and 16 s', () => {
  const run = (speed: number) => {
    let t = 0;
    for (let i = 0; i < 240; i++) t = advance(t, 1 / 60, 100, speed).t;
    return t;
  };
  expect(run(0.25)).toBeCloseTo(1, 9);
  expect(run(1)).toBeCloseTo(4, 9);
  expect(run(4)).toBeCloseTo(16, 9);
  expect(advance(99, 1, 100, 4)).toEqual({ t: 100, ended: true });
});

test('stepping back from between two samples goes to the earlier one', () => {
  expect(stepTime(samples, 0.15, -1)).toBe(0.1);
  expect(stepTime(samples, 0.15, 1)).toBe(0.2);
});
