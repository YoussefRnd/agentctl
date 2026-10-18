# Performance baseline and optimization milestones

Milestone 1 adds an isolated browser lab, repeatable CPU benchmarks, and opt-in measurements for real application journeys. Milestone 2 optimizes streaming text and final code highlighting. Milestone 3 narrows event subscriptions and avoids redundant timeline rendering. Milestone 4 measures production startup/navigation, defers closed overlays, and prefetches session data on navigation intent. Milestone 5 protects repeatable wins with CI checks and retains timing trends as artifacts. Results below distinguish component render time, production journeys with synthetic APIs, and native startup.

## Run the lab

From the repository root:

```sh
pnpm --filter @agentctl/web perf:build
pnpm --filter @agentctl/web perf:baseline
```

The runner uses installed Google Chrome, a temporary browser profile, and a localhost-only static server. It saves JSON and a screenshot under `performance-results/`, then closes its browser and server. It does not connect to the AgentCtl server or start an agent. Set `CHROME_PATH` if Chrome has another executable name. Chrome's sandbox remains enabled by default.

For an interactive run:

```sh
pnpm --filter @agentctl/web perf:preview
```

Open `http://localhost:4174/performance.html`, keep the tab in the foreground, and click **Run baseline suite**. The page uses real `StreamingMarkdown`, `EventFeed`, and `CommandInputComposer` components with synthetic data and disabled queries. An API request is rejected rather than forwarded to a real server. Its empty session providers exclude SSE processing and provider work from the component benchmark.

The lab is a separate HTML entry, included only in the performance build. Normal application builds exclude it and retain the ordinary React renderer. The performance build uses React's production profiling renderer, without StrictMode replays.

## What is measured

- Six scenarios: short reply, long reply, code and tables, 200-event history, 1,000-event history, and dense tool activity.
- Each scenario gets one discarded warmup and three measured repetitions. Streaming scenarios start with an existing response and append 40 five-character chunks at a nominal 50 ms cadence. History scenarios update the last provider response 12 times at the same cadence.
- Mounting, update processing, and stream completion/deferred highlighting have separate phase results.
- React commit counts and render durations, DOM mutation record counts, animation-frame gaps, and main-thread tasks over 50 ms are recorded. `blockingMs` is the sum of each long task's duration beyond 50 ms, not all CPU work.
- Controlled composer state is updated alongside the workload. The harness waits for the actual input value to commit, then two animation frames. These synthetic input timings exclude keyboard dispatch and are not an INP measurement.
- Ten CPU baselines cover Markdown splitting, grapheme segmentation, event grouping, turn grouping, and history merging. Each has warmup, adaptive batch sizes, and nine timed batches. CPU percentiles describe batch averages per operation, not individual-call tail latency.

Two animation frames approximate a paint opportunity; they do not prove pixels reached a physical display. Headless Chrome's roughly 60 Hz frames do not establish 120 Hz hardware performance. Unsupported long-task metrics remain `null`. A hidden tab or fixture failure invalidates the suite rather than exporting a partial success.

## Initial results — October 7, 2026

Collected using Chrome 154 on Linux, a production profiling build, a 1280 × 813 viewport, and reduced motion disabled. Values below are medians of three scenario repetitions; the stall column is the largest observed long task. These are local lab results, not field p75/p95 measurements.

| Scenario                         | Total conversation React render time | Mount to paint opportunity | Largest long task |
| -------------------------------- | -----------------------------------: | -------------------------: | ----------------: |
| Short reply, about 2 KB          |                                85 ms |                      50 ms |              None |
| Long reply, about 32 KB          |                               811 ms |                     104 ms |             97 ms |
| Long reply with code and tables  |                               978 ms |                     206 ms |            157 ms |
| Recent conversation, 200 events  |                               109 ms |                      60 ms |              None |
| Large conversation, 1,000 events |                               232 ms |                      99 ms |             66 ms |
| Dense tools, 1,000 events        |                               113 ms |                      57 ms |              None |

The short and long streaming cases use the same chunk cadence and count. The long plain response spends approximately 690 ms rendering during updates, versus 69 ms for the short response. Its update phase had no task over 50 ms, but its repeated work still consumes substantial CPU. The code/table case also has completion tasks up to 151 ms: idle scheduling postpones expensive work without making that work smaller.

