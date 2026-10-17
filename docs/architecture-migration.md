# AgentCtl architecture migration tracker

This records the completed architecture migration across AgentCtl.
The design rules live in [Code architecture](code-architecture.md); repository semantics live
in [Repository architecture](repository-architecture.md). This tracker defines the work,
order, acceptance criteria, and evidence needed to declare the migration complete.

## Status and completion rules

Baseline: **2026-10-16**. **16 of 16 checkpoints are complete locally; none remain open.**
This is a checkpoint count, not an estimate of engineering effort. Implementation through CP03
is committed as `e1fc843`; subsequent completed checkpoints are recorded in descriptive
implementation commits. No merge or release is implied.

- **Done:** every checkbox in that checkpoint is checked, required verification passed, and
  evidence is recorded. Existing suitable architecture can be accepted after review and
  verification; a file does not need rewriting to count as reviewed.
- **In progress:** work has started but at least one acceptance criterion is open.
- **Planned:** criteria are defined, but implementation or acceptance review is outstanding.
- **Blocked:** name the missing decision/dependency and the next action. It still counts as open.

Update this file in the same change that completes a criterion. Record changed/accepted paths,
verification commands and results, and a commit/PR when available. Do not mark a whole checkpoint
Done because only its largest file was split. Changes to scope must be explicit here, with a
reason; unresolved work cannot be renamed an exception to reach 100%.

**100% means CP00 through CP15 are Done, every coverage row below is accepted, the frontend
cycle baseline is empty, temporary migration shims are resolved, and the final verification
gate passes against the exact accepted revision.** It does not mean the application is bug-free.

## Checkpoint dashboard

| ID   | Checkpoint                                                    | Status | Depends on             |
| ---- | ------------------------------------------------------------- | ------ | ---------------------- |
| CP00 | Scope, coverage, and acceptance baseline                      | Done   | —                      |
| CP01 | Initial boundaries and maintainability foundation             | Done   | CP00                   |
| CP02 | Remaining server workflows and transport boundaries           | Done   | CP01                   |
| CP03 | Session execution, persistence, and runtime ownership         | Done   | CP02                   |
| CP04 | Git capability and forge separation                           | Done   | CP01                   |
| CP05 | Repository-neutral session workspace and checkpoint workflows | Done   | CP03, CP04             |
| CP06 | Provider lifecycle and agent protocol composition             | Done   | CP03                   |
| CP07 | Remaining core domains and infrastructure ownership           | Done   | CP03, CP06             |
| CP08 | Composer, review, and session dependency cycles               | Done   | CP01                   |
| CP09 | Conversation and subagent dependency cycle                    | Done   | CP01                   |
| CP10 | Complete frontend state, effects, and rendering audit         | Done   | CP02, CP08, CP09       |
| CP11 | Shared contracts, client APIs, and public exports             | Done   | CP05, CP06, CP07, CP10 |
| CP12 | Desktop lifecycle, server ownership, and IPC                  | Done   | CP02, CP03, CP06       |
| CP13 | Design system and UI ownership                                | Done   | CP10                   |
| CP14 | Complete architecture enforcement and delivery tooling        | Done   | CP07, CP11, CP12, CP13 |
| CP15 | Repository-wide acceptance and migration closure              | Done   | CP00–CP14              |

Recommended execution order: CP02 → CP03 → CP04 → CP05 → CP06 → CP07 → CP08 → CP09 →
CP10 → CP11 → CP12 → CP13 → CP14 → CP15. Each checkpoint may use multiple reviewable
changes; keep a complete workflow working between changes.

## Coverage ledger

A checkpoint is responsible for every source file and its relevant tests/configuration under
its listed area, including files absent from the hotspot list. New files must be added explicitly to their owning
file ledger with acceptance evidence; automated checks reject missing assignments. Add a coverage row before introducing a new package or product domain.
Acceptance is recorded at the checkpoint that closes the area. Every row is accepted after
the full audit; later additions require ownership and evidence rather than inheriting an unreviewed completion claim.

| Area                                                                                                       | Owning checkpoint(s) | Acceptance |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | ---------- |
| Server routes, routers, services, events, authentication, terminals, and app composition                   | CP02, CP12           | Accepted   |
| Core session commands, execution, requests, projection, persistence, runtime, and services                 | CP03, CP05           | Accepted   |
| Core repository-neutral workspace lifecycle and handoff context                                            | CP05                 | Accepted   |
| Core Git, repository, and forge modules                                                                    | CP04, CP05           | Accepted   |
| Core providers, agent contracts/diagnostics, ACP v1/v2, transport, cache, and extensions                   | CP06                 | Accepted   |
| Core security, auth, MCP, context, skills, config, database, logger, and root factories                    | CP07                 | Accepted   |
| Web composer, review, and session features                                                                 | CP08, CP10           | Accepted   |
| Web conversation and subagent features                                                                     | CP09, CP10           | Accepted   |
| Web projects, providers, settings, workbench, updates, command palette, and retained feature directories   | CP10                 | Accepted   |
| Web app/shell/routes, shared capabilities, performance lab, and test utilities                             | CP10, CP14           | Accepted   |
| Shared schemas, contracts, types, policies, utilities, and environment definitions                         | CP11                 | Accepted   |
| API-client services, HTTP errors/configuration, SSE engine, and query integration                          | CP11                 | Accepted   |
| Electron main process, embedded server, windows/tray, updates, preload, and IPC contracts                  | CP12                 | Accepted   |
| UI components, primitives, patterns, foundations, exports, and app UI adapters                             | CP13                 | Accepted   |
| TS configuration package, root workspace configuration, package manifests, patches, and build/test tooling | CP14                 | Accepted   |
| CI/release workflows, hooks, scripts, browser/performance tooling, and architecture checks                 | CP14                 | Accepted   |
| Architecture docs, migration notes, compatibility decisions, and release communication                     | CP15                 | Accepted   |

Generated bundles, dependency installations, local databases/credentials, downloaded binaries,
and personal tool directories are outside the source migration. Their application ownership
and configuration are still reviewed where relevant. Existing historical SQL migration files
are retained; schema changes use new migrations with upgrade tests.

## CP00 — Scope, coverage, and acceptance baseline

- [x] Enumerate all application/package areas, tooling, and documentation in the coverage ledger.
- [x] Define checkpoint statuses, prerequisites, evidence, and a strict final completion gate.
- [x] Separate the source architecture migration from new product capabilities and distributed execution.

Evidence: this tracker, the current source-directory inventory, and links from README and the
design guide. This is planning completion; it does not accept unreviewed code in the ledger.

## CP01 — Initial boundaries and maintainability foundation

- [x] Introduce backend-neutral repository/revision contracts with Git and directory adapters;
      preserve legacy Git review access while the new review path uses opaque references.
