# AgentCtl

AgentCtl is a local-first control plane for AI coding agents. It runs agents inside project
workspaces, keeps their work isolated with Git worktrees, streams their activity into a unified
conversation, and provides review, terminal, permission, rewind, handoff, and pull-request tools.

The repository is a pnpm and Vite+ monorepo containing a Fastify server, React web client,
Electron desktop application, and shared agent/runtime packages.

## Requirements

- Node.js 26+
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

| Command                   | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `pnpm dev:web`            | Run the web client and server in development mode  |
| `pnpm dev:desktop`        | Run the Electron desktop application               |
| `pnpm lint`               | Run the repository linter                          |
| `pnpm format`             | Format sources with Vite+                          |
| `pnpm format:check`       | Check source formatting without changing files     |
| `pnpm check`              | Check architecture, formatting, lint, and types    |
| `pnpm typecheck`          | Typecheck every workspace package                  |
| `pnpm test`               | Run the complete test suite                        |
| `pnpm build`              | Build all packages and applications                |
| `pnpm architecture:check` | Check dependency directions and ownership coverage |
| `pnpm ui:check`           | Build and review the isolated UI gallery in Chrome |
| `pnpm desktop:smoke`      | Exercise built native startup, IPC and shutdown    |

Vite+ runs the web toolchain, tests, linting, and formatting. The commands above use the
project-local CLI; no global installation is required. Use `pnpm exec vp run <script>`
to run a workspace script, or `pnpm exec vp test` for the consolidated test projects.
`pnpm test` also runs the architecture regression tests.

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