Measured median CPU costs per operation:

| Path                  |                    Input |     Cost |
| --------------------- | -----------------------: | -------: |
| Grapheme segmentation | 32,882 UTF-16 code units |  4.35 ms |
| Markdown segmentation | 32,882 UTF-16 code units | 0.049 ms |
| Turn grouping         |             1,000 events | 0.666 ms |
| Feed grouping         |             1,000 events | 0.249 ms |
| History merging       |             1,000 events | 0.087 ms |

The raw capture is `performance-results/baseline-2026-10-07.json`; generated results and screenshots are ignored by Git. Retain that capture when comparing the next milestone. Future runner exports include the build HTML hash and host metadata for provenance.

## Milestone 2 implementation

`GraphemeRevealBuffer` segments each appended suffix once, including the previous final grapheme so emoji, flags, combining marks, CRLF, and split surrogate pairs remain intact. Animation frames consume cached reveal units. Initialization happens once per mounted stream; replacements and truncations discard the old backlog. Completion and reduced motion flush it immediately. Finished progressive Markdown blocks retain their existing memoized components.

For completed responses of at least 8,192 UTF-16 units containing fenced code, a lazily created module worker performs the full-document Markdown/GFM conversion and syntax highlighting. ReactMarkdown renders the prepared tree using its existing raw-HTML, URL, code-block, and table handling. The pending view retains the progressive component, removes the caret immediately, and switches to the complete tree in a React transition. Short replies and long plain-text replies use the synchronous renderer. This limits worker startup and transfer overhead to the code-heavy completion path that stalled in the baseline.

One shared worker deduplicates active documents, cancels queued work without subscribers, ignores stale results, and releases completed jobs rather than caching conversation content. Worker creation, execution, transfer errors, or a 15-second timeout fall back to the full synchronous renderer. Tests verify full-document reference links, footnotes, tables, nested lists, unknown languages, highlighted code, raw HTML, unsafe URLs, stream replacement/resumption, reduced motion, and cleanup.

The worker build resolves Markdown's named-entity decoder to its DOM-free implementation. Development uses the same implementation through an alias because its worker dependencies share the browser optimizer. Production renderer bundles retain the smaller browser decoder. The new 322 KB worker asset loads on demand. After building the lab, `node apps/web/scripts/performance-browser.mjs --worker-smoke` verifies highlighted code and named entities in the actual built worker using Chrome.

The lab now waits for an explicitly complete renderer and verifies final code highlighting and worker use before accepting a code/table sample. The completion window still includes a minimum 650 ms wait and is not a time-to-highlight metric. Benchmark runs made alongside builds/tests or using the synchronous fallback are excluded from the worker comparison.

### Milestone 2 results — October 7, 2026

Same six fixtures, browser, viewport, profiling renderer, discarded warmups, and three measured repetitions as the baseline. No tests or builds ran during this final capture. Render values are medians; the completion-task values are maxima across the three repetitions.

| Scenario             | Update React time, before → after | Completion React time, before → after | Total React time, before → after |
| -------------------- | --------------------------------: | ------------------------------------: | -------------------------------: |
| Short reply          |                     68.7 → 8.4 ms |                          9.2 → 5.7 ms |                   84.5 → 20.6 ms |
| Long plain reply     |                   690.4 → 30.1 ms |                        39.3 → 42.1 ms |                 810.8 → 164.6 ms |
| Long code and tables |                   724.0 → 43.0 ms |                       124.8 → 23.5 ms |                 978.2 → 192.7 ms |
| Recent conversation  |                    75.2 → 73.8 ms |                          6.2 → 7.7 ms |                 109.4 → 108.2 ms |
| Large conversation   |                  162.1 → 166.1 ms |                        16.6 → 16.5 ms |                 232.4 → 235.4 ms |
| Dense tool activity  |                    78.9 → 77.4 ms |                          7.6 → 6.6 ms |                 113.1 → 111.4 ms |

Long-reply update render work fell by 94–96%. Code/table completion React work fell by 81%, and its largest completion long task fell from 151 to 75 ms. Worker parsing does not remove all main-thread work: code/table mounts still reached a 138 ms task, and the plain-text completion had one 52 ms task. Plain-text completion and history rendering showed no demonstrated improvement. Synthetic input p95 remained essentially unchanged for the streaming fixtures; reduced render CPU does not establish better INP, provider latency, or native startup time.

