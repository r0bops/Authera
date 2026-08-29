# syntax=docker/dockerfile:1.7
# Multi-stage build: compile the Vite SPA and the Hono API, then ship one small runtime
# image where the API serves the compiled frontend (single origin, single process).

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.22.0

# ---------- base: Node 24 LTS + pnpm ----------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# ---------- manifests: only files that affect dependency resolution ----------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/purchasing-agent/package.json packages/purchasing-agent/package.json
COPY packages/test-support/package.json packages/test-support/package.json

# ---------- build: full install, compile web + api ----------
FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---------- prod-deps: runtime dependencies of the API only ----------
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @authera/api...

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/db/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null || exit 1
CMD ["node", "apps/api/dist/server.js"]