- [x] Separate repository selection, opened-handle operations, identity encoding, and errors;
      compose default adapters explicitly and add a repository dependency boundary test.
- [x] Split repository/Git HTTP contracts and routers; separate project query, directory, and
      open/create workflows, native-session import, and session-aware Git command services.
- [x] Move SSE transport to the API client, split client helpers by capability, and replace
      import-time database creation with explicit startup initialization.
- [x] Extract GitHub CLI operations behind a forge contract; retain Git locking/preflight ownership.
- [x] Split session configuration, stream composition, message outbox, and status effects;
      give reusable markdown and workspace navigation their own shared owners.
- [x] Add package/server checks, parsed frontend dependency/cycle checks, and documented design rules.

Evidence: [code organization and validation](code-architecture.md),
[repository boundary](repository-architecture.md), and the current local implementation.
Last implementation verification: 1,429 Vitest tests across 237 files; four architecture
regression tests; all-workspace typechecks, lint, formatting, builds, and production browser
journeys passed. These are historical results for CP01, not final-migration acceptance.

## CP02 — Remaining server workflows and transport boundaries

Starting points: `apps/server/src/plugins/ts-rest/`, `routes/`, `services/session-service.ts`,
`services/terminal-service.ts`, `utils/`, and `app.ts`.

- [x] Audit every endpoint and event channel; map it to an owning workflow, query, transport,
      or application composition responsibility, including auth, context, attachments, search,
      diagnostics, settings, providers, MCP, terminal/WebSocket, SSE/history, and turn indexes.
- [x] Extract remaining product workflows from handlers. Keep HTTP validation/response mapping,
      streaming backpressure, socket handling, and connection teardown in transport adapters.
- [x] Separate session-detail query assembly from explicitly named recovery/reconciliation;
      preserve workspace restoration and metadata repair until callers migrate deliberately.
- [x] Reduce `SessionService` to intended coordination/delegation; workflows own their own
      narrow dependencies, transaction boundaries, and publish-after-commit behavior.
- [x] Centralize service construction/lifetimes in server composition and consistently translate
      reusable domain errors at the server boundary. Extend thin-handler checks to migrated routes.

Exit evidence: endpoint-to-owner map and accepted file list; affected route/service tests for
success, missing resources, failures, cancellation, replay, and teardown; stable HTTP/event
contracts or an explicitly documented compatibility migration. Checkpoint verification passes.

Acceptance evidence (2026-10-16): [server ownership audit and endpoint inventory](server-architecture.md)
covers 77 contract endpoints plus 21 directly registered routes/channels. Accepted paths include
all server routers/routes/plugins, focused application services, `composition/`, `app.ts`,
`errors/`, `utils/`, and their relevant tests. Desktop process ownership remains CP12.

Verification for CP02 and the initial CP03 composition change:

- `pnpm exec vitest run packages/core/src/session apps/server --maxWorkers=2`: 270 tests, 49 files passed.
- `pnpm exec vitest run --maxWorkers=2`: 1,434 tests, 239 files passed.
- `pnpm architecture:check`, `pnpm architecture:test` (4 tests), `pnpm typecheck`, `pnpm lint`,
  and `pnpm build`: passed, including web/desktop builds.
- Prettier checks on all changed source/docs, document-link and endpoint-inventory checks,
  and `git diff --check`: passed.

The new regression tests verify query/repair separation, failed workspace recovery,
concurrent/ordered shutdown, cleanup after failure, and suppression of background follow-up
work after shutdown. The duplicate unawaited shutdown plugin is removed. Changes are local and
uncommitted; no HTTP contract or database schema migration is introduced.

## CP03 — Session execution, persistence, and runtime ownership

Starting points: all `packages/core/src/session/`, especially `manager.ts`,
`execution/session-operation-worker.ts`, `projection/conversation-projector.ts`, and runtime registry.

- [x] Review every session submodule against its existing documented responsibility. Keep
      `SessionManager` as a deliberate facade; move default wiring and circular callback assembly
      into explicit composition where needed, without recursive command-lane acquisition.
- [x] Give acceptance, dispatch, retry/recovery, cancellation, runtime binding, and retirement
      explicit owners and typed transitions. Reuse suitable existing state machines/coordinators.
- [x] Isolate persistence transactions and projection policy from provider callbacks and I/O;
      preserve durable receipts, cursor ordering, snapshot consistency, and bounded retention.
- [x] Make permission/elicitation/terminal resource scopes and cleanup ownership explicit;
      prevent stale runtime callbacks from modifying replacement sessions.
- [x] Narrow dependencies and public exports; preserve provider-independent agent contracts.

Accepted (2026-10-16): the [session ownership audit](session-architecture.md) records all
35 production modules, their dependency map, transition owners, resource lifetimes and public
exports. Concrete resources/default selection and workflow callbacks have explicit composition
owners. Atomic queue acceptance/claim/recovery and history reconciliation have persistence
owners. Internal services consume narrowed capabilities; runtime/projector/request internals
are no longer wildcard package exports, and architecture checks enforce the session boundaries.

Runtime identity now fences detached and replacement callbacks, including projection after
asynchronous reads. Initializing runtimes remain hidden until binding completes. Shutdown
releases request waiters before I/O, shares one close operation, attempts every cleanup step,
removes only captured owners, and awaits dispatch settlement. Elicitations have bounded settled
retention, a pending limit and duplicate-ID protection. Streaming flushes serialize writes,
await in-flight persistence, report failures and retain pending content for retry. Binding and
initialized persona persistence commit together. Thirteen new regressions cover these ownership,
cleanup, capacity, ordering and rollback cases; the legacy startup fixture now models synchronous
transaction execution correctly.

Verification:

- `pnpm exec vitest run --maxWorkers=2`: **1,447 tests across 241 files passed**.
- `pnpm exec vitest run packages/core/src/session --maxWorkers=2`: **163 tests across 24 files passed**
  after the final projection ownership changes. The full suite above includes the binding
  regression, protocol boundary checks and all server integration tests.
- `pnpm architecture:test`: four regression tests passed. `pnpm typecheck` passed all workspace
  typechecks and package/server/frontend architecture checks.
- `pnpm lint`, `pnpm build` (including web/desktop), Prettier checks for changed/new files and
  `git diff --check` passed.

No HTTP contract or database schema changes were introduced. Work remains local and uncommitted.
One server owner per database remains explicit. Git workspace/checkpoint substitution belongs
to CP05; broader provider/ACP lifecycle composition belongs to CP06, with their existing scope
and acceptance criteria unchanged.

Exit evidence: accepted session responsibility/dependency map; tests for duplicate acceptance,
ordered dispatch, unknown delivery, restart recovery, Stop/approval bypass, projector rollback,
reconnect/catch-up, stale bindings, and cleanup. One server owner per database remains explicit.

## CP04 — Git capability and forge separation

