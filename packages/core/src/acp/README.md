# ACP adapter

This package translates ACP wire behavior into the product contracts in `../agent`.
Protocol method names, `_meta`, SDK types, capability-shape compatibility, and extension
routing stay here. Session, provider, API, and UI code depend on `AgentDriver`, `AgentSession`,
and `AgentUpdate`.

The adapter targets SDK 1.8.0 (v1 schema 1.25.0 and v2 schema 2.0.0-alpha.8).
ACP v1 is stable; v2 is a draft implemented through the SDK's experimental entry point.
Automatic selection defaults to stable v1. Opt into draft v2 with a profile's Protocol
setting or `AGENTCTL_ACP_PROTOCOL=v2`. To enable automatic v2 negotiation with v1 fallback,
set `AGENTCTL_ACP_V2_ENABLED=true`. Only initialization incompatibility triggers fallback;
authentication and runtime failures do not.

When upgrading `@agentclientprotocol/sdk`, run the ACP and core tests and review occurrences of
`unstable_`, `extMethod`, and `_meta` inside this package. These identifiers should not be added
outside this directory.

## Structure

- `driver.ts` selects a version and handles initialization-only fallback. Selection uses
  a launch fingerprint and a one-hour expiry; authentication invalidates discovery caches.
- `v1/` and `v2/` each contain a driver for session setup, a running `session` implementation,
  provider `control` operations, and version-specific capability/configuration conversion.
  V1 completes through the prompt response; v2 completes through foreground state updates.
- `transport/` owns processes, connection leases, request/update lifetimes, and bounded buffering.
  A lease captures the connection and generation once. Stale handles cannot register, close,
  unregister, or write to a replacement process's resources.
- `protocol/` contains shared content, authentication, permission, compaction, and subagent
  reducers. Custom methods live in `extensions/`.
- `cache/` owns launch fingerprints and the asynchronous descriptor cache. Writes are atomic
  and locked across processes. The manifest expires after one hour and retains at most
  256 entries / 4 MiB, with a 512 KiB maximum per entry.

The public entry point exports the selecting driver and connection-coordinator type.
`runtime.ts`, `v2/runtime.ts`, and `transport/capabilities-cache.ts` are compatibility imports.

## Protocol boundaries

- Require the version returned by initialization to match the selected adapter.
- Send optional session fields and MCP transports only when negotiated. V2 stdio
  servers require a `type` discriminator; SSE endpoints must never be relabeled as HTTP.
- Scope native session IDs and terminal ownership to their connection. IDs returned
  by different provider processes are independent, including replacement connections.
- Preserve request cancellation signals through permissions, elicitations, and client
  operations. A cancelled terminal wait does not release or kill the terminal.
- Sending session cancellation also cancels pending permission and elicitation callbacks
  for that session, including its children. Other sessions retain their own request signals.
- Closing a session settles its pending prompt, prevents further prompts, and releases
  connection-owned resources. Persistent session close and metadata operations have deadlines;
  foreground work is not limited by a metadata request deadline.
- Process event listeners belong to individual sessions and are removed on shutdown.
  Terminal diagnostics record input byte counts without logging input contents.
- Select only permission option IDs supplied by the agent. Control connections cancel
  permission requests and expose URL authentication consent, without filesystem access.
- ACP filesystem paths are absolute, and read offsets are one-based. Extensions have
  their own validation and must not change standard ACP request semantics.
- Use SDK validation for native child announcements and directed messages. The stream wrapper
  only tracks setup/replay boundaries and rejects child dependencies within one batch. V1
  session clients advertise `subagents: {}` through SDK client capabilities.
- Build known v2 variants with literal tags and matching payloads. The SDK permits unknown
  variants received from peers and custom tags starting with `_`; shared prompt/elicitation
  builders return only their supported known variants.
