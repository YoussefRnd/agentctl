# Frontend state, effects and rendering audit

This audit covers every file under `apps/web/src`, including bootstrap/CSS/declarations,
performance fixtures, test helpers and retained directories. The [web ownership ledger](web-ownership.json)
lists each non-test source file exactly once; colocated tests belong to the same capability.
The architecture checker rejects missing, duplicate and stale entries. The earlier
[composition map](frontend-architecture.md) describes feature dependency direction. Public export
and transport-contract cleanup is recorded separately in the contracts audit.

## State and workflow owners

| Area                           | Accepted ownership and decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App bootstrap/providers/router | Startup selects browser/native routing and installs app-wide query/theme/update owners. Error recovery clears the existing query client and remounts its boundary. State-change subscription owns one abortable reconnect loop; cache invalidation uses shared keys.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Shell and session composition  | Header/dialogs and launcher remain above features. Sidebar filters, pending actions and confirmation/rename state stay local. `useWorkspaceDrop` owns opening/invalidation/navigation; `droppedWorkspace` resolves portable/desktop drop metadata without I/O. Font zoom, shortcuts and search listeners/timers have paired cleanup.                                                                                                                                                                                                                                                                                                                                       |
| Routes                         | Assemble session providers, retained feed/workbench and page action ports. Page memoization and static sidebar preserve streaming isolation. The gallery owns isolated example query clients and fixture state, with no application queue writes.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Composer                       | `useComposerDraft` owns persisted input, pending insert consumption and the edit listener. `useComposerFiles` owns drop/paste/input routing to the existing attachment/context capabilities. `useComposerState` composes command/provider selection, submission admission and acceptance; rejected sends retain input. Context search cancels on scope/query changes and bounds its cache; attachments own upload aborts and object URLs. History, home-start recovery and queued-send state retain their existing owners.                                                                                                                                                 |
| Conversation                   | `useConversationHistory` owns the mutation guard, retained feed snapshot, rewind/edit/undo and refresh ordering. Provider selection uses the existing session configuration mutation; saved history transfers automatically with the next turn. Persisted provider changes render as timeline dividers with captured provider/model labels. `useFeedViewport` owns virtualizer state, prepend anchors, historical target loading, follow mode, active turns and its frames/observers/timers. `MainFeed` composes them with parent approval/draft and child selection. Pure grouping/turn parsing stays in lib; cards retain only their own presentation/interaction state. |
| Review                         | Captured revision/file queries and UI selection remain distinct. `useReviewGitActions` owns mutation admission, generation, commit/push sequence and branch-scoped retry; its view renders menus/dialogs. Retry after a successful commit never commits again. Diff virtualization, hunk quoting, staging/revert and immutable captures retain tested behavior. Turn-change parsing remains pure despite its size.                                                                                                                                                                                                                                                         |
| Sessions                       | Configuration, prompt events, accepted queue and high-frequency turn/stream state keep their separate contexts. Bounded historical windows and explicit abort/generation guards stay in the history owner. Client outbox is pre-acceptance delivery/retry state; accepted queue/execution stays server-authoritative. No context merge or new global event bus.                                                                                                                                                                                                                                                                                                            |
| Projects/providers             | Query factories and provider mutations own remote state. Directory selection and provider selection are feature views. The auth dialog owns method/env selection; `EmbeddedAuthTerminal` owns its socket/xterm and ignores late callbacks after disposal. Existing browser-auth interaction keeps server challenge ownership.                                                                                                                                                                                                                                                                                                                                              |
| Settings                       | React Query owns settings/MCP/registry data; overlay store owns visibility/active section. Auth/setup/settings heavy UI stays lazy. Profile/MCP forms retain local edit state until successful server acceptance. Download object URLs are revoked after use.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Subagents                      | Existing identity/grouping and session-scoped selection are retained. Shared read-only renderers receive child data and callbacks. Parent input, approval execution and cancellation remain outside child display. Child observers and elapsed timers are disposed.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Workbench                      | Shared navigation store owns tabs; terminal workspace store owns session-specific panes/layout. `useTerminalPane` owns one xterm instance and socket generation, callbacks, queued input, reconnect/resize timers and frame disposal. Reconnect always sends dimensions. `TerminalPane` renders chrome and an imperative display handle; `InteractiveTerminal` owns layout/ref registration and cancels its delayed fit. Plan artifacts/status/MCP panels remain read models.                                                                                                                                                                                              |
| Command palette                | Query data feeds a local search/action projection; open/query/filter/selection and focus restoration stay in the dialog. Keyboard and previous-focus behavior retain existing regression tests. The action list is cohesive presentation policy and needs no generic command framework.                                                                                                                                                                                                                                                                                                                                                                                    |
| Updates                        | Native snapshot/subscription lives in UpdateProvider with unsubscribe and late-result guards. A delayed initial snapshot cannot overwrite a newer event. Browser fallback remains inert. Native updater behavior is separate desktop scope.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Shared stores/hooks            | Workbench/project expansion/action/notification preferences and outbox have named client-only owners. Storage validation/recovery remains local; shared capabilities cannot import features. `useFrameScheduler` cancels deferred DOM work at session change/unmount; copy-feedback timers end with their display owner.                                                                                                                                                                                                                                                                                                                                                   |
| Shared rendering/workers       | Markdown worker/reveal and diff highlighter are lazy document-lifetime resources, shared across mounted consumers. Jobs release listeners on unsubscribe; markdown has a 15-second watchdog/no completed-document cache; diff cache is bounded to 1 MiB and batches 64 lines. Worker failure falls back to escaped text. These resources intentionally survive individual card unmounts and end with the renderer document. No synchronous grammar fallback during streaming.                                                                                                                                                                                              |
| Shared utilities/UI            | Query keys and workspace invalidation have one owner; existing cache identities are retained. Theme/media queries, relative-time scheduling and font pickers pair listeners with cleanup. File/editor/provider icons, parsing and formatting remain app-independent.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Performance/test support       | PerformanceLab and stream probes own synthetic measurement lifetimes and restore transport overrides; test helpers own isolated providers. Production fixtures reject unexpected API mutations. Timing is recorded as a trend rather than a live-provider claim.                                                                                                                                                                                                                                                                                                                                                                                                           |

