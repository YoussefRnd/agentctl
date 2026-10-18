# Server ownership and transport audit

This records server transport/application ownership and its original acceptance evidence.
The [migration record](architecture-migration.md) contains final repository-wide acceptance;
[session ownership](session-architecture.md) and [desktop lifecycle](desktop-architecture.md)
describe the corresponding runtime boundaries.

## Application and transport boundaries

`app.ts` composes host resources, security middleware, serializers, and route registration.
`composition/server-services.ts` constructs application services once per app, lazily, so a
route fixture can supply only the resources it exercises. No service is shared across apps.
Routes consume this explicit service collection and existing core facades; they do not
query the database, launch an ACP driver, or implement filesystem storage.

`composition/session-services.ts` constructs the server session facade's command, query,
reconciliation, Git-command, and native-import owners. `SessionService` keeps its public calling
surface and coordinates multi-field patches in the established order. It does not own SQL.

| Owner                                    | Responsibility                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `services/session-queries.ts`            | List/detail/execution query assembly without repair or workspace restoration                                                          |
| `services/session-reconciler.ts`         | Explicit legacy workspace recovery, branch snapshot, token and context-limit repair                                                   |
| `services/session-commands.ts`           | Create/configure/finalize/rename/spawn/handoff/elicitation application operations                                                     |
| `services/session-git-service.ts`        | Branch checkout/merge and their session command lanes                                                                                 |
| `services/session-git-operations.ts`     | Git preconditions, mutation lane, partial-change notifications, review/status/merge preview, draft generation and fingerprint recheck |
| `services/session-repository-service.ts` | Backend-neutral review and legacy baseline import                                                                                     |
| `services/session-event-history.ts`      | Bounded history windows/replay and transactional snapshot/change-cursor catch-up                                                      |
| `services/session-turn-index.ts`         | Bounded, cursor-invalidated turn preview read model                                                                                   |
| `services/session-event-queries.ts`      | Event list/high-water/batch/query facade for transport replay                                                                         |
| `services/projects/`                     | Project queries, folder discovery and open/create/delete application workflows                                                        |
| `services/search-queries.ts`             | Search SQL, categorization, text extraction and snippets                                                                              |
| `services/provider-session-queries.ts`   | Project-scoped native session listing and import annotations                                                                          |
| `services/settings-service.ts`           | Settings defaults, validation, normalization, persistence and notifications                                                           |
| `services/mcp-service.ts`                | MCP config persistence, approval compatibility, reload and tools                                                                      |
| `services/workspace-queries.ts`          | Context/terminal workspace resolution with their established fallback rules                                                           |
| `services/attachment-service.ts`         | Attachment validation, filename policy, storage, rollback and read errors                                                             |
| `services/auth-attempt-limiter.ts`       | Per-app pairing-attempt window state                                                                                                  |
| `services/terminal-service.ts`           | Interactive/command terminal processes, input/resize, output history and termination                                                  |
| `services/server-lifecycle.ts`           | Recovery, credential-change retirement, background provider refresh and awaited shutdown                                              |
| `services/session-state-events.ts`       | Session/workspace notification topics independent of Fastify                                                                          |

## Preserved workflow semantics

Session detail still loads the existing session record, explicitly reconciles it, then builds
its response. Pure query consumers can use `SessionQueries` without triggering snapshots,
workspace restoration, token recalculation, or metadata writes. This retains legacy recovery
behavior while making the mutation visible in the facade's workflow.

Git changes still acquire the existing session workspace command lane. Preconditions run
inside that lane. Notifications for index/ref/hook side effects still run in `finally`, even
when a mutation fails. Draft generation retains one in-flight request per session, an app-owned
driver, provider/model selection, and the final captured-change fingerprint check.

Attachment transport owns binary parsing, body limits, headers, and the HTTP envelope. Its
service preserves session-first validation, signature/MIME checks, filename handling, metadata
and payload rollback, missing-file errors, and logged storage failures. Context and terminal
lookups deliberately preserve their different directory fallbacks.

MCP transport reports whether approval-policy fields were present before schema defaults;
the application service owns legacy auto-approve conversion, persistence, reload, and notification.
Settings validation still happens before writes; error status and response envelopes are retained.

## Streaming, authentication, and lifecycle acceptance

- `routes/events.ts` owns SSE headers, subscription-before-catch-up ordering, bounded pending
  events/backpressure, notices, heartbeat, reconnect protocol and socket cleanup. SQL and turn
  indexing belong to the event-query services. Legacy event-ID and durable change-cursor modes remain.
