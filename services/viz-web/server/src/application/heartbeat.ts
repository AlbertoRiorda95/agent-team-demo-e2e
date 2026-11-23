// The `status.viz-web` heartbeat (docs/design/viz-backend.md > Data and API):
// a ServiceStatus every interval (5 s), `ok` while the subscription is up,
// `degraded` while it is down; nothing is sent while the bus cannot publish.
import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { ServiceStatusSchema, ServiceStatus_State } from '@albertoriorda95/trajectory-proto';
import type { Clock, LaunchesAcceptedSubscription, Logger, Publisher } from './ports.ts';
import { SERVICE_NAME } from './record-launch.ts';

export const HEARTBEAT_INTERVAL_MS = 5000;

export interface HeartbeatDeps {
  publisher: Publisher;
  subscription: LaunchesAcceptedSubscription;
  logger: Logger;
  instance: string;
  version: string;
  intervalMs?: number;
  clock?: Clock;
}

/** Sends one heartbeat now when it can; never throws. */
export async function sendHeartbeat(deps: HeartbeatDeps): Promise<void> {
  if (!deps.publisher.canPublish()) return;
  const up = deps.subscription.isUp();
  const status = create(ServiceStatusSchema, {
    service: SERVICE_NAME,
    instance: deps.instance,
    state: up ? ServiceStatus_State.OK : ServiceStatus_State.DEGRADED,
    detail: up ? '' : 'the subscription to launches.accepted is down',
    version: deps.version,
    configVersion: 0n,
    sentAt: timestampFromDate((deps.clock ?? (() => new Date()))()),
  });
  try {
    await deps.publisher.publishStatus(status);
  } catch (error) {
    deps.logger.warn({ err: error }, 'cannot publish the heartbeat');
  }
}

/** Starts the heartbeat (a first one right away); returns the function that stops it. */
export function startHeartbeat(deps: HeartbeatDeps): () => void {
  const timer = setInterval(() => void sendHeartbeat(deps), deps.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  void sendHeartbeat(deps);
  return () => clearInterval(timer);
}
