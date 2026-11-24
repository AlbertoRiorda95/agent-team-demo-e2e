# syntax=docker/dockerfile:1
# services/propagator: the trajectory propagator (C++20, CMake + Conan 2).
# Build from the repository root (the context of every service image):
#   docker build -f services/propagator/Dockerfile -t propagator .
# The tests and clang-tidy run in the CI `propagator` job, not in the image build.
# Base: Ubuntu 24.04 (the Debian slim image fails the CI vulnerability gate on
# unfixed findings). Runtime: non-root (uid 10001), read-only root filesystem
# ok: it writes only its config file under /var/lib/propagator
# (PROPAGATOR_CONFIG_PATH), a volume in compose.

ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289

FROM ${UBUNTU_IMAGE} AS build
ARG CONAN_VERSION=2.34.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ cmake make python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/conan \
 && /opt/conan/bin/pip install --no-cache-dir "conan==${CONAN_VERSION}"
ENV PATH=/opt/conan/bin:$PATH
WORKDIR /src
# dependencies first (cached layer): the Conan recipe only
COPY services/propagator/conanfile.py ./
RUN conan profile detect --force \
 && conan install . --build=missing -s compiler.cppstd=20 -s build_type=Release \
      -c tools.graph:skip_test=True
COPY services/propagator/CMakeLists.txt services/propagator/CMakePresets.json ./
COPY services/propagator/include ./include
COPY services/propagator/src ./src
RUN cmake --preset release -DBUILD_TESTING=OFF -DPROPAGATOR_CLANG_TIDY=OFF \
 && cmake --build --preset release \
 && cmake --install build/Release --prefix /out --strip

FROM ${UBUNTU_IMAGE}
COPY --from=build /out/bin/propagator /usr/local/bin/propagator
# the config folder, owned by the runtime user: a named volume mounted here
# copies this ownership when it is created
RUN install -d -o 10001 -g 10001 -m 0750 /var/lib/propagator
USER 10001:10001
# No health endpoint yet (docs/alignment/2026-11-22-5.md): liveness of PID 1
# (the propagator itself) only, until backend adds a probe.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "kill -0 1"]
CMD ["propagator"]
