# @albertoriorda95/trajectory-proto

The TypeScript types of the Protobuf messages in `proto/`, generated with
protobuf-es (`@bufbuild/protoc-gen-es`), as an npm package. The web apps use
it as a workspace dependency; other projects install it from GitHub Packages
(`@albertoriorda95:registry=https://npm.pkg.github.com`).

```ts
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { PingSchema } from '@albertoriorda95/trajectory-proto';

const bytes = toBinary(PingSchema, create(PingSchema, { message: 'hello' }));
const ping = fromBinary(PingSchema, bytes);
```

Version 0.0.0: only the placeholder `demo.v1.Ping` (foundations); the real
messages come with the M1 contracts.

## Scripts
- `npm run generate`: `src/gen/` from `proto/` (its own TypeScript-only
  template, `buf.gen.yaml`, with no network access). `src/gen/` is committed:
  after a change in `proto/`, run it and commit the result.
- `npm run build`: generate, then `dist/` (ES modules and declarations).
- `npm run typecheck`: generate, then `tsc` on `src/` and `test/`.
- `npm test`: build, check that `src/gen/` is in step with `proto/`, then the
  Node test runner on `test/` against `dist/`.

Released on a `v*` tag by `.github/workflows/publish.yml`; on this machine
with `./ci/registry.sh local`.
