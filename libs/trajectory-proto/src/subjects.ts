/**
 * The NATS subjects of the pipeline, as documented in `proto/README.md`
 * (the test `test/subjects.test.ts` checks that they match its table). Use
 * these instead of literal subject strings.
 *
 * @module
 */

/** The services of the pipeline, as they appear in the per-service subjects. */
export const SERVICE_NAMES = [
  'api',
  'propagator',
  'ros2-publisher',
  'store',
  'viz-web',
  'control-web',
] as const;

/** One of the six service names. */
export type ServiceName = (typeof SERVICE_NAMES)[number];

/** `trajectory.v1.LaunchAccepted`, published by api (stream `LAUNCHES`). */
export const LAUNCHES_ACCEPTED = 'launches.accepted';

/** `trajectory.v1.TrajectoryComputed`, published by propagator (stream `TRAJECTORIES`). */
export const TRAJECTORIES_COMPUTED = 'trajectories.computed';

/** `trajectory.v1.TrajectoryStored`, published by store (stream `TRAJECTORIES`). */
export const TRAJECTORIES_STORED = 'trajectories.stored';

/** `trajectory.v1.PipelineError`, published by every service (stream `ERRORS`). */
export const PIPELINE_ERRORS = 'pipeline.errors';

/** `trajectory.v1.ServiceStatus` of a service, every 5 s on core NATS. */
export function statusSubject(service: ServiceName): `status.${ServiceName}` {
  return `status.${service}`;
}

/** `trajectory.v1.ConfigSet` for a service, published by control-web (stream `CONFIG`). */
export function configSetSubject(service: ServiceName): `config.${ServiceName}.set` {
  return `config.${service}.set`;
}

/** `trajectory.v1.ConfigApplied` of a service, published by that service (stream `CONFIG`). */
export function configAppliedSubject(service: ServiceName): `config.${ServiceName}.applied` {
  return `config.${service}.applied`;
}