The source architecture migration is complete: **16/16 checkpoints**. The
[acceptance record](docs/architecture-migration.md#final-acceptance--2026-10-17) identifies the verified
revision, complete file coverage, test/build/browser/native results and product/platform limits.

Run `pnpm architecture:check` to enforce package, server, and frontend boundaries.
See [Code architecture](docs/code-architecture.md) for design patterns, file ownership,
state conventions and compatibility changes. The [architecture migration record](docs/architecture-migration.md) contains the ownership
coverage and final acceptance evidence.
The [Git capability ownership audit](docs/git-architecture.md) records capability boundaries and lock ordering.
[Workspace workflow ownership](docs/workspace-architecture.md) covers repository-neutral session lifecycle and checkpoint persistence.

The application uses focused workflow services, narrow repository/provider ports, explicit
composition roots, and one owner per resource lifetime. React Query owns remote state; Zustand
owns client UI state and drafts. Native capabilities are exposed through one shared IPC contract.

The [desktop lifecycle](docs/desktop-architecture.md), [UI acceptance inventory](docs/ui-architecture.md),
and [delivery/enforcement matrix](docs/tooling-architecture.md) describe the final boundaries.
Combined ownership ledgers cover application code, assets, tests, scripts and configuration;
new files require an owner and acceptance evidence. See the
[source compatibility notes](docs/releases/architecture-migration.md) when updating source integrations.

For the full local acceptance gate, use the commands in the migration record. Browser checks
require Chrome; Linux native smoke requires Xvfb when DISPLAY is unavailable (`XVFB_PATH` can
select a binary). Native acceptance currently covers Linux x64. macOS/Windows native release
checks, signing and update installation remain platform work.

## UI development

Open `http://localhost:5173/_dev/ui` while the web development server is running to inspect
shared components and real conversation/settings fixtures. The gallery works without the API
server. Its panel-width, font-size, theme, streaming, and drop-overlay controls are temporary;
fixture actions never send prompts or save application settings.

Use the [UI consistency checklist](docs/ui-consistency.md) when polishing layouts and controls.

See [Performance measurements](docs/performance.md) for the isolated browser lab, initial baseline,
opt-in web/desktop journey timings, and the local/CI performance safeguards (`perf:check`).

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

Review uses a backend-independent repository boundary with opaque revision references and
capability discovery. Git is the first versioned backend; ordinary folders remain usable but
do not provide change history or checkpoints. See [Repository architecture](docs/repository-architecture.md)
for supported capabilities, scoped revisions, and compatibility rules.

Apply requires committed work in isolated worktrees. Discard keeps a recovery copy until the
session is deleted. Use **Recover discarded changes** in the review panel to resume a retained
worktree or restore local files and staging. Local recovery refuses to overwrite newer changes.
Branch switches in isolated sessions reuse the existing checkout. If Git was initialized after
a local session began, explicitly commit its changes before applying the session.

The review panel also offers independent AI review through any installed ACP provider/profile.
Choose **Review changes** for uncommitted or all session changes. Findings and dismissal reasons
survive restarts; reviews show **Outdated** when either comparison revision changes. Saved history
remains available, including cancelled/failed reviews. Reviews include captured diffs and related source/test context, with a saved report of supplied
files, excerpts and omissions. **Verification** saves explicitly run commands, output and revision checks.
Findings appear inline when the displayed revisions match, and retain captured code for later inspection.
Relevant earlier findings, decisions, and evidence carry into new reviews. Findings start as suspected; link a matching failed check and confirm its failure scenario to mark
one reproduced. Recorded evidence can inform a new review with any ACP provider. See
[AI code review](docs/code-review.md) for scope and execution limits.

## Drafts and conversation history

Composer text, project selections, and queued messages survive browser and desktop restarts.
Failed messages stay in the outbox for an explicit retry. Stable message IDs prevent retries
from submitting an accepted prompt twice. Unsent browser file selections must be reattached
after restarting; already uploaded attachments remain usable while their temporary files exist.

Conversations initially load up to 200 recent events within a 1 MiB payload target. Large
reconnect gaps refresh this recent window; use **Load earlier messages** to retrieve older pages.
Individual oversized events remain intact so pagination can always advance. The feed renders
visible conversation groups and preserves navigation to turns and search results.

Reported delegated tasks appear as cards with status, progress, and result previews. Use the
task overview to find active tasks, pending approvals, or previous tasks. Open a card to inspect
its details beside the conversation on desktop or in a full-screen panel on smaller screens.
Only explicitly linked child activity is attributed to a task; providers that report just a
delegation and result cannot supply a full child conversation. An unfinished call shows an
unknown status when its turn ends, and later provider updates can resolve it. Pending approvals
remain available in the parent chat while inspecting tasks.

Provider settings support named profiles with independent encrypted environment configuration,
model defaults, thinking defaults, and protocol overrides. Profiles share the registry agent's
installation and updates. Agents that store login credentials globally need their own supported
account-directory environment setting for separate accounts. Add custom model IDs in the Provider
Profiles panel when an agent accepts models missing from its advertised list; an optional context
window helps size handoffs. The agent must support selecting the supplied ID.

The approval selector controls how agentctl answers ACP requests:
**Ask every time**, **Auto-approve workspace edits**, or **Auto-approve requests**.
Workspace-edit approval requires a recognized file-change kind and every reported location
inside the workspace. Commands and incomplete or unfamiliar requests ask for approval.
Configured MCP tool rules apply too; explicit deny and ask rules override automatic approval.
Client file writes, terminal creation/input, and executable extensions also pass through this
policy before agentctl performs them. File access remains confined to allowed roots in every mode;
a terminal working directory restriction does not sandbox the command itself.

Automatic approvals select an advertised allow-once choice. Persistent provider choices retain
their original labels and scope; agentctl remembers only the exact request, without generating
directory wildcards or command prefixes. A provider approval can cover one matching client
operation in the current turn. Client-specific remembered choices last for the running session
and distinguish file content, command arguments, supplied environment, and terminal input.
These settings do not change the provider's own permissions or sandbox, and ACP cannot force
providers to request approval for every action they execute internally.

Browser sign-in requests show an Open/Copy link and wait for Continue before the agent proceeds.
Signing in or out stops running sessions for profiles of the same agent and invalidates their
authentication status, since ACP does not describe whether those profiles share credentials.

ACP v2 plans support checklists, Markdown, file references, and removal. Context compaction appears
as an activity with its progress and summary. Agent terminals show command, bounded output, and
exit status. Stop waits up to five seconds for cancellation; an unresponsive runtime is terminated.
Process failures include a bounded stderr excerpt with known credentials redacted.

The new-session dialog can list and import native sessions when the agent advertises listing and
loading capabilities. Imports are scoped to the project and profile, retain replayed conversation
roles, and reuse the existing local session on repeated imports.

ACP adapters default to stable v1. Opt into draft v2 in provider settings or with
`AGENTCTL_ACP_PROTOCOL=v2`. Set `AGENTCTL_ACP_V2_ENABLED=true` to enable automatic v2 negotiation
with v1 fallback for initialization incompatibility. Authentication, launch, and session errors
remain visible. Set `AGENTCTL_ACP_PROTOCOL=v1` to force v1. Unavailable model selections produce
a visible conversation notice identifying the fallback model.

Switch providers directly in the current chat. The next message carries a deterministic selection
of saved conversation and tool activity; no outgoing-agent summary turn or separate chat is needed.
Returning to a provider resumes its native conversation when supported and transfers only history
it missed. Successful provider changes appear as a divider in the conversation, with the previous
and next provider and model. Whole messages retain their order, with the original request and latest exchanges taking
priority. History is capped at 16,000 conservative UTF-8/JSON bytes after reserving room for existing
context, your current request, attachments, skills, tools, and output. Per-model capacity comes from
registry `contextWindow` or ACP model metadata; unknown capacity defaults to 128,000 tokens.
Omitted history remains available in private, session-scoped documents across reconnects and server
restarts. These documents are removed when the chat is deleted. Interrupted
handoff delivery and exhausted native context recover in a fresh provider conversation inside the
same chat; the current message is preserved.

The session sidebar shows provider logos, branch/worktree details, activity and unread results.
Pin sessions from their options menu to keep them above recent chats within a workspace.
Settle finished sessions to move them into the workspace's collapsed Settled group while preserving
their files and history. Reopen them from that group, pin them, or send a new message to return them
to active work. Running or queued work must finish or be cancelled before settling. Pins and
read markers survive restarts; unread activity clears when the latest history is viewed in a focused
window. Existing chats start as read when upgrading.

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
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Commit messages follow the Conventional Commits format and use lowercase subjects.

The session command, runtime, execution and persistence boundaries are described in
[Session architecture](packages/core/src/session/README.md).

## OpenTelemetry

Optional traces, metrics and logs, with a local Collector/Grafana development stack, are described in
[the observability guide](docs/observability.md). Telemetry is disabled by default.
