# syntax=docker/dockerfile:1.7

# AgentCtl standalone deployment: nginx serves the built web client and proxies
# /api + /health to the Fastify server. See README.md ("Docker") for usage.
ARG NODE_VERSION=26

# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS build

ENV CI=true \
    HUSKY=0 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# Node 26 images no longer bundle corepack.
RUN npm install --global pnpm@12.16.1

WORKDIR /app

# Workspace manifests first, so dependency installation stays cached when only
# sources change. Every workspace member needs its package.json present.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/

RUN --mount=type=cache,id=agentctl-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# Build the server (with its core/shared dependencies) and the web client.
# compile emits apps/server/dist/src/index.js and packages/*/dist.
RUN pnpm exec vp run --filter '@agentctl/server...' --filter '@agentctl/web...' compile \
 && node packages/core/scripts/copy-skills.mjs

# Drop build tooling and every dependency outside the server's runtime graph.
RUN --mount=type=cache,id=agentctl-pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter '@agentctl/server...'

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    AGENTCTL_HOST=0.0.0.0 \
    AGENTCTL_WORKSPACE_SEARCH_PATHS=/workspaces \
    AGENTCTL_HOME=/data/.agentctl \
    DATABASE_URL=/data/agentctl.db \
    HOME=/data

# git is required for sessions, worktrees and review; agents are installed at
# runtime through the UI and store credentials under HOME (/data).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client nginx-light \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /workspaces /app/web \
 && chown -R node:node /data /workspaces

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/server/package.json apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/node_modules apps/server/node_modules
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/packages/core/package.json packages/core/package.json
COPY --from=build --chown=node:node /app/packages/core/node_modules packages/core/node_modules
COPY --from=build --chown=node:node /app/packages/core/dist packages/core/dist
# SQLite migrations resolve relative to packages/core/dist/db.
COPY --from=build --chown=node:node /app/packages/core/drizzle packages/core/drizzle
COPY --from=build --chown=node:node /app/apps/web/dist /app/web

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /usr/local/bin/agentctl-entrypoint
RUN chmod +x /usr/local/bin/agentctl-entrypoint

USER node

EXPOSE 8080 3000
VOLUME ["/data", "/workspaces"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/agentctl-entrypoint"]
