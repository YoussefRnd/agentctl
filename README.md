# AgentCtl

AgentCtl is a local-first control plane for AI coding agents. It runs agents inside project
workspaces, keeps their work isolated with Git worktrees, streams their activity into a unified
conversation, and provides review, terminal, permission, rewind, handoff, and pull-request tools.

The repository is a pnpm and Turborepo monorepo containing a Fastify server, React web client,
Electron desktop application, and shared agent/runtime packages.

## Requirements

- Node.js 24 or newer
- pnpm 12
- Git

Provider-specific CLIs or API credentials may also be required for the agents you enable.

## Quick start

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:web
```

The web client runs on `http://localhost:5173` and connects to the local AgentCtl server on port
`3000` by default.

To run the Electron desktop application instead:

```bash
pnpm dev:desktop
```

The first launch opens a setup checklist for installing, authenticating, and selecting an agent
provider.

## Common commands

| Command            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `pnpm dev:web`     | Run the web client and server in development mode |
| `pnpm dev:desktop` | Run the Electron desktop application              |
| `pnpm lint`        | Run the repository linter                         |
| `pnpm typecheck`   | Typecheck every workspace package                 |
| `pnpm test`        | Run the complete test suite                       |
| `pnpm build`       | Build all packages and applications               |

## Architecture

| Workspace             | Responsibility                                                               |
| --------------------- | ---------------------------------------------------------------------------- |
| `apps/web`            | React and Vite user interface                                                |
| `apps/server`         | Fastify API, authentication, events, terminals, and application services     |
| `apps/desktop`        | Electron wrapper, embedded server, tray, and updates                         |
| `packages/core`       | Agent runtimes, ACP, sessions, Git worktrees, MCP, security, and persistence |
| `packages/shared`     | Runtime schemas, API contracts, events, and shared types                     |
| `packages/api-client` | Typed browser and desktop API client                                         |
| `packages/ui`         | Shared design system primitives and patterns                                 |

The web package enforces feature boundaries with `pnpm --filter @agentctl/web architecture:check`.

## Core workflow

1. Add a project directory.
2. Start a local or worktree-isolated session.
3. Select a provider, model, thinking level, and approval policy.
4. Follow the agent's conversation, plan, tool activity, subagents, and terminal processes.
5. Review the resulting diff.
6. Commit, push, create a pull request, apply the work, or discard it.

Session events are persisted in SQLite and streamed to clients over SSE. Worktree sessions keep
concurrent tasks isolated from the primary checkout.

## Git review and recovery

The review loads file summaries first and loads diffs as you expand files. **Uncommitted**
shows current Git changes; **All edits** compares against the session baseline. Files with
both staged and unstaged changes expose both actions. Commits require a message and can
include unstaged changes in the same operation.

The Git menu provides **Fetch remote changes** and **Switch or create branch**. Synchronization
respects the configured upstream. Creating a branch preserves current edits; switching to an
existing branch requires a clean workspace and cannot reuse a branch checked out elsewhere.
Pushing to the base branch is available through an explicit preference in the commit dialog.

Apply requires committed work in isolated worktrees. Discard keeps a recovery copy until the
session is deleted. Use **Recover discarded changes** in the review panel to resume a retained
worktree or restore local files and staging. Local recovery refuses to overwrite newer changes.
Branch switches in isolated sessions reuse the existing checkout. If Git was initialized after
a local session began, explicitly commit its changes before applying the session.

## Drafts and conversation history

Composer text, project selections, and queued messages survive browser and desktop restarts.
Failed messages stay in the outbox for an explicit retry. Stable message IDs prevent retries
from submitting an accepted prompt twice. Unsent browser file selections must be reattached
after restarting; already uploaded attachments remain usable while their temporary files exist.

Conversations initially load the newest 200 events. Use **Load earlier messages** to retrieve
older pages. The feed renders visible conversation groups and preserves navigation to turns
and search results.

## Configuration

Copy `.env.example` to `.env` for local development. Important settings include:

| Variable                          | Description                                                        |
| --------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                    | SQLite database path                                               |
| `PORT`                            | Server port                                                        |
| `VITE_API_URL`                    | API origin used by the web client                                  |
| `CORS_ALLOWED_ORIGINS`            | Comma-separated origins accepted by a standalone production server |
| `AGENTCTL_WORKSPACE_SEARCH_PATHS` | Paths shown by the workspace browser                               |
| `AGENTCTL_SESSION_KEY`            | Secure-session encryption key                                      |
| `AGENTCTL_SESSION_SALT`           | Sixteen-character secure-session salt                              |

The checked-in session key and salt are development-only values. A standalone production server
refuses to start with those defaults. Generate unique values before deploying:

```bash
openssl rand -hex 32
openssl rand -hex 8
```

The desktop application generates ephemeral session secrets for its embedded server automatically.

## Security model

- The desktop server listens on loopback and requires a random per-launch capability delivered to
  the renderer through validated Electron IPC. The capability remains in memory and expires when
  the application closes.
- Standalone production servers exchange a short-lived, one-time pairing token for an encrypted,
  `HttpOnly` browser cookie. Browser credentials are never stored in `localStorage`.
- Remote browser sessions are persisted in SQLite, expire automatically, and can be revoked per
  device. Authentication attempts are throttled and cookie-authenticated mutations validate their
  browser origin.
- Agent tool calls flow through configurable approval policies.
- Diagnostic exports intentionally exclude prompts, tool arguments, environment variables, stderr,
  and raw protocol frames.
- Worktree, attachment, terminal, and editor operations are constrained to resolved project paths.

Do not expose the standalone server directly to the public internet. Put it behind TLS, configure
`CORS_ALLOWED_ORIGINS`, and use unique production secrets.

## Releases

Pull requests and pushes to `main` or `dev` run lint, typecheck, tests, and a full build. Version tags
matching `v*` produce the Linux AppImage release after running the same quality checks.

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

Commit messages follow the Conventional Commits format and use lowercase subjects.
