# Code organization and dependency rules

AgentCtl is a modular monolith. Features have deliberate public APIs and explicit owners for
workflows, state, persistence, and external resources. Web, server, and Electron remain separate
application entry points. Moving a workflow between modules should preserve its transactions,
command lanes, cancellation, recovery, and cleanup behavior.

## Decisions

| Pattern                  | Convention                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature modules          | Group related behavior by product capability. Split by responsibility inside a module when useful.                                                                                    |
| Ports and adapters       | Use narrow interfaces at variable external boundaries: agent protocols, repositories, workspace allocation, and forge operations.                                                     |
| Application services     | One owner coordinates each workflow. HTTP handlers translate requests/responses and errors; they do not implement the workflow.                                                       |
| Composition roots        | Startup constructs resources and owns their lifetime. Importing a database module must not open or migrate SQLite.                                                                    |
| Command/query separation | Read-model queries assemble data; commands own mutations and reconciliation. Preserve legacy reads that reconcile until their callers migrate explicitly.                             |
| State transitions        | Model lifecycle transitions explicitly. Prefer discriminated unions, pure transition functions, and existing coordinators where they fit.                                             |
| Persistence              | Use focused stores for shared queries and transaction rules. A small application service may use the injected database directly; a generic CRUD repository per table is not required. |

Interfaces are useful when they express an ownership boundary, an alternative implementation,
or a smaller dependency needed by a workflow. Plain functions remain appropriate for pure
transformations. New layers need a concrete responsibility; modules do not require empty
`domain`, `ports`, or `adapters` directories.

## Dependency direction

- Shared contracts and policies do not import application code, Node adapters, React, or the API client.
- The API client owns HTTP/SSE transport and depends on shared contracts, never host implementations.
- Core owns agent/session/workspace behavior and host adapters, without Fastify or React dependencies.
- Server routes call application services and queries. Server composition constructs the services.
- Web routes/app composition assemble features. Features use public entries of other features;
  shared web capabilities do not depend on features. The feature graph must remain acyclic.
- The design system does not import application features. Electron owns native app lifecycle and IPC.

Repository and ACP boundaries have dedicated regression tests. Parsed architecture checks
enforce package/module directions, public entries, UI purity, main/preload separation and
frontend cycles. Canonical targets prevent relative-path, re-export, type and lazy-import
bypasses. A modular monolith can retain a small injected application service without adding
a generic repository or domain layer.

## Current owners

| Location                                                          | Owns                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/server/src/services/projects/project-queries.ts`            | Project/session read-model assembly, search, and sorting                                     |
| `apps/server/src/services/projects/project-directory.ts`          | Host folder resolution and exploration, without database/session access                      |
| `apps/server/src/services/projects/project-service.ts`            | Open/reuse/create/delete project workflows and state notifications                           |
| `apps/server/src/services/native-session-import-service.ts`       | Native import deduplication, persisted import identity, cleanup, and recovery                |
| `apps/server/src/services/session-git-service.ts`                 | Session-aware branch checkout, merge, and command-lane coordination                          |
| `packages/core/src/forge/types.ts`                                | Forge contract independent of Git mutation and session persistence                           |
| `packages/core/src/forge/github-pull-requests.ts`                 | GitHub CLI requests, response normalization, remote URL parsing, browser fallback            |
| `packages/core/src/db/database.ts`                                | Explicit database creation and migrations                                                    |
| `packages/core/src/db/default-database.ts`                        | Environment/path resolution and lazy default database creation                               |
| `packages/api-client/src/services/`                               | Capability-specific projects, sessions, Git, history, editors, search, and terminal requests |
| `packages/api-client/src/stream/session-engine.ts`                | Session stream lifecycle; framing and coalescing have focused stream owners                  |
| `apps/web/src/features/sessions/model/SessionConfigContext.tsx`   | Configuration/review context composition                                                     |
| `apps/web/src/features/sessions/model/SessionStreamContext.tsx`   | History, plan, execution, and queue context composition                                      |
| `apps/web/src/features/sessions/model/useSessionMessageQueue.ts`  | Client outbox, delivery retry, and durable acceptance reconciliation                         |
| `apps/web/src/features/sessions/model/useSessionStatusEffects.ts` | Notifications and query invalidation on session status changes                               |
| `apps/web/src/shared/markdown/`                                   | Reusable markdown rendering, worker processing, and text reveal                              |
| `apps/web/src/shared/stores/useWorkbenchStore.ts`                 | Client workspace navigation state shared by page and feature consumers                       |

Git preflight, pushing, locking, and PR-cache invalidation remain owned by the existing Git
workflow. Forge adapters never reacquire the Git lock. Session command services retain the
existing workspace command lane rather than introducing another queue.

Project listing groups sessions once by project instead of scanning every session again for
every project. It still loads the existing complete sidebar read model; pagination and query
limits are separate product/API decisions.

## Frontend state and composition

React Query owns remote data. Zustand owns client-only UI state and drafts. The outbox owns
optimistic delivery until durable acceptance; the server queue owns accepted messages. Contexts
expose focused capabilities and preserve existing update isolation for prompts, queues, and
turn progress. Splitting files must not merge these distinct lifetimes.

Markdown rendering and workspace navigation are shared capabilities used outside their original
features. Conversation cards and inspector panels import those owners directly; temporary feature forwarding exports are removed.

The feature graph is acyclic. `apps/web/architecture-cycles.json` is empty and the checker
rejects cycle exceptions, including cycles through re-exports, type and lazy imports. Shared
owners cannot import application/features, including through relative barrels. Page composition
owns session headers/launch dialogs and supplies explicit review-to-composer actions. Conversation
has a one-way dependency on subagents; both use shared transcript renderers that have no parent
session subscriptions or control APIs. The [frontend ownership map](frontend-architecture.md)
and [parsed graph snapshot](frontend-feature-graph.json) record these boundaries. The complete [frontend state audit](frontend-state-architecture.md) and [contracts/public API audit](contracts-architecture.md) record the remaining owners and alias decisions.

## File and API conventions

- Core/server files use descriptive kebab-case names. Web components use PascalCase and hooks
  use `useSomething`. Preserve local conventions when extracting related files.
- Public `index.ts` files expose intended capabilities. Internal code imports the owning file
  directly. Avoid broad root barrels when a focused package entry exists.
- Keep testable pure policies separate from I/O. Colocate unit tests; route suites verify HTTP
  integration; adapter tests verify external semantics, cancellation, and failure behavior.
- Infer transport inputs from the shared schema rather than repeating request interfaces.
- Use explicit domain errors at reusable boundaries and translate them at the application edge.
  Existing server-local application services retain `AppError` compatibility.

The architecture migration preserves HTTP URLs/response shapes, session command ordering and
the database schema. Capability helper function names remain exported from `@agentctl/api-client`;
`services/project-sessions.ts` has been removed in favor of the package root.

The complete source compatibility list is in the [architecture release notes](releases/architecture-migration.md).
Two common import changes are:

```ts
// Transport lives with the client, not shared contracts or core.
import { SessionEngine } from '@agentctl/api-client';

