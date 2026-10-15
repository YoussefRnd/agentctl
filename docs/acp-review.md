# ACP implementation review — October 14, 2026

The findings below record the SDK 1.7.0 baseline reviewed on October 14. The follow-up
implementation upgrades to SDK 1.8.0 and addresses ownership, authentication, compaction,
notices, module structure, retained-state limits, and caching. Current module locations,
limits, and verification commands are documented in the
[adapter README](../packages/core/src/acp/README.md). Real provider behavior remains unverified;
the smoke runner is opt-in and the performance comparison uses synthetic workloads.

## Implementation follow-up — October 15, 2026

The implementation preserves the product driver/session/update boundary, v1 default,
explicit v2 opt-in, initialization-only fallback, cancellation, and ordered persistence.
The npm registry was checked again on October 15 and still reports SDK **1.8.0**.

- Upgraded the pinned SDK and lockfile; removed the idle-error compatibility shim.
  Added native wire-decoding coverage and support for live notices and v1 compaction.
- Bound persistent operations to captured connection leases, including delayed startup,
  close, registration, terminal input, and capability reads. Persistent MCP extensions
  now retain the supplied gateway, with an isolated fallback for mismatched gateways.
- Corrected terminal-auth discovery and v2 environment conversion. Restricted control
  connections now share bounded deadlines and authoritative cleanup.
- Shared compaction patch reduction preserves null clears, omission, error/metadata state,
  cancelled/future statuses, and bounded UTF-8 content. Role-scoped message identity has
  an explicit collision regression.
- Extracted versioned drivers, sessions, controls, capabilities, caching, and custom
  extensions. Narrowed the public ACP barrel while retaining compatibility module paths.
- Added queue/setup byte budgets, bounded subagent retention, per-root release, and
  asynchronous atomic descriptor caching with cross-process writer locks and expiry.
  Replaced repeated directed-message reconstruction with incremental text accumulation.

The standalone benchmark ran on Linux / Node 24.20.0, without concurrent builds or tests.
These are medians of five samples after one discarded warmup:

| Synthetic workload                             | Previous algorithm | Current implementation |
| ---------------------------------------------- | -----------------: | ---------------------: |
| Accumulate 2,048 directed chunks / 512 KiB     |          419.86 ms |                4.41 ms |
| 100 warm descriptor reads / 256-entry manifest |        1,028.98 ms |               22.56 ms |

The benchmark checks identical resulting text. After 500 root-session lifecycles it
retains zero children, messages, or content bytes. Draining 100 queued updates retains
zero pending updates/bytes (peak: 100 updates / 28,100 bytes). These measurements isolate
reducer/cache work; they do not measure model, network, UI, or complete application latency.
Reproduce with `pnpm --filter @agentctl/core acp:benchmark` after building shared/core.

The local SDK-peer smoke run passed 13 operations: initialize, new, prompt, config, list,
cancel, fork, close/delete fork, close, resume, close resume, and delete. Real-provider
authentication and compatibility still require the opt-in smoke run described in the README.
V2 pooling remains deferred until live startup measurements justify it.

Verification: **851 core/shared/server tests passed across 129 files**, and **485 web tests
passed across 87 files**. The final concurrent gateway-isolation and persistent-close
tests also passed after tightening gateway matching. Shared/core builds, core/server/web/
desktop typechecks, web architecture checks, lint, formatting, and `git diff --check` passed.

## Verified findings

### 1. Persistent session operations need a connection lease — high priority

`packages/core/src/acp/runtime.ts:298` closes a persistent session using only
`providerId` and native session ID. `transport/persistent-connection.ts:338` looks up
the **current** connection for that provider. A handle from an older process can therefore
close a session in a replacement process if the agent reuses a native ID.

A targeted probe reproduced this: open a handle on generation 1, install generation 2
with the same native ID, close the old handle, and observe generation 2's close RPC and
local registration removal. Generations already exist on persistent connections, but
`IConnectionManager` does not require callers to use them.