Retained captures: `performance-results/baseline-2026-10-07.json`, `milestone-2-segmentation.json` (isolates the buffer change), and `milestone-2-final.json` (verified worker). Earlier experiments are named `milestone-2-fallback.json` and `milestone-2-contended-fallback.json` and are excluded. Results remain local ignored artifacts; this table preserves the reviewable summary.

Validation: 120 related tests across conversation components, stream buffering, worker lifecycle, performance fixtures, and opt-in instrumentation passed. Web typechecking, lint, architecture checks, normal and performance builds passed. The actual built-worker Chrome smoke test and all 18 final browser samples passed. Vite still reports the existing review-barrel dynamic-import warning. Packaged Electron execution and real provider/SSE latency were not tested in this milestone.

## Milestone 3 implementation

The stream provider now publishes separate queue/actions, execution/progress, and user-prompt contexts. Queue arrays and handlers retain their references during text updates. Turn progress is derived once in the provider and retains its reference while phase, start time, cancel availability, and retry details remain equal. Historical response cards subscribe to that smaller state. Composer queue controls and session actions use the queue context; composer history receives a stable user-event list instead of every provider chunk. Actual queue, prompt, retry, approval, and completion changes still propagate.

Timeline ticks compare the fields displayed in their previews, so a newly grouped event array no longer causes every tooltip and tick to render. Selection reads the latest committed full turn and callback by index, preserving current data even when the preview skips rendering. Existing grouping, SSE ordering, delta reconciliation, pagination, and virtualization remain in use; their correctness tests pass.

### Measure the SessionEngine path

The lab's **Run stream probe** button adds a separate measurement:

```sh
pnpm --filter @agentctl/web perf:build
node apps/web/scripts/performance-browser.mjs performance-results/stream.json --stream-probe
```

It seeds 1,000 history rows, feeds 16 text deltas and final persisted rows through an in-memory `ReadableStream`, and uses the actual SessionEngine SSE parser, 16 ms batching, query cache, stream provider, and EventFeed. It verifies that the final response reaches the feed. The synthetic session has no outbox messages; APIs remain blocked, and this does not run an agent. Memoized queue, progress, and prompt observers count their committed renders. Server execution, network delivery, a full composer, and native Electron startup remain outside its scope.

### Milestone 3 results — October 7, 2026

Same browser and profiling build configuration, one discarded warmup and three measured repetitions. These are local medians with no tests/builds running alongside the browser. The six component fixtures are unchanged from milestone 2; the SessionEngine probe has its own before/after captures.

| Scenario                          | Update React time, milestone 2 → milestone 3 | Reduction |
| --------------------------------- | -------------------------------------------: | --------: |
| Recent conversation, 200 events   |                               73.8 → 51.7 ms |       30% |
| Large conversation, 1,000 events  |                              166.1 → 72.5 ms |       56% |
| Dense tool activity, 1,000 events |                               77.4 → 58.9 ms |       24% |
| SessionEngine path, 16 deltas     |                              239.7 → 48.5 ms |       80% |

On the SessionEngine probe, post-mount queue and progress observer commits fell from 19 each to zero. Prompt observer commits fell from 19 to one: the final status row legitimately trims the loaded history window and removes its oldest input. Unit tests separately verify stable subscriptions during an active turn, edited prompts, queue changes, retry updates/reset, approval attention, and completion. Timeline selection tests verify that memoization still delivers the latest full turn and handler.

Long-response streaming retains milestone 2's gains: update React medians were 27.4 ms for plain text and 39.8 ms for code/tables. The code/table completion renderer was verified to use the worker. Initial mounts still stall: the largest observed history mount task was 79 ms, and the code/table mount reached 190 ms; that fixture also had one 65 ms update task. This milestone demonstrates less repeated render work, not a reduction in every stall or a measured INP/startup improvement.

Retained local captures: `performance-results/milestone-3-final.json` and `milestone-3-stream-before.json` / `milestone-3-stream-after.json`. Generated captures and screenshots remain ignored by Git.

Validation: all 337 web tests across 76 files passed, along with web typechecking, lint, architecture checks, normal and performance builds. All 18 component samples and both three-sample SessionEngine captures completed successfully. The existing Vite review-barrel dynamic-import warning remains.

