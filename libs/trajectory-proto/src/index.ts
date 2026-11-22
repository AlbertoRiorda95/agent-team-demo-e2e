/**
 * The TypeScript types of the Protobuf messages of `proto/`, generated with
 * protobuf-es (`npm run generate`), and the NATS subjects they are published
 * on. Each message comes with its schema (`LaunchAcceptedSchema`), to use with
 * `create`, `toBinary` and `fromBinary` of `@bufbuild/protobuf`.
 *
 * @packageDocumentation
 */

/** The pipeline messages (`trajectory.v1`). */
export * from './gen/trajectory/v1/launch_pb.js';
export * from './gen/trajectory/v1/trajectory_pb.js';
export * from './gen/trajectory/v1/service_pb.js';
export * from './gen/trajectory/v1/config_pb.js';

/** The NATS subjects (`proto/README.md`). */
export * from './subjects.js';

/**
 * Deprecated placeholder of the foundations milestone (`demo.v1`), kept until
 * nothing uses it.
 */
export * from './gen/demo/v1/ping_pb.js';
