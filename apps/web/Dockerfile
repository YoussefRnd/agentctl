# syntax=docker/dockerfile:1

# Build the web client from the pnpm workspace.
FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN npm install --global pnpm@12.4.2

# Baked into the client at build time; override for a non-local API origin.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agentctl/web... build

# Serve the static bundle.
FROM nginx:1.29-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
