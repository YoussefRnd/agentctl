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

## Deliberate migration scope

This establishes the read/review and checkpoint service boundary. Existing turn capture,
rewind persistence, staging, branching, worktree creation, integration, and remote/PR workflows
still use their existing Git implementation, with Git mechanisms now separated into the focused
capabilities documented in [Git capability ownership](git-architecture.md). This does not claim another VCS can already
replace every workflow in the application. No new VCS, background service, database migration,
or independent checkpoint store is introduced.

Further migration should move one complete workflow at a time:

1. Store opaque revision references for new checkpoints, retaining compatibility reads for
   historical snapshot fields. Move turn capture and rewind through the repository handle.
2. Define capability-specific workspace allocation and integration contracts. Keep staging,
   branch names, remotes, and forge/PR features optional instead of requiring every backend
   to emulate Git.
3. Separate durable change identity from conversation and workspace lifetime. Revisions should
   belong to retained changes even when execution directories are released.
4. Implement an additional backend against those contracts when a concrete use case is chosen.
   Native checkpoints for ordinary folders require an explicit storage and retention design.

Future repository adapters must preserve literal paths, immutable revision reads, scoped
ownership, user staging, recoverable restore behavior, and clear unsupported operations.

## Validation

The full suite passed 1,428 tests across 236 files after the maintainability refactor. The
focused repository, Git, route, contract, API, and review suite passed 389 tests across 55 files.
Typechecks, frontend
architecture checks, lint, formatting, whitespace checks, and web/desktop builds passed.
The isolated production browser journey check also passed startup, navigation, and deferred
asset checks with the new review endpoint in its fixture API. These synthetic API journeys
do not establish backend latency improvements or native Electron runtime behavior.