Starting points: `packages/core/src/git/worktree-manager.ts`, snapshot service and helpers,
`packages/core/src/forge/`, and their callers.

- [x] Separate worktree allocation/restoration/retirement, working-copy/staging operations,
      branch/integration operations, and remote/tracking operations into focused capabilities.
- [x] Keep snapshot capture/retention and immutable comparisons owned separately; retain literal
      path safety, user staging, recoverable restore, and narrow critical sections.
- [x] Complete the forge boundary: Git workflows depend on an explicit forge capability for
      forge-specific remote interpretation and PR operations. Unavailable/unsupported hosts are explicit.
- [x] Preserve one owner for each Git lock and resource lifetime; extracted adapters do not
      reacquire a lock already held by their caller or duplicate connection/cache state.
- [x] Migrate callers to focused contracts. Any retained manager facade delegates; it does not
      continue owning all implementations under new filenames.

Implementation evidence: [Git capability and lock ownership audit](git-architecture.md),
covering all 34 production Git, forge, and repository modules. `WorkspaceManager` now delegates
to the capabilities built in `git/composition.ts`; server Git/project callers consume structural
operation ports. Immutable comparison has its own owner, and only composition selects the
concrete forge. The repository-neutral session workflow dependency is deliberately CP05.

Verification accepted 2026-10-16: `pnpm exec vitest run --maxWorkers=2` passed **1,454 tests
across 241 files**. The focused Git/repository/server suite passed **177 tests across 15 files**.
`pnpm typecheck`, `pnpm lint`, `pnpm architecture:test` (4 tests), `pnpm build`, formatting,
and whitespace checks passed. The module inventory covers all 34 production files, and a
read-only extraction comparison confirmed 36 Git method bodies retain their prior implementation
after dependency rewiring. Seven new regression cases cover the new ownership boundaries.

Exit evidence: Git capability dependency map; adapter tests and current Git safety regressions
cover staging preservation, worktree retention, dirty/conflicting integration, nested projects,
remote failure, PR fallback, and lock ordering. GitHub can remain the only implemented forge.

## CP05 — Repository-neutral session workspace and checkpoint workflows

Starting points: `git/session-workspace.ts`, session history/lifecycle/execution services,
repository contracts, persisted snapshot fields, review/restore APIs, and consumers.

- [x] Model workspace allocation/lifecycle and integration as capability-specific contracts;
      session orchestration consumes these contracts rather than concrete Git classes.
- [x] Route turn capture, checkpoint comparison, rewind, undo/restore, archive/reactivate,
      finalization, and teardown through the correct repository/workspace capability.
- [x] Write opaque revision references for new persisted checkpoints. Preserve reads and
      recoverability for historical Git snapshot/baseline fields with explicit compatibility logic.
- [x] Keep staging, branch names, remotes, and PR operations optional and Git/forge-specific;
      unsupported folder/backend workflows are explicit in APIs and UI.
- [x] Verify the neutral workflow boundary with a non-Git test adapter, not just fake hash
      strings. Keep identity/scope/retention semantics consistent across reopen and restoration.

Implementation evidence: [workspace workflow-to-capability and persistence audit](workspace-architecture.md).
All 41 production Git/forge/repository/workspace modules and 36 session modules have an owner.
The non-Git file-backed adapter exercises real allocation, capture, restore, rewind/undo,
archive/reactivation, discard/recovery, integration and teardown with named Unicode revisions;
composition also accepts a supplied backend catalog without a Git workspace manager.

New checkpoints/baselines and discard recovery values are opaque. Historical Git selectors and
JSON backups have explicit adapter imports; populated SQLite reopen/restore coverage preserves
files, staging and original allocation commits. Existing text columns and wire field names remain;
no SQL migration is needed. Unsupported directory workflows and restore previews are explicit.
Handoff workspace context uses backend review capabilities and cannot invent clean Git state.

Verification accepted 2026-10-16: `pnpm exec vitest run --maxWorkers=2` passed **1,467 tests
across 243 files**. The combined session/Git/repository/HTTP/UI suite passed 348 tests/41 files;
follow-up handoff/allocation/reconciliation checks passed 55/5. `pnpm typecheck`, `pnpm lint`,
`pnpm architecture:check`, `pnpm architecture:test` (4 tests), `pnpm build`, changed-file formatting,
and whitespace checks passed. The full suite includes populated-database migration regressions.
Thirteen new regression cases cover neutral workflows, historical recovery, and restore UI states.

Exit evidence: workflow-to-capability matrix, persistence/compatibility decision, legacy database
upgrade coverage if schema changes, and complete capture/rewind/workspace integration tests.
A production second VCS or native history for ordinary folders is not required for this checkpoint.

## CP06 — Provider lifecycle and agent protocol composition

Starting points: `packages/core/src/providers/`, `agent/`, `acp/`, `default-agent-driver.ts`,
and `agent/runtime-services.ts`.

- [x] Separate registry queries/profiles, discovery/probing, installation/update operations,
      credentials/authentication interactions, and native-session controls behind clear owners.
- [x] Review large registry, auth, installer, and installation service files for independent
      policies, I/O adapters, operation state, and cleanup. Keep registry behavior behind a focused facade.
- [x] Move concrete default resource construction into explicit factories; agent-facing contracts
      stay independent of ACP wire types and provider-name conditionals.
- [x] Audit v1/v2 drivers, protocol reducers, extensions, transport leases, caches, diagnostics,
      and bounded queues; retain sound existing separation with recorded acceptance where no change is needed.
- [x] Use explicit operation states and cancellation/credential lifetimes; define who owns
      shared connections and shutdown so one operation cannot retire another's resources.

Exit evidence: provider/agent ownership map; protocol SDK boundary checks; authentication,
installation recovery, cancellation, version negotiation, session/control, retention-limit,
and stale-lease regressions. Local SDK peers suffice; live paid-provider calls are not required.

Acceptance (2026-10-17): [provider and agent ownership map](provider-architecture.md) covers
all provider/agent/ACP production modules, including retained protocol owners. Registry queries,
profiles/configuration, readiness/native listing, startup recovery and update policy now have
separate owners. Runtime construction moved to a root factory; application connection contracts
are protocol-neutral and diagnostics are scoped to the runtime. Authentication shares attempt
lifetimes, guards cancelled verification, and retains the credential lane until adapter cleanup.
Registry shutdown closes admission, drains queued operations and awaits final connection cleanup.
Archive validation/extraction has its own adapter. Existing candidate transaction, v1/v2 reducers,
generation leases, bounded caches/queues and diagnostics were reviewed and retained.

Verification: provider/agent/ACP suite **367 tests / 58 files**; final connection disposal
regression suite **6 tests / 1 file**; workspace `pnpm typecheck`, `pnpm lint`, parsed architecture
checks and all four architecture regression tests passed. Full workspace verification is recorded
with the remaining-core acceptance below. Local subprocess/SDK peers only.

