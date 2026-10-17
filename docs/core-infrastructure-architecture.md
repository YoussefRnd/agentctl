# Remaining core ownership and acceptance

The core remains a modular monolith. Public facades orchestrate capabilities; policy does not
reach through a facade into persistence or a protocol implementation. Small cohesive modules
are accepted as they stand. No extra layer is required for a constants file or a narrow adapter.

[`core-ownership.json`](core-ownership.json) records every production core source and bundled
skill asset, including the previously accepted session, repository, workspace, Git and protocol
areas. Parsed architecture checks reject missing, duplicate and stale assignments, and require
an evidence document. This closes core ownership coverage; it does not close the remaining web,
desktop, public-export or repository-wide migration checkpoints.

## Security and credentials

| Module                                                   | Owner and acceptance                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `security/credential-store.ts`                           | Storage contract; configuration and launch resolution depend on capabilities, not encryption internals.                                                                                                                                                            |
| `security/credential-vault.ts`                           | The encrypted file/key adapter and its single in-memory cache. Imports do not instantiate it. Copy-on-write mutations publish cache state only after atomic file replacement; failures remove temporary files and preserve the prior secret in memory and on disk. |
| `security/credential-migration.ts`                       | Explicit startup application operation. Persist all secrets before replacing plaintext with references in one synchronous database transaction. Failure can leave harmless orphan secrets; references roll back and migration can retry. No schema changes.        |
| `default-credential-vault.ts`                            | Lazy process-default composition and a stateless compatibility resolver for standalone Provider/Launcher construction. The default instance is created on explicit access, never import.                                                                           |
| `security/path-security.ts`                              | Canonical path resolution, including symlinks and non-existing descendants. Shared by permissions, ACP and context attachments; filesystem ownership stays here.                                                                                                   |
| `security/permission-engine.ts`, `permission-options.ts` | Approval/action identity and option selection. Grants and one-shot receipts belong to each engine, are bounded at 256 entries and clear on turn/session cleanup. Retained without another facade.                                                                  |
| `security/index.ts`                                      | Exposes policy/storage contracts and explicit migration; creates no service.                                                                                                                                                                                       |

`default-agent-runtime.ts` selects one CredentialStore and supplies it to ProviderLauncher and
ProviderRegistry. Registry query/readiness read models and configuration/removal use that same
store; configuration persists references rather than another secret copy. The server runs
migration with that selected instance. Deliberate registry cancellation during shutdown aborts
metadata acquisition without persisting a sync failure or logging a startup failure. Tests and
alternate compositions can inject an isolated
store. Direct standalone construction retains lazy default resolution for compatibility.

The former eager `defaultCredentialVault` internal export is replaced by
`getDefaultCredentialVault()`. Database migration moved from a vault method to
`migrateProviderCredentials(db, store)`; all repository consumers use these explicit APIs.
The vault itself has no database import. ACP, MCP and server authentication never own its cache.

## Pairing and browser authentication

| Module                          | Owner and acceptance                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/auth-manager.ts`          | Pairing/startup token creation, consumption, expiry and desktop capability policy. Random tokens and constant-time capability comparison remain local. Expired pairing tokens are pruned on creation; a consumed token is burned before session creation. |
| `auth/browser-session-store.ts` | Durable browser-session creation, validation, minute-throttled activity updates, revocation and active listing. Injected database, clock and TTL; no token/transport/default ownership.                                                                   |
| `auth/types.ts`, `index.ts`     | Public session shape and compatibility exports; no runtime initialization.                                                                                                                                                                                |

Browser sessions persist across manager restart; startup/pairing tokens remain owned by that
manager. Server transports continue to depend on AuthManager, preserving expiry and revocation.

## MCP

| Module                   | Owner and acceptance                                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp/mcp-gateway.ts`     | Configured-server queries, startup/reload ordering, tool names and routing. Concurrent starts coalesce, repeated starts reuse connections, and an external stop supersedes reload.                                                                                            |
| `mcp/mcp-connections.ts` | Owns persistent/temporary leases, in-flight handshakes and requests, current-generation errors, idempotent close and awaited shutdown. Stop prevents new work and late publication. Stale callbacks cannot remove a replacement. Every failed handshake closes its resources. |
| `mcp/mcp-connection.ts`  | Explicit SDK client plus stdio/HTTP transport factory. Resolves configuration and environment only on construction, preserves SDK transport handlers, and closes both client and transport.                                                                                   |
| `mcp/index.ts`           | Public facade export, without opening a connection.                                                                                                                                                                                                                           |

Temporary remote calls share the same resource owner as persistent connections and are closed
on success, failure or shutdown. Stop waits handshakes, transport cleanup and outstanding calls;
SDK close cancels its requests. Errors remain per configured server and are cleared at stop.
Transport factories are injectable for deterministic lifecycle tests; existing real local SDK
stdio and HTTP peers still exercise the default adapter.

