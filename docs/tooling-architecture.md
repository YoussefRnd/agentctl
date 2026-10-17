# Architecture enforcement and delivery ownership

The repository keeps a modular monolith with explicit application composition, narrow ports,
pure policies and resource owners. Source additions need an owner and acceptance evidence.
The core, contracts and web ledgers cover their production trees; `workspace-ownership.json`
assigns every other versioned or newly added, non-ignored file, including tests, native/UI/server
sources, configuration, delivery scripts, patches, hooks and documentation. Coverage rejects
missing, duplicate and stale assignments across the combined ledgers. Documentation ownership
does not imply final migration closure, which has its own acceptance checkpoint.

| Rule                           | Enforcement                                                                                                                                                       | Regression evidence                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Package directions             | Parsed imports and canonical package/relative/web alias targets; shared/UI have no product dependencies; core and API client have separate host responsibilities  | `boundaries.test.mjs` covers type imports, re-exports, lazy imports, CommonJS require and relative bypasses    |
| Public package surfaces        | Manifest exports match reviewed map; all apps/packages use declared entries, including server composition entries; relative source bypasses rejected              | `public-api.test.mjs` includes platform-neutral path handling                                                  |
| Core/server module directions  | Existing workflow/persistence/transport/adapter policies apply to original and canonical targets                                                                  | Root checker checks all production source, including declarations; tests cannot become production dependencies |
| Desktop integration            | Shared contract separates main/preload; renderer uses shared DTOs and API client; every main IPC operation validates sender/frame                                 | Boundary fixtures, desktop lifecycle/IPC tests and real native smoke                                           |
| UI purity                      | No application packages, Node runtime, query/store/router ownership or hidden fetch/socket transport                                                              | Boundary fixtures, public export interaction tests, gallery/browser review                                     |
| Frontend layers/public entries | App owns composition; shared capabilities have no feature dependencies; alias and relative feature access obey reviewed entries                                   | Web checker and empty-cycle baseline regression tests                                                          |
| Cycles                         | Parsed feature graph remains acyclic; contract/client module graph is acyclic; nonempty feature baseline rejected                                                 | Dependency tests include multi-hop and resolved/new cycle cases                                                |
| Ownership completeness         | Git-tracked plus non-ignored additions, cross-ledger exact coverage; evidence links must exist                                                                    | Ownership tests and normal root architecture check                                                             |
| Import-time side effects       | Runtime initialization in core defaults/database adapters must remain explicit                                                                                    | Parsed top-level-call fixtures distinguish deferred work                                                       |
| Delivery                       | Root typecheck runs architecture checks; root test runs architecture regressions; CI and release run lint/types/tests/build/native/gallery and retain diagnostics | Local frozen-source and clean-checkout verification recorded in migration tracker                              |

Root and package manifests, TypeScript project references, lint/format hooks, Vitest projects,
workspace dependency policy and the packaging patch are retained. The patch removes pnpm's
obsolete `--loglevel` option from electron-builder's dependency collector; it remains necessary
for the configured pnpm version. Dependencies and lockfile policy are unchanged. The root test command runs the consolidated Vitest projects with two workers so package-level
Turbo jobs do not compete for memory or mask execution behind independent cached tests. Package
focused test scripts remain available. Native tests
remain in the existing jsdom Vitest project because Electron is mocked there; the separate smoke
runs the real runtime. The workspace clean command remains an explicit user-invoked destructive
maintenance utility and is not part of acceptance.

The desktop Turbo task explicitly depends on `@agentctl/web#build`, including its UI/API-client
dependency builds, so a clean targeted desktop build has all renderer dependencies ready.
Desktop build inputs include the external web source/index/manifest and migration files;
its cached outputs include `out/`, `release/` and copied `drizzle/`. Shared package changes flow
through dependency build hashes. Global TypeScript/test/architecture helper configuration is
included, and test/typecheck inputs retain the default package inputs rather than dropping
package manifests. The task hash regression checks reversible web source and UI CSS changes, confirms
the desktop build hash changes for each, and verifies restoration returns the original hash. Gallery/profiling outputs are deliberately separate from release
renderer output. CI/release native smoke is Linux; other native platforms remain explicit checks.

Clean-checkout verification uses an isolated snapshot with no existing generated outputs,
a frozen dependency install, architecture checks/regressions, typechecking and both renderer
builds. The exact results and subsequent full-source verification are recorded in
`architecture-migration.md`. Local execution does not claim a remote GitHub Actions run occurred.