## CP07 — Remaining core domains and infrastructure ownership

Scope: `security/`, `auth/`, `mcp/`, `context/`, `skills/`, `config/`, `db/`, logging, and
root composition files under `packages/core/src`.

- [x] Assign and review the public entry, policy, application operations, I/O, and resource
      lifetime in every remaining core domain. Record accepted modules as well as refactored ones.
- [x] Keep credentials/vault and pairing/auth policy behind clear contracts; separate configuration
      resolution from secret storage and transport without duplicating sensitive data ownership.
- [x] Separate MCP gateway connection/routing/lifecycle, context filesystem/search access, and
      skill discovery/catalog/delivery responsibilities where currently mixed.
- [x] Audit database schema/codecs/migration/factory/transaction responsibilities; imports remain
      inert and transaction types are explicit where needed. Preserve upgrade and rollback semantics.
- [x] Remove unintended default instances, environment mutation, and process/resource creation
      outside declared composition/startup paths; retain documented immutable constants/caches only.

Exit evidence: full remaining-core acceptance ledger; appropriate auth/vault, MCP shutdown,
context path handling, skills delivery, configuration, and populated-database upgrade tests.
No unassigned core files remain for the final audit.

Acceptance (2026-10-17): [remaining-core ownership audit](core-infrastructure-architecture.md)
records the public entry, policy, I/O, persistence and resource lifetime for every scoped domain,
including retained modules. The [core ownership ledger](core-ownership.json) assigns all **214
production core files and bundled skill assets** across 16 areas, including earlier accepted
session/repository/provider/ACP owners. Architecture checks reject missing, duplicate or stale
assignments and require linked acceptance evidence.

MCP routing, SDK connection construction and persistent/temporary lifecycle ownership are
separate; shutdown drains handshakes/requests and stale callbacks cannot retire replacements.
Context search/index policy delegates canonical path and bounded UTF-8 file access and Git
queries. Skill parsing/discovery/install I/O is separate from catalog/activation/delivery, with
bounded completed installation receipts and retryable failed copies. Pairing policy delegates
browser-session persistence. CredentialStore is injected through runtime composition; the vault
is lazy and copy-on-write, and explicit startup migration persists secrets before transactionally
publishing database references. Failed migration rolls back and retries. Background provider
work is included in shutdown draining; cancellation aborts registry fetches without false stored
sync failures or startup error logs. Workspace transaction parameters are typed. Existing database
schema/codecs/factory/upgrade/savepoint behavior and immutable configuration/logging owners were
reviewed and retained; no historical SQL or schema change was required.

Verification on the final fixed source tree: **1,489 tests / 248 files**, plus **5 architecture
regression tests**; workspace `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check`, formatting,
whitespace checks and `pnpm build` all passed. Focused remaining-core/provider tests passed **143
tests / 23 files**; final fetch/shutdown regressions passed **4 tests / 2 files**. The full suite
includes populated database upgrade/rollback, session skill delivery, auth/vault/configuration,
context, MCP local SDK peers, protocol and server integration coverage. No paid-provider run.

## CP08 — Composer, review, and session dependency cycles

Baseline edges in `apps/web/architecture-cycles.json`: composer → review, composer → sessions,
review → composer, review → sessions, sessions → composer, sessions → review.

- [x] Move screen-level composition such as session headers and launch/workspace review dialogs
      to the appropriate page/composition owner; expose narrow session model APIs to leaf features.
- [x] Replace review's direct composer-store access with explicit draft/context actions supplied
      through composition or a deliberately owned capability. Avoid a hidden global event bus.
- [x] Give Git status/editor presentation and workspace state a suitable owner so session models
      do not depend back on review or composer UI.
- [x] Remove all six listed cycle exceptions; verify that no indirect replacement cycle exists.
- [x] Preserve drafts, comment/context insertion, provider configuration, queued sends, review
      captures, and session navigation behavior and update-isolation characteristics.

Exit evidence: dependency graph diff, six deleted baseline entries, relevant component/hook tests,
and production browser journeys covering the composed session screen.

Acceptance (2026-10-17): [frontend composition audit](frontend-architecture.md) and the
[parsed feature graph](frontend-feature-graph.json) record the resulting owners. Header/title/
lifecycle dialogs and quick launch moved above features into app/session composition. Composer
and review consume typed session workspace/configuration capabilities. Git status and editor
presentation have shared owners with no feature dependency. Page-supplied draft actions flow
through Workbench/ReviewView/file/diff rendering; review no longer selects the composer store.
All six listed cyclic edges are removed; the only remaining cycle is conversation/subagents.
Relative shared-barrel imports cannot conceal application/feature dependencies.

Verification: **239 tests / 36 focused files**, plus **7 tests / 1 file** after the injected-action
regression; all five architecture regressions, workspace typechecks, lint, formatting/whitespace
and the web production build passed. Production browser fixture navigation/deferred-asset checks
and draft restoration, context attachment, hunk quotation and launch-dialog cancellation passed
(`/tmp/agentctl-screen-browser.json`). These are synthetic browser journeys, not live-provider or
native Electron checks. Full workspace/build verification follows the conversation acceptance.

## CP09 — Conversation and subagent dependency cycle

Baseline edges: conversation → subagents and subagents → conversation.

- [x] Define ownership for reusable read-only transcript, activity, approval presentation, and
      terminal rendering without moving parent-session control into child views.
- [x] Compose parent/child views above their independent models or expose deliberately one-way
      rendering contracts; keep child identity/grouping and retained state owned explicitly.
- [x] Remove both cycle exceptions and verify the feature graph is acyclic with an empty baseline
      after CP08. Include re-export, type-only, and lazy-import edges.
- [x] Preserve child navigation, live streaming, tool grouping, parent approval handling,
      cancellation, and retained-child cleanup.

Exit evidence: rendering/interaction ownership map, empty cycle baseline, subagent/conversation
regressions, and a browser fixture journey through parent/child views.

Acceptance (2026-10-17): the [frontend ownership map](frontend-architecture.md) assigns
shared transcript/activity/tool/approval presentation, directed messages and bounded terminal
history to `shared/transcript`. Parent connected wrappers retain session/turn/settings policy;
conversation supplies child preferences through an explicit composition wrapper. Subagents
consume supplied groups, child status and navigation/review callbacks without parent session
contexts or approval/cancellation APIs. The parent feed/composer, session-scoped selection,
focus restoration and history transitions keep their existing owners.

Both cycle exceptions are deleted. The [parsed graph](frontend-feature-graph.json) has zero
cycles and an empty baseline; the checker rejects adding exceptions or hiding reverse imports
through shared barrels. Conversation depends on subagents in one direction only. Compatibility display exports retained at this acceptance are removed by CP11.