- `routes/terminal.ts` owns WebSocket framing, terminal subscriptions, transport input/resize,
  workspace-change debounce and connection cleanup. Core auth coordination owns advertised-method
  validation and authentication. An auth terminal's abort controller remains scoped to its socket.
- `plugins/auth.ts` owns HTTP/WebSocket credentials, cookie/origin checks and development/embedded
  transport rules. `AuthManager` owns pairing/session policy and persistence. `routes/auth.ts`
  owns request schemas, cookie mutation, retry headers and pairing URL construction; its limiter
  is constructed per route registration rather than as shared module state.
- Diagnostics handlers only set download/cache headers and delegate to provider diagnostics.
  The typed router is registered by `app.ts`; `routes/diagnostics.ts` remains a standalone transport
  exercised by its focused fixture, with no separate domain implementation.
- `plugins/worktree.ts` is a startup adapter that awaits the session facade's orphan synchronization.
  Terminal service, event bus, editor launcher and process-signal lifecycle utilities retain their
  cohesive I/O responsibilities. Their existing tests remain their acceptance evidence.
- Global `AppError` serialization remains in `app.ts`; contract-specific `{ message }` error
  responses stay in the corresponding router. Repository domain errors are translated by the
  repository HTTP adapter. Reusable core modules do not import server errors or Fastify.

`ServerLifecycle` has one idempotent, awaited close path. The duplicate fire-and-forget session
shutdown plugin is removed. Cleanup attempts the remaining owned resources when an earlier close
fails and reports collected errors. Background refresh has one timer/in-flight run and does not
start follow-up updates/probes after shutdown. Provider operation cancellation and native server
process lifecycle remain owned by core providers and the desktop checkpoint respectively.

## Contract endpoint inventory

All 77 declared contract endpoints have a transport owner below. Their application ownership is
mapped above; the contracts remain in `packages/shared/src/contracts`. Router paths here are
relative to `apps/server/src/plugins/ts-rest/`.

