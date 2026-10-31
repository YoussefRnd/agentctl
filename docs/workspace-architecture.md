# Repository-neutral session workspace and checkpoints

Session orchestration depends on repository capabilities rather than Git objects or subprocesses.
Git remains the production versioned backend. Ordinary folders support local sessions but advertise
history, isolated allocation, integration, and staging as unavailable. A non-Git test backend verifies
the complete workflow boundary; this migration does not ship another production VCS.

## Workflow-to-capability matrix

| Workflow                                | Session/application owner                            | Backend capability and persistence                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New session                             | `workspace/session-workspace.ts`, session launcher   | Open the selected project; choose local versus isolated mode from capabilities; allocate through `WorkspaceLifecycle` or capture through the opened repository.                                                                                        |
| Default workspace mode                  | Session launcher and workspace orchestration         | A preference for isolation lets the backend decide availability. An explicit unsupported isolated request fails; an empty Git history explicitly returns unavailable allocation and retains the existing local fallback.                               |
| Missing workspace                       | Session workspace availability coordinator           | Stop and await the runtime; pass persisted allocation label, original opaque baseline, path, and conversation-aware recreation policy to lifecycle restore.                                                                                            |
| Turn start/end                          | Conversation projector and turn executor             | `RepositoryCheckpoints` captures scoped references and compares them through the selected backend; event metadata retains its historical field names.                                                                                                  |
| Review and checkpoint detail            | Repository application service and opened repository | Validate identity/scope; review, compare, and diff through capabilities. The Git adapter alone projects commit/tree objects into the selected project scope.                                                                                           |
| File rewind                             | Session history service                              | Validate restore support and reference ownership before stopping the runtime; restore through the opened repository; retain the opaque backup for undo.                                                                                                |
| Undo rewind / explicit restore          | Session history service                              | Restore the scoped backup/reference through the same backend. Preserve the existing conversation event backup/restore policy and restart behavior.                                                                                                     |
| Archive/reactivate                      | Session workspace                                    | Archive keeps workspace files, staging, and history. Reactivation retains the original baseline in both modes; absent isolated workspaces use lifecycle restore instead of allocating from today's project state.                                      |
| Change workspace mode                   | Session lifecycle and workspace services             | Allocate/retire through the backend. Git retirement refuses dirty workspaces or ignored files that would be lost.                                                                                                                                      |
| Apply / finalize                        | Session workspace and backend integration            | Delegate integration and destination preview. Local Git apply uses a separate index and preserves unrelated staging; isolated Git apply retains the established merge safety checks and source history.                                                |
| Discard / recover discard               | Session workspace and backend integration            | Persist an opaque, scoped recovery reference in `discard_backup`. The backend owns native backup/index state and checks later edits before recovery.                                                                                                   |
| Teardown / orphan synchronization       | Session workspace and backend lifecycle              | Preserve active, retained, and unknown workspaces; retire only known allocations, clean up snapshot ownership, and retain shared project snapshots while another session remains. Missing project directories do not prevent explicit record deletion. |
| Staging, branches, remote/PR operations | Existing Git/forge application services              | Remain optional Git capabilities. Git review keeps its legacy response shape through an explicit native-revision compatibility adapter.                                                                                                                |

The command lane is still acquired by the session command coordinator. Workspace orchestration
awaits runtime retirement before file mutations. Git integration owns its repository mutation lock;
its compound helpers do not re-enter that lock. Snapshot capture/restore owns its private-index
lock. Immutable comparisons and forge metadata retain the separate ownership accepted in CP04.

## Contracts and module ownership

Paths are relative to `packages/core/src/` unless prefixed with an application.