Verification: **135 tests / 21 focused files** include live updates/tool grouping, parent approval
routing, cancellation/history transitions, selection scope, focus/follower cleanup, bounded
terminal replacement/exit behavior and a child render without parent providers. The production
browser fixture passed child/sibling navigation, terminal output, exact parent feed/composer node
retention, draft preservation, Escape return and session-scoped selection restoration, alongside
all session/review/deferred-asset journeys (`/tmp/agentctl-transcript-browser.json`). These use
synthetic APIs with no paid provider or native Electron lifecycle claim. The final source tree passed **1,491 tests / 249 files** with
`pnpm exec vitest run --maxWorkers=2`, all **5 architecture regression tests**, **9 performance
checker tests**, workspace `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check`, formatting
and whitespace checks. `pnpm build` passed; desktop was also rebuilt directly with
`pnpm --filter @agentctl/desktop build` to avoid the external-input cache issue recorded in CP14.
The CI built-desktop-renderer markdown worker smoke passed against that fresh output
(`/tmp/agentctl-frontend-desktop-worker.json`).

## CP10 — Complete frontend state, effects, and rendering audit

Scope: every web feature plus app/shell/routes/shared, including projects, providers, settings,
workbench/terminals, updates, command palette, retained empty directories, and performance/test helpers.

- [x] Audit every feature and composition entry. Split remaining mixed responsibilities in
      `MainFeed`, `EventFeed`, `ReviewGitActions`, `useComposerState`, terminal panes, provider auth UI,
      and shell/dialog orchestration where justified by ownership rather than line count.
- [x] Keep remote data in React Query, client UI/drafts in deliberately owned stores, and accepted
      queue/execution state on the server. Extract pure derived policy from effects and rendering.
- [x] Give networking, subscriptions, keyboard/window listeners, timers, workers, and terminal
      resources explicit owners and cleanup. Preserve high-frequency streaming update isolation.
- [x] Consolidate duplicated query keys/invalidation/error handling where they express the same
      behavior; split broad contexts/hooks only along meaningful capabilities.
- [x] Review shared modules for real reuse and app-independent direction; keep route composition
      out of leaf features and avoid introducing new generic store/helper dumping grounds.

Exit evidence: acceptance record for every web area in the ledger; targeted interaction and
cleanup tests; empty cycle baseline; production navigation/deferred-worker checks and existing
performance safeguards without unsupported performance claims.

Acceptance (2026-10-17): [frontend state/effects audit](frontend-state-architecture.md)
and [web ownership ledger](web-ownership.json) cover all **275 current non-test files across 29
owners**. History/handoff/viewport, Git operation state, draft/file interactions, terminal
resources and workspace drop resolution have separate owners. Query identities are centralized.
Cancelled focus/copy/layout work, native update snapshot ordering and stale auth callbacks have
explicit lifetimes. Image upload cancellation follows attachment/session ownership. The final
contracts cleanup removes temporary aliases and gives app query/navigation policy explicit owners.

Verification: initial frontend suite **507 tests / 94 files** and final upload suite **8 tests /
2 files** passed; the final combined acceptance below verifies all changes together. The graph is
acyclic with no exceptions. Production architecture journeys retain drafts, composer/feed nodes,
review actions, child/sibling navigation and selection scope. All six performance safeguard suites
pass, including queue/turn subscriber isolation and startup asset budgets; timings remain trends.
Implementation is committed as `148ef06`; follow-up API integration is in the contracts commit.

## CP11 — Shared contracts, client APIs, and public exports

Scope: all shared and API-client source, all package/feature public entries, and their consumers.

- [x] Review large session/event/registry schema and contract files; group them by stable
      capability and infer types from schemas without circular re-exports or duplicate transport shapes.
- [x] Verify shared owns portable contracts/policies only, client owns HTTP/SSE, and application
      defaults, error normalization, and state policy have one intended source of truth.
- [x] Audit HTTP configuration/errors/authorization, abort propagation, SSE parsing/reconnect,
      query integration, and all capability helper modules. Preserve their public behavior.
- [x] Narrow public package/feature exports and eliminate cross-module internal imports. Classify
      compatibility barrels individually: migrate/remove temporary shims, or document/test an intentional
      permanent public alias and remove its migration/deprecation status.
- [x] Reconcile source-level API changes, historical database/protocol compatibility, and published
      package surfaces with explicit migration notes. No unknown internal consumers remain.

Exit evidence: accepted public API/dependency map, client/contract compatibility and cancellation
regressions, and a resolved list for every temporary shim/legacy entry in this migration.

Acceptance (2026-10-17): [contracts/public API audit](contracts-architecture.md),
[80-file contract/client ledger](contracts-ownership.json) and [public entries](public-api.json)
record schema capability leaves, inferred helper results, one HTTP policy, app-owned query/
navigation policy, shared SSE framing and independent state streaming. Temporary ACP/frontend/
client aliases are removed; permanent Git constructors and DTO/schema aliases are documented and
tested. All **77 typed HTTP methods/paths/status sets** and established shared runtime exports
are preserved. Historical database/revision decoding and ACP v1/v2 wire behavior remain covered.

Final combined acceptance on unchanged source fingerprints: **1,511 tests / 259 files** with
`pnpm exec vitest run --maxWorkers=2`, **6 architecture regressions** with `pnpm architecture:test`,
and **9 budget-checker regressions** within the six performance suites. Workspace `pnpm typecheck`
(**12/12**), `pnpm lint`, `pnpm architecture:check`, formatting and whitespace checks passed.
`pnpm build` (**7/7**), direct `pnpm --filter @agentctl/desktop build`, and
`pnpm --filter @agentctl/web perf:build` passed. The direct desktop build avoids the external-input
cache issue assigned to CP14.

Production verification passed with:

- `node apps/web/scripts/performance-browser.mjs /tmp/agentctl-migration-browser-final.json --journeys --verify-deferred --architecture-journeys`
- `AGENTCTL_PERF_DIST=apps/desktop/out/renderer node apps/web/scripts/performance-browser.mjs /tmp/agentctl-migration-desktop-worker-final.json --production --worker-smoke`
- `node apps/web/scripts/performance-check.mjs /tmp/agentctl-migration-performance-final`

All six performance suites passed: budget tests, both workers, component workloads, session stream
and navigation. Local Git/database/server/ACP peers are included in the full suite; synthetic
browser fixtures do not claim paid-provider or native Electron lifecycle acceptance. Dependency
reconciliation completed with the frozen lockfile and package policy checks enabled.

## CP12 — Desktop lifecycle, server ownership, and IPC

Scope: all `apps/desktop` main/preload/shared code and packaging configuration, plus relevant
server start/stop APIs and browser desktop integration.

- [x] Audit native lifecycle, server process start/restart/stop, windows, tray, deep links,
      window controls, and updater ownership. Confirm suitable existing separation where present.
- [x] Keep startup/shutdown construction explicit and idempotent; await owned resources and
      propagate startup failure without duplicate server/process ownership.