| Method and path                                     | Contract operation        | Transport owner                |
| --------------------------------------------------- | ------------------------- | ------------------------------ |
| `GET /api/search/events`                            | `searchEvents`            | `search.router.ts`             |
| `GET /api/projects`                                 | `getProjects`             | `projects.router.ts`           |
| `POST /api/projects/open`                           | `openProject`             | `projects.router.ts`           |
| `GET /api/editor/available`                         | `getAvailableEditors`     | `projects.router.ts`           |
| `POST /api/editor/open`                             | `openInEditor`            | `projects.router.ts`           |
| `DELETE /api/projects/:id`                          | `deleteProject`           | `projects.router.ts`           |
| `GET /api/fs`                                       | `exploreFs`               | `projects.router.ts`           |
| `POST /api/providers/:id/profiles`                  | `createProfile`           | `providers.router.ts`          |
| `GET /api/providers/:id/native-sessions`            | `listNativeSessions`      | `providers.router.ts`          |
| `GET /api/providers`                                | `getProviders`            | `providers.router.ts`          |
| `GET /api/registry`                                 | `getRegistry`             | `providers.router.ts`          |
| `POST /api/providers/:id/install`                   | `installProvider`         | `providers.router.ts`          |
| `POST /api/providers/:id/install/cancel`            | `cancelInstallProvider`   | `providers.router.ts`          |
| `POST /api/providers/:id/remove`                    | `removeProvider`          | `providers.router.ts`          |
| `POST /api/providers/:id/login`                     | `loginProvider`           | `providers.router.ts`          |
| `POST /api/providers/:id/auth/respond`              | `respondAuthInteraction`  | `providers.router.ts`          |
| `POST /api/providers/:id/login/cancel`              | `cancelLoginProvider`     | `providers.router.ts`          |
| `POST /api/providers/:id/verify`                    | `verifyProvider`          | `providers.router.ts`          |
| `POST /api/providers/:id/logout`                    | `logoutProvider`          | `providers.router.ts`          |
| `POST /api/providers/:id/activate`                  | `activateProvider`        | `providers.router.ts`          |
| `POST /api/providers/:id/refresh`                   | `refreshProvider`         | `providers.router.ts`          |
| `POST /api/providers/:id/config`                    | `setProviderConfig`       | `providers.router.ts`          |
| `POST /api/providers/sync`                          | `syncProviders`           | `providers.router.ts`          |
| `GET /api/sessions/:id/repository`                  | `getSessionRepository`    | `session-repository.router.ts` |
| `GET /api/sessions/:id/repository/review`           | `getRepositoryReview`     | `session-repository.router.ts` |
| `GET /api/sessions/:id/branches`                    | `getSessionBranches`      | `session-git.router.ts`        |
| `GET /api/sessions/:id/merge-preview`               | `getSessionMergePreview`  | `session-git.router.ts`        |
| `GET /api/sessions/:id/review`                      | `getSessionReview`        | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/stage`               | `stageFile`               | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/revert`              | `revertFile`              | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/unstage`             | `unstageFile`             | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/stage-all`           | `stageAllFiles`           | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/unstage-all`         | `unstageAllFiles`         | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/commit`              | `commitChanges`           | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/push`                | `pushChanges`             | `session-git.router.ts`        |
| `POST /api/sessions/:id/review/pull`                | `pullChanges`             | `session-git.router.ts`        |
| `POST /api/sessions/:id/git/fetch`                  | `fetchChanges`            | `session-git.router.ts`        |
| `POST /api/sessions/:id/git/branches`               | `createSessionBranch`     | `session-git.router.ts`        |
| `GET /api/sessions/:id/git/status`                  | `getGitStatus`            | `session-git.router.ts`        |
| `POST /api/sessions/:id/git/generate-draft`         | `generateGitDraft`        | `session-git.router.ts`        |
| `POST /api/sessions/:id/git/pull-request`           | `createPullRequest`       | `session-git.router.ts`        |
| `POST /api/sessions/:id/merge-branch`               | `mergeSessionBranch`      | `session-git.router.ts`        |
| `GET /api/sessions/:id/check-merge`                 | `checkMergeBranch`        | `session-git.router.ts`        |
| `POST /api/sessions/:id/queue/resume`               | `resumeSessionQueue`      | `sessions.router.ts`           |
| `GET /api/sessions/:id/execution`                   | `getSessionExecution`     | `sessions.router.ts`           |
| `POST /api/sessions/:id/queue/:commandId`           | `changeQueuedMessage`     | `sessions.router.ts`           |
| `POST /api/sessions/import-native`                  | `importNativeSession`     | `sessions.router.ts`           |
| `GET /api/sessions`                                 | `getSessions`             | `sessions.router.ts`           |
| `POST /api/sessions`                                | `createSession`           | `sessions.router.ts`           |
| `GET /api/sessions/:id`                             | `getSessionById`          | `sessions.router.ts`           |
| `POST /api/sessions/:id/terminal/:terminalId/input` | `sendTerminalInput`       | `sessions.router.ts`           |
| `POST /api/sessions/:id/merge`                      | `mergeSession`            | `sessions.router.ts`           |
| `POST /api/sessions/:id/discard`                    | `discardSession`          | `sessions.router.ts`           |
| `PATCH /api/sessions/:id`                           | `patchSession`            | `sessions.router.ts`           |
| `DELETE /api/sessions/:id`                          | `deleteSession`           | `sessions.router.ts`           |
| `POST /api/sessions/:id/archive`                    | `archiveSession`          | `sessions.router.ts`           |
| `POST /api/sessions/:id/restore`                    | `restoreSession`          | `sessions.router.ts`           |
| `POST /api/sessions/:id/cancel`                     | `cancelSession`           | `sessions.router.ts`           |
| `POST /api/sessions/:id/approve`                    | `approveEvent`            | `sessions.router.ts`           |
| `POST /api/sessions/:id/deny`                       | `denyEvent`               | `sessions.router.ts`           |
| `POST /api/sessions/:id/input`                      | `sendInput`               | `sessions.router.ts`           |
| `POST /api/sessions/:id/undo-discard`               | `undoDiscard`             | `sessions.router.ts`           |
| `POST /api/sessions/:id/rewind`                     | `rewindSession`           | `sessions.router.ts`           |
| `POST /api/sessions/:id/undo-rewind`                | `undoRewind`              | `sessions.router.ts`           |
| `POST /api/sessions/:id/handoff`                    | `handoffSession`          | `sessions.router.ts`           |
| `POST /api/sessions/:id/restore-snapshot`           | `restoreSnapshot`         | `sessions.router.ts`           |
| `GET /api/sessions/:id/snapshots/:eventId/preview`  | `previewSnapshotDiff`     | `sessions.router.ts`           |
| `POST /api/sessions/:id/agents`                     | `spawnParallelAgent`      | `sessions.router.ts`           |
| `GET /api/settings`                                 | `getSettings`             | `settings.router.ts`           |
| `PATCH /api/settings`                               | `patchSettings`           | `settings.router.ts`           |
| `GET /api/mcp-servers`                              | `getMcpServers`           | `mcp.router.ts`                |
| `POST /api/mcp-servers`                             | `createMcpServer`         | `mcp.router.ts`                |
| `PATCH /api/mcp-servers/:id`                        | `updateMcpServer`         | `mcp.router.ts`                |
| `DELETE /api/mcp-servers/:id`                       | `deleteMcpServer`         | `mcp.router.ts`                |
| `GET /api/mcp/tools`                                | `getMcpTools`             | `mcp.router.ts`                |
| `POST /api/mcp/tool/call`                           | `callMcpTool`             | `mcp.router.ts`                |
| `GET /api/diagnostics/transport`                    | `getTransportDiagnostics` | `diagnostics.router.ts`        |

## Direct routes and event channels

All paths below are relative to the app root, including the `/api` registration prefix.

| Transport               | Paths / channels                                                                                                                                                         | Application owner                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `routes/auth.ts`        | `GET /api/auth/status`, `POST /api/auth/pairing/consume`, `POST /api/auth/pairing/create`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/logout` | Core AuthManager; per-app attempt limiter                                                     |
| `routes/events.ts`      | `GET /api/events/stream`                                                                                                                                                 | EventBus state subscription; transport owns heartbeat/cleanup                                 |
| `routes/events.ts`      | `GET /api/sessions/:id/events`, `GET /api/sessions/:id/events/turns`, `GET /api/sessions/:id/events/page`                                                                | SessionEventQueries and bounded history/turn read models                                      |
| `routes/events.ts`      | `GET /api/sessions/:id/events/stream`                                                                                                                                    | Core session resuscitation plus event-query catch-up; transport owns framing and flow control |
| `routes/events.ts`      | `POST /api/sessions/:id/elicitations/:elicitationId/respond`                                                                                                             | SessionService → SessionCommands → active core session                                        |
| `routes/terminal.ts`    | `GET /api/sessions/:id/terminal/ws`                                                                                                                                      | WorkspaceQueries and InteractiveTerminalService                                               |
| `routes/terminal.ts`    | `GET /api/providers/:id/auth/terminal/ws`                                                                                                                                | Provider auth coordinator and command terminal service                                        |
| `routes/context.ts`     | `GET /api/projects/:id/context/search`, `POST /api/projects/:id/context/resolve`, `GET /api/sessions/:id/context/search`, `POST /api/sessions/:id/context/resolve`       | WorkspaceQueries and core ContextService                                                      |
| `routes/attachments.ts` | `POST /api/sessions/:sessionId/attachments`, `GET /api/sessions/:sessionId/attachments/:attachmentId`                                                                    | AttachmentService                                                                             |
| `app.ts`                | `GET /health`                                                                                                                                                            | Server transport health response                                                              |

