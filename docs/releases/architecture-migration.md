# Architecture migration: source compatibility notes

These unreleased notes describe the architecture changes following the 0.3.0 release
preparation. They are ready for the next release's developer communication; they do not
publish a release, change package versions or replace the historical 0.3.0 upgrade notes.
The [migration acceptance record](../architecture-migration.md) identifies the verified revision.

## Resulting structure

AgentCtl keeps one modular monolith with separate server, web and native entry points.
Application services coordinate workflows; transport handlers translate their inputs and
results. Repository and agent contracts separate product workflows from Git, forge and ACP
adapters. Explicit composition owns database, provider, terminal, stream and native resources.

The frontend uses public feature entries and an acyclic feature graph. Shared transcript
rendering has no parent-session subscription. Remote data, drafts, queued delivery, transient
selection and native capabilities have separate owners. The UI package remains generic.
Architecture checks and exact file-ownership ledgers cover every repository source area,
including tests, assets and delivery tooling.

## Updating source consumers

Workspace packages are private, but integrations that import their source must update these
entry points together with AgentCtl. Existing HTTP clients do not need these source imports.

| Former source usage                                                                          | Supported owner / replacement                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionEngine` from shared or core                                                          | Import `SessionEngine` and its options from `@agentctl/api-client`                                                                                                                       |
| Eager `db` singleton from core                                                               | Call `getDefaultDatabase()` or `createDatabase()` through `@agentctl/core/db` during explicit composition; injected databases bypass the default                                         |
| Eager internal credential vault or vault-owned database migration                            | Use `getDefaultCredentialVault()` from `@agentctl/core` at composition and `migrateProviderCredentials(db, store)` from `@agentctl/core/security`; the vault owns encrypted storage only |
| API-client `queryClient` singleton                                                           | Call `createApiQueryClient()`; the host owns its singleton, mutation notifications, reset and navigation policy                                                                          |
| Client/shared URL-forwarding modules or renderer-specific client navigation                  | Configure `setApiBaseUrl()` and `setUnauthorizedHandler()` from the API client at app startup                                                                                            |
| Deep UI/client source imports, including UI source wildcards and `services/project-sessions` | Import named helpers/components from `@agentctl/api-client` or `@agentctl/ui`; styles use `@agentctl/ui/theme.css`                                                                       |
| Provider registry implementation classes from a root barrel                                  | Use the public `Provider`, `ProviderRegistry` and named discovery/launch/install contracts; concrete registry adapters are internal                                                      |
| ACP runtime/cache/path forwarding files                                                      | Protocol internals import their versioned driver, cache or security owner directly; application consumers use the public agent/ACP contracts                                             |
| Feature-internal paths or forwarding exports for rendering/navigation                        | Use reviewed feature entries or the actual shared transcript, markdown and navigation owners; app composition owns cross-feature workflows                                               |
| Duplicated web/native Electron API types or local preload contract forwarding file           | Shared `ElectronAPI`, `UpdateState`, `TrayStatus` and `WindowControlFlags` types come from `@agentctl/shared`; navigation subscriptions return cleanup functions                         |

Public package entries are listed in [public-api.json](../public-api.json). Tests retain shared
runtime values/schema identity and deliberately supported host facades. Git's public
`WorkspaceManager` and Git-specific `SessionWorkspace` remain supported adapters. Shared schema
aggregates and schema-derived context type aliases remain permanent APIs. Lazy process-default
factories remain explicitly invoked APIs; they are not eager import-time resources or temporary
migration shims. The [contracts audit](../contracts-architecture.md) records the detailed decisions.

## Wire and persisted-data compatibility

The architecture migration preserves the typed HTTP route method/path/status surface, ACP v1/v2
wire fields, event normalization, and historical session/recovery decoding. It adds no SQL
migration and does not rewrite existing historical migrations. New checkpoint writes contain
scoped opaque repository references; explicit adapter paths continue to import legacy raw Git
commit/tree selectors and recovery JSON. Existing field names remain supported.

Populated databases are tested from every historical migration boundary, including retained
session/event data and foreign-key validation. This architecture-only statement does not remove
the separate database/API changes documented for upgrading 0.2.0 to 0.3.0. Keep the normal backup
and version-specific upgrade procedure for the release you install.

## Supported scope

Git is the production versioned backend. Ordinary folders support local execution and advertise
unavailable history/checkpoint/restore/isolation capabilities. A file-backed non-Git adapter is a
test fixture. Adding a production backend still requires durable storage, recovery/retention,
capability-specific integration and conformance verification.

One server process owns each database. Distributed ownership, leases, new VCS implementations,
ordinary-folder history, sparse checkout and new pagination APIs remain separate product work.
Linux x64 native startup/IPC/shutdown is verified with the real built Electron application.
macOS/Windows runtime acceptance, signing, OS protocol association and downloaded update
installation remain platform/release checks. Synthetic browser journeys do not establish live
provider or network performance guarantees. No push, tag, package publication or deployment is
part of migration closure.
