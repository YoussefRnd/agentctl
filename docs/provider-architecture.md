# Provider and agent ownership

ProviderRegistry is the public application facade. It composes capabilities once and delegates
without changing the server/session API. Capability dependencies use narrow structural ports;
callbacks refer to facade operations where operation ordering must remain observable.

| Owner                                                                            | Responsibility and resource lifetime                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-agent-runtime.ts`, `default-agent-driver.ts`                            | Explicit ACP selection, process adapter construction, provider adapters and one diagnostics recorder per runtime. No import-time runtime instance.                                                                               |
| `agent/types.ts`, `connection-lifecycle.ts`, `runtime-services.ts`               | Product contracts and application resource handles; no protocol imports. Shared connections expose final awaited disposal separately from per-provider invalidation.                                                             |
| `provider-registry.ts`                                                           | Public operations, shared coordinator, sync coalescing, notifications and shutdown. Removal retains atomic secret/database rollback.                                                                                             |
| `registry/provider-queries.ts`                                                   | Cached catalog/discovery, profile lookup and settings queries. Reading catalog never fetches, probes or spawns.                                                                                                                  |
| `registry/provider-configuration.ts`                                             | Profile creation/hiding, configuration, secret reference updates, default selection and connection invalidation.                                                                                                                 |
| `registry/provider-readiness.ts`                                                 | Readiness/reinstall policy and native session listing through AgentDriver.                                                                                                                                                       |
| `registry/provider-recovery.ts`                                                  | Startup repair of interrupted install/auth/probe states and orphan staging.                                                                                                                                                      |
| `registry/provider-operation-coordinator.ts`                                     | Concurrent mutations, exclusive sync, per-provider coalescing/ordering; idempotent leases, stop admission and await draining.                                                                                                    |
| `registry/provider-auth-coordinator.ts`                                          | Advertised method validation, family credential invalidation, browser consent and persisted auth/verification policy.                                                                                                            |
| `registry/provider-auth-operations.ts`                                           | Family queues, attempt controllers, timeout/external listeners and drain. Cancellation returns promptly, while queued credential changes await prior adapter settlement. Late verification cannot publish success.               |
| `registry/provider-installation-service.ts`                                      | One candidate transaction: staging, verification, activation, rollback, progress and cancellation. Keep these phases together so cleanup sees the complete previous/candidate state.                                             |
| `registry/provider-updates.ts`                                                   | Comparable version policy, update retry backoff and orphan npx cache retention. Calls the installation owner; never activates a candidate itself.                                                                                |
| `registry/binary-installer.ts`                                                   | Download/checksum and atomic managed directory activation/removal. Cancellation and failure clean temporary directories.                                                                                                         |
| `registry/binary-archive.ts`                                                     | Archive format/path/link policy and extraction subprocess adapter; compatibility helpers re-exported by installer.                                                                                                               |
| `registry/provider-launcher.ts`                                                  | Launch/environment resolution, system executable discovery and fingerprinted 30-second probe cache; invalidation also reaches driver descriptor caches.                                                                          |
| `registry/provider-probing-service.ts`                                           | Probe error classification, state preservation and startup probe orchestration.                                                                                                                                                  |
| `registry/registry-fetcher.ts`, `provider-sync.ts`                               | Conditional HTTP/local registry acquisition and one retained snapshot; metadata/system discovery reconciliation preserves installed capabilities. Fetch coalesces, has an eight-second deadline and aborts at registry shutdown. |
| `registry/provider-store.ts`                                                     | Provider/settings persistence and inherited installation state for profiles.                                                                                                                                                     |
| `registry/provider-data.ts`, `registry-parser.ts`, `provider-lifecycle-error.ts` | Validated data/default mapping and typed lifecycle failures.                                                                                                                                                                     |
| `provider.ts`, `capabilities-negotiator.ts`, provider/agent `index.ts`           | Read model, launch/config interpretation, capability policy and compatibility exports.                                                                                                                                           |
| Remaining `agent/` modules                                                       | Diagnostics allowlist/bounded retention, errors/redaction, tool effects, conformance and adapter-independent text generation. No process/default construction.                                                                   |

Shutdown closes admission before aborting installers/authentication and interrupting shared
connections. It waits queued application operations and background update/probe/readiness workflows without
holding mutation lanes across their nested operations, then closes any resources finishing during
the drain and awaits the connection manager's final cleanup. Per-provider close remains reusable;
final disposal rejects new connections. Auth attempt listeners/timers are removed by their owner.
Adapters must settle credential-changing work after abort; returning cancellation does not release
the credential family lane early. Install rollback retains the last working executable and auth.

## Accepted protocol implementation

The existing adapter already separates version drivers, running sessions, control operations,
reducers, transport, extensions and cache. Its detailed invariant map remains in
[`acp/README.md`](../packages/core/src/acp/README.md). All production files below were reviewed
as part of this acceptance; existing cohesive owners are retained.

- `acp/driver.ts`, `types.ts`, `index.ts`, `runtime.ts`: negotiation, adapter-only wire contracts
  and compatibility exports. Auto fallback is initialization-only; the protocol selection cache
  is capped at 256 launch fingerprints with a one-hour expiry.
- Every `acp/v1/` and `acp/v2/` production module: capabilities, configuration (v1), driver,
  session, control, events/permissions/runtime/terminals (v2). Native identities stay scoped to
  the connection; session close owns process listeners and active request cancellation.
- Every `acp/protocol/` production module: authentication/browser consent, bounded text, content,
  handlers/authorization, compaction/events, elicitations, error classification, filesystem,
  model context, negotiation, permission metadata/policy, prompt, request cancellation/scopes,
  retry metadata, session fork/params, subagent sessions, terminals/manager, tool call utilities
  and usage. These reducers/adapters do not construct application default services.
- Every `acp/transport/` production module: owned process groups, connection facade/leases,
  persistent pooling, request deadlines, update draining, subagent streams, turn control,
  stderr/debug redaction, limits and path-security/cache compatibility exports. Generation and
  exact resource identity protect replacements from stale close/unregister/terminal callbacks.
  Final manager disposal additionally drains pending creation, terminals and process exit.
- `acp/cache/launch-identity.ts`, `provider-descriptor.ts`, `writer-lock.ts`: credential-sensitive
  hashed fingerprints, bounded atomic disk cache and cross-process lock ownership. Async writer
  maps retain only in-flight work. Cache failure remains best effort.
- `acp/extensions/agentctl.ts` and `testing/smoke-peer.mjs`: custom wire methods and explicit local
  test peer. SDK/custom method identifiers remain within the adapter boundary.

Verification uses local SDK peers, not paid providers: registry/profile/auth/install recovery,
candidate rollback, cancellation during verification, queued shutdown and credential cleanup;
negotiation/fallback, native sessions/control, process-tree shutdown, stale leases, bounded queues,
cache retention/locks, terminal ownership and diagnostics/redaction. Parsed architecture checks
forbid ACP imports in agent/provider application modules and capability imports of their facade.
