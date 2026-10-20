# Session architecture

`SessionManager` is the public application facade. ACP wire formats and negotiation remain
inside `../acp`; this layer uses the provider-independent `AgentSession` contract.
The [session ownership audit](../../../../docs/session-architecture.md) inventories every module,
its accepted responsibility, state transitions, public exports and verification.

| Directory      | Responsibility                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `composition/` | Construct workflow dependencies and internal callbacks without reentering public command lanes        |
| `commands/`    | Serialize session mutations, validate attachments, recognize acceptance receipts, and handle commands |
| `execution/`   | Dispatch accepted messages, execute turns, recover operations and expose queue controls               |
| `runtime/`     | Own a live provider connection, binding and resource cleanup                                          |
| `requests/`    | Evaluate permissions, track user input and release request-specific waiters on cancellation           |
| `persistence/` | Commit conversation rows, metadata, token accounting and change cursors atomically                    |
| `projection/`  | Merge provider updates into conversation and session read models                                      |
| `services/`    | Launch sessions and perform workspace, history and lifecycle operations                               |

## Identity and state

A conversation is the application session ID. A message command has a stable client command
ID and an operation receipt. Each accepted message creates a turn attempt. A runtime binding
has its own UUID, configured provider/profile ID and provider-native session ID. Reconnecting
a provider does not change the conversation identity or reuse the old runtime identity.

Connection (`connected`, `closed`, `lost`), turn execution, and attention are independent.
The existing session status remains available for compatibility. The execution endpoint
returns the independent dimensions and the accepted queue.

Each execution response also identifies the owning user event and exposes persisted failure
details (`message`, and provider `code`/`data` when supplied) and turn timings. Diagnostics belong
to an attempt, so a newly active turn never inherits a previous turn's failure. Conversation
grouping uses attempt and parent identities to keep output and errors beside their owning
input even when several inputs were accepted before the active turn completed.

Timings use a monotonic clock. `preparationMs` measures execution start to provider dispatch;
`acceptanceMs`, `firstOutputMs` and `completionMs` measure elapsed time from that dispatch.
First output includes text, thoughts, tool calls, delegated activity and terminal output.
An unobserved phase stays absent: v1 does not report v2 acceptance, and rejected prompts may
have no output. Timings and structured errors are saved in correlated status rows, while the
operation retains its failure message. Independent API reads restore them after reconnect.

## Acceptance and execution

1. Validate the session and resolve attachments before accepting a message.
2. Commit the user row, operation and turn attempt in one SQLite transaction.
3. Publish only after commit and return the accepted event ID immediately.
4. Dispatch queued messages in server order, with one active turn per conversation.
5. Record completion, cancellation or failure separately from acceptance.

Commands use short per-session lanes. A provider turn does not occupy the command lane.
Approvals and Stop bypass it so they can release the active turn. Configuration, persona,
history and handoff commands coordinate at the public facade; internal dependencies avoid
recursively acquiring the same lane. User reconnect, approval-policy changes and workspace commands also pass through the coordinator.
Archive, delete and finalization suspend dispatch, cancel outstanding messages, close the runtime,
and wait for the active dispatch to settle before changing the workspace. Failed retirement
releases the suspension; a successful delete remains closed to acceptance until its row is removed.
The legacy input entry point acknowledges durable acceptance, just like `startInput`.
Short configuration RPCs have deadlines. Waiting for
the final ACP v2 turn notification has no fixed one-minute timeout.

The browser keeps an outbox until the server acknowledges a send. Accepted prompts belong
to the server and keep executing with the browser closed. Queue reorder, cancellation and
resume use server commands. Legacy acceptance receipts remain valid across this migration.

## Recovery

The application currently assumes **one owning server process per database**. Startup retires
its previous runtime bindings. Unsent operations can resume. Operations interrupted while
running have unknown delivery and block later messages until the user resolves the uncertainty.
A failed queue can be resumed explicitly. Unknown delivery is never automatically resent:
ACP cannot guarantee that the provider did not execute a request before the connection broke.

Runtime identity checks prevent callbacks from an old connection from changing a replacement
runtime's state. Attempt updates also preserve cancellation and unknown outcomes. Provider
permission choices retain their ACP meaning; this architecture adds no provider-name mapping.
Initializing runtimes own their callbacks but become queryable only after binding succeeds.
Shutdown revokes callbacks and releases request waiters before I/O, shares one close operation,
and attempts all cleanup even after failure. Registry cleanup removes only its captured runtime.