- [x] Keep preload capabilities and IPC contracts narrow, validated, and independent of renderer
      internals; ensure listener cleanup and unavailable-native-feature behavior are explicit.
- [x] Verify browser and desktop modes share product workflows while native integration stays
      behind its declared boundary; review packaging/build paths as part of acceptance.

Exit evidence: desktop ownership map, process/lifecycle and IPC tests, web/desktop builds,
built-renderer worker smoke, and native lifecycle smoke on the available supported environment.
Unavailable platform checks remain explicitly open or use a named verified CI job; a browser
fixture alone cannot close native-runtime acceptance.

Accepted 2026-10-17. [Desktop ownership and lifecycle](desktop-architecture.md) records every
native area and retained packaging boundary. `desktopRuntime` owns startup/shutdown, including
activation before readiness and cancellation during startup. The utility manager coalesces starts,
validates readiness, clears capabilities, rejects early exits, kills timed-out startup and supports
an explicit restart. IPC verifies main-window/main-frame senders; window navigation stays within
the renderer, and only approved external protocols leave the app. Update/IPC/preload listeners
have disposers. Native DTOs moved to shared contracts; the web adapter owns validated navigation.

The focused desktop/UI/navigation run passed **26 tests/11 files**. Final verification passed
**1,532 tests/267 files**, both renderer builds and the desktop Markdown worker. Real Electron
Linux x64 smoke passed on the final build and a clean-checkout build: one server, capability IPC,
HTTP readiness, deep-link delivery, listener cleanup, denied outsider IPC and server exit before
quit. The separate real utility-process startup failure opened no window and exited with status
**1**; normal startup/shutdown exited **0**. Reports: `/tmp/agentctl-final-native.json`,
`/tmp/agentctl-clean-native.json`, `/tmp/agentctl-final-desktop-worker.json`. The exact native command
was `XVFB_PATH=/tmp/agentctl-native-tools/usr/bin/Xvfb pnpm desktop:smoke <report.json>`.
macOS/Windows native checks remain explicitly open platform checks; Linux evidence does not
verify OS protocol registration, signing or a downloaded updater install.

## CP13 — Design system and UI ownership

Scope: all `packages/ui` foundations/primitives/components/patterns, exports, tests, and consuming UI adapters.

- [x] Confirm generic design-system code has no product/session/provider dependencies or hidden
      application networking/state; move any product composition to its owning app feature.
- [x] Review reusable contracts, accessibility/keyboard/focus behavior, styling/token ownership,
      and meaningful duplication across primitives/components/patterns.
- [x] Keep feature-specific UI and interaction policy local; consolidate generic components only
      when their responsibilities and behavior actually match.
- [x] Accept the existing gallery/test fixtures and public exports against the final consumers;
      record areas that already meet the conventions without unnecessary rewrites.

Exit evidence: UI acceptance list, affected accessibility/interaction tests, gallery review,
both renderer builds, and package import-boundary enforcement.

Accepted 2026-10-17. [UI acceptance inventory](ui-architecture.md) records foundations, every
primitive/component/pattern, exports and consuming adapters; the workspace ledger covers all
**63 UI area files**, including configuration and tests. Existing product-independent composition
is retained. Fixed dangling field descriptions, Select validation/selection semantics,
confirmation descriptions, consumer tab-handler composition and tooltip focus/description lifetime.
Product workflows remain in features; there is no new design framework or duplicate overlay owner.

The final public-export interaction tests and full suite passed. The explicit gallery build and
real Chrome review passed desktop/narrow containment, dialog naming, initial focus, Escape and
focus restoration. Screenshots of stress layouts, controls, surfaces and feedback were reviewed;
reports/screenshots use `/tmp/agentctl-final-gallery*`. Production journeys passed all nine
architecture interactions in `/tmp/agentctl-final-journeys.json`. Both renderer builds and all
six performance safeguard suites passed. The gallery remains outside normal production builds.

## CP14 — Complete architecture enforcement and delivery tooling

Scope: architecture scripts, root/package configuration, TS config package, all build/test/dev
and browser/performance scripts, patches, hooks, and CI/release workflows.

- [x] Enforce final package/module dependency directions across aliases, relative imports,
      re-exports, type/lazy imports, and package exports. Include server/core/desktop boundaries,
      not just the initial project router and selected modules.
- [x] Remove the need for the cycle exception mechanism or keep only an empty, tested baseline;
      ensure fixtures/tests do not accidentally introduce production exceptions.
- [x] Keep migration-coverage enforcement and boundary regression tests wired into normal CI;
      ensure every source area/file maps to an accepted ledger owner and new modules cannot be missed.
- [x] Review manifests, TS references, Turbo tasks, test fixtures, scripts/hooks, patches, and
      dev/release composition for clear ownership and repeatable clean-checkout behavior.
- [x] Run the final checks in CI/release with usable failure diagnostics and retained artifacts;
      validate import rules against deliberate violation fixtures, including relative-path bypasses.

Exit evidence: enforcement coverage matrix, regression tests, normal CI wiring, clean-checkout
verification results, and no migration-only allowlists, dead compatibility files, or unowned tooling.

Resolved the frontend acceptance cache issue: the desktop Turbo task depends on the web build (and therefore its
UI/API-client dependency builds), explicitly hashes web source/index/manifest and migration inputs, and restores copied `drizzle/` output alongside
`out/`. A reversible web source edit changed the desktop task hash; both clean and normal builds
and their native/worker smoke checks passed. The earlier direct-build workaround is no longer
needed to account for missing web inputs.

Accepted 2026-10-17. [Enforcement and tooling matrix](tooling-architecture.md) records package/module
rules, ledgers, manifests, TS references, hooks, patches and CI/release composition. Combined ledgers
cover **1,162 repository files**: **210 core**, **81 contract/client**, **276 web** production files
and **595** remaining server/native/UI/test/configuration/tooling/documentation files. New, duplicate
and stale assignments fail the root check. The empty frontend cycle baseline is enforced. Package
surfaces include server composition exports; parsed type/re-export/lazy/require imports and canonical
relative/alias targets share boundary policy. An isolated deliberate-violation repository exercises
the actual checker, including core workflow, server, UI, preload, import-time initialization,
contract cycles and missing ownership. Architecture regressions passed **11/11**.

The root test command now runs consolidated Vitest projects with two workers; focused package
scripts remain available. CI/release run native and gallery acceptance and retain diagnostics.
Local results are not presented as remote Actions executions. Dependency versions and lockfile are
unchanged. The application source was frozen for the full test run, and `pnpm test`
passed **1,532 tests/267 files** in **407.02 s**. `pnpm typecheck` passed **12/12**, `pnpm build`
**7/7**, lint/format/whitespace passed, and browser/native/worker plus all six performance suites
passed. Logs/reports use `/tmp/agentctl-final-*`.

