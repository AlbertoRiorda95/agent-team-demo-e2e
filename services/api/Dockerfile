# syntax=docker/dockerfile:1
# services/api: the ingestion REST API (FastAPI, Python 3.12, uv).
# Build from the repository root (the context of every service image):
#   docker build -f services/api/Dockerfile -t api .
# Base: Ubuntu 24.04 with the CPython build that uv manages (pinned by
# PYTHON_VERSION and the uv image), not the Debian python image: the CI
# vulnerability gate (HIGH, CRITICAL) fails on the unfixed Debian findings.
# Runtime: non-root (uid 10001), writes only to /tmp (read-only root
# filesystem ok), healthcheck on GET /healthz (200 ok, 503 degraded).

ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.5@sha256:32a7bb39b496babbd997b0a39a4d66c126bdaf5661b302bf6f06abda8deca6ff

FROM ${UV_IMAGE} AS uv

FROM ${UBUNTU_IMAGE} AS build
ARG PYTHON_VERSION=3.12.15
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_PYTHON_PREFERENCE=only-managed \
    UV_PROJECT_ENVIRONMENT=/app/.venv
RUN uv python install "${PYTHON_VERSION}"
WORKDIR /src
# dependencies first (cached layer), from the lockfile only
COPY services/api/pyproject.toml services/api/uv.lock services/api/README.md services/api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
# then the project itself, installed into the venv (not editable)
COPY services/api/src ./src
# no package manager at runtime: drop the interpreter's pip and ensurepip
# (their vendored copies of urllib3, msgpack... fail the vulnerability gate)
RUN uv sync --frozen --no-dev --no-editable \
 && rm -rf /opt/python/cpython-*/lib/python3.*/site-packages/pip \
           /opt/python/cpython-*/lib/python3.*/site-packages/pip-*.dist-info \
           /opt/python/cpython-*/lib/python3.*/ensurepip \
           /opt/python/cpython-*/bin/pip*

FROM ${UBUNTU_IMAGE}
# the interpreter at the same path as in the build stage: the venv links to it
COPY --from=build /opt/python /opt/python
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    API_HOST=0.0.0.0 \
    API_PORT=8000
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('API_PORT', '8000'), timeout=2)"]
CMD ["trajectory-api"]