Return a connection lease from acquisition and bind registration, unregistration, close,
terminal ownership, and capability lookup to that lease. Reject stale operations or
clean up only the lease's original instance. Acquire once during startup; the second
`getConnection()` in `runtime.ts:434` can otherwise obtain capabilities from a different
process than the captured connection.

Acceptance: replacing a provider process and reusing a native ID cannot let an old handle
close, unregister, or modify a new session. Exercise delayed startup and delayed close.

### 2. Provider inspection misses or corrupts terminal authentication — high priority

There are two independent issues:

- **V1:** `runtime.ts:833` initializes the probe without client capabilities. The helper
  defaults to `{}`. A compliant agent must withhold terminal authentication methods unless
  the client advertises support. A real SDK peer probe confirmed terminal auth is false
  on the wire and the resulting descriptor contains no terminal auth method.
- **V2:** `v2/runtime.ts:120` casts terminal-auth `env` to a string record. ACP v2 sends
  an array of `{ name, value }`. The object check accepts the array unchanged. A real SDK
  peer probe confirmed the descriptor then fails the product `authMethodSchema`.
  Persisted auth methods decode through that schema, and terminal launch code spreads
  `targetMethod.env` into its environment, so the incorrect representation affects login.

Build explicit capability sets for session, inspection, and authentication connections.
Inspection should advertise supported terminal authentication and boolean config discovery
without filesystem or terminal-execution access. Translate v2 environment arrays to the
product record and validate the projected descriptor instead of asserting its shape.

Acceptance: terminal-only providers appear in discovery, v2 variables retain their names
and values through persistence and launch, and probes still cannot execute client tools.

### 3. Compaction patches lose protocol semantics — medium priority

`v2/compaction.ts:20` uses optional chaining and `??` to retain the old summary. This makes
`summary: null` behave like an omitted field, even though null must clear it. A targeted
probe reproduced retention of the previous summary after an explicit null update.

The projector also stores only the summary, recreates error output from each notification,
discards compaction metadata, and maps cancellation to failure. These are additional
state-model limitations to cover when changing it.

Keep a bounded compaction state record per ID. Apply omission, null, replacement, and
chunk append separately. Preserve cancelled and future statuses; choose a generic visual
presentation independently. Reuse the reducer for v1 when enabling its now-stable compaction
capability. The current synthetic tool-call presentation can remain if it retains these
semantics.

Acceptance: omitted fields remain, null and empty summaries clear, explicit errors clear,
metadata patches survive, and a later status-only update retains prior content.

## Structural and performance improvements

### Make runtime files coordinators

The v1 runtime is 1,212 lines and the v2 runtime is 1,124 lines. Both combine process
startup, negotiation, authentication, provider inspection, session setup, configuration,
turn handling, and teardown. The existing transport and protocol helpers are useful;
the missing boundary is between a provider driver and a running session.

Suggested destination, using the current directories where they already fit:

```text
acp/
  driver.ts                       # adapter selection and fallback
  transport/
    acp-process-lifecycle.ts
    connection-lease.ts
    persistent-connection.ts
    update-drain.ts
    session-requests.ts
    limits.ts
  cache/
    provider-descriptor.ts         # storage and launch fingerprinting
  protocol/
    content.ts
    prompt.ts
    elicitations.ts
    request-scopes.ts
    subagent-sessions.ts
  v1/
    driver.ts                     # inspection and session creation
    session.ts                    # product AgentSession implementation
    connection.ts                 # SDK requests and client handlers
    control.ts                    # probe/list/delete/auth/logout connections
    capabilities.ts
    events.ts
  v2/
    driver.ts
    session.ts
    connection.ts
    control.ts
    capabilities.ts
    events.ts
    compaction.ts
    terminals.ts
  extensions/
    agentctl.ts
```

Extract authentication projection and control connections first, then session setup and
the running-session object. Keep v1 prompt-response completion and v2 acceptance/idle
completion explicit in their respective session implementations. Share ownership,
cancellation, queueing, and pure reducers; avoid forcing both wire lifecycles into one
large configurable class.

