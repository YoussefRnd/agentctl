# agentctl — agent coding control plane

## Monorepo layout

| package | path | purpose |
|---|---|---|
| `@agentctl/shared` | `packages/shared` | Zod schemas, types, env parsing (only deps: zod) |
| `@agentctl/core` | `packages/core` | DB (Drizzle+better-sqlite3), git worktrees, ACP sessions, driver registry |
| `@agentctl/server` | `apps/server` | Fastify HTTP+WebSocket server |
| `@agentctl/web` | `apps/web` | React 19 + Vite + Tailwind 4 frontend |
| `@agentctl/desktop` | `apps/desktop` | placeholder (empty) |

## Commands (from root)

```
pnpm build          # turbo build (^build deps)
pnpm dev            # turbo dev (persistent)
pnpm lint           # turbo lint (dependsOn ^build)
pnpm typecheck      # tsc --build (root tsconfig with project references)
pnpm format         # prettier --write .
pnpm clean          # remove all node_modules, dist/, .turbo cache, and prune pnpm store
```

Pre-commit hook runs `pnpm typecheck && pnpm lint`. No auto-format.

## Commit rules

Conventional commits via commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Subject must be **lower-case**, header max 100 chars.

## Dev server

```
# terminal 1: server
cd apps/server && pnpm dev   # tsx watch src/index.ts, port 3000, binds 127.0.0.1

# terminal 2: web
cd apps/web && pnpm dev      # vite, port 5173, proxies /api -> :3000, /ws -> ws://:3000
```

Vite `envDir` is root (`../../`), so `.env` sits at repo root. Web uses `VITE_*` vars only.

## Build system quirks

- **TypeScript 6**, `NodeNext` module resolution, `composite: true` project references.
- Turbo `build` task outputs to `dist/`, depends on `^build` (build deps first).
- Turbo `test` and `lint` also depend on `^build`.
- Drizzle migrations in `packages/core/drizzle/`. Run `pnpm --filter @agentctl/core exec drizzle-kit generate` to create new migrations. Migrations run **automatically on server startup** (`migrate()` in `db/index.ts`).
- Lockfile: `pnpm-lock.yaml` (pnpm 11.0.9). `better-sqlite3` and `esbuild` have `allowBuilds` in workspace config.

## Code style

- ESLint: strict type-checked config. `no-console: error`, `@typescript-eslint/no-unused-vars` (allow `_` prefix), `@typescript-eslint/consistent-type-imports: error`.
- Prettier: semicolons, single quotes, trailing commas, 100 width, LF.
- No `any` allowed.

## Architecture notes

- `@agentctl/core` has **no Fastify dependency**. Logger interface is a minimal pino-compatible type (used by `DriverRegistry`, `ACPSession`).
- Server `buildApp()` accepts optional dependency overrides (`db`, `worktreeManager`, `driverRegistry`, `env`) for testing.
- All server routes use `@fastify/type-provider-zod` for request validation.
- Auth: `@fastify/secure-session` cookie-based. Public paths: `/health`, `/api/login`, `/api/logout`. Everything else returns 401 if not authenticated.
- Drivers (agents) are discovered via ACP protocol: spawn, initialize, probe, kill. Probing timeout: 60 seconds. Cache TTL: 5 minutes.
- Git worktrees stored in `~/.agentctl/worktrees/`. Branch pattern: `agentctl/{sanitized-session-id}/{sanitized-task-slug}`.
- Default DB: `~/.agentctl/agentctl.db`. SQLite with WAL mode, foreign keys ON.

## Env variables

```
AGENTCTL_SECRET          # login key, logged at server startup
AGENTCTL_SESSION_KEY     # min 32 chars, for secure-session cookie
AGENTCTL_SESSION_SALT    # exactly 16 chars
PORT=3000
DATABASE_URL=sqlite.db   # default: ~/.agentctl/agentctl.db
VITE_API_URL             # web only, must start with http
```