// Smoke test of the built package: the package's own name resolves to dist/
// through the "exports" of package.json (the type check maps it to src/, see
// tsconfig.json). The deprecated demo.v1.Ping still round-trips through the
// Protobuf binary encoding.
import { describe, expect, it } from 'vitest';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { PingSchema } from '@albertoriorda95/trajectory-proto';

describe('demo.v1.Ping (deprecated)', () => {
  it('round-trips through the binary encoding', () => {
    const ping = create(PingSchema, { message: 'hello', sentAtMs: 1_700_000_000_000n });

    const decoded = fromBinary(PingSchema, toBinary(PingSchema, ping));

    expect(decoded.message).toBe('hello');
    expect(decoded.sentAtMs).toBe(1_700_000_000_000n);
  });

  it('has the full Protobuf name', () => {
    expect(PingSchema.typeName).toBe('demo.v1.Ping');
  });
});
