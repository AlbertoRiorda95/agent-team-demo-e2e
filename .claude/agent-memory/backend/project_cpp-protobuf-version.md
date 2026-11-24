---
name: cpp-protobuf-version
description: C++ protobuf gencode needs the exact runtime version; ConanCenter has no 6.33.1, so the propagator uses cpp v33.5 + protobuf/6.33.5 (root buf.gen.yaml still says v33.1)
metadata:
  type: project
---

C++ gencode from `buf.build/protocolbuffers/cpp:vX` has `#if PROTOBUF_VERSION != ...  #error`: the Conan runtime must be the exact same version. ConanCenter (checked 2026-11-24, issue #86) has protobuf 6.32.1, 6.33.5, 7.35.x but no 6.33.1, so `services/propagator/buf.gen.yaml` pins cpp v33.5 with `protobuf/6.33.5`; Python/Java stay on v33.1 (same wire format). Building protobuf + abseil from source with `--build=missing` takes ~10 min on the runner.

**Why:** the spec and proto/README say v33.1 for every language; following that literally does not build.
**How to apply:** when bumping protobuf for C++ (propagator, ros2-publisher), pick a version present in ConanCenter (`conan list "protobuf/*" -r conancenter`) and regenerate with `services/propagator/scripts/generate-proto.sh`. Every proto change on main also needs that script (the committed code goes stale, like api's). See [[ci-runner-env]].
