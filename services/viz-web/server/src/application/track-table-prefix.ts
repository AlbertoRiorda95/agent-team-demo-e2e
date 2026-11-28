// Use case "Table prefix" (docs/design/viewer.md > Data and API,
// Subscriptions): a `ConfigApplied` from `config.store.applied` puts its
// `store.table_prefix` in force for the next history requests, also when `ok`
// is false (the payload is the config still in force). A message that does
// not decode, is not store's, has no store payload or has a prefix of the
// wrong format changes nothing: it is logged and reported once on
// `pipeline.errors`.
import { fromBinary } from '@bufbuild/protobuf';
import {
  ConfigAppliedSchema,
  configAppliedSubject,
  type ConfigApplied,
} from '@albertoriorda95/trajectory-proto';
import { type TablePrefix, isTablePrefix } from '../domain/table-prefix.ts';
import type { Clock, Logger, MessageHandler, Publisher } from './ports.ts';
import { InvalidMessage, reportInvalidMessage } from './record-launch.ts';

export const STORE_CONFIG_APPLIED = configAppliedSubject('store');

export interface TrackTablePrefixDeps {
  prefix: TablePrefix;
  publisher: Publisher;
  logger: Logger;
  clock?: Clock;
}

function decode(data: Uint8Array): ConfigApplied {
  try {
    return fromBinary(ConfigAppliedSchema, data, { readUnknownFields: false });
  } catch (error) {
    throw new InvalidMessage(`ConfigApplied does not decode: ${(error as Error).message}`);
  }
}

/** The checks of the edge: the prefix of the store payload, in the format of config.proto. */
function validate(message: ConfigApplied): string {
  if (message.service !== 'store') {
    throw new InvalidMessage(`ConfigApplied service is "${message.service}", not "store"`);
  }
  if (message.payload.case !== 'store') throw new InvalidMessage('ConfigApplied has no store payload');
  const prefix = message.payload.value.tablePrefix;
  if (!isTablePrefix(prefix)) {
    throw new InvalidMessage(`ConfigApplied table_prefix does not match ^[a-z][a-z0-9_]{0,15}$: "${prefix}"`);
  }
  return prefix;
}

/** The handler of `config.store.applied`. It never throws. */
export function trackTablePrefix(deps: TrackTablePrefixDeps): MessageHandler {
  const clock = deps.clock ?? (() => new Date());
  return async (data) => {
    let prefix: string;
    try {
      prefix = validate(decode(data));
    } catch (error) {
      if (!(error instanceof InvalidMessage)) throw error;
      await reportInvalidMessage(deps, clock, STORE_CONFIG_APPLIED, error);
      return;
    }
    if (prefix !== deps.prefix.current) {
      deps.logger.info({ table_prefix: prefix, previous: deps.prefix.current }, 'table prefix in force changed');
    }
    deps.prefix.set(prefix);
  };
}
