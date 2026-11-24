# syntax=docker/dockerfile:1
# services/store: keeps the trajectories in PostgreSQL (Java 25, Gradle, Flyway).
# Build from the repository root (the context of every service image):
#   docker build -f services/store/Dockerfile -t store .
# The tests (Testcontainers) run in the CI `store` job, not in the image build.
# Runtime: non-root (uid 10001), read-only root filesystem ok: it writes only to
# /tmp and its config file under /var/lib/store (STORE_CONFIG_PATH), a volume in compose.

ARG JDK_IMAGE=eclipse-temurin:25-jdk-noble@sha256:4ddc1a8bdaf283421df5487411aff10b797ccf1e06a339041005114c8f489b5c
ARG JRE_IMAGE=eclipse-temurin:25-jre-noble@sha256:f3dd0838e69b881cc382237d5901e74ae3705b1056ad964b2e0e523b174fef99

FROM ${JDK_IMAGE} AS build
WORKDIR /src
# the wrapper (its distribution is checked against distributionSha256Sum) and
# the build scripts first: a cached layer for Gradle and the dependencies
COPY services/store/gradlew services/store/settings.gradle.kts services/store/build.gradle.kts ./
COPY services/store/gradle ./gradle
RUN ./gradlew --no-daemon --quiet dependencies > /dev/null
COPY services/store/src/main ./src/main
RUN ./gradlew --no-daemon installDist

FROM ${JRE_IMAGE}
COPY --from=build /src/build/install/store /app
# the folder of STORE_CONFIG_PATH (default /var/lib/store/config.json), owned by
# the runtime user: a new named volume mounted here starts writable for it
RUN install -d -o 10001 -g 10001 -m 0750 /var/lib/store
USER 10001:10001
# No health endpoint (docs/alignment/2026-11-22-7.md): liveness of PID 1 (the
# JVM: bin/store execs java) only, until backend adds a probe.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["sh", "-c", "kill -0 1"]
CMD ["/app/bin/store"]