## Milestone 4 implementation

Session links prefetch detail and the latest history page on mouse hover or keyboard focus. Repeated intent shares an in-flight request; at most two sessions can be prefetched concurrently. Existing live history is left intact. The initial-page cache is fresh for five seconds and discarded after thirty seconds without use. The history hook retains cursor/anchor initialization and connects the usual SessionEngine. Explicit history refetches bypass that cache, so a rewind or other invalidation cannot replay the prefetch snapshot. Failed prefetches are silent; opening the session still uses the normal error/retry flow. Ordinary clicks do not wait for speculative work.

Settings screens load when opened, onboarding loads only after settings confirm it is incomplete, and provider authentication (including its terminal library) loads only when opened. Dialog loading states can be dismissed. The settings feature entry now exposes its live hooks/stores and overlay boundary; gallery-only screens are imported by the development route, which is lazy and excluded from the production router. The existing vendor chunk configuration remains in use.

### Measure production startup and navigation

```sh
pnpm --filter @agentctl/web build
pnpm --filter @agentctl/web perf:journeys
# Choose an output filename explicitly:
node apps/web/scripts/performance-browser.mjs performance-results/journeys.json --journeys --verify-deferred
```

This mode serves the **normal production build**, with real routing, providers, query cache, virtualized feed, composer, and sidebar links. A localhost fixture server responds only to synthetic GET APIs, with a fixed 120 ms delay and 200 text events per session. Idle SSE connections use the real session engine. Unexpected APIs or mutations fail the run; no AgentCtl backend or agent is contacted. Remote fonts are blocked so every run uses the same system fallback.

The runner discards one warmup and retains three page reloads with HTTP caching disabled in a temporary browser profile. It records navigation-start-to-enabled-composer plus two frames, and click-to-loaded-feed plus two frames. First visits include an immediate click, a 250 ms hover lead-in, and a 250 ms keyboard-focus lead-in; it also revisits the starting session. Resource byte counts, startup long tasks, and synthetic request timings help explain the results. The strict mode checks that closed settings/authentication/terminal assets were not downloaded at startup and that hover/focus fetched both detail and history before clicking. Every run opens and closes the real settings dialog by keyboard shortcut to verify the deferred screen remains reachable.

The 250 ms lead-in is **outside** click latency. Prefetching moves fetching earlier; it does not make the server faster. These are browser journeys against controlled APIs, not real backend/provider latency or packaged Electron startup.

### Milestone 4 results — October 7, 2026

Final paired repeat, one discarded warmup and three measured samples per build, with no tests/builds running alongside Chrome. The prior build was reconstructed in a temporary source copy with milestone 3 streaming/context changes retained and the original stylesheet; the working source was never reverted. The first pre-change capture is also retained as a cross-check.

| Journey / resource                |          Before |     Milestone 4 |
| --------------------------------- | --------------: | --------------: |
| Launch to typeable                |        923.5 ms |        859.1 ms |
| Immediate click                   |        374.4 ms |        377.1 ms |
| Click after hover                 |        385.9 ms |        215.5 ms |
| Click after keyboard focus        |        372.5 ms |        242.4 ms |
| Cached revisit                    |        160.1 ms |        191.3 ms |
| JavaScript loaded before typeable | 2,013,667 bytes | 1,606,191 bytes |

Hover navigation improved 44% and keyboard-focus navigation 35% in this paired repeat. The earlier captures showed the same direction for these two journeys, but varied in magnitude. Initial JavaScript bytes fell 20%; the browser verified that closed settings, onboarding, authentication, and terminal assets were deferred. No session/history GET was repeated after a completed intent prefetch.

Ordinary clicks showed no improvement, and cached revisits were slower in this capture. Startup and navigation timings varied across repetitions, so the startup result does not establish a reliable latency reduction. Startup long tasks remain. Treat these three-sample timings as local trends; the repeatable wins here are less eager code and successful request prefetching, with a measured benefit for intent-led navigation.

Retained local captures: `performance-results/milestone-4-before.json` (original pre-change build), `milestone-4-repeat-before.json` (baseline cross-check), and `milestone-4-final.json` / `.png` (final build). `milestone-4-after.json` is an intermediate capture preceding the final ordinary-load/refetch safeguards. Generated reports and screenshots remain ignored by Git.

