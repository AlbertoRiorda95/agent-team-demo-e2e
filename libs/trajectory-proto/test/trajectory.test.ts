// The largest trajectory the pipeline allows (the sample cap of
// proto/README.md: 100000 samples) survives the binary and the JSON encodings
// unchanged, and its binary encoding fits in the NATS max_payload of 8 MB.
import { describe, expect, it } from 'vitest';
import { create, equals, fromBinary, fromJson, toBinary, toJson } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  LaunchAcceptedSchema,
  Sample_Phase,
  TrajectoryComputed_EndReason,
  TrajectoryComputedSchema,
  type TrajectoryComputed,
} from '@albertoriorda95/trajectory-proto';

const SAMPLE_CAP = 100_000;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

const request = {
  massKg: 1.5,
  position: { xM: 1.25, yM: -2.5, zM: 0.75 },
  azimuthDeg: 45.5,
  elevationDeg: 60.25,
  forceN: 120.125,
  burnDurationS: 2.75,
};

// Every field non-zero and with a full-precision fraction: proto3 omits zero
// values, so this is the worst case for the size.
function largestTrajectory(): TrajectoryComputed {
  const samples = Array.from({ length: SAMPLE_CAP }, (_, seq) => {
    const t = (seq + 1) / 3;
    return {
      seq,
      tS: t,
      xM: 1000 + t * Math.PI,
      yM: -1000 - t * Math.E,
      zM: 5000 * Math.sin(t / 7) + 5001,
      vxMps: Math.PI + 1 / (seq + 3),
      vyMps: -Math.E - 1 / (seq + 7),
      vzMps: 300 * Math.cos(t / 11) + 0.1,
      phase: seq < 300 ? Sample_Phase.BURN : Sample_Phase.BALLISTIC,
    };
  });
  return create(TrajectoryComputedSchema, {
    launchId: '0b7f9d64-3c2e-4d5a-9f1e-8a6b2c4d1e3f',
    acceptedAt: { seconds: 1_795_000_000n, nanos: 123_456_789 },
    computedAt: timestampFromDate(new Date('2026-11-22T10:00:01.987Z')),
    request,
    config: {
      propagationTimeS: 33_333.333,
      sampleStepS: 1 / 3,
      gravityMps2: 9.80665,
      configVersion: 18_446_744_073_709_551_615n,
    },
    endReason: TrajectoryComputed_EndReason.TIME_LIMIT,
    flightTimeS: 33_333.333,
    maxHeightM: 10_000.987654321,
    rangeM: 123_456.789012345,
    samples,
  });
}

describe('trajectory.v1.TrajectoryComputed with the sample cap', () => {
  const trajectory = largestTrajectory();
  const binary = toBinary(TrajectoryComputedSchema, trajectory);

  it(`fits in ${MAX_PAYLOAD_BYTES} bytes as binary`, () => {
    expect(trajectory.samples).toHaveLength(SAMPLE_CAP);
    expect(binary.byteLength).toBeLessThan(MAX_PAYLOAD_BYTES);
  });

  it('round-trips through the binary encoding unchanged', () => {
    const decoded = fromBinary(TrajectoryComputedSchema, binary);

    expect(equals(TrajectoryComputedSchema, decoded, trajectory)).toBe(true);
    expect(decoded.samples[SAMPLE_CAP - 1]).toEqual(trajectory.samples[SAMPLE_CAP - 1]);
  });

  it('round-trips through JSON with the proto field names unchanged', () => {
    const json = JSON.parse(
      JSON.stringify(toJson(TrajectoryComputedSchema, trajectory, { useProtoFieldName: true })),
    );

    expect(json.launch_id).toBe(trajectory.launchId);
    expect(json.end_reason).toBe('END_REASON_TIME_LIMIT');
    expect(json.samples[0]).toHaveProperty('vx_mps');

    const decoded = fromJson(TrajectoryComputedSchema, json);
    expect(equals(TrajectoryComputedSchema, decoded, trajectory)).toBe(true);
  });
});

describe('trajectory.v1.LaunchAccepted', () => {
  it('round-trips through the binary encoding unchanged', () => {
    const accepted = create(LaunchAcceptedSchema, {
      launchId: '0b7f9d64-3c2e-4d5a-9f1e-8a6b2c4d1e3f',
      acceptedAt: timestampFromDate(new Date('2026-11-22T10:00:00.000Z')),
      request,
      config: { propagationTimeS: 600, sampleStepS: 0.1, gravityMps2: 9.80665 },
    });

    const decoded = fromBinary(LaunchAcceptedSchema, toBinary(LaunchAcceptedSchema, accepted));

    expect(equals(LaunchAcceptedSchema, decoded, accepted)).toBe(true);
    expect(LaunchAcceptedSchema.typeName).toBe('trajectory.v1.LaunchAccepted');
  });
});