The retained legacy feature directories are empty and rejected if production code reappears.
Large cohesive pure parsers, static action lists and visual fixtures are accepted without splitting
by line count. The ledger distinguishes these accepted owners from extracted workflow/resource owners.

## Query and compatibility decisions

`shared/lib/queryKeys.ts` supplies detail/events/review/execution/project/MCP identities to all
matching query writers and invalidators. The unused alternate session detail factory is removed, so a consumer cannot silently create
a second detail cache. Filtered project
lists keep filter values in their keys. Workspace mutation invalidation remains centralized in
`workspaceQueries`; it does not invalidate unrelated streaming data on every tool update.

The settings response derives from shared schemas; app composition owns the query singleton
and delegates HTTP/SSE to the client. The [contracts audit](contracts-architecture.md) records
all public API and alias decisions. There is no second transport or state owner.

## Verification

Existing interaction suites cover outbox acceptance/retry, rejected-send drafts, historical
paging/rewind/edit snapshots, automatic provider context transfer, virtualized diff and feed navigation,
child retained state, settings lazy loading and search keyboard behavior. Added regressions verify
terminal reconnect dimensions and complete disposal, cancelled focus frames and update snapshot
ordering/unsubscription. The production browser fixture covers navigation/deferred assets,
review-to-composer actions and parent/child/sibling retained drafts. Both renderer builds and the
built-desktop markdown worker smoke validate the shared sources. Exact acceptance results live
in the migration tracker.

### Compact history and expanded output

The web client opts into `compact=true` on history pages and session streams. Completed ordinary
read/search/execute/edit tool output, file bodies and terminal output are replaced with a
revision marker. Conversation messages, approvals, active tool inputs and delegation results
remain complete. File paths, operations, statistics, routing metadata and terminal identity
stay in the compact row so collapsed views and review summaries need no detail requests.
Unknown tool shapes are kept complete rather than guessing which fields drive their display.
This is a transport projection; persisted events and pagination selection are unchanged.

`shared/transcript/ui/EventDetailContent` owns expanded output loading through the API client's
session-scoped detail service. Queries are keyed by session, event ID and observed revision;
concurrent expanded views share a request. Full rows never replace compact rows in the history
cache. Closing the last view cancels in-flight work and immediately makes its detail cache
eligible for collection (`gcTime: 0`). Reopening fetches again. An updated revision cancels the
old subscription, and late responses cannot replace the newly displayed revision. Errors offer
explicit retry. The endpoint reads the current persisted event, so it can return a newer version
than the revision observed by the history page; it does not promise an immutable historical copy.
Deleted or rewound-away rows return 404.

Terminal expansion loads only events contributing to its existing 64 KiB tail, stopping at the
last replacement or enough UTF-8 output bytes. Complete detail responses can still be large;
this design reduces default transfer and retained client data rather than imposing a hard global
memory limit or truncating persisted output. Expanding every output trades those savings for
additional requests and full bodies while the views remain open.

### Session sidebar

The project sidebar keeps pinned sessions above recent sessions within each project. Pins and
monotonic read markers live on the server session row and reconcile through existing project
state notifications. Provider logos use the discovered provider metadata; branch/worktree details
and explicit working, approval, input, failure and unread-completion labels share each session row.

`ProjectQueries` summarizes root assistant output and turn/request events without returning
transcripts. Administrative changes and child transcript text do not create unread activity; actionable
approval/input requests from child agents still surface on the parent chat.
`useSessionReadMarker` acknowledges only loaded current history in a focused, visible chat, with
bounded event IDs supplied by the client. Prefetching, historical pages and background tabs do
not mark chats read. Sidebar mutations neither restore worktrees nor reconnect providers.
Migration 0059 initializes existing chats as read to avoid flagging historical work as new.