Native startup remains unmeasured: this execution environment has neither a display (`DISPLAY` is unset) nor Xvfb. Existing `AGENTCTL_PERF=1` instrumentation is available for a desktop run on a display-equipped machine. No earlier-window or persistent-composer change was justified by these browser measurements. Large history mounts and final React/DOM work remain candidates for further investigation.

Validation: all 346 web tests across 78 files passed, including pending-prefetch deduplication, cursor/anchor preservation, failure handling, live-history protection, and fresh refetch after rewind. Web typechecking, lint, architecture checks, formatting, and normal/performance builds passed. Production browser validation passed deferred-asset and intent-request checks and exercised visible feed/composer/settings behavior; the built Markdown worker smoke also passed. The existing Vite review-barrel dynamic-import warning remains.

## Milestone 5: regression safeguards

Run the same checks locally as CI, after building both versions:

```sh
pnpm exec vp run --filter '@agentctl/web...' compile
pnpm --filter @agentctl/web perf:build
pnpm --filter @agentctl/web perf:check
# Optional explicit artifact directory (relative to your current directory):
node apps/web/scripts/performance-check.mjs performance-results/my-check
# Budget checker tests without a browser or build:
pnpm --filter @agentctl/web perf:test
```

`perf:check` sequentially runs the budget checker tests, the built Markdown worker smoke in profiling and production web builds, all six component fixtures (18 samples), the real SessionEngine probe (three samples), and production startup/navigation (three samples). Each browser run uses a fresh temporary profile and the synthetic transports described above. Build and test processes should finish before collecting timings. Existing quality CI keeps the Unicode, cancellation, stale worker result, Markdown parity, subscription, navigation cache, and overlay correctness tests.

The checked-in policy is `apps/web/scripts/performance-budgets.json`. Every measured sample must pass:

| Check                             | Budget / required behavior                                                                    | Evidence                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| JavaScript loaded before typeable | At most 1,750,000 decoded bytes                                                               | Milestone 4: 1,606,191 bytes; about 9% headroom, below the earlier 2,013,667 bytes |
| Queue / turn subscriber commits   | Zero per 16-delta sample                                                                      | Milestone 3 eliminated unrelated streaming invalidations                           |
| Prompt subscriber commits         | At most one per sample                                                                        | Final history trimming legitimately changes prompt history                         |
| Hover and focus prefetch          | One detail GET and one history GET before click, with no repeat through feed paint            | Milestone 4 reused completed or pending intent requests                            |
| Closed overlay code               | No settings/onboarding/authentication/terminal asset in startup resources                     | Deferral remains observable in production                                          |
| Final long code/table reply       | Actual worker result, highlighted code, no streaming caret                                    | Prevents silent main-thread fallback from passing                                  |
| Report completeness               | Known schema/fixture version, full repetitions, unchanged workload sizes, finite measurements | Prevents partial or invalid reports from passing                                   |

There are **no elapsed-time, frame-gap, long-task, CPU-time, or total React commit thresholds**. Smoothing and frame scheduling vary with the browser/host. Render duration and launch/navigation medians are saved as trends; functional timeouts still fail an incomplete fixture. Startup bytes are decoded resource sizes, not compressed transfer bytes or total distribution size.

The independent `Web performance safeguards` CI job runs on Ubuntu 24.04 with Node 24 and installed Chrome. The OS label is pinned; Chrome updates with the [GitHub runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). Reports include browser/Node versions, CPU/platform, entry HTML hash, and the CI commit SHA. The job builds only the web app and its workspace dependencies, then runs the suites sequentially. GitHub's step summary shows checks and timing medians. JSON, screenshots, and `summary.md` upload on success or failure with 14-day retention; failed browser runs also save a failure JSON and screenshot when the page remains reachable. Independent suites continue after a failure, but the command exits unsuccessfully if any check fails.

Locally, artifacts go to ignored `performance-results/check/`. Existing milestone 1–4 captures remain there as local before/after evidence; the checked-in policy and result tables preserve the reference values. Download CI artifacts before their retention expires if a comparison must be kept longer.