Clean-checkout evidence: copied the tracked/non-ignored snapshot without generated outputs into
`/tmp/agentctl-clean-checkout-t8tkyu6d`, initialized an isolated Git repository and installed with
`pnpm install --frozen-lockfile --ignore-scripts --store-dir /home/youssef/.local/share/pnpm/store/v11 --package-import-method=copy`.
Copy mode reused the verified cache across filesystems; supply-chain checks remained enabled.
Architecture checks, **11** regressions, **12/12** typecheck tasks with no pre-existing Turbo cache,
**7/7** build tasks and real native smoke passed. Logs: `/tmp/agentctl-clean-install-cached.log`,
`/tmp/agentctl-clean-verification.log`, `/tmp/agentctl-clean-native.json`. The final delivery configuration was additionally verified by a targeted desktop build from
empty generated outputs (**7/7 tasks, zero cached**, including web/UI/API-client dependencies),
real native smoke and cache-hash changes after reversible web and UI edits. The application code
covered by the full suite stayed unchanged. Final delivery logs: `/tmp/agentctl-clean-targeted-desktop-build.log`
and `/tmp/agentctl-final-delivery-native.json`. Cache proof: `/tmp/agentctl-final-cache-proof.json`. Final revision closure and repository/release documentation acceptance are recorded below in CP15.

## CP15 — Repository-wide acceptance and migration closure

- [x] CP00–CP14 are Done with file coverage, test evidence, and resolved compatibility decisions.
- [x] Re-audit every coverage row against the final source tree. Record accepted, refactored, or
      deliberately removed modules; verify new files since CP00 are covered. Mark every row Accepted.
- [x] Verify zero frontend cycles, no unresolved architecture violations/migration TODOs, no
      temporary migration shims, and accurate docs/public exports. Retain justified permanent aliases
      only with their explicit contract and tests.
- [x] Run the final verification gate below against one exact revision; record commit SHA, date,
      command/results, browser/native evidence, remaining product limitations, and any source API changes.
- [x] Update README/design/repository/session docs to describe the completed implementation,
      replace this dashboard's statuses, and announce 16/16 complete only after the gate passes.

Preflight audit (2026-10-17): all **1,163** repository files have exactly one owner across
**61** accepted areas: **210** core production files/assets, **81** contract/client files,
**276** web production files, and **596** server/native/UI/tests/tooling/documentation files.
The parsed feature graph matches its committed snapshot, has zero cycles and an empty baseline.
All permanent aliases have explicit compatibility decisions; removed forwarding paths are absent.
Historical SQL migrations are unchanged from `2867b13`, before the architecture commits.
README, design/repository/session guides and unreleased source compatibility notes now describe
the implemented architecture. All final gates passed on the exact clean revision below. No merge, push or release is implied.

Final verification gate:

```sh
pnpm architecture:check
pnpm architecture:test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @agentctl/web perf:build
pnpm ui:check
pnpm desktop:smoke
pnpm --filter @agentctl/web perf:check
```

Also run formatting and whitespace checks on the complete migration diff, the built desktop
renderer worker smoke used by CI, populated-database upgrade/legacy revision compatibility
coverage, and the native lifecycle smoke accepted in CP12. Existing scripts may be improved
in CP14; record their final exact commands here rather than inventing unimplemented checks.

This gate verifies the source architecture migration. Extra VCS/forge implementations, native
folder checkpoints, pagination, microservices, multiple server owners per database, new product
features, and unrelated redesigns are separate follow-up scopes. Their absence must not be
misrepresented as implemented backend support.

## Final acceptance — 2026-10-17

The accepted implementation/documentation revision is **`03994d93c13a6712e9c6884bfeed48f3e4229a4c`**.
Every command below ran with that revision checked out and a clean working tree. All **1,163**
committed file SHA256 values matched both before and after the gate. The closure commit changes
only README and this acceptance record; runtime code, dependency/configuration files, public API
fixtures and ownership ledgers remain byte-identical to the verified revision.

The source architecture migration is **16/16 complete (100% of the defined migration scope)**.
Every coverage row is Accepted. The **61** ownership areas cover **210** core source/assets,
**81** shared/client production files, **276** web production files and **596** remaining
server/native/UI/test/tooling/documentation files. New, stale and duplicate assignments fail
normal checks. Retained cohesive modules are accepted without artificial splits; removed
forwarding modules are recorded in the contracts audit. Public facades, permanent schema/type
aggregates and lazy composition factories have explicit decisions and regression coverage.

