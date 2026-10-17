# Frontend composition and dependency ownership

The feature graph is generated from parsed imports, re-exports, dynamic imports and type imports
by `apps/web/scripts/check-architecture.mjs --json`. The checked-in
[graph snapshot](frontend-feature-graph.json) records acceptance. Shared capabilities cannot
import application/features through aliases or relative barrels, and features cannot import page
composition. This prevents moving a cycle into a shared directory without changing ownership.

## Session, composer and review composition

The original graph contained six cyclic edges between composer, sessions and review. All six
are removed. Composer and review may consume session model capabilities; sessions have no
reverse dependency on their UI. Composer does not consume review and review does not select a
composer store. Conversation/subagent cycles remain assigned to the next checkpoint.

| Owner                                                      | Responsibility                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/session/SessionHeader.tsx`, title/dialog helpers      | Page header composition: session identity and lifecycle actions, workspace presentation and editor integration.                                                                                                  |
| `app/session/QuickLaunchSessionDialog.tsx`                 | Composes provider/settings selection, native import and composer home drafts; prepares navigation without creating a session prematurely.                                                                        |
| `app/shell/ProjectItem.tsx`, `routes/SessionWorkspace.tsx` | Compose the launch dialog/header/workbench and supply draft actions to the review pane.                                                                                                                          |
| `features/sessions/model/SessionConfigContext.tsx`         | Existing configuration/workspace subscription owner; typed `useSessionWorkspace` and `useSessionConfiguration` views expose focused capabilities without creating another state owner or changing subscriptions. |
| Existing sessions queue/execution/prompt hooks             | Retained focused streaming capabilities. No provider merge, broad transcript subscription or queue lifetime change.                                                                                              |
| `shared/workspace/useGitStatus.ts`                         | React Query workspace status/PR capability using the existing cache keys and invalidation. No dependency on review presentation.                                                                                 |
| `shared/editors/EditorIcons.tsx`                           | Reusable editor brand presentation, independent of session/review features.                                                                                                                                      |
| `features/review/model/composer-actions.ts`                | Explicit page-supplied context attachment/text insertion port. No composer store import, event bus or second draft owner.                                                                                        |
| ReviewView → ReviewFileList → DiffBlock/hunk header        | Pass the same action port to file attachment and hunk quotation. Diff virtualization, query captures and editor/stage/revert behavior remain owned by review.                                                    |
| `features/workbench/ui/Workbench.tsx`                      | Receives the action port and supplies it to the lazily loaded review pane. Deferred terminal/settings/auth/setup loading remains intact.                                                                         |
| Composer draft store, command bar and input hooks          | Retain draft persistence, queued-send integration and pending input/context consumption. Review invokes their page-supplied callbacks.                                                                           |

The existing session configuration subscription still owns its original state. Typed capability
views intentionally do not claim new render isolation; streaming/queue/prompt boundaries remain
separate and retain their regression coverage. Compatibility exports for workspace status/editor
presentation forward to the shared owner; the moved page components are no longer re-exported
from sessions, so feature barrels cannot reintroduce page composition.

Verification includes configuration, draft persistence, context insertion/quotation through an
alternate injected target, captured review/diff virtualization, queue acceptance and navigation.
`performance-browser.mjs --journeys --verify-deferred --architecture-journeys` exercises the
production bundle with synthetic APIs: click/hover/focus/revisit navigation and deferred settings,
draft restoration, review file attachment, hunk quotation and launch dialog cancellation. It
contacts no model provider and rejects unexpected fixture mutations. Timing samples are fixture
measurements, not live-provider performance claims.
