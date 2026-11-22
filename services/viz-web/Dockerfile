# syntax=docker/dockerfile:1
# services/viz-web: the viz-web server (Node 24, Fastify; server/openapi.yaml).
# Build from the repository root (the context of every service image; the app
# is an npm workspace of the root package.json):
#   docker build -f services/viz-web/Dockerfile -t viz-web .
# Node 24 runs the TypeScript sources directly (type stripping): no build step.
# Base: node:24-alpine (the Debian images fail the CI vulnerability gate).
# Runtime: non-root (the image's `node` user, uid 1000), writes nothing
# (read-only root filesystem ok), healthcheck on GET /healthz.

ARG NODE_IMAGE=node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# the lockfile and every workspace manifest: `npm ci` checks them all
COPY package.json package-lock.json ./
COPY services/viz-web/package.json services/viz-web/
COPY services/viz-web/server/package.json services/viz-web/server/
COPY services/control-web/package.json services/control-web/
COPY libs/trajectory-proto/package.json libs/trajectory-proto/
COPY packages/ui-tokens/package.json packages/ui-tokens/
# production dependencies of the server only, no install scripts
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w services/viz-web/server

FROM ${NODE_IMAGE}
# the package managers are not needed at runtime (and bring their own findings)
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    VIZ_WEB_SERVER_HOST=0.0.0.0 \
    VIZ_WEB_SERVER_PORT=3001
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/viz-web/server/package.json services/viz-web/server/
COPY services/viz-web/server/src services/viz-web/server/src
WORKDIR /app/services/viz-web/server
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.VIZ_WEB_SERVER_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