## Repository boundary

The registry owns a `RepositoryService` alongside the legacy Git snapshot service. The
repository service selects a backend, exposes supported capabilities, and issues opaque
revision references scoped to a backend, repository, and project subdirectory. Review clients
use these references without interpreting commit IDs, hash lengths, or Git trees. Git is the
first versioned backend; ordinary folders report that review/checkpoints/restore are unavailable.
Turn capture, rewind, workspace allocation/lifecycle and integration now use the selected backend.
New persisted checkpoints and discard recovery values are opaque; historical field names and
Git values remain explicit compatibility paths. See
[Workspace workflow ownership](../../../../docs/workspace-architecture.md) and
[Repository architecture](../../../../docs/repository-architecture.md) for the implemented boundary, retained Git compatibility and backend extension scope.

## Read models and reconnect

Conversation rows are mutable read models. `session_event_changes` holds immutable, monotonically
increasing cursor entries pointing to those rows. It is a change journal, not a full event-sourced
history of every previous body. Body, metadata, token accounting and cursor changes commit together.
The journal retains 10,000 entries per session; older clients receive a fresh bounded snapshot.

`session_event_change_counts` stores the retained row count per session. Migration-owned SQLite
AFTER INSERT/DELETE triggers maintain it in the same transaction as the journal, including direct
writes, rollback and session cascades. Repository writes prune only the excess oldest entries via
the session/sequence index; below the limit, the selection reads zero journal entries. Counts live
in the database so independent repositories/connections and restarts share the same state. Use
versioned migrations for this invariant; a migration rebuilding the journal must recreate its
custom triggers. Migration regressions verify backfill against the actual upgraded journal.

A snapshot and its cursor are read from the same transaction. Corrections to an older message
or tool row receive a new cursor, so reconnects can discover them. Legacy row-ID replay remains
supported. Streaming deltas are transient; persisted full rows and live full snapshots restore
content after reconnect. Message IDs survive projector recreation; a bounded in-memory cache
falls back to persisted identity. ACP v2 explicit null clearing remains distinct from omission.

## Runtime responsibilities

`SessionRuntime` owns the connection and its lifecycle. `SessionTurnExecutor` prepares and
executes one turn, captures usage and finalizes its output. `SessionPermissionController`
evaluates policy, records grants and coordinates permission choices. Request cancellation
uses the SDK request signal in both ACP adapters. Request-scoped elicitations are correlated
with the exact outstanding client request; unsupported or stale scopes are declined.
Form validation runs before settling a request, so an invalid submission can be corrected.
Duplicate pending elicitation IDs are rejected; at most 100 requests may remain outstanding
and 200 settled items are retained. Failed publication releases the request waiter.
Legacy ACP `models` capabilities use `session/set_model`; categorized configuration options
use `session/set_config_option`. Selection follows the advertised protocol surface without
provider-name mappings.

## Skill context delivery

AgentCtl sends its skills catalog on the first prompt to a native provider session and
again when the catalog changes. Delivery receipts are persisted in `session_skill_catalogs`,
scoped by local session, provider, and native session ID, so reconnecting to a restored
conversation does not repeat the unchanged catalog. Fresh sessions always receive it.
Explicit skill activation includes the current instructions on every requested invocation.
Conversation transcripts and other per-message context are independent of catalog delivery.

A reported completed compaction invalidates the catalog receipt. The next prompt refreshes
it; compaction during a prompt prevents that prompt from marking the catalog as retained.
Resume reconciles the latest replayed compaction, ignoring older replayed completions.
Providers that compact without reporting it cannot be detected by AgentCtl. Rejected or
uncertain sends do not establish a new receipt; a returned foreground failure still means
the prompt was accepted into the provider conversation.

## Validation

Regression tests cover transaction rollback, message receipt reuse, ordered and independent
session dispatch, restart uncertainty, queue mutations, old-message corrections, metadata
preservation, request cancellation, migration upgrades and SSE catch-up. Use the workspace
Vitest configuration; localhost and subprocess fixtures require a runtime that permits them.
Streaming flushes wait for in-flight persistence; background errors are logged and retain
pending content for retry. Explicit flush failures remain visible to shutdown callers.

The [final acceptance record](../../../../docs/architecture-migration.md#cp15--repository-wide-acceptance-and-migration-closure)
identifies the verified revision and full gate. Source integration changes are listed in the
[architecture release notes](../../../../docs/releases/architecture-migration.md); HTTP and persisted
record compatibility remain covered separately from source export changes.