`transport/capabilities-cache.ts` currently mixes synchronous file storage, executable
fingerprints, v1 capabilities, and initialization. Separate those responsibilities.
`acp/index.ts` exports almost every implementation module; narrow its public exports and
keep version-specific SDK details private. Extend the existing boundary tests to check
extension identifiers and adapter imports across packages, not just SDK imports in core.

### Bound retained bytes and release per-session state

`AcpSubagentSessions` retains children, callback wrappers, and directed messages in maps
until the whole connection closes. It has no per-root release or entity/byte limits.
Directed chunks copy the entire content array and render the full accumulated message
on every update (`protocol/subagent-sessions.ts:154`), so processing grows with the
retained message history.

Add per-root disposal that removes descendants and associated messages when a persistent
session closes. Bound entities and accumulated bytes. Where late updates need old state,
use a bounded cache with repository lookup rather than retaining all transcript content.
The v1 pending-update buffer also retains unresolved sessions and repeatedly scans them
on active-session notifications (`transport/client-connection.ts:85`). Buffer only IDs
associated with an outstanding setup/replay request and expire failed setup buffers.

The existing 1,024-update limit is a **count** limit; it does not bound aggregate payload
size. Add a retained-byte budget and queue high-water diagnostics. Preserve failure on
overflow and ordering. Coalesce only consecutive append chunks for the same entity;
flush before replacement, permission, lifecycle, and completion boundaries.

Measure cold/warm startup, spawn count, initialization duration, queue depth/bytes,
event-loop delay, heap growth, and time to persist completion. Existing turn diagnostics
already measure preparation, acceptance, first output, and completion. Existing transcript
code also already coalesces UI deltas and persistence; do not add another batching layer
without measuring its benefit.

### Improve caching before expanding process reuse

V1's file cache reads and rewrites the entire manifest synchronously. Expired entries
are ignored but never pruned. V2 has no matching adapter-level descriptor cache, although
the provider launcher already deduplicates and caches probes above the adapter.

Consolidate caching ownership, retain probe deduplication, add a bounded in-memory cache,
prune expired records, and persist asynchronously with atomic replacement. Serialize
updates or use the existing database if multiple app processes share this cache; atomic
rename alone does not prevent competing read-modify-write operations from losing entries.

The protocol-selection cache in `driver.ts:143` uses command, arguments, and supplied env,
but no executable fingerprint or TTL. A v1 fallback can remain sticky after a provider
upgrade until explicit invalidation. Share a launch fingerprint and invalidate on provider
updates, authentication/configuration changes, and relevant inherited launch-env changes.

V1 already reuses provider processes; v2 spawns for each session and control operation.
Only add v2 pooling after leases and per-root disposal are correct and measurements show
startup cost matters. Make pooling respect launch identity and provider multiplexing
behavior, with an isolated-process fallback.

### Align connection features and deadlines

Persistent v1 connections explicitly pass `mcpGateway: undefined`
(`transport/persistent-connection.ts:213`), while spawned sessions pass the supplied gateway.
Consequently, custom `_agentctl.dev/mcp/*` tools registered from that gateway disappear
when a session uses the normal persistent path. This does not disable ordinary MCP servers
sent in session setup. Define whether the gateway belongs to the connection or session and
test extension parity across both paths.

V1 `logoutProvider` awaits initialization and logout without deadlines
(`runtime.ts:1128`); an unresponsive agent can leave the operation and process alive.
Centralize control-connection teardown and deadline policy for inspect/list/delete/login/
logout. Keep these deadlines separate from foreground work.

## Upstream update and adaptation

