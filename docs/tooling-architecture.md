# Architecture enforcement and delivery ownership

The repository keeps a modular monolith with explicit application composition, narrow ports,
pure policies and resource owners. Source additions need an owner and acceptance evidence.
The core, contracts and web ledgers cover their production trees; `workspace-ownership.json`
assigns every other versioned or newly added, non-ignored file, including tests, native/UI/server
sources, configuration, delivery scripts, patches, hooks and documentation. Coverage rejects
missing, duplicate and stale assignments across the combined ledgers. Documentation ownership
does not imply final migration closure, which has its own acceptance checkpoint.

| Rule                           | Enforcement                                                                                                                                                       | Regression evidence                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Package directions             | Parsed imports and canonical package/relative/web alias targets; shared/UI have no product dependencies; core and API client have separate host responsibilities  | `boundaries.test.mjs` covers type imports, re-exports, lazy imports, CommonJS require and relative bypasses     |
| Public package surfaces        | Manifest exports match reviewed map; dependency-cruiser resolves declared entries to source and rejects relative source bypasses                                  | `public-api.test.mjs` exercises the actual resolver before any build                                            |
| Core/server module directions  | Dependency-cruiser enforces workflow/persistence/transport/adapter policies against resolved targets                                                              | `boundaries.test.mjs` exercises real direction violations; production cannot import tests                       |
| Desktop integration            | Shared contract separates main/preload; renderer uses shared DTOs and API client; every main IPC operation validates sender/frame                                 | Boundary fixtures, desktop lifecycle/IPC tests and real native smoke                                            |
| UI purity                      | No application packages, Node runtime, query/store/router ownership or hidden fetch/socket transport                                                              | Boundary fixtures, public export interaction tests, gallery/browser review                                      |
| Frontend layers/public entries | App owns composition; shared capabilities have no feature dependencies; alias and relative feature access obey reviewed entries                                   | Dependency-cruiser fixtures include test-file public entries and relative bypasses                              |
| Cycles                         | Dependency-cruiser checks production feature folders and contract/client modules; governance rejects cycle exceptions                                             | Fixtures include type-only cycles and feature cycles with no module cycle; test-only feature edges are excluded |
| Ownership completeness         | Git-tracked plus non-ignored additions, cross-ledger exact coverage; evidence links must exist                                                                    | Ownership tests and normal root architecture check                                                              |
| Import-time side effects       | Oxlint AST rules require explicit initialization in core defaults/database adapters                                                                               | Real Oxlint fixtures distinguish factories from eager construction and immediately invoked functions            |
| Delivery                       | Root typecheck runs architecture checks; root test runs architecture regressions; CI and release run lint/types/tests/build/native/gallery and retain diagnostics | Local frozen-source and clean-checkout verification recorded in migration tracker                               |

Architecture enforcement has three owners:

- `scripts/architecture/dependency-config.mjs` declares dependency-cruiser rules for packages,
  workflows, adapters, public entries and cycles. `scripts/check-dependencies.mjs` runs the engine.
  Workspace exports resolve to their source entries, `.js` imports resolve TypeScript sources,
  and `@/` follows the web alias. Type-only imports participate in architecture checks.
- `scripts/oxlint/architecture.mjs` supplies the small AST rules enabled by Vite+: UI/shared
  networking, server transport database access and eager runtime initialization. They run in
  `pnpm lint`, `vp check` and staged linting, with editor diagnostics through Oxlint.
- `scripts/check-architecture.mjs` retains repository governance: ownership/evidence coverage,
  reviewed manifest exports, removed legacy entries and the prohibition on cycle exceptions.

`pnpm architecture:check` runs governance and dependency checks. `pnpm architecture:graph` emits
dependency-cruiser's JSON module graph and production `folders` graph; it does not require a build.
The runner validates public feature entries in tests too, then checks feature-folder cycles in
a production-only pass so test helpers do not create production cycles. The deleted custom import
parser, resolver, cycle detector and separate web checker no longer duplicate those engines.
`pnpm check` is the combined gate including the syntax rules. Package typecheck tasks perform
TypeScript checks; the root typecheck command also runs architecture checks.

The migrated regressions invoke the real dependency-cruiser and Oxlint engines in disposable
workspaces. They retain static/type/re-export/lazy/CommonJS/template imports, adapter directions,
package and feature entry restrictions, multi-hop module and feature cycles, ownership/export
drift, and eager versus deferred initialization. Comments and string literals cannot masquerade
as imports or prohibited calls.

