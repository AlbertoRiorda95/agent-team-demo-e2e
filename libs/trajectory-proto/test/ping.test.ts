// Smoke test of the built package (dist/): a demo.v1.Ping survives a round
// trip through the Protobuf binary encoding.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { PingSchema } from '../dist/index.js';

test('a Ping round-trips through the binary encoding', () => {
  const ping = create(PingSchema, { message: 'hello', sentAtMs: 1_700_000_000_000n });

  const decoded = fromBinary(PingSchema, toBinary(PingSchema, ping));

  assert.equal(decoded.message, 'hello');
  assert.equal(decoded.sentAtMs, 1_700_000_000_000n);
});

test('the schema has the full Protobuf name', () => {
  assert.equal(PingSchema.typeName, 'demo.v1.Ping');
});
