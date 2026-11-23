# syntax=docker/dockerfile:1
# labebal: single container, Next.js standalone server + embedded Postgres (PGlite)
# whose data lives in the /data volume. Set DATABASE_URL to use a real Postgres instead.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# ---- dependencies (cached while lockfile / manifests are unchanged)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/app/package.json packages/app/
COPY examples/vite-host/package.json examples/vite-host/
# Only what the standalone app needs (not the example host's Vite).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...

# ---- build
FROM deps AS build
COPY . .
RUN pnpm --filter web build

# ---- runtime: only the traced standalone output
FROM node:${NODE_VERSION}-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    LABEBAL_DATA_DIR=/data/pglite
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
# Standalone keeps the monorepo layout: server at apps/web/server.js, traced node_modules
# (incl. PGlite's .wasm/.data files) next to it.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# The module's runtime files: migrations, built-in fonts and mockup photos, the
# Examples pack (read from ../../packages/app, see apps/web/src/labebal.ts).
COPY --from=build --chown=node:node /repo/packages/app/drizzle ./packages/app/drizzle
COPY --from=build --chown=node:node /repo/packages/app/assets ./packages/app/assets
COPY --from=build --chown=node:node /repo/packages/app/packs ./packages/app/packs
USER node
WORKDIR /app/apps/web
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/library').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