Vite+ owns workspace task orchestration, web development/builds, the consolidated test runner,
linting and formatting. Use the package scripts through pnpm; no global Vite+ installation is
required. The root `vite.config.ts` owns test projects and lint/format policy. Each application
and library defines its commands in a local Vite config through `scripts/workspace-tasks.mjs`.
Public package scripts delegate to `compile`, `types` and `watch` tasks. Root builds select
`compile` tasks directly so dependency commands are not expanded repeatedly through aliases.

`compile` follows workspace dependencies and dev dependencies. Its cache includes the transitive
workspace source/configuration closure, shared tooling, lockfile and root environment files.
Explicit inputs protect native TypeScript compilers whose filesystem reads may bypass automatic
tracing, and include newly added source files. Inputs intentionally exclude generated artifacts;
tracking reads of generated directories could invalidate the cache when outputs are deleted.
Multi-step builds use `scripts/run-build-steps.mjs` so a single cache entry contains
the final output; restoring separately cached steps could otherwise resurrect intermediate files
that a later step deleted. Outputs include complete `dist/` artifacts and
build info. Explicit workspace prerequisites also contribute their transitive source inputs.
The desktop compile task depends on `@agentctl/web#compile`, fingerprints the renderer's UI and
API-client dependencies and migration sources, and restores `out/` and copied `drizzle/`. An uncached
Electron runtime prerequisite also runs on cache hits, since its binary lives in `node_modules`.
Installer
packaging remains an uncached script that runs the compile task first. Gallery/profiling outputs
are separate from the release renderer. The workspace task regression exercises real cache hits,
restoration after artifact removal, dependency edits/additions, external renderer inputs, unrelated-package isolation and
dev environment passthrough in a disposable workspace.

`types` and `watch` tasks are never cached. Root development commands finish prerequisite builds
before starting watchers with `--parallel`, because that mode ignores dependency ordering.
Desktop prerequisites include the server build, while the watch phase excludes a standalone
server: Electron owns its embedded server. Uncached watchers inherit the host environment,
including desktop session/cursor variables. Core's existing predev asset copy remains a lifecycle
hook. The workspace clean command is an explicit user-invoked destructive utility, outside the
acceptance gate.

`pnpm check` runs architecture checks, Vite+ formatting/lint checks and the existing TypeScript
project-reference checks. Type-aware linting remains a separate policy decision;
`pnpm typecheck` is authoritative. Husky runs `vp staged` for staged lint/format fixes and retains
commitlint. CI and release workflows check formatting. Vite+ and Vite/Vitest resolutions are
pinned together in workspace policy. The electron-builder patch still removes pnpm's obsolete
`--loglevel` argument from dependency collection.

Tests use Vitest 5 defaults for mock clearing, shared Vite servers and inline-project inheritance.
Node and jsdom projects keep their intended environments and file sets, with two workers and
no test-result cache. Native unit tests mock Electron in jsdom; the separate Linux smoke runs
the real runtime. Other native platforms remain explicit checks.

Local Vite+ acceptance (2026-10-18, Linux, Node 24.20.0) passed frozen dependency validation,
all 1,532 tests in 267 files, 12 architecture regressions, formatting/linting, project and tooling
configuration typechecks, workspace builds, the root web development command, the real Electron
lifecycle smoke and the built desktop Markdown worker in Chrome. An isolated snapshot with a
frozen dependency install and no generated outputs built the desktop and all prerequisites.
Removing all eight artifact trees and build info restored identical file contents from seven
compile-cache hits; a removed Electron binary was installed again. Adding and removing a UI
stylesheet invalidated UI, web and desktop compilation, followed by seven cache hits on an
unchanged build.

Architecture-tool migration acceptance (2026-10-18) passed all 1,532 application tests,
11 architecture regression scenarios through the real engines, the combined quality gate,
workspace builds and a frozen dependency install. Dependency-cruiser 18.6.0 reports no
violations, and its production feature relationships exactly match
`frontend-feature-graph.json`. Ownership coverage includes all 1,170 repository files.

Earlier architecture-migration clean-checkout and full-source evidence remains recorded in
`architecture-migration.md`. Local execution does not claim a remote GitHub Actions run occurred.
