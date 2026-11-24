// The store config payload (version 0.2.0): a ConfigSet and a ConfigApplied
// with a `store` payload survive the binary and the JSON encodings unchanged,
// on the field numbers of proto/README.md > Config payloads, and the existing
// `propagator` payload is unchanged.
import { describe, expect, it } from 'vitest';
import { create, equals, fromBinary, fromJson, toBinary, toJson } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  ConfigAppliedSchema,
  ConfigSetSchema,
  StoreConfigSchema,
} from '@albertoriorda95/trajectory-proto';

// Stand-in sealed bytes: 12-byte nonce || ciphertext || 16-byte tag. The
// package carries them as opaque bytes; the sealing is the store's.
const sealed = Uint8Array.from({ length: 12 + 40 + 16 }, (_, i) => (i * 37 + 11) % 256);

describe('trajectory.v1.StoreConfig', () => {
  it('has the full Protobuf name and the field numbers of the contract', () => {
    expect(StoreConfigSchema.typeName).toBe('trajectory.v1.StoreConfig');
    expect(StoreConfigSchema.field.tablePrefix.number).toBe(1);
    expect(StoreConfigSchema.field.dbCredentialsSealed.number).toBe(2);
    expect(ConfigSetSchema.field.store.number).toBe(4);
    expect(ConfigAppliedSchema.field.store.number).toBe(8);
  });

  it('round-trips a ConfigSet with a store payload', () => {
    const set = create(ConfigSetSchema, {
      service: 'store',
      configVersion: 3n,
      payload: {
        case: 'store',
        value: { tablePrefix: 'demo_', dbCredentialsSealed: sealed },
      },
    });

    const decoded = fromBinary(ConfigSetSchema, toBinary(ConfigSetSchema, set));

    expect(equals(ConfigSetSchema, decoded, set)).toBe(true);
    expect(decoded.payload.case).toBe('store');
    if (decoded.payload.case !== 'store') return;
    expect(decoded.payload.value.tablePrefix).toBe('demo_');
    expect(decoded.payload.value.dbCredentialsSealed).toEqual(sealed);

    const fromJsonSet = fromJson(ConfigSetSchema, toJson(ConfigSetSchema, set));
    expect(equals(ConfigSetSchema, fromJsonSet, set)).toBe(true);
  });

  it('round-trips a prefix-only ConfigSet (empty sealed credentials)', () => {
    const set = create(ConfigSetSchema, {
      service: 'store',
      configVersion: 4n,
      payload: { case: 'store', value: { tablePrefix: '' } },
    });

    const decoded = fromBinary(ConfigSetSchema, toBinary(ConfigSetSchema, set));

    expect(decoded.payload.case).toBe('store');
    if (decoded.payload.case !== 'store') return;
    expect(decoded.payload.value.tablePrefix).toBe('');
    expect(decoded.payload.value.dbCredentialsSealed).toHaveLength(0);
  });

  it('round-trips a ConfigApplied with a store payload', () => {
    const applied = create(ConfigAppliedSchema, {
      service: 'store',
      instance: 'store-0',
      configVersion: 3n,
      ok: true,
      appliedAt: timestampFromDate(new Date('2026-11-24T10:00:00.123Z')),
      payload: { case: 'store', value: { tablePrefix: 'demo_' } },
    });

    const decoded = fromBinary(ConfigAppliedSchema, toBinary(ConfigAppliedSchema, applied));

    expect(equals(ConfigAppliedSchema, decoded, applied)).toBe(true);
    expect(decoded.payload.case).toBe('store');
    if (decoded.payload.case !== 'store') return;
    expect(decoded.payload.value.dbCredentialsSealed).toHaveLength(0);
  });

  it('keeps the propagator payload as before', () => {
    const set = create(ConfigSetSchema, {
      service: 'propagator',
      configVersion: 2n,
      payload: { case: 'propagator', value: { propagationTimeS: 60, sampleStepS: 0.01 } },
    });

    const decoded = fromBinary(ConfigSetSchema, toBinary(ConfigSetSchema, set));

    expect(decoded.payload.case).toBe('propagator');
    expect(equals(ConfigSetSchema, decoded, set)).toBe(true);
  });
});
