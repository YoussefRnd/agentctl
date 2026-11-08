# Codebase refactor decisions

The audit started at `e87fc58`. The parsed graph contained 1,188 modules and 16 circular import edges, all in ACP or provider installation. The architecture suite passed its 11 baseline checks.

## Contracts and tooling

- Derive event payload types and validators from the same discriminated wire schema. Keep SQLite recovery defaults at the storage boundary.
  - `packages/shared/src/schemas/session-event.ts` listed every payload twice. `packages/core/src/db/json-codecs.ts` listed schemas again for writes, switched on the same kinds for reads and duplicated parsing in the named readers.
  - Storage reads tolerate malformed rows and preserve unknown event kinds. The historical text, tool, approval, plan, and mode readers also accepted double-encoded JSON. New writes validate against the shared schema.
- Use one decoder for JSON-backed fields in the session row schema.
  - `packages/shared/src/schemas/session-model.ts` copied the same catch and null handling for six fields. Malformed JSON and missing values still fall back, while valid JSON with the wrong shape still fails validation.
- Run repository ownership checks from one snapshot of tracked and untracked files and the checked-in ledgers.
  - `scripts/check-architecture.mjs` and `scripts/architecture/workspace.mjs` each enumerated files and loaded the scoped ledgers. A change between reads could produce contradictory results.
  - The backend performance fingerprint used a separate Git file list and could fail on a tracked source deletion in a dirty worktree. It uses the same existing-file snapshot.
  - `scripts/workspace-tasks.mjs` already loaded each package manifest at discovery, then reread the same file during every dependency traversal. Walk the discovered package graph directly.

## Core

- Move process and connection contracts to their owning boundaries. Give provider updates a narrow install contract.
  - ACP lifecycle, terminals, client handlers and connection types looped through `acp/types.ts`. Provider installation and update modules imported one another.
  - The module-cycle rule covered only shared and API-client source files. Apply it to all workspace modules, with a separate rule for frontend feature boundaries.
- Make provider handoff readiness and context preparation part of the transition into a turn.
  - `session-command-handler.ts`, `session-launcher.ts`, and `provider-context-delivery.ts` independently interpreted the handoff receipt. Context preparation could fail after turn bookkeeping or direct MCP execution, then replacement recovery could repeat work.
  - Context-budget errors were classified by matching message text. Historical transcript modes and `AGENTCTL_CONTEXT_TURN_LIMIT` had no production callers. Session-owned documents superseded the cleanup helper and process-local context file registration.
  - Stop could miss an accepted attempt while its native runtime was starting or binding. The queue records cancellation before runtime cleanup, and recovery honors terminal attempt states.
  - ACP adapters both build prompt blocks asynchronously before their wire call. One shared preparation guard keeps a cancelled prompt from being sent after attachment work finishes.
- Run code review and Git drafting through the same isolated text session.
  - `agent/code-review.ts` and `agent/text-generation.ts` separately disabled tools and permissions, bounded output, cleaned up a temporary workspace, and closed providers that finished startup after a deadline. They also stripped the same JSON fences before parsing their distinct results.

## Server, desktop and client

- Give repository workspace resolution and review revision capture named owners.
  - The code review, verification, fix and session repository services separately loaded worktrees and interpreted the legacy `none` revision. `review-workspace.ts` and `review-records.ts` own the review-specific revision and stored evidence rules.
  - Review results, fixes, handoffs, and walkthroughs use one freshness vocabulary.
- Use the actual diagnostics route in its HTTP test and remove the copied handler.
  - The old test could pass when the production handler changed.
- Use one desktop IPC channel vocabulary and one utility-process protocol.
  - Preload, main, windows and updates duplicated channel strings. Preserve renderer authorization and public bridge methods.
- Share SSE reader lifecycle and cancellable reconnect timing in the client.
  - State and session streams duplicated reading and abort behavior. Keep cursor reconciliation and stream-specific timing policies with their owners.
- Give terminal WebSocket input decoding and event request cancellation a single implementation each.
  - The terminal routes both parsed and forwarded messages. Parse fallback enclosed writes and could replay input on write failure. Session and auth terminals intentionally differ for unrecognized input.
  - The history page and detail routes both attached and removed the same HTTP disconnect handlers.

## Web and design system

- Build project-list queries from one typed factory and use the unfiltered query for global tray counts.
  - The home, palette, sidebar and session header built equivalent queries separately. A sidebar filter changed the native tray totals.
- Reuse the ordered button selection behavior for segmented controls.
  - Tabs and segmented controls independently handled arrow keys, disabled options, direction, and focus.
- Colocate history paging policy and session lifecycle actions with their respective owners.
  - History navigation and the history model duplicated query parameters and cache vocabulary. Sidebar and header repeated mutation effects and the fork-latest event marker.
- Centralize editor and theme preferences around their existing storage formats.
  - Workspace file opening and the editor picker interpreted saved editors independently. Theme preference migration wrote from render and theme application duplicated migration policy.
- Give the feed viewport one owner for initial and subsequent scrolling.
  - Initial scrolling used several forced delayed jumps that could race reader input. Resize and follow behavior already had an owner.
- Verify accessible form behavior and remove brittle output hashes.
  - The form field test could pass for a missing attribute and coupled to generated IDs. Design snapshots hashed CSS and rendered markup, including unrelated app CSS.

## Retained special cases

- ACP versions and historical records support existing peers and databases. The named protocol and persistence owners hold their compatibility branches.
- Reconnect waits, utility startup and shutdown deadlines, and terminal command fallbacks cover independent processes and platform behavior.
- The Markdown worker processes a single active syntax tree. The diff worker batches requests and bounds its cache. Each retains its own failure fallback and resource limits.
- Source tests use the actual route or behavior they protect. Compile-time event union assertions run through the workspace type check. The recovery test that spawns a fresh process relies on that process's assertions and exit status.

## Verification

- The post-refactor dependency graph contains 1,195 modules, zero circular import edges, and zero rule violations. The frontend feature relationships match the checked-in graph.
- Independent reviews covered the frontend, core, server, desktop, and client boundaries. The final cancellation review traced Stop from the operation store to both ACP adapters and back to persisted history. The regression tests cover startup, projection, tool preparation, wire preparation, and a rejected in-flight prompt.
- Node 26.13.0 passed workspace architecture, formatting, lint, type checking, and production compilation. The built Electron application passed startup, authorized IPC, rejection of a second window's IPC, shutdown, and startup-failure checks. The browser gallery passed its layout and focus checks, and the built desktop Markdown worker rendered highlighted code and named entities.
- The full suite passed all 1,894 application tests across 320 files and all 11 architecture tests.
- All three event-decoding workloads passed the 1.25 candidate-to-reference ratio limit. The measured ratios were 0.840, 0.812, and 0.855.