| Module                                                      | Responsibility                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository/workspace.ts`                                   | Capability-specific allocation, lifecycle, binding, integration, preview, and recovery contracts. Backend-owned labels/targets are optional hints; no Git implementation is required.                                                                          |
| `repository/types.ts`                                       | Optional backend lifecycle/integration/staging/selected-file restore/cleanup capabilities and explicit legacy import adapters.                                                                                                                                 |
| `repository/source-repository.ts`                           | One opened handle validates and translates scoped references for all operations, exposes capabilities, and wraps backend recovery state in a separate recovery reference namespace.                                                                            |
| `repository/identity.ts`                                    | Versioned reference encoding and backend/repository/scope validation. Revision and recovery namespaces cannot substitute for each other.                                                                                                                       |
| `repository/checkpoints.ts`                                 | Session checkpoint port for capture and turn comparison; unsupported capture returns unavailable rather than inventing a revision.                                                                                                                             |
| `workspace/session-workspace.ts`                            | Session persistence and lifecycle policy. No Git, forge, ACP, or provider implementation imports. Historical database column names map to generic allocation labels, paths, and opaque baselines.                                                              |
| `workspace/workspace-context.ts`                            | Backend-neutral workspace description without false clean-state claims.                                                                                                                                                                                        |
| `workspace/index.ts`                                        | New public entry point, `@agentctl/core/workspace`, for neutral session workspace construction.                                                                                                                                                                |
| `git/session-workspace-operations.ts`                       | Git allocation/restoration/retirement and integration adapter; own local apply, discard/index backup, guarded recovery, and Git cleanup. No database or session implementation dependency.                                                                     |
| `git/legacy-revisions.ts`                                   | Export native immutable Git IDs only for the legacy Git HTTP adapter. Generic session workflows never decode opaque references.                                                                                                                                |
| `git/session-workspace.ts`                                  | Historical Git constructor compatibility wrapper; composes repositories and delegates to the neutral workspace owner. Old local/worktree handle implementation helpers have been replaced by the neutral handle factory; in-repository consumers are migrated. |
| `git/repository-backend.ts`                                 | Compose Git capabilities for the selected project scope; declare legacy imports; retain commit IDs where allocation repair needs the original commit and tree IDs for file captures.                                                                           |
| `default-repository-service.ts`                             | Select Git/directory adapters explicitly; supply the existing Git capability set when workspace operations are needed.                                                                                                                                         |
| `session/composition/repository-resources.ts`               | Choose repository defaults or the supplied backend catalog and construct the one legacy snapshot namespace.                                                                                                                                                    |
| `session/runtime/session-runtime-registry.ts`               | Own the injected repository resources and expose neutral checkpoints; no concrete repository construction. The native snapshot accessor is retained only for legacy Git HTTP compatibility.                                                                    |
| `session/projection/conversation-projector.ts`              | Persist the captured opaque turn-start checkpoint before dispatch.                                                                                                                                                                                             |
| `session/execution/session-turn-executor.ts`                | Capture the end checkpoint and obtain backend-neutral change statistics.                                                                                                                                                                                       |
| `session/services/session-history-service.ts`               | Rewind/undo/explicit restore and native fork context adoption.                                                                                                                                                                                                 |
| `session/handoff.ts`                                        | Secret redaction and temporary history-file retention; no Git subprocess.                                                                                                                                                                                      |
| `apps/server/src/services/session-repository-service.ts`    | Import either opaque or explicitly supported historical baselines before generic review.                                                                                                                                                                       |
| `apps/server/src/services/session-git-service.ts`           | Optional Git branching; pin the new allocation commit as an opaque baseline after branch switching.                                                                                                                                                            |
| `apps/server/src/services/session-reconciler.ts`            | Compatibility branch reconciliation writes an opaque checkpoint through the neutral checkpoint service.                                                                                                                                                        |
| `apps/server/src/services/session-git-operations.ts`        | Keep the native legacy review API behind `legacyGitRevision`, retaining captured tree fields; reject Git review for unsupported backends.                                                                                                                      |
| `apps/web/src/features/sessions/ui/RewindConfirmDialog.tsx` | Describe file restore without Git assumptions; disable confirmation and distinguish unavailable/error previews from a successful empty comparison.                                                                                                             |

The remaining Git, forge, and repository modules retain the ownership maps in
[Git capability ownership](git-architecture.md) and [Repository architecture](repository-architecture.md).
All production files under those directories plus `core/src/workspace` are covered by these audits.
Package checks enforce that repository/workspace owners and session execution/projection/services
cannot import concrete Git implementations. Concrete adapter selection remains in composition.

## Persistence and historical compatibility

No SQL schema or historical migration changes are needed: existing columns already store text.
New values follow these rules:

- `sessions.base_commit` contains an opaque revision reference when checkpoint support exists;
  the existing `none` sentinel means no baseline. New isolated Git allocations retain their
  original commit ID inside the reference, so repair never substitutes today's branch state.
- Event metadata `snapshotHash` contains an opaque revision reference for new turn checkpoints.
  Historical wire names such as `undoSnapshotHash` and `backupHash` remain compatible string
  fields; consumers treat their values as opaque.
- `sessions.discard_backup` contains a `recovery:v1:` reference for new discards. It carries
  backend/repository/scope ownership and a backend-owned compact recovery token. Git keeps
  snapshot IDs, index trees, and recovery guards behind this boundary.
- Existing raw Git tree/commit baselines and event checkpoints are imported only because the
  Git backend explicitly declares legacy revision import. Existing JSON discard backups and
  retained-worktree markers are handled by its explicit recovery import. A different backend
  cannot silently reinterpret an unrecognized native selector as one of its revisions.
- Opaque values are validated as opaque values. Malformed, future-version, other-backend,
  other-repository, and other-scope references fail instead of falling back to legacy parsing.
  Reopening a service preserves identity; linked Git workspaces share repository identity and
  remain constrained to the same selected project scope.

Git continues to populate the optional historical project metadata used by existing Git-only
UI and routes. Those compatibility fields do not select the backend or require another backend
to emulate branches, indexes, commit hashes, or remotes. Public Git entry points and constructor
compatibility remain; new neutral callers use `@agentctl/core/workspace` and repository contracts.
`SessionManager` accepts an injected backend catalog and an absent Git workspace manager.

Snapshot retention refs, backup/index guards, literal-path protection, private-index ownership,
and the one-server-per-database assumption remain in force. A production VCS adapter must persist
its revisions and recovery tokens with the required retention; the in-memory revision catalog in
the file-backed test VCS is test infrastructure, not a proposed production checkpoint store.

## Verification

The non-Git adapter tests perform real file capture/restore with named Unicode revision IDs,
allocation and repair, archive/reactivation, discard/recovery, integration, retirement, persisted
turn capture, history preview/rewind/undo/restore, cross-owner/scope rejection, explicit unsupported
folder operations, missing-folder deletion, and session composition without a Git workspace manager.

Real Git compatibility tests reopen a populated SQLite database containing historical raw baseline
and JSON recovery fields, recover files and exact index state, then write opaque checkpoints.
Missing historical worktree records restore their original commits after the project advances.
Existing staging, nested-project, ignored-file, merge/conflict, hook, retention, and snapshot
concurrency suites remain acceptance requirements. UI tests cover unavailable and failed restore
previews and prevent them from confirming a destructive file action.

Actual verification commands/results are recorded in the [migration tracker](architecture-migration.md).
