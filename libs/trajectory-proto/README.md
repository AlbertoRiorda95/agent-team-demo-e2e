# @albertoriorda95/trajectory-proto

The TypeScript types of the Protobuf messages in `proto/`, generated with
protobuf-es (`@bufbuild/protoc-gen-es`), as an npm package. The web apps use
it as a workspace dependency; other projects install it from GitHub Packages
(`@albertoriorda95:registry=https://npm.pkg.github.com`).

```ts
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  LAUNCHES_ACCEPTED,
  LaunchAcceptedSchema,
  statusSubject,
} from '@albertoriorda95/trajectory-proto';

const bytes = toBinary(LaunchAcceptedSchema, create(LaunchAcceptedSchema, { launchId }));
await js.publish(LAUNCHES_ACCEPTED, bytes, { msgID: launchId }); // Nats-Msg-Id = launch_id
const accepted = fromBinary(LaunchAcceptedSchema, bytes);
statusSubject('store'); // 'status.store'
```

Version 0.1.0 exports:
- the protobuf-es messages of `trajectory.v1` (`LaunchAccepted`,
  `TrajectoryComputed`, `TrajectoryStored`, `PipelineError`, `ServiceStatus`,
  `ConfigSet`, `ConfigApplied` and their parts), each with its `*Schema`;
- the NATS subjects of `proto/README.md` (`src/subjects.ts`):
  `LAUNCHES_ACCEPTED`, `TRAJECTORIES_COMPUTED`, `TRAJECTORIES_STORED`,
  `PIPELINE_ERRORS`, and `statusSubject(service)`, `configSetSubject(service)`,
  `configAppliedSubject(service)` over the `ServiceName` union
  (`SERVICE_NAMES`);
- the deprecated placeholder `demo.v1.Ping`, until nothing uses it.

`proto/README.md` is the documentation of the subjects, the streams and the
encoding.

## Scripts
- `npm run generate`: `src/gen/` from `proto/` (its own TypeScript-only
  template, `buf.gen.yaml`, with no network access). `src/gen/` is committed:
  after a change in `proto/`, run it and commit the result.
- `npm run build`: generate, then `dist/` (ES modules and declarations).
- `npm run typecheck`: generate, then `tsc` on `src/` and `test/`.
- `npm test`: build, check that `src/gen/` is in step with `proto/`, then
  Vitest on `test/` against `dist/` (round-trip and size of the largest
  trajectory, subjects against the table of `proto/README.md`).

Released on a `v*` tag by `.github/workflows/publish.yml`; on this machine
with `./ci/registry.sh local`.