- Publish v2 command snapshots returned by new, fork, and resume, including empty lists.
- Apply updates in order and retain persistence errors until completion is checked.
  Update queues and pre-setup buffers are bounded by `transport/limits.ts`; overflow fails
  completion instead of silently reporting success after losing updates. Unknown session
  traffic cannot block updates for an active session.
  V1 prompt completion comes from the prompt response. V2 prompt responses identify the
  inserted user message; foreground completion comes from an idle update with a stop reason.
  A foreground error fails the attempt without retiring a healthy connection. SDK 1.8
  natively decodes the idle state's error details; no stream metadata shim is needed.
- Apply full message replacements and chunks by native message ID. Echoes of an accepted
  local user message update its existing row, and empty configuration lists clear state.
  V2 user updates received before acceptance are buffered and reconciled by the accepted ID;
  identical content from another client cannot claim the local message.
  An explicit prompt rejection marks delivery failed; a lost response remains uncertain.
- V2 diffs use their structured file operations as the source of truth and render an optional
  patch. Binary files, directories, symlinks, moves, and copies do not require text patches.
- Preserve cancelled and unfamiliar plan statuses and priorities through persistence and UI.
- Compaction upserts preserve omitted fields, clear explicit nulls, and replace concrete
  values in both protocol versions. V1 advertises compaction and notice support.
- Notices travel through a live-only `session_notice` SSE channel. They do not create history,
  advance replay cursors, invalidate app-wide state, or fail a turn based on severity.
  The UI uses toasts and generic presentation for unfamiliar severities.
- Update queues and setup buffers allow at most 1,024 updates / 16 MiB. Subagent retention
  allows 256 children, 512 directed messages, and 8 MiB per connection. Closing a root releases
  its descendants, content, callbacks, terminal ownership, and request scopes. Limit violations
  fail completion rather than silently losing updates. Queue snapshots expose high-water counts.
- SDK request validation is supplemented by positive read offsets and non-negative safe-integer
  terminal output limits. Inspection advertises terminal authentication without filesystem or
  terminal-execution access; v2 terminal-auth environment arrays become validated product records.

The transport tests use SDK peers to exercise wire requests, cancellation, and unsupported
methods, plus early prompt acceptance, transport loss, shutdown, bounded buffering, and
unresponsive metadata requests.

## Checks and measurements

Build the shared and core packages before running the standalone tools:

```sh
pnpm --filter @agentctl/shared build
pnpm --filter @agentctl/core build
pnpm exec vitest run packages/core/src/acp
pnpm --filter @agentctl/core acp:benchmark
```

The benchmark compares the previous directed-message reconstruction and synchronous manifest
read algorithms against the current implementations, using identical synthetic content.
It discards a warmup, records five samples, checks content parity, and asserts zero retained
subagent state after 500 root-session lifecycles. Timing trends are not live provider or UI
latency guarantees; run it without other builds/tests for comparable measurements.

Live provider checks are explicit and opt-in. Use a private configuration file:

```json
{
  "providers": [
    { "id": "provider", "command": "/absolute/path/to/agent", "args": ["--acp"], "protocol": "v1" }
  ]
}
```

```sh
AGENTCTL_ACP_SMOKE=1 pnpm --filter @agentctl/core acp:smoke --config /absolute/providers.json
```

The runner inherits the launch environment; profiles can additionally specify `env`,
`timeoutMs`, and an explicit agent `authMethodId`. It uses temporary workspaces and the
production connection pool, denies client tool permissions, and cancels elicitations.
It exercises initialization, prompt, cancellation, close, and advertised configuration,
listing, fork, resume, and delete operations. JSON reports contain operation timings and
failure categories, excluding credentials, prompts, paths, and provider stderr. It contacts
real configured providers and may consume their quota. No real provider run is part of CI.
`testing/smoke-peer.mjs` is a local SDK peer for checking the runner without a model service.

References: [v1 protocol](https://agentclientprotocol.com/protocol/v1/overview),
[request cancellation](https://agentclientprotocol.com/protocol/v1/cancellation),
[v2 prompt lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle), and
[v2 session setup](https://agentclientprotocol.com/protocol/v2/session-setup).