// Call during startup; importing db contracts no longer initializes SQLite.
import { getDefaultDatabase } from '@agentctl/core/db';
const db = getDefaultDatabase();
```

The former `SessionEngine` exports from shared/core and the eager `db` singleton export are
removed. All in-repository consumers migrate together. A supplied database bypasses default
initialization in server startup, keeping test and embedded composition isolated.

## Enforcement and migration

Run `pnpm architecture:check` for package/server and frontend checks, and
`pnpm architecture:test` for import parsing, multi-hop cycle detection, and baseline regression
tests. Root typecheck runs the checks; root test runs architecture regressions and the
consolidated Vitest projects with two workers. The checker uses TypeScript syntax trees for import, re-export, dynamic import,
and type dependencies. Existing protocol/repository boundary tests remain in the Vitest suite.

The [server ownership audit](server-architecture.md) records CP02's endpoint inventory and
application/transport owners, including explicit session reconciliation and awaited lifecycle
cleanup. The [session ownership audit](session-architecture.md) inventories all session modules,
their state transitions, resource lifetimes, persistence rules, and deliberate public exports.
Session resources and workflow callbacks now have explicit composition owners; persistence
and internal workflows cannot import the public session facade or barrel.

The [architecture migration record](architecture-migration.md) contains the complete ownership
audit, compatibility decisions and verification evidence. Core, web and contracts ledgers map
production modules to their owners; the workspace ledger covers the remaining source, assets,
tests, tools and documents. Missing, duplicate or stale file assignments fail normal checks.
The [enforcement matrix](tooling-architecture.md) describes delivery tasks and violation fixtures.
The [desktop audit](desktop-architecture.md) and [UI inventory](ui-architecture.md) cover native
resource lifetimes, IPC, accessibility and gallery acceptance.

This structure improves maintainability and backend substitution. The execution model still
assumes one owning server process per database. Horizontal multi-server execution requires a
separate design for ownership, leases, queues, locking, and event delivery.

## Validation

The final revision, test counts, commands and artifacts are recorded in the
[migration acceptance record](architecture-migration.md#cp15--repository-wide-acceptance-and-migration-closure).
The gate covers populated-database upgrades, legacy revision decoding, protocol boundaries,
frontend state/resource cleanup, browser navigation, emitted workers, UI gallery interaction
and real Linux Electron startup/IPC/shutdown. Synthetic browser journeys do not measure live
provider latency; native smoke verifies the available platform rather than macOS/Windows.

The [Git capability audit](git-architecture.md) records CP04 composition, operation contracts,
forge selection, complete module ownership, and lock/resource ordering.

The [workspace workflow audit](workspace-architecture.md) records backend-neutral lifecycle,
checkpoint persistence, legacy import rules, optional Git capabilities, and non-Git adapter acceptance.

The [provider/agent audit](provider-architecture.md) records registry capabilities, protocol-neutral
runtime composition, authentication/install cancellation and awaited shared connection ownership.
The [remaining-core audit](core-infrastructure-architecture.md) records security/auth, MCP,
context, skills, configuration, database and root composition ownership. The
[core ownership ledger](core-ownership.json) assigns every production core module and bundled
skill asset; architecture checks reject missing, duplicate or stale entries.