The session SSE stream carries `session_event`, `session_snapshot`, `session_notice`, error and
heartbeat frames. The app SSE stream carries `state_ready`, `state_change` and heartbeat frames.
Session notices remain live-only and do not advance durable history. WebSockets retain init,
data/input, resize, restart, exit, authenticated and error behavior on their respective channels.

## Enforcement and evidence

`pnpm architecture:check` now scans all production server route/router files. They cannot import
Drizzle, database tables, filesystem/path discovery, simple-git, or ACP implementations. Server
application services cannot import route/plugin implementations. Typed composition is the only
place the Git text driver is constructed.

Acceptance is based on route integration, Git failure/staging/merge safety, settings/MCP presence
compatibility, auth/origin/pairing, attachments, context, terminal/WebSocket, event pagination/replay,
turn-index tests, and dedicated query-reconciliation and lifecycle failure/concurrency regressions.
Exact commands and final results for this change are recorded in the migration tracker.

## CP02 validation

Accepted locally on 2026-10-16. The full suite passed 1,434 tests across 239 files; the focused
core-session/server suite passed 270 tests across 49 files. Four architecture regression tests,
all-workspace typechecks, lint, formatting, and web/desktop builds passed. Endpoint inventory,
local document links, and whitespace checks passed. This includes the initial CP03 workflow
composition extraction. Later session/native acceptance is recorded in the final migration
gate; these original server checks do not claim native-runtime or live-provider acceptance.

The process entry point explicitly owns the optional [OpenTelemetry SDK](observability.md).
Fastify hooks instrument requests using route templates and bridge sanitized application logs.
Core uses API-only turn/provider observations and persists traceparent with durable operations.
SDK shutdown follows server/session disposal, with a bounded flush. SDK construction is absent
from `buildApp()` and ordinary imports.
