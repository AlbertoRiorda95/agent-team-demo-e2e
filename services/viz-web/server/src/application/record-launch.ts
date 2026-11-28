// Use case "Record" (docs/design/viz-backend.md > User flows): a message from
// `launches.accepted` is validated at the edge, then kept in the record. A
// message that does not decode or lacks a required value is not recorded: it
// is logged and reported once on `pipeline.errors` (proto/README.md >
// Encoding).
import { create, fromBinary } from '@bufbuild/protobuf';
import { timestampDate, timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  LAUNCHES_ACCEPTED,
  LaunchAcceptedSchema,
  PipelineErrorSchema,
  type LaunchAccepted,
} from '@albertoriorda95/trajectory-proto';
import type { AcceptedLaunch, AcceptedLaunches } from '../domain/accepted-launches.ts';
import type { Clock, Logger, MessageHandler, Publisher } from './ports.ts';

export const SERVICE_NAME = 'viz-web';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordLaunchDeps {
  record: AcceptedLaunches;
  publisher: Publisher;
  logger: Logger;
  clock?: Clock;
}

/** A message rejected at the edge; `launchId` when the message had one. */
export class InvalidMessage extends Error {
  readonly launchId: string;
  constructor(message: string, launchId = '') {
    super(message);
    this.launchId = launchId;
  }
}

function decode(data: Uint8Array): LaunchAccepted {
  try {
    // unknown fields are dropped: the record keeps at most 1000 requests, and a
    // message padded with unknown bytes must not grow it beyond their size
    return fromBinary(LaunchAcceptedSchema, data, { readUnknownFields: false });
  } catch (error) {
    throw new InvalidMessage(`LaunchAccepted does not decode: ${(error as Error).message}`);
  }
}

/** The checks of the edge: the values the record and the API need. */
function validate(message: LaunchAccepted): AcceptedLaunch {
  const launchId = message.launchId;
  if (launchId === '') throw new InvalidMessage('LaunchAccepted has no launch_id');
  if (!UUID.test(launchId)) {
    throw new InvalidMessage(`LaunchAccepted launch_id is not a UUID: "${launchId}"`, launchId);
  }
  if (message.acceptedAt === undefined) {
    throw new InvalidMessage('LaunchAccepted has no accepted_at', launchId);
  }
  if (message.request === undefined) {
    throw new InvalidMessage('LaunchAccepted has no request', launchId);
  }
  const acceptedAt = timestampDate(message.acceptedAt);
  if (Number.isNaN(acceptedAt.getTime())) {
    throw new InvalidMessage('LaunchAccepted accepted_at is out of range', launchId);
  }
  return { launchId, acceptedAt, request: message.request };
}

/** The handler of `launches.accepted`. It never throws. */
export function recordLaunchAccepted(deps: RecordLaunchDeps): MessageHandler {
  const clock = deps.clock ?? (() => new Date());
  return async (data) => {
    let launch: AcceptedLaunch;
    try {
      launch = validate(decode(data));
    } catch (error) {
      if (!(error instanceof InvalidMessage)) throw error;
      await reportInvalidMessage(deps, clock, LAUNCHES_ACCEPTED, error);
      return;
    }
    if (!deps.record.add(launch)) {
      deps.logger.info({ launch_id: launch.launchId }, 'duplicate launch ignored');
    }
  };
}

/** Logs the rejected message and reports it once on `pipeline.errors`; never throws. */
export async function reportInvalidMessage(
  deps: { publisher: Publisher; logger: Logger },
  clock: Clock,
  subject: string,
  error: InvalidMessage,
): Promise<void> {
  deps.logger.warn(
    { subject, launch_id: error.launchId, reason: error.message },
    'message rejected',
  );
  const pipelineError = create(PipelineErrorSchema, {
    launchId: error.launchId,
    service: SERVICE_NAME,
    subject,
    message: error.message,
    occurredAt: timestampFromDate(clock()),
  });
  try {
    await deps.publisher.publishPipelineError(pipelineError);
  } catch (publishError) {
    deps.logger.error({ err: publishError, subject }, 'cannot publish the PipelineError');
  }
}
