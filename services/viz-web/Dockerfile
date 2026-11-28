# syntax=docker/dockerfile:1
# services/viz-web: the viz-web server (Node 24, Fastify; server/openapi.yaml)
# and the built viewer UI it serves at / (docs/design/viewer.md > Serving).
# Build from the repository root (the context of every service image; the app
# is an npm workspace of the root package.json):
#   docker build -f services/viz-web/Dockerfile -t viz-web .
# Node 24 runs the server's TypeScript sources directly (type stripping).
# Built here, in the `build` stage: libs/trajectory-proto (tsc on the committed
# src/gen/, so neither buf nor proto/ is needed) and the UI (`vite build`).
# Base: node:24-alpine (the Debian images fail the CI vulnerability gate).
# Runtime: non-root (the image's `node` user, uid 1000), writes nothing
# (read-only root filesystem ok), healthcheck on GET /healthz.

ARG NODE_IMAGE=node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

# the lockfile and every workspace manifest: `npm ci` checks them all
FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/viz-web/package.json services/viz-web/
COPY services/viz-web/server/package.json services/viz-web/server/
COPY services/control-web/package.json services/control-web/
COPY libs/trajectory-proto/package.json libs/trajectory-proto/
COPY packages/ui-tokens/package.json packages/ui-tokens/

# production dependencies of the server only, no install scripts
FROM manifests AS deps
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w services/viz-web/server

# the build tools (root typescript, vite), no install scripts; never shipped
FROM manifests AS build
RUN npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
      -w libs/trajectory-proto -w @agent-team-demo-e2e/viz-web
COPY tsconfig.base.json ./
COPY libs/trajectory-proto/tsconfig.build.json libs/trajectory-proto/
COPY libs/trajectory-proto/src libs/trajectory-proto/src
RUN npx --no-install tsc -p libs/trajectory-proto/tsconfig.build.json
COPY packages/ui-tokens packages/ui-tokens
COPY services/viz-web/index.html services/viz-web/vite.config.ts services/viz-web/tsconfig.json services/viz-web/
COPY services/viz-web/src services/viz-web/src
# by package name: the path would also select the nested server workspace
RUN npm run build -w @agent-team-demo-e2e/viz-web

FROM ${NODE_IMAGE}
# the package managers are not needed at runtime (and bring their own findings)
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    VIZ_WEB_SERVER_HOST=0.0.0.0 \
    VIZ_WEB_SERVER_PORT=3001
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# node_modules/@albertoriorda95/trajectory-proto links here (npm workspace)
COPY libs/trajectory-proto/package.json libs/trajectory-proto/
COPY --from=build /app/libs/trajectory-proto/dist libs/trajectory-proto/dist
# packages/ui-tokens is a dependency of the UI only: bundled into dist/ by vite
COPY --from=build /app/services/viz-web/dist services/viz-web/dist
COPY services/viz-web/server/package.json services/viz-web/server/
COPY services/viz-web/server/src services/viz-web/server/src
WORKDIR /app/services/viz-web/server
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.VIZ_WEB_SERVER_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
