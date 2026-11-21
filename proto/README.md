# proto

The Protobuf messages that the services exchange on NATS, and the subjects
they are published on. This folder is the contract: backend changes it before
or together with the code (`AGENTS.md` > API contract).

## Layout
One buf module (`buf.yaml` at the repository root), one folder per package
and version: `proto/<package>/v<N>/*.proto`.

| Package | Status | Messages |
|---|---|---|
| `demo.v1` | placeholder (foundations), removed with the M1 contracts | `Ping` |

## NATS subjects
None yet: the subjects come with the M1 contracts. Each will be listed here
with its message type, its publisher and its consumers.

## Commands (from the repository root)
- `npx buf lint`: the `STANDARD` rules.
- `npx buf breaking --against '.git#branch=main'`: the `FILE` rules (CI runs it
  on every pull request).
- `npx buf generate`: the code of every message in `gen/` (ignored by Git):
  `gen/python` (`*_pb2.py` and `.pyi`), `gen/cpp` (`*.pb.h`, `*.pb.cc`),
  `gen/java`, `gen/ts`. The Python, C++ and Java plugins are buf remote
  plugins pinned to protobuf v33.1 (network access to buf.build needed): a
  service that uses the generated code links the protobuf runtime of that
  version.
- TypeScript for the web apps: the package `@albertoriorda95/trajectory-proto`
  in `libs/trajectory-proto/` (`npm run build -w libs/trajectory-proto`).