The audited baseline pinned `@agentclientprotocol/sdk` **1.7.0**, with schemas v1.24.1 and
v2.0.0-alpha.7. The latest published version checked on October 14 is **1.8.0**, released
October 9, with schemas **v1.25.0** and **v2.0.0-alpha.8**.
Sources: [SDK release](https://github.com/agentclientprotocol/typescript-sdk/releases/tag/v1.8.0),
[schema update](https://github.com/agentclientprotocol/typescript-sdk/commit/c979649b1b69d6576e3b6a29e152235b4c324984).

| Upstream change                           | Adaptation in agentctl                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native idle `stopReason: "error"` details | Remove `v2/state-error-compatibility.ts` after retaining wire tests for valid, malformed, absent, and null error details. Native SDK 1.8 decoding was verified to preserve a valid error.                                                               |
| Notices stabilized                        | Add a product notice event and live presentation for v1/v2. Advertise `clientCapabilities.session.notices: {}` in v1 only after supporting it. Preserve unknown severity; an error notice must not fail a turn or become replayed conversation history. |
| Compaction stabilized                     | Fix patch handling, reuse the reducer for v1, then advertise `clientCapabilities.session.compaction: {}`. V2 already projects compaction but v1 currently neither advertises nor projects it.                                                           |
| Stricter actionable request validation    | Add wire tests for malformed filesystem offsets, terminal args/env/cwd/output limits, terminal-auth args/env, and session additionalDirectories/MCP arrays. These fields are no longer silently defaulted or filtered on decode errors.                 |
| IDs clarified as unique per entity type   | Retain role/type in message identity. `ConversationProjector` already keys messages by role plus ID; add an explicit cross-role collision regression test.                                                                                              |
| More precise idle-state union typing      | Change the test fixture at `v2/runtime.test.ts:138` to construct complete idle variants in separate branches rather than conditionally spreading `stopReason`.                                                                                          |

Notices are live presentation events with a v1 capability gate and no v2 capability gate.
Compaction follows entity patch semantics, including null clears.
Sources: [session notices](https://agentclientprotocol.com/rfds/session-notices),
[session compaction](https://agentclientprotocol.com/rfds/session-compaction).

Keep v1 as the default. V2 remains draft despite stabilization of individual features;
continue explicit opt-in and SDK pinning. Subagents and other draft extensions should
remain isolated and capability-aware.
Source: [official SDK guidance](https://github.com/agentclientprotocol/typescript-sdk).

## Validation and implementation order

- Current SDK 1.7.0: **234 tests passed in 42 ACP test files**. Core typechecking passed.
  The sandbox initially suppressed nested Node subprocess output and caused four failures;
  rerunning outside it passed the entire suite.
- Four temporary targeted probes confirmed stale-generation close, null-summary retention,
  v2 auth-env schema mismatch, and missing v1 terminal-auth discovery. They asserted the
  observed defective behavior; they were removed from the workspace after the audit.
- Published SDK 1.8.0 was installed only in an isolated `/tmp` source copy. All **234 ACP
  tests passed**. Typechecking initially reported one error in the idle test fixture;
  constructing explicit variants fixed it and the isolated core typecheck then passed.
- No live-provider smoke test or provider performance benchmark was run. Existing passing
  tests do not cover the newly identified cases or establish complete provider compatibility.

Recommended sequence:

1. Fix connection leases and both authentication projections/discovery paths; add the
   missing regression tests. Fix compaction patches and control-operation deadlines.
2. Pin SDK 1.8.0, update the lockfile/README and idle fixture, remove the compatibility shim,
   and test the stricter wire validation. Add notices and v1 compaction as separate feature
   changes so the dependency update stays reviewable.
3. Extract control connections, capability/descriptor projection, and running-session
   implementations. Preserve the existing SDK peer tests through these extractions.
4. Add per-session disposal and byte/entity budgets, then benchmark cache and chunk handling.
5. Add opt-in live-provider smoke tests for initialize/auth, new, prompt, cancel, resume,
   fork, config, list/delete, and close. Measure before deciding on v2 pooling.

Success means no cross-generation session mutations, discoverable working terminal auth,
correct patches, bounded memory after repeated session churn, deterministic deadlines,
and an SDK upgrade whose protocol behavior is tested separately from organizational changes.