| Exact gate / acceptance command                                                                          | Result                                                                                                                                      | Local evidence                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm architecture:check`                                                                                | All files owned; package/module/public-entry policies valid; no contract/client cycles                                                      | `/tmp/agentctl-closure-quality.log`                                           |
| `pnpm architecture:test`                                                                                 | **11/11** regressions, including actual-checker violation fixtures                                                                          | `/tmp/agentctl-closure-quality.log`                                           |
| `pnpm lint`                                                                                              | Passed without warnings                                                                                                                     | `/tmp/agentctl-closure-quality.log`                                           |
| `pnpm build --force`                                                                                     | **7/7** tasks, **zero cached**                                                                                                              | `/tmp/agentctl-closure-quality.log`                                           |
| `pnpm typecheck --force`                                                                                 | **12/12** tasks, **zero cached**                                                                                                            | `/tmp/agentctl-closure-quality.log`                                           |
| `pnpm test`                                                                                              | **1,532 tests/267 files**, **279.54 s**, no failures; architecture regressions also run by this command                                     | `/tmp/agentctl-closure-tests.log`                                             |
| `pnpm --filter @agentctl/web perf:build`                                                                 | Profiling fixtures built separately from production output                                                                                  | `/tmp/agentctl-closure-quality.log`                                           |
| `pnpm ui:check /tmp/agentctl-closure-gallery.json`                                                       | Gallery build; desktop/narrow containment; dialog name/focus/Escape/return; screenshots reviewed                                            | `/tmp/agentctl-closure-gallery*`                                              |
| `XVFB_PATH=/tmp/agentctl-native-tools/usr/bin/Xvfb pnpm desktop:smoke /tmp/agentctl-closure-native.json` | Real Linux Electron main/preload/server; normal exit **0** and startup-failure exit **1**; one server; awaited cleanup; outsider IPC denied | `/tmp/agentctl-closure-native.json`                                           |
| `pnpm --filter @agentctl/web perf:check /tmp/agentctl-closure-performance`                               | All **six** safeguard suites passed, including nine budget regressions                                                                      | `/tmp/agentctl-closure-performance/`, `/tmp/agentctl-closure-performance.log` |
| Production browser architecture journeys, command below                                                  | All **nine** interactions, production navigation and deferred loading passed                                                                | `/tmp/agentctl-closure-journeys.json`                                         |
| Built desktop Markdown worker, command below                                                             | Syntax highlighting and named entities passed                                                                                               | `/tmp/agentctl-closure-desktop-worker.json`                                   |
| Prettier on the complete migration diff from `2867b13`                                                   | **500** changed-file candidates; all matched files passed, honoring lockfile/generated exclusions                                           | `/tmp/agentctl-closure-migration-format.log`                                  |
| `git diff --check 2867b13 HEAD` and local documentation/source link audit                                | Passed; graph snapshot matches actual imports, zero frontend cycles and empty baseline                                                      | `/tmp/agentctl-closure-feature-graph.json`                                    |

Additional browser commands:

```sh
node apps/web/scripts/performance-browser.mjs /tmp/agentctl-closure-journeys.json --journeys --verify-deferred --architecture-journeys
AGENTCTL_PERF_DIST=apps/desktop/out/renderer node apps/web/scripts/performance-browser.mjs /tmp/agentctl-closure-desktop-worker.json --production --worker-smoke
```

Browser/gallery/performance commands set `GITHUB_SHA` to the full accepted revision above.
Reports record that revision and their built HTML hash; both were checked against the accepted
builds. Native JSON records actual platform, scenario, individual checks and exit status.
`XVFB_PATH` selects a locally extracted Xvfb on this host; normal Linux CI uses installed Xvfb.
Local execution does not claim a remote GitHub Actions run or a published release occurred.

Compatibility acceptance is included in the full suite: populated SQLite upgrades from every
historical migration boundary; preserved session/event records and foreign keys; legacy Git
baseline/checkpoint/recovery import; opaque non-Git IDs and cross-scope rejection; ACP v1/v2
boundaries; inert database/default imports; **183** established shared runtime values and schema
identity; and the unchanged **77-route** typed HTTP method/path/status surface. Historical SQL
files are unchanged from before the architecture commits. The source import changes and retained
aliases are communicated in [architecture release notes](releases/architecture-migration.md).

Remaining product/platform work is outside this completed source migration: production VCS
backends beyond Git, ordinary-folder history/checkpoint storage, distributed ownership and
multi-server databases, sparse checkout and new pagination APIs. Linux x64 native integration
is verified; macOS/Windows native runtime, signing, OS protocol association and downloaded update
installation remain explicit platform/release checks. Synthetic journeys do not establish live
provider/network latency promises. No version bump, tag, push, merge, publication or deployment
was performed. These limits do not hide unresolved migration aliases, cycles or unowned source.

## Checkpoint evidence log

| Checkpoint | Revision / delivery                                               | Verification                                                                                                                                                    | Follow-up at acceptance (historical)                                              |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| CP00       | `e1fc843` (CP03 baseline)                                         | Coverage inventory; tracker/link/format checks                                                                                                                  | None within planning scope                                                        |
| CP01       | `e1fc843` (CP03 baseline)                                         | 1,429 Vitest tests; 4 architecture tests; typechecks/lint/builds/browser checks, recorded in design guide                                                       | Follow-up work assigned to CP02–CP14                                              |
| CP02       | `e1fc843`, accepted 2026-10-16                                    | 1,434 tests/239 files; focused 270/49; 4 architecture tests; typechecks/lint/format/builds; 98 endpoint inventory                                               | None in server application/transport scope; native integration remains CP12       |
| CP03       | `e1fc843`, accepted 2026-10-16                                    | 1,447 tests/241 files; session 163/24; 4 architecture tests; typechecks/lint/format/builds; 35-module audit                                                     | None within CP03; neutral workspace remains CP05, provider lifecycle CP06         |
| CP04       | `a628a08`, accepted 2026-10-16                                    | 1,454 tests/241 files; focused 177/15; 4 architecture tests; typechecks/lint/format/builds; 34-module audit                                                     | None within CP04; neutral session workflows remain CP05                           |
| CP05       | `2789c9c`, accepted 2026-10-16                                    | 1,467 tests/243 files; combined 348/41; follow-up 55/5; 4 architecture tests; typechecks/lint/format/builds; 41-module and 36-session audits                    | None within CP05; additional production VCS/folder history remains separate scope |
| CP06       | `5d60524`, accepted 2026-10-17                                    | Provider/agent 367 tests/58 files; disposal 6/1; typechecks/lint/architecture checks                                                                            | None within provider/protocol composition scope                                   |
| CP07       | `a117a46`, accepted 2026-10-17                                    | 1,489 tests/248 files; 5 architecture tests; types/lint/format/builds; 214-file ownership ledger                                                                | None within remaining-core scope                                                  |
| CP08       | `d3b0869`, accepted 2026-10-17                                    | Focused 239/36 and injected-action 7/1; types/lint/architecture/format/web build; production screen journeys                                                    | Broader frontend audit remains CP10                                               |
| CP09       | `4ba6b0e`, accepted 2026-10-17                                    | 1,491 tests/249 files; focused 135/21; 5 architecture and 9 performance tests; types/lint/format/builds; parent/child browser and desktop worker smoke          | Broader frontend audit remains CP10                                               |
| CP10       | `148ef06`, accepted with contracts integration 2026-10-17         | 275-file web ledger; initial frontend 507/94; final combined 1,511/259; cleanup regressions, production journeys, six performance suites                        | None in frontend scope; delivery tooling remains CP14                             |
| CP11       | `f158004`, accepted 2026-10-17                                    | 1,511 tests/259 files; 6 architecture regressions; 80-file ledger; unchanged 77-route surface; types/lint/format/builds/browser/worker/performance              | Source API release communication remains CP15                                     |
| CP12       | `b62954c`, accepted 2026-10-17                                    | Final 1,532/267; lifecycle/IPC/navigation regressions; Linux Electron normal/failure smoke on final and clean builds; worker smoke                              | macOS/Windows runtime and OS release integration remain platform checks           |
| CP13       | `b62954c`, accepted 2026-10-17                                    | UI acceptance inventory; public-export interaction tests; gallery screenshots and focus/keyboard review; renderer builds/journeys/performance                   | No open UI architecture work; exhaustive assistive-technology audit is separate   |
| CP14       | `b62954c`, accepted 2026-10-17                                    | 1,162-file coverage; 11 enforcement regressions; full tests/types/lint/format/build; clean install/build/native verification; cache proof; CI/release wiring    | Final repository/release documentation closure remains CP15                       |
| CP15       | `03994d9`, accepted 2026-10-17; documentation-only closure commit | 1,163 files/61 owners; 1,532 tests/267 files; 11 architecture regressions; forced 7/7 builds and 12/12 typechecks; all browser/gallery/native/performance gates | None within source migration; explicit product/platform scope below               |

Earlier rows retain their original verification counts and follow-ups as historical evidence.
Current completion and remaining product/platform scope are stated in the dashboard and final
acceptance record; earlier phase results do not substitute for the final gate.
