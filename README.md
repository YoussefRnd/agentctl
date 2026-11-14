# AgentCtl

AgentCtl is a local-first control plane for AI coding agents. It runs agents inside your own
project workspaces, isolates concurrent work with Git worktrees, and streams everything they do
into one conversation view — with review, terminals, approvals, rewind, handoff, and
pull-request tools built in.

It is provider-agnostic: AgentCtl speaks the [Agent Client Protocol](https://agentclientprotocol.com/)
(ACP), so any compatible agent can be installed, authenticated, and driven from the same UI.

> AgentCtl is pre-1.0 (`0.2.0`). Interfaces and on-disk formats may still change between releases.

## What you get

- **Isolated sessions.** Run each task in its own Git worktree, or work directly in the primary
  checkout. Parallel sessions never step on each other's files.
- **Any ACP agent.** Discover providers from the ACP registry, install their binaries, and run
  their login flow without leaving the app.
- **One live timeline.** Messages, plans, tool calls, subagents, permission requests, and terminal
  processes stream into a single conversation over SSE.
- **Review before you ship.** Inspect the diff, run project checks, then commit, push, open a pull
  request, apply the work, or discard it.
- **Control when it matters.** Configurable approval policies gate sensitive tool calls; every
  session is persisted and can be rewound to an earlier snapshot.
- **Handoff and subagents.** Move a session to another agent or model, and follow delegated
  subagent work inline.
- **Two front ends.** A React web client and an Electron desktop app with an embedded server,
  tray integration, and auto-updates.

## Requirements

- Node.js 24 or newer
- pnpm 12
- Git

Individual providers may also need their own CLI, API key, or subscription. AgentCtl walks you
through that on first launch.

## Quick start

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:web
```

The web client runs at `http://localhost:5173` and talks to the local server on port `3000`.

Prefer the desktop app?

```bash
pnpm dev:desktop
```

The first launch opens a setup checklist for installing, authenticating, and selecting a provider.

### Docker (web only)

The web client can be built and served on its own:

```bash
docker compose up --build
```

It is served at `http://localhost:8080` and still expects a reachable AgentCtl server (set via the
`VITE_API_URL` build argument).

## Core workflow

1. Add a project directory.
2. Start a local or worktree-isolated session.
3. Pick a provider, model, thinking level, and approval policy.
4. Follow the agent's conversation, plan, tool activity, subagents, and terminals.
5. Review the resulting diff and run project checks.
6. Commit, push, create a pull request, apply the work, or discard it.

Session events are persisted in SQLite and streamed to clients over SSE. Worktree sessions keep
concurrent tasks isolated from the primary checkout.

## Architecture

The repository is a pnpm + Turborepo monorepo:

| Workspace             | Responsibility                                                                |
| --------------------- | ----------------------------------------------------------------------------- |
| `apps/web`            | React and Vite user interface                                                 |
| `apps/server`         | Fastify API, auth, events, terminals, and application services                |
| `apps/desktop`        | Electron wrapper, embedded server, tray, and updates                          |
| `packages/core`       | Agent runtimes, ACP, sessions, Git worktrees, MCP, security, and persistence  |
| `packages/shared`     | Runtime schemas, API contracts, events, and shared types                      |
| `packages/api-client` | Typed browser and desktop API client                                          |
| `packages/ui`         | Shared design system primitives and patterns                                  |

At runtime:

```text
web / desktop  ──ts-rest + SSE──▶  Fastify server  ──ACP──▶  agent process
                                        │
                                        ├── SQLite (sessions, events, projects)
                                        └── Git worktrees + snapshots
```

`packages/core` owns the provider-neutral contracts (`AgentDriver`, `AgentSession`, `AgentUpdate`).
ACP wire details stay in `packages/core/src/acp`; see its
[README](packages/core/src/acp/README.md). ACP v1 is the default adapter. The draft v2 adapter is
opt-in per provider via `AGENTCTL_ACP_PROTOCOL=v2`.

The web package enforces feature boundaries:

```bash
pnpm --filter @agentctl/web architecture:check
```

## Common commands

| Command            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `pnpm dev:web`     | Run the web client and server in development mode |
| `pnpm dev:desktop` | Run the Electron desktop application              |
| `pnpm lint`        | Run the repository linter                         |
| `pnpm typecheck`   | Typecheck every workspace package                 |
| `pnpm test`        | Run the complete test suite                       |
| `pnpm build`       | Build all packages and applications               |
| `pnpm format`      | Format the repository with Prettier               |
| `pnpm clean`       | Remove build output, caches, and `node_modules`   |

## Configuration

Copy `.env.example` to `.env` for local development. The settings you are most likely to change:

| Variable                          | Description                                                        |
| --------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                    | SQLite database path                                               |
| `PORT`                            | Server port (default `3000`)                                       |
| `VITE_API_URL`                    | API origin used by the web client                                  |
| `CORS_ALLOWED_ORIGINS`            | Comma-separated origins accepted by a standalone production server |
| `AGENTCTL_WORKSPACE_SEARCH_PATHS` | Paths shown by the workspace browser                               |
| `AGENTCTL_HOME`                   | Data directory for installed providers and credentials             |
| `AGENTCTL_SESSION_KEY`            | Secure-session encryption key                                      |
| `AGENTCTL_SESSION_SALT`           | Sixteen-character secure-session salt                              |
| `AGENTCTL_ACP_PROTOCOL`           | Per-provider ACP adapter selector (`v1` default, `v2` opt-in)      |

Timeouts, retention windows, and other tuning knobs are documented in `.env.example`.

The checked-in session key and salt are development-only. A standalone production server refuses
to start with those defaults. Generate unique values before deploying:

```bash
openssl rand -hex 32
openssl rand -hex 8
```

The desktop application generates ephemeral session secrets for its embedded server automatically.

## Security model

- The desktop server listens on loopback and requires a random per-launch capability delivered to
  the renderer through validated Electron IPC. The capability lives in memory and expires when the
  application closes.
- Standalone production servers exchange a short-lived, one-time pairing token for an encrypted,
  `HttpOnly` browser cookie. Browser credentials are never stored in `localStorage`.
- Remote browser sessions are persisted in SQLite, expire automatically, and can be revoked per
  device. Authentication attempts are throttled, and cookie-authenticated mutations validate their
  browser origin.
- Agent tool calls flow through configurable approval policies.
- Diagnostic exports intentionally exclude prompts, tool arguments, environment variables, stderr,
  and raw protocol frames.
- Worktree, attachment, terminal, and editor operations are constrained to resolved project paths.

Do not expose the standalone server directly to the public internet. Put it behind TLS, configure
`CORS_ALLOWED_ORIGINS`, and use unique production secrets.

## Releases

Pull requests and pushes to `main` or `dev` run lint, typecheck, tests, and a full build. Tags
matching `v*` run the same checks and publish a Linux AppImage (with `latest*.yml` update metadata)
to GitHub Releases.

Desktop packaging is also available locally:

```bash
pnpm --filter @agentctl/desktop package:linux
pnpm --filter @agentctl/desktop package:mac
pnpm --filter @agentctl/desktop package:win
```

## Contributing

Keep changes scoped, add tests for behavior changes, and run the following before opening a pull
request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Commit messages follow Conventional Commits with lowercase subjects (enforced by commitlint).

## License

ISC, as declared in `package.json`.
