// Use case "New trajectory" (docs/design/viewer.md > User flows, Live
// stream): a message from `trajectories.computed` is validated at the edge,
// kept as the latest trajectory and handed to the live stream. A message that
// does not decode or has no valid launch_id is not pushed: it is logged and
// reported once on `pipeline.errors` (proto/README.md > Encoding).
import { fromBinary } from '@bufbuild/protobuf';
import {
  TRAJECTORIES_COMPUTED,
  TrajectoryComputedSchema,
  type TrajectoryComputed,
} from '@albertoriorda95/trajectory-proto';
import type { LatestTrajectory } from '../domain/latest-trajectory.ts';
import type { Clock, Logger, MessageHandler, Publisher } from './ports.ts';
import { InvalidMessage, UUID, reportInvalidMessage } from './record-launch.ts';

export interface TrackTrajectoryDeps {
  latest: LatestTrajectory;
  /** Called with each new latest trajectory (not with a duplicate). */
  onNewTrajectory: (trajectory: TrajectoryComputed) => void;
  publisher: Publisher;
  logger: Logger;
  clock?: Clock;
}

function decode(data: Uint8Array): TrajectoryComputed {
  try {
    // unknown fields are dropped: they would be lost in the JSON anyway
    return fromBinary(TrajectoryComputedSchema, data, { readUnknownFields: false });
  } catch (error) {
    throw new InvalidMessage(`TrajectoryComputed does not decode: ${(error as Error).message}`);
  }
}

/** The checks of the edge: the live stream needs a launch_id (the SSE `id`). */
function validate(message: TrajectoryComputed): TrajectoryComputed {
  if (message.launchId === '') throw new InvalidMessage('TrajectoryComputed has no launch_id');
  if (!UUID.test(message.launchId)) {
    throw new InvalidMessage(
      `TrajectoryComputed launch_id is not a UUID: "${message.launchId}"`,
      message.launchId,
    );
  }
  return message;
}

/** The handler of `trajectories.computed`. It never throws. */
export function trackTrajectoryComputed(deps: TrackTrajectoryDeps): MessageHandler {
  const clock = deps.clock ?? (() => new Date());
  return async (data) => {
    let trajectory: TrajectoryComputed;
    try {
      trajectory = validate(decode(data));
    } catch (error) {
      if (!(error instanceof InvalidMessage)) throw error;
      await reportInvalidMessage(deps, clock, TRAJECTORIES_COMPUTED, error);
      return;
    }
    if (!deps.latest.offer(trajectory)) {
      deps.logger.info({ launch_id: trajectory.launchId }, 'duplicate trajectory ignored');
      return;
    }
    deps.onNewTrajectory(trajectory);
  };
}