The main quality job also smoke-tests the emitted desktop worker after its Electron build and uploads separate diagnostics. Electron uses its own Vite configuration, so its worker resolver and development alias select the same DOM-free entity decoder as the web build. Worker smoke runs load a blank same-origin page and execute the emitted asset without starting the app or contacting an API. To check an existing desktop build locally:

```sh
AGENTCTL_PERF_DIST=apps/desktop/out/renderer node apps/web/scripts/performance-browser.mjs performance-results/desktop-worker.json --production --worker-smoke
```

This verifies the packaged renderer's worker artifact in Chrome; it does not measure native Electron startup.

Pre-commit review also validated this separate Electron build path: the desktop main/preload/renderer build and emitted worker smoke passed, along with profiling and production web worker smokes. All 346 web tests and both web/desktop typechecks passed after the resolver fix. The complete 24-sample browser suite passed again. Review restored first/last-block spacing inside the Markdown status wrapper; 19 focused Markdown tests, all three builds, and three final production journey samples then passed. Final startup JavaScript was 1,606,246 bytes, within budget. Native startup remains unmeasured.

Change a budget only alongside a documented reason and a comparable before/after run using the same fixtures. For intentional fixture changes, update the fixture/policy version and establish a fresh baseline. Do not raise a limit simply to make a failing change pass. A green browser job does not establish real provider/network latency or native Electron startup performance.

Validation on October 7, 2026: all nine budget checker tests passed, including rejection of the prior eager byte baseline, restored per-delta subscriptions, duplicate requests, missing samples, worker fallback, and invalid profiling measurements. The complete local browser check passed the worker smoke, 18 component samples, three stream samples, and three production journey samples. Startup JavaScript stayed at 1,606,191 bytes; every stream sample recorded queue/turn/prompt commits of 0/0/1. The final policy was rechecked against all saved reports. Missing-build failure injection returned a failing exit code, continued independent suites, and wrote diagnostics plus the GitHub summary. Normal/profiling builds, web typechecking, architecture checks, lint, and formatting passed. The existing Vite review-barrel warning remains. Hosted CI has been configured but has not been triggered from this workspace.

## Remaining work

1. Collect native process/server/window timings and production journeys against representative real backend latency before changing desktop startup order or shell/composer lifetime.
2. Investigate large history mount stalls and remaining final React/DOM work using representative conversations. Keep noisy wall-clock timings as trends until their variability is understood.

## Measure normal app journeys

Open the web app with `?perf=1`. Opt-in remains active for that page's lifetime, including subsequent client-side navigation. In DevTools:

```js
window.agentctlPerformance.snapshot();
window.agentctlPerformance.clear();
```

Browser samples are held locally in memory, capped at 200, and contain only a metric name, relative start time, and duration. Internal correlation scopes, message text, paths, and tool arguments are not exported. This browser recorder sends nothing to a telemetry service. The separate, opt-in server/desktop pipeline is described in [OpenTelemetry](observability.md).

| Metric                           | Start                                            | End                                                         |
| -------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `launch-to-typeable`             | Renderer navigation start                        | Enabled composer committed plus two frames                  |
| `session-click-to-feed-painted`  | Same-window session link click                   | Session and history loaded, feed committed plus two frames  |
| `send-to-first-text-received`    | Validated submission in an existing idle session | First correlated parent-conversation provider text received |
| `send-to-first-text-painted`     | Same submission                                  | Matching response committed plus two frames                 |
| `first-text-received-to-painted` | First text received                              | Same paint opportunity                                      |

Prompt timings use message IDs and parent relationships so output from an older turn or a child transcript does not satisfy the measurement. SSE may arrive before the HTTP acknowledgment; the recorder preserves the original receive and paint timestamps. Queued messages, initial new-session prompts, and output that cannot be correlated are excluded. Navigating away or a submission failure cancels incomplete prompt timings. Use a visible tab and consistent workloads when comparing samples. Existing core `TurnDiagnostics` complements these timings with preparation, provider acceptance, first output, and completion durations.

For desktop startup, set `AGENTCTL_PERF=1` when launching the desktop app. This automatically opts the renderer into the same journey measurements and prints JSON duration records for process-to-app-ready, server-start-to-ready, window-create-to-ready, and process-to-window-ready. Renderer navigation and Electron process start have different clock origins; do not add their durations together. Native startup instrumentation is implemented; no packaged desktop startup baseline has been collected in these milestones.