## Context and skills

| Module                                        | Owner and acceptance                                                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context/context-service.ts`, `types.ts`      | Search/ranking and attachment orchestration with stable public shapes. No filesystem or Git dependency in the facade.                                                                                                                                                       |
| `context/workspace-index.ts`                  | Per-service index cache: five-second TTL, at most 20 completed workspaces and one active scan per workspace. Git discovery falls back to directory scanning.                                                                                                                |
| `context/context-files.ts`                    | Canonical workspace-contained reads, bounded file handles and non-symlink directory scanning. Read at most 48 KiB; UTF-8 decoding withholds incomplete trailing characters, and reports original byte size. File/folder links outside the root are rejected.                |
| `context/git-context.ts`                      | Git listing and read-only attachment queries/formatting. NUL-delimited listing preserves spaces, Unicode and newlines. Git actions remain explicitly Git-specific.                                                                                                          |
| `skills/types.ts`, `registry.ts`              | In-memory catalog, source precedence, purpose/name selection and prompt formatting; public compatibility directory helpers re-export the file owner.                                                                                                                        |
| `skills/skill-files.ts`                       | Environment path resolution, frontmatter validation, discovery and bundled installation. Only managed skills are overwritten. Active copies coalesce and are removed on settlement; completed installation receipts retain at most 20 directories. Failed copies can retry. |
| `skills/builtin/handoff/SKILL.md`             | Bundled delivery asset, installed with private directory/file modes. The existing core build script copies it into distributions.                                                                                                                                           |
| `session/execution/skill-catalog-delivery.ts` | Previously accepted per-session/provider/native-session delivery receipts and compaction reset. Catalog I/O stays in skills, delivery state stays in session execution.                                                                                                     |

## Configuration, database and root composition

| Module                                                | Owner and acceptance                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/index.ts`, `workspace.ts`                     | Explicit Config.load/workspace environment startup. Workspace discovery itself does not mutate the environment; loading dotenv does, only when called. Existing environment values take precedence.                                                                             |
| `config/runtime-defaults.ts`                          | Immutable defaults and lazy validated positive-integer environment getters. No environment capture/mutation at import.                                                                                                                                                          |
| `config/application-info.ts`                          | Installed package version metadata and protocol identity builder. Its package metadata read is an intentional immutable import-time value; no process/network/database resource.                                                                                                |
| `db/schema.ts`, `zod-schemas.ts`, `json-codecs.ts`    | Table definitions, derived validation and typed/defaulted JSON decoding. No connections, migrations or environment loads at import.                                                                                                                                             |
| `db/database.ts`                                      | Explicit SQLite factory, compatibility adapter, synchronous transactions/savepoints and migration execution. Existing historical SQL retained. Foreign keys are disabled before migration table rebuilds, checked after migration, then enabled; startup failure closes SQLite. |
| `db/default-database.ts`, `index.ts`                  | Lazy application-default database and path/environment startup access; no eager database singleton. Transaction options in workspace operations now use DbClient instead of unknown/casts.                                                                                      |
| `default-agent-runtime.ts`, `default-agent-driver.ts` | Explicit provider/ACP runtime factories and per-runtime diagnostics. No module-level recorder or process creation.                                                                                                                                                              |
| `default-repository-service.ts`                       | Explicit Git/directory backend composition; no backend default selected by neutral workflow code.                                                                                                                                                                               |
| `logger.ts`                                           | Logger contract and shared stateless no-op implementation. Application loggers remain injected.                                                                                                                                                                                 |
| Root `index.ts`                                       | Existing compatibility/public exports plus explicit factories. Imports allocate no database, vault, provider processes or MCP connections. Public export surface consolidation remains in its own checkpoint.                                                                   |

Declared shared state is limited to lazy default database/vault instances selected explicitly,
immutable metadata/policies, the bounded skill-install receipts and in-flight copy coordination.
Other accepted areas declare their state in the provider/session/repository ownership maps:
ACP cache writes retain only active work, process diagnostics use weak ownership, descriptor/
protocol/update/subagent caches are bounded, and session context grants expire and are released.
No new hidden process/environment startup path was introduced.

Verification covers pairing expiry/revocation/restart, encrypted persistence and atomic-write
failure, migration database rollback/retry, inert imports, configuration resolution, MCP lifecycle
races and real SDK peers, context containment/UTF-8/cache behavior, skill precedence/failed-copy
retry, session skill delivery, populated historical database upgrades and transaction/savepoint
rollback. Root type checks, lint, architecture/coverage regressions, formatting and builds are
part of acceptance; exact final counts are recorded in the migration tracker.
