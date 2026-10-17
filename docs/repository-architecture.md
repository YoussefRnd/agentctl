# Repository backend boundary

AgentCtl coordinates conversations and agent execution independently of how a source control
system represents revisions. Git is the first versioned implementation. Ordinary directories
are also recognized as workspaces, with history-related capabilities explicitly unavailable.

## Current implementation

`packages/core/src/repository` defines `RepositoryBackend`, `BackendWorkspace`, and the
`RepositoryService` facade. `createDefaultRepositoryService` composes the Git backend and directory
fallback; the session runtime registry supplies its existing shared snapshot service. Backends are selected in order on each
open, so initializing Git after registering a folder is detected without restarting AgentCtl.
A backend returns `null` when it does not own a directory; errors are propagated, rather than
being mistaken for an unversioned workspace.

The public handle exposes repository information, capability discovery, revision resolution,
capture, review, comparisons, file diffs, and restore. Capabilities reflect implemented backend
operations. Unsupported checkpoint/comparison/restore requests fail explicitly. An unavailable
review returns its repository descriptor and no files; the UI shows that review is unavailable
instead of claiming the workspace is clean.

The Git adapter lives in `packages/core/src/git/repository-backend.ts`. The generic repository
module has no Git imports. Another backend can implement the same contract with its own
revision identifiers and checkout model. Tests exercise a backend whose IDs contain labels
and Unicode instead of Git hashes, through both the service and the HTTP review path.

## Code organization

| Area / file                                               | Responsibility                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `core/src/repository/types.ts`                            | Backend contracts and explicit operation results                                  |
| `core/src/repository/repository-service.ts`               | Directory canonicalization and ordered backend selection                          |
| `core/src/repository/source-repository.ts`                | Operations on one opened repository, with capability checks and opaque references |
| `core/src/repository/identity.ts`                         | Local identity hashing and scoped revision encoding/decoding                      |
| `core/src/repository/errors.ts`                           | Domain errors shared by the handle, codec, and adapters                           |
| `core/src/repository/directory-backend.ts`                | Ordinary folder adapter                                                           |
| `core/src/git/repository-backend.ts`                      | Translation between the generic contracts and Git snapshots                       |
| `core/src/default-repository-service.ts`                  | Application composition of default backends                                       |
| `shared/src/contracts/repository.contract.ts`             | Generic repository HTTP contract and query schema                                 |
| `shared/src/contracts/session-git.contract.ts`            | Git-specific session HTTP contract, including the legacy review endpoint          |
| `server/src/services/session-repository-service.ts`       | Session lookup and persisted baseline compatibility                               |
| `server/src/plugins/ts-rest/session-repository.router.ts` | Request/response handling and domain-to-HTTP error translation                    |
| `server/src/plugins/ts-rest/session-git.router.ts`        | Git workflow handlers and Git mutation coordination                               |
| `web/src/features/sessions/api/workspaceReview.ts`        | Review response normalization before session state                                |

The core, shared, and server paths above are relative to their corresponding `packages/`
or `apps/` directory. Session contracts and routers compose these groups to retain existing
entry points and URLs. The repository package's public entry point retains its existing exports.

Dependencies run from application composition into adapters and from the opened handle into
contracts, identities, and domain errors. Adapters do not import the backend-selection service
for utility functions. A boundary test keeps Git, ACP, process spawning, and session orchestration
out of the generic repository domain.

Backend-independent service tests stay beside the generic service; real Git/worktree tests live
beside the Git adapter. Repository API tests use a dedicated fixture in
`apps/server/src/routes/session-repository.test.ts`, separate from Git mutation workflow tests.

## Identities and revisions

- **Repository identity** identifies an object/history store. Git derives it from the canonical
  common Git directory, so linked worktrees share repository identity.
- **Workspace identity** identifies a checkout. Git derives it from the checkout's Git directory,
  so linked worktrees have separate workspace identities. Multiple project folders within the
  same checkout share that identity.
- **Scope** identifies the selected project directory relative to the repository root. Comparisons
  and restores cannot accidentally consume references from another project scope.
- **Revision reference** is an opaque, versioned string carrying the backend, repository, scope,
  and backend-native immutable ID. Applications retain and return this string without examining
  hash formats, branches, tree objects, or the reference encoding.

References remain usable after reopening the service. They can cross linked worktrees in the
same repository and scope. They are rejected for another backend, repository, or scope.
Git selectors such as `HEAD` are resolved at the adapter boundary before issuing a reference;
subsequent comparisons use immutable IDs. Backend-native IDs received by the Git adapter are
validated there, while other backends can use different identifier formats.

The reference encoding is an interchange format, not encryption or an authorization token.
Existing session authentication and workspace/path checks still govern access. Local Git
identity is path-based: moving or replacing a repository is not a supported reference migration.
Retained revisions also depend on the backend's object-retention policy. This boundary does
not introduce new snapshot pruning or workspace eviction.

## HTTP and UI

`GET /api/sessions/:id/repository` returns backend identity and capabilities.

`GET /api/sessions/:id/repository/review` returns file summaries and a capture with `current`,
`working`, and `baseline` revision references. File details use `fromRevision`, `toRevision`,
and a literal `filePath`. Both references and the path are required together. Scope selects
the existing working-versus-session comparison behavior.

The review UI uses this endpoint for summaries and captured file details. Cache keys include
the complete opaque references. Captured details remain immutable and cancellable; backend
changes or changed revisions produce distinct keys.

`GET /api/sessions/:id/review` remains the legacy Git-compatible endpoint. It retains its raw
hash parameters and tree capture fields for existing clients. Session baselines stored before
this boundary remain unchanged; the new API imports those selectors through the selected
backend rather than sending them to the browser.

## Workspace and checkpoint workflows

Turn capture/comparison, persisted baselines, rewind/undo/restore, archive/reactivation, allocation,
integration and teardown now use the selected repository/workspace capabilities. The optional Git
and forge workflows retain their focused implementations. New checkpoint and recovery writes are
scoped opaque references; historical Git selectors and JSON recovery state have explicit adapter
imports. See [workspace workflow ownership](workspace-architecture.md) for the workflow matrix,
persistence decision, module inventory, and verification.

No new production VCS, ordinary-folder checkpoint store, background service, or database schema
is introduced. Ordinary folders advertise unsupported history, staging, isolation and integration.
A file-backed non-Git test adapter verifies the entire neutral workflow boundary. Adding a production
backend still requires its own durable object/recovery retention and product integration.

## Validation and extension scope

The [final migration acceptance](architecture-migration.md#cp15--repository-wide-acceptance-and-migration-closure)
records exact revision, commands and results. Repository/Git/server tests cover scoped opaque
references, alternate backend IDs, legacy raw Git revisions, worktree safety, checkpoint recovery
and ordinary-folder capability fallback. Database tests upgrade populated data from every
historical migration boundary. Production browser journeys exercise repository review consumers;
separate native smoke exercises the built Electron integration.

A new production backend implements and advertises its actual capabilities, defines durable
revision/recovery retention, and passes the neutral workflow and HTTP tests with non-Git IDs.
AgentCtl's development tooling still uses Git to audit this source checkout. That development
requirement does not place Git inside the repository-neutral runtime contract. Git-specific
branch, staging, push and forge operations remain optional backend workflows.
