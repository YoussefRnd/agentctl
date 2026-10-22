# Backend, concurrency and native startup baselines

Run these alongside the existing [browser performance safeguards](performance.md). They measure
different parts of AgentCtl; their durations must not be added together.

## Commands

```sh
pnpm perf:backend
pnpm perf:desktop
pnpm perf:decoding
pnpm perf:soak
pnpm exec vp test run apps/server/tests/performance/concurrency.test.ts
```

The root baseline commands build their workspace dependencies first. A backend-only rerun after
building is `pnpm --filter @agentctl/server perf:baseline`. An explicit artifact directory must be
the first argument: `pnpm --filter @agentctl/server perf:baseline /tmp/agentctl-baseline`.
Native startup needs Electron's system dependencies and a display or Xvfb; set `XVFB_PATH` when
Xvfb is not on PATH. The native runner uses the existing lifecycle smoke with `--startup-only`;
the ordinary smoke still checks both startup and startup failure.

Avoid running builds, tests or other benchmarks during captures. Backend samples run sequentially
in separate Node processes, with fresh temporary SQLite WAL databases and synthetic sessions.
Samples execute built JavaScript without a TypeScript loader. The parent removes temporary files
after child exit, when SQLite has released its handles.
The server compile task explicitly fingerprints `apps/server/tests/**`; editing a workload cannot
reuse a cached benchmark artifact from an older fixture.
They never open the normal AgentCtl database, launch providers, refresh the catalog, or require
credentials. Temporary databases disappear when each process exits. Generated reports are ignored
under `performance-results/backend/` and `performance-results/desktop/`.

## Backend workload and measurements

Four workloads run with telemetry disabled and enabled:

| Sessions | Seeded history per session | Measured turns per session | Output per turn             |
| -------: | -------------------------: | -------------------------: | --------------------------- |
|        1 |                 200 events |                          5 | 20 chunks of synthetic text |
|        5 |                 200 events |                          5 | 20 chunks of synthetic text |
|       20 |                 200 events |                          5 | 20 chunks of synthetic text |
|        1 |              10,000 events |                          5 | 20 chunks of synthetic text |

Each combination has one discarded process run and three measured repetitions. Each process also
discards one warmup turn and history request per session to exercise lazy/JIT paths before measuring.
History seeding, startup, warmup and shutdown are outside the measured workload; `setupMs` records
the setup/warmup interval separately. The synthetic provider waits 2 ms, emits chunks, and yields
every four chunks. Its wait is a fixture parameter, not an approximation of a real model.

The harness exercises the actual application composition, input HTTP route, durable acceptance and
queue worker, session runtime, event persistence, paged history HTTP route and SSE transport. Only
provider execution and unrelated startup integrations are replaced. Provider transport/ACP process
cost, model latency, renderer work and external network behavior are excluded.

Per-run JSON includes:

- Input acceptance, paged-history, first-output-received and completion p50/p95/max in milliseconds.
- Completed turns/second and maximum concurrent turns, with FIFO and single-dispatch assertions.
- Process user/system CPU, RSS before/after, sampled peak RSS/heap, event-loop utilization and delay.
- Workload dimensions and telemetry signal delivery counts.

Completion starts at client submission and ends when the client parses the SSE `turn_end` event.
First output ends when that client parses the first provider text for the prompt. It is not paint
latency. SSE batches may combine chunks; the harness reconstructs and verifies complete output
instead of assuming one network frame per chunk. It also requires usable bounded history pages,
unique durable receipts, completed operations and listener cleanup before accepting a sample.

HTTP requests, response decoding and SSE parsing run in a separate Node child process. Server
CPU, memory and event-loop measurements exclude that load generator but still include the local
telemetry receiver when enabled. The client imports only its protocol/SSE helpers and Node APIs.
IPC coordinates warmup, measurement start, results and shutdown; clients exit if their parent dies,
and the server bounds waits and terminates a client that fails to close. Durable rows, receipt IDs,
FIFO, non-overlapping per-session dispatch, complete streamed text and listener cleanup must all
pass before a sample is accepted. These are loopback workload measurements, not a capacity claim.
Peak memory is sampled every 20 ms and can miss short spikes. No forced garbage collection is used;
RSS is not a live-object or leak measurement. Within-run p95 from five turns is usually the maximum;
it must not be presented as a production p95. Compare the three-run distributions as well as medians.

Sample/report schema version 2 and fixture version 2 identify this process boundary and completion
end point; do not compare their latency/CPU/RSS values directly with version 1 shared-process
captures. Resource fields cover the server process, and each sample includes explicit `measurement`
labels. Reports include Node/OS/CPU, commit, dirty state and a source/lockfile hash. `summary.md` contains
medians across the three runs; `report.json` retains every sample. Timing and memory values are
trends. Functional timeouts, incomplete runs and invariant violations fail the command. Establish
variance over repeated comparable captures before adding elapsed-time or RSS budgets.

## Decoder regression guard and sustained load

`pnpm perf:decoding` measures database validation, data/metadata JSON parsing, object construction,
wire validation and full decoding for text-only and mixed event pages (200/500 rows). Each process
discards two stage passes, measures seven passes of 20,000 rows, and alternates stage order. It
checks every fixture row against a preserved intersection-based reference decoder. Results escape
into a bounded ring so the harness does not retain every allocation.

The runner discards one process and collects three fresh-process samples. CI requires the median
full candidate/reference ratio to be at most 1.25 for every scenario. This coarse relative limit
detects substantial regressions without hardcoding this laptop's nanoseconds. It is not a promise
that decoding is 25% faster, nor an application latency SLO. Tighten it only with repeated runner
history. Acceptance/output differential tests separately cover all event variants, invalid fields,
legacy text transforms, loose metadata/tool fields, and TypeScript discriminant narrowing. Error
issue ordering may change; accepted values and parsed contracts remain the compatibility target.

`pnpm perf:soak` runs for five minutes by default. Use an explicit output directory and duration:

```sh
pnpm perf:soak /tmp/agentctl-soak 300
# After building, without another compile:
node scripts/performance/backend-checks.mjs soak /tmp/agentctl-soak 60
# Start at the retention cap to exercise steady-state pruning throughout:
pnpm perf:soak /tmp/agentctl-retention-soak 60 --full-retention
node scripts/performance/backend-checks.mjs decoding /tmp/agentctl-decoding
pnpm perf:test
```

The soak keeps one server/database, 20 sessions and 20 SSE connections alive while submitting
successive batches of five turns per session. It seeds 200 history rows per session once and
discards one warmup turn per session. The isolated client clears its event buffers each batch,
and the server fixture clears dispatch bookkeeping; neither retains all generated payloads.
Every batch checks FIFO, no overlapping per-session dispatch, complete streamed output, receipts,
listeners and queue drain. Final persisted success counts include all batches and warmup turns.
An indexed outstanding-status query samples queue depth alongside server RSS/heap/external memory
once per second. Thirty-second natural-GC low-water windows, batch latency summaries, CPU and
event-loop metrics are recorded. All listeners must close at the end.

This is a closed-loop synthetic saturation test: the next batch begins after the previous batch
finishes, and durable history grows throughout. Telemetry is disabled for the soak; the ordinary
baseline covers both modes. The first/last 20% batch summaries describe drift, not production
percentiles. Five minutes cannot prove absence of leaks. CI runs a 60-second functional smoke
preloaded with 10,000 journal entries per session,
uploads both reports, and fails on timeouts/invariants; memory and sustained latency remain trends
until comparable CI history supports stable budgets. New reports live in ignored
`performance-results/decoding/` and `performance-results/soak/`, with source/lockfile provenance.

## Telemetry comparison and dashboards

Default captures override inherited telemetry settings and use a loopback OTLP protobuf discard
receiver for enabled runs. All three signals must reach it. This measures local instrumentation,
batching and export overhead without requiring Docker; it excludes collector storage/query cost.
The order of enabled/disabled runs alternates across repetitions.

To populate the local dashboards deliberately:

```sh
pnpm telemetry:up
pnpm --filter @agentctl/server perf:baseline /tmp/agentctl-dashboard-capture --collector
pnpm telemetry:check --require-data
```

`--collector` honors standard `OTEL_*` configuration. Use it only with a backend intended to receive
synthetic data. For everyday dashboards, start the normal application with `AGENTCTL_TELEMETRY=1`.
Short-lived samples may export only once: rate panels need multiple points from the same process.
Gauges and logs can appear immediately; ongoing application activity populates rate panels.

The stack provisions [operations](http://127.0.0.1:3001/d/agentctl-operations) and
[runtime/startup](http://127.0.0.1:3001/d/agentctl-runtime) dashboards into the AgentCtl folder.
Service and anonymous process-instance selectors filter queries. Definitions live in
`observability/grafana/dashboards/`; edit those files and let provisioning reload them. UI edits are
disabled. `telemetry:check` verifies provisioning and executes every panel query against Grafana's
actual Prometheus/Loki datasources. `--require-data` additionally checks recently exported metric
families. It does not require every failure/connection/startup series to exist.

The operations dashboard excludes long-lived SSE connections from request-latency percentiles,
shows queue waiting and turn phases/outcomes, and links operational logs to traces through Loki.
Connection panels count lifecycle events, not active connections. No traffic is distinct from
healthy traffic. Process dashboards show RSS/heap/external memory, CPU cores, event-loop utilization
and collection-window p99/max delay. Desktop startup shows recorded phase means for selected
processes, not a rolling fleet percentile. Process metrics contain no executable, host, PID or user
attributes and run only while the opt-in SDK owns the process.

## Concurrency and recovery regressions

The test suite uses real loopback HTTP/SSE and the durable SQLite queue to verify:

- Twenty sessions overlap while accepted turns retain FIFO order within each session.
- Concurrent duplicate client IDs share one persisted receipt and one dispatch.
- A provider failure after dispatch leaves uncertain delivery paused while other sessions progress.
- Queued cancellation avoids dispatch; active cancellation releases the lane for its next turn.
- Twelve SSE subscribers receive events, disconnect cleanly and replay missed persisted history.
- A paused reader hits the stream buffer limit and closes while a healthy reader keeps receiving.
- One OS process persists queued work and exits without cleanup. A second process reopens the
  database, recovers safe work, preserves uncertain dispatched work, and deduplicates a retry after
  a lost acknowledgment. Durable rows explicitly model the claim-before-dispatch and
  dispatch-before-result crash boundaries; this does not simulate every filesystem/power failure.

These are deterministic correctness assertions with bounded waits, not latency promises. They join
the ordinary test suite and a separate backend CI job. That job builds dependencies, runs the
concurrency suite, collects all 24 measured samples, and retains JSON/logs/summary artifacts for
14 days. The quality job collects native startup trends after building Electron and keeps the
existing failure/IPC/shutdown smoke. Hosted CI has to run before its timings can be compared.

## Native startup interpretation

The native baseline discards one launch and records three launches with fresh database/profile
directories. It verifies all four existing process/app/server/window milestones and retains
Electron/Chrome/Node versions. Results include first-use database and profile work; they are not
warm-profile startup numbers. Xvfb/headless graphics differ from an interactive desktop. Renderer
typeability remains covered by the separate browser journey lab. Native clocks and renderer clocks
have different origins.

Use these captures to choose the next optimization. Candidate areas remain query plans, event
serialization/fan-out, large-history rendering and startup work. A benchmark result alone does not
justify replacing SQLite, adding worker threads or changing scheduling policy.

## Reference capture — October 18, 2026

Historical **version 1, shared-process** capture, retained for provenance; it is not directly
comparable with the current isolated-client fixture. Verified locally on Linux x64, Node v24.22.0,
Intel Core i3-8130U with four logical CPUs.
All 24 measured backend samples passed. The following are medians across three runs per row;
first output and completion include queue waiting. CPU/RSS include the loopback clients and
receiver. No builds or tests ran during these measured workloads.

| Sessions | History/session | Telemetry | Turns/s | Accept p95 ms | History p95 ms | First output p95 ms | Completion p95 ms | Peak RSS MiB |
| -------: | --------------: | --------- | ------: | ------------: | -------------: | ------------------: | ----------------: | -----------: |
|        1 |             200 | disabled  |    24.8 |          33.8 |           27.3 |               112.7 |             120.5 |        303.4 |
|        1 |             200 | enabled   |    20.7 |          21.2 |           24.6 |               124.4 |             140.4 |        306.1 |
|        5 |             200 | disabled  |    41.8 |          67.9 |           70.0 |               300.6 |             328.4 |        307.3 |
|        5 |             200 | enabled   |    38.7 |          71.4 |           72.4 |               329.7 |             354.5 |        309.3 |
|       20 |             200 | disabled  |    47.7 |         203.2 |          544.7 |              1103.9 |            1210.2 |        323.8 |
|       20 |             200 | enabled   |    44.0 |         210.6 |          579.6 |              1231.4 |            1330.1 |        334.2 |
|        1 |           10000 | disabled  |    33.2 |          15.5 |           13.1 |                73.2 |              76.9 |        306.6 |
|        1 |           10000 | enabled   |    30.3 |          17.7 |           13.9 |                77.5 |              80.3 |        301.5 |

Native startup used Electron 43.7.5 / Chromium 150.0.7871.250 on Xvfb,
with telemetry disabled. All three measured launches passed after one discarded warmup.

| Phase                           | Median ms |
| ------------------------------- | --------: |
| desktop-process-to-app-ready    |     241.1 |
| desktop-server-start-to-ready   |    1125.9 |
| desktop-window-create-to-ready  |    1212.8 |
| desktop-process-to-window-ready |    3070.6 |

Full captures: `performance-results/backend/report.json`, `summary.md`, per-run JSON/logs,
and `performance-results/desktop/report.json`, `summary.md`, per-launch JSON/logs. These generated
files are ignored; the tables above preserve the reference values. Both captures include build/source
provenance for this working tree based on commit `993f7bd`.

This capture motivated the 20-session profiling and isolated-client comparison below. These
original measurements alone did not isolate SQL, validation, serialization or client load
generation as the cause.

Validation: the full suite passed 1,560 tests across 274 files. Final focused checks passed all
23 observability/concurrency tests and all eight concurrency cases again after rebuilding the
fixture. All 11 architecture regressions (including fixture cache invalidation), workspace types,
lint/formatting and builds passed. All 15 provisioned dashboard queries executed successfully
against the local stack with recent metric data. Native startup, IPC, shutdown and startup-failure
cleanup also passed with telemetry enabled. Hosted CI has been configured but was not triggered.

## Isolated-client prepared-query comparison — October 19, 2026

Version 2 uses a separate HTTP/SSE client process. The before/after rows below both use that same
fixture, including client-received completion timing. They compare the committed runtime at
`1b854a4` with connection-scoped prepared event/queue statements and a narrower queue status read.
The original runtime was reconstructed from committed sources into an immutable compiled snapshot;
the optimized runtime was frozen separately. Both used the same built server/client harness and
installed dependencies. This prevents background rebuilds from changing the runtime between samples.
Earlier captures with mutable build artifacts were discarded from this comparison.

The host and workload dimensions match the previous reference. Each row below covers 20 sessions,
200 seeded events per session and 100 measured turns, with three fresh-process repetitions after
warmup. CPU/RSS exclude the client; telemetry-enabled runs use the local discard receiver.

| Telemetry | Query implementation | Window ms | Accept p95 ms | History p95 ms | First output p95 ms | Completion p95 ms | Server CPU ms |
| --------- | -------------------- | --------: | ------------: | -------------: | ------------------: | ----------------: | ------------: |
| disabled  | before               |      1700 |           153 |            155 |                 927 |              1017 |          1991 |
| disabled  | prepared             |      1262 |           129 |            130 |                 759 |               860 |          1590 |
| enabled   | before               |      1813 |           162 |            163 |                 971 |              1083 |          2196 |
| enabled   | prepared             |      1385 |           132 |            137 |                 805 |               939 |          1780 |

Median elapsed time fell about 26% with telemetry disabled and 24% enabled; client completion p95
fell about 15% and 13%. Server CPU fell about 20% and 19%. Disabled window p99 event-loop delay
fell from 161 to 106 ms. Peak server RSS stayed around 297 MiB disabled and 302 MiB enabled.
Disabled elapsed ranges were 1693–1722 ms before and 1254–1266 ms after. These are three-run local
synthetic trends, not production SLOs, sustained capacity or a statistical significance claim.

Separate CPU/SQL captures explain the change: native preparation fell from 6120 to 2000 calls per
100-turn workload (67% fewer), while statement executions stayed at 6120 and transaction-control
calls stayed at 2000 (1000 transactions). No retention, acceptance/claim or uncertain-delivery policy
was relaxed. Median sampled Drizzle time fell from 711 to 423 ms, and native SQLite time from 424
to 307 ms. Self-sample shares changed from 39.5% to 32.7% and 23.6% to 23.0%, respectively; percentages
alone conceal the absolute reduction. Diagnostic acceptance transaction p95 fell from 1.37 to
0.43 ms, claim p95 from 0.66 to 0.13 ms, and queue selection p95 from 1.09 to 0.09 ms. History-page
method p95 stayed near 5 ms; its query construction/decoding remains a candidate for another profile.

All 48 uninstrumented measured samples across four workloads and both telemetry modes passed, as
did 12 separate 20-session CPU/SQL captures. Profiling startup frames were excluded from CPU
attribution; remaining sampled windows agreed with measured elapsed windows within 5 ms.
Latency tables use controls, not instrumented runs. Captures ran sequentially without concurrent
builds or tests; the existing desktop development session was left running. No real provider/model
or external network was involved.

Validation covered 1564 tests across 275 files. The first full run found query-builder stubs in the
manager test that lacked prepared statements and hit worker startup timeouts in 13 files. The one
manager test that exercises persistence now uses a real database; statement sets initialize lazily
for owners that do not use persistence. All affected/skipped files passed targeted reruns, including
the final eight concurrency cases. All 11 architecture regressions, workspace types, lint,
formatting and server/core builds passed. A forced failed-client check verified prompt error
propagation and child cleanup; successful captures require a zero client exit status.

Local ignored artifacts: `performance-results/prepared-comparison/before/`, `after/`,
`before-profile/`, `after-profile/`, `comparison.json`, `variant-manifest.json` and `report.md`.
The manifest records immutable runtime hashes; profiling helpers/snapshots are local diagnostic
artifacts. The baseline command and isolated client implementation are tracked in the repository.

## History-page statement reuse — October 19, 2026

This compares commit `9491f6f` with a connection-owned history-page reader. Both variants retain
the isolated-client version 2 fixture and the prior prepared event/queue writes. Server and core
compiled snapshots were frozen before captures; the benchmark JavaScript and core runtime were
identical between variants. Telemetry mode order alternated by repetition; variant order was fixed
within each mode and reversed for the other mode. There were no concurrent builds or tests during measurement; the existing
desktop development session was left running.

Each value below is the median of three fresh-process measurements for 20 sessions with 200
seeded events and five measured turns/history requests per session. The provider remains synthetic.

| Telemetry | History reads | Window ms | History HTTP p95 ms | First output p95 ms | Completion p95 ms | Server CPU ms |
| --------- | ------------- | --------: | ------------------: | ------------------: | ----------------: | ------------: |
| disabled  | before        |      1457 |                 152 |                 879 |               990 |          1800 |
| disabled  | prepared      |      1337 |                 130 |                 773 |               875 |          1645 |
| enabled   | before        |      1622 |                 146 |                 938 |              1086 |          2016 |
| enabled   | prepared      |      1477 |                 141 |                 831 |               972 |          1850 |

History HTTP p95 improved about 14% disabled and 3% enabled; workload duration improved 8% and 9%,
and completion p95 about 12% and 11%. Disabled window ranges were 1379–1535 ms before and
1321–1369 ms after; enabled ranges were 1576–1693 ms and 1476–1510 ms. These small local captures
show trends, not production SLOs or statistical significance. Not every metric improved: enabled
input p95 moved from 145 to 149 ms, window p99 loop delay was approximately unchanged/slightly
higher (124 to 126 ms disabled, 158 to 162 ms enabled), and peak RSS rose roughly 3 MiB. Event-loop
utilization stayed near 0.994. RSS does not measure live-object retention.

Separate CPU/SQL captures isolate the history work:

| 100 history reads within the 20-session burst    |  Before |   After |
| ------------------------------------------------ | ------: | ------: |
| History service method p95                       | 5.40 ms | 3.84 ms |
| History service method total                     |  363 ms |  274 ms |
| Sampled inclusive history-page CPU time          |  358 ms |  271 ms |
| Native prepares for history queries after warmup |     200 |       0 |
| Whole-workload native statement prepares         |    2000 |    1800 |
| Whole-workload statement executions              |    6120 |    6120 |
| Whole-workload transaction-control calls         |    2000 |    2000 |

History processing p95 fell about 29%, total method time and inclusive CPU about 24%. Instrumented
method timings locate costs; the HTTP table uses uninstrumented controls. The payload query now
uses two bound values for a 200-row page, replacing 201, through a parameterized `json_each` ID
list. Its diagnostic plan retains `session_events_session_id_idx (session_id=? AND rowid=?)`;
the virtual-table scan is over the bound JSON list. Plans used NULL placeholder bindings and are
structural diagnostics, not exact request-parameter plans. Both database-row and shared wire
schemas still validate every returned row. Row decoding remained around 126–135 sampled ms and
accounts for roughly half the optimized page path; no result/validation cache was introduced.

All 48 measured controls across the four canonical workloads and both telemetry modes, plus 12
20-session CPU/SQL captures, passed. The full server suite passed 151 tests across 33 files,
including eight new regressions covering prepared-shape reuse, fresh updates/deletions, sparse
session-scoped IDs, cursor/high-water bounds, oversized-parent preflight, extended metadata,
corrupt row rejection and independent database connections. Workspace types, lint/formatting,
builds and architecture checks passed. No schema, pagination contract or telemetry setup changed.

Local ignored captures are under `performance-results/history-comparison/`: `before/`, `after/`,
`before-profile/`, `after-profile/`, `comparison.json`, `variant-manifest.json` and `report.md`.
The manifest verifies identical core and benchmark code. Snapshot selection and alternating-run
helpers are local diagnostic scripts; `pnpm perf:backend` remains the tracked baseline command.

## Row decoding and sustained load — October 20, 2026

This compares `5c4bfde` with shared event schemas built from one variant factory. Each row variant
validates envelope and payload together, avoiding the previous intersection's extra object pass and
merge. Database validation, JSON decoding, wire validation, defaults, transforms and loose metadata
remain. No row cache, database schema, retention policy or pagination contract changes.

Server/core compiled hashes, including the client harness, match between frozen variants; only the
shared runtime differs. Captures ran sequentially without concurrent builds/tests on Node 24.22.0,
an Intel i3-8130U Linux desktop with four logical CPUs. Normal desktop applications remained running.
Telemetry mode order alternated by repetition; variant order was fixed within each mode and
reversed for the other mode. Values below
are medians of three fresh-process controls, after discarded warmups, for 20 sessions and 100 turns.

| Telemetry | Runtime | Window ms | History HTTP p95 ms | Completion p95 ms | Server CPU ms |
| --------- | ------- | --------: | ------------------: | ----------------: | ------------: |
| disabled  | before  |      1320 |               130.3 |               875 |          1641 |
| disabled  | after   |      1315 |               129.2 |               850 |          1686 |
| enabled   | before  |      1445 |               134.7 |               954 |          1834 |
| enabled   | after   |      1427 |               133.6 |               934 |          1779 |

Decoder full candidate/reference ratios were 0.857 for 200 text rows, 0.766 for 200 mixed rows and
0.807 for 500 mixed rows: 14–23% less decoding time against the same-process reference. Database
validation remained about 0.4–0.5 μs/row; data/metadata JSON roughly 0.8 μs combined; construction
was negligible. Separate CPU profiles show inclusive row decoding 143→95 ms, inclusive history
272→237 ms and validation self samples 192→125 ms. Drizzle/SQLite remained about 389/348 sampled ms
afterward. These sample categories do not all represent disjoint intervals.

The end-to-end effect is modest: history p95 changes less than 1%, completion about 2–3%, and
elapsed time less than 2%. Disabled elapsed ranges overlap (1317–1349 ms before, 1271–1541 after).
Disabled CPU and sampled RSS rose slightly, enabled CPU fell, and loop p99 stayed near 133/144 ms
for disabled/enabled runs. Do not present the decoder improvement as an equivalent request-latency
improvement or a statistically established capacity gain. Instrumented history method total fell
280→255 ms while method p95 rose 3.93→4.08 ms. SQL counts matched: 1800 prepares, 6120 statement
executions and 2000 transaction-control calls per workload. Profiler startup frames were excluded;
remaining sampled windows agreed with measured windows within 5 ms.

Both five-minute soaks completed 19,900 measured turns with 20 persistent SSE connections,
drained every batch, and released all listeners. First/last values summarize the first/last
39 batches out of 199, rather than production request percentiles.

| Runtime | Batch median ms, early→late | History p95 median ms, early→late | Completion p95 median ms, early→late | Peak RSS MiB |
| ------- | --------------------------: | --------------------------------: | -----------------------------------: | -----------: |
| before  |                   1215→1833 |                           119→159 |                             778→1191 |          445 |
| after   |                   1193→1784 |                           114→155 |                             754→1149 |          444 |

Both show sustained latency drift. Complete 30-second heap low-water windows stayed around
55–76 MiB before and 50–89 MiB after, without monotonic growth; partial final windows are excluded.
RSS plateaued after early growth. This five-minute evidence does not prove absence of leaks.
Sampled queue maxima were 80 pending, 20 running and zero unknown; final work/listener counts
were zero. Event-loop utilization remained near 0.996 and delay p99 near 180/182 ms.

Three additional diagnostics held history at 200 events/session while preloading 10,000 valid
change references per session outside measurement, using the optimized runtime. The instrumented
100-turn window rose 1430→2091 ms. Its 800 retention-cutoff lookups rose from 25→557 ms total;
pruning added only about 13 ms. The deep-offset cutoff lookup runs for every recorded change and
walks up to 9999 entries. This strongly supports retention bookkeeping as a major contributor to
the sustained drift. The next optimization target is bounded/amortized retention work, with replay
gap handling, cursor safety, transactional writes and retention bounds preserved.

All 48 measured controls, 12 ordinary CPU/SQL captures, three retention diagnostics and both soaks
passed. The full suite passed 1575/1576 tests across 276 files; the sole 5-second ReviewView UI
timeout passed immediately in isolation (5/5). Decoder differential tests, two budget regressions,
all 11 architecture regressions, workspace types, lint/formatting and dependency builds passed.
CI now checks a coarse relative decoder budget and a 60-second functional soak; application timing
and memory remain trends pending historical runner variance.

Local ignored evidence is in `performance-results/decoding-comparison/`: `report.md`, `comparison.json`,
`variant-manifest.json`, controls, profiles, decoder-stage reports and both soak reports. The tracked
commands are `pnpm perf:decoding`, `pnpm perf:soak` and `pnpm perf:test`.

## Retention bookkeeping — October 20, 2026

The decoder/safeguard work was committed as `e0b80ae`. This comparison replaces the per-change
deep-offset retention lookup with a transactionally maintained per-session count. Migration
`0049_session_change_counts` backfills existing journals once and installs INSERT/DELETE count
triggers. The repository prunes only excess oldest entries through the existing session/sequence
index. Below the cap, LIMIT 0 reads no journal entries; normal overflow removes one entry. The
exact 10,000-entry limit, global cursor sequencing, snapshot fallback and publication-after-commit
behavior remain. There is no process-local count cache to reconcile after rollback or restart.

Each runtime uses its own frozen compiled code **and copied migration directory**. Snapshot checks
verify the original has no count table/triggers and the optimized version has both. Server/shared
JavaScript hashes match. Captures ran sequentially without concurrent builds/tests on the same
Node 24.22.0 / i3-8130U desktop. The 48 canonical controls retained the prior ordering pattern.
Because short-burst results were mixed, an additional 20-session comparison explicitly alternated
variant order and telemetry mode order between repetitions, with one discarded process and five
measured processes per variant/mode. All initial results and outliers remain in the local reports.

| Telemetry | Runtime | Burst median ms | Range ms  | History p95 median ms | Completion p95 median ms |
| --------- | ------- | --------------: | --------- | --------------------: | -----------------------: |
| disabled  | before  |            1352 | 1289–1461 |                 131.4 |                      890 |
| disabled  | after   |            1296 | 1272–1587 |                 129.8 |                      852 |
| enabled   | before  |            1424 | 1391–1551 |                 134.6 |                      931 |
| enabled   | after   |            1451 | 1400–1525 |                 139.4 |                      947 |

Short bursts show roughly 4% improvement disabled and 2% regression enabled, with overlapping
ranges; no universal short-request latency improvement is established. The initial three-run
disabled burst medians were 1280→1423 ms and enabled 1448→1412 ms. The follow-up preserves that
uncertainty rather than substituting only favorable captures.

Separate native CPU/SQL profiles preload 10,000 valid journal references per session while keeping
event histories at 200 rows/session. Seeding/warmup are outside measurement. Medians of three
100-turn captures across 20 sessions show the isolated retention effect:

| Instrumented metric        |  Before |   After |
| -------------------------- | ------: | ------: |
| Workload window            | 2074 ms | 1474 ms |
| Deep-offset cutoff calls   |     800 |       0 |
| Cutoff SQLite time         |  547 ms |       0 |
| Pruning SQLite time        |   13 ms |   20 ms |
| Journal insert SQLite time | 18.5 ms | 20.4 ms |

The full-retention window improved about 29%; application-issued cutoff/prune work fell from
roughly 560→20 ms. Insert timings include the new counter trigger. Wrapper counts do not enumerate
SQLite statements executed internally by triggers; they are not total engine instruction counts.
Transaction-control calls remain 2000 per workload. Structural query plans use the existing
`session_event_changes_cursor` covering index and counter primary-key index, with no OFFSET.

| Five-minute soak                         |       Before |        After |
| ---------------------------------------- | -----------: | -----------: |
| Completed measured turns                 |       19,900 |       23,400 |
| Batch median, first→last fifth           | 1194→1780 ms | 1145→1426 ms |
| Completion p95 median, first→last fifth  |  759→1160 ms |   741→905 ms |
| History p95 median, first→last fifth     |   113→153 ms |   113→130 ms |
| Retained entries per session at shutdown |         7968 |         9368 |
| Peak sampled server RSS                  |      450 MiB |      443 MiB |
| Event-loop delay p99                     |       182 ms |       150 ms |

The optimized closed-loop soak completed about 18% more turns and its late batch median was 20%
lower. Different throughput means different history sizes; these are synthetic observations,
not production capacity SLOs. Residual within-run batch drift remains (+49% before, +25% after),
so another late-run profile is needed before choosing the next change. Complete 30-second heap
low-water windows stayed about 48–79/48–78 MiB without monotonic growth; partial final windows are
excluded. Both runs drained every batch, sampled at most 80 pending/20 running/0 unknown, released
all listeners and stayed near 0.996 loop utilization. Five minutes does not prove absence of leaks.

A separate 60-second optimized run started with 10,000 journal entries per session, completed
5100 turns, and retained exactly 10,000 entries in all 20 sessions. Early/late batch medians were
1188/1176 ms. This is now CI's functional smoke; the parent rejects over-pruning as well as exceeding
the cap. Source fingerprints now include migration files. Reproduce with
`pnpm perf:soak /tmp/agentctl-retention-soak 60 --full-retention`.

All 1049 Node tests across 173 files passed, including upgrades from every migration boundary,
interleaved session cursors, oversized journals, independent deletes, failed pruning, full rollback,
nested savepoints, independent connections and replay gap recovery. Workspace types, architecture
checks and lint/formatting passed. All 48 canonical controls, 20 balanced follow-up controls,
12 short CPU/SQL captures, six full-retention profiles, two five-minute soaks and the full-retention
smoke passed. No real database/provider was used. Local ignored evidence is under
`performance-results/retention-comparison/`, including `report.md`, `variant-manifest.json`,
`full-retention-comparison.json`, `confirmation-20/` and all raw profiles/soak reports.

## Remaining sustained-run drift — October 20, 2026

Retention work is committed as `986481f` (`perf: bound session change retention bookkeeping`).
The follow-up uses that exact runtime: frozen server/core/shared JavaScript, copied migrations,
Node 24.22.0 and the same i3-8130U desktop. No application optimization is included in this
investigation. Twenty sessions use separate-process clients, persistent SSE connections,
200 initial events/session, 100 turns/batch and disabled telemetry. Captures, builds and tests
run sequentially. All data and providers are synthetic.

A five-minute run completed 21,500 measured turns. CPU sampling at 1 ms and native SQL timings
cover five consecutive batches early (starting at 12.5 seconds) and late (271.5 seconds).
Consistent SQLite backups are taken after each window, outside its timings. Profiling/export
and backup overhead affect overall throughput; compare normalized windows and the separate
uninstrumented controls below, rather than treating this run as a new capacity baseline.

| Metric                                    | Early window | Late window |
| ----------------------------------------- | -----------: | ----------: |
| Attempts in database at window end        |        1,520 |      20,120 |
| Batch median                              |     1,316 ms |    1,680 ms |
| Average elapsed per 100 turns             |     1,392 ms |    1,652 ms |
| Server CPU per 100 turns                  |     1,526 ms |    1,675 ms |
| Attempt lookup native time per 100 turns  |      17.9 ms |    323.2 ms |
| Retention prune native time per 100 turns |      10.4 ms |     10.5 ms |
| History page method time per 100 turns    |       276 ms |      301 ms |
| Client CPU per 500-turn window            |     1,590 ms |    1,530 ms |

`SessionOperationWorker.drain()` reads `session_turn_attempts` by `operation_id` once per turn.
The table has a primary-key index on `id` and an index on `session_id`, but no index on
`operation_id`. Plans with actual captured bindings show `SCAN session_turn_attempts`. These
lookups scan attempts across all sessions, so accumulated work elsewhere also increases their
cost. The same 500 lookups take roughly 90→1,616 ms across the two windows. This is the dominant
growing SQL cost; retention pruning remains bounded. History's two page reads grow about
11 ms/100 turns combined, far less than the attempt lookup's 305 ms increase.

SQLite self CPU samples rise about 398→720 ms/100 turns. Drizzle falls 408→370 ms and validation
stays near 122/121 ms; GC falls 32→27 ms. Categories describe leaf samples, while method totals
include their callees and must not be added to those categories. Server logical read bytes rise
about 70 MB→2.07 GB per window with SQLite's unchanged 2 MiB cache setting; OS-accounted physical
reads rise 0→13 MB. These measurements support repeated database scanning, without establishing
production disk behavior. Client CPU and RSS (143→146 MiB) stay similar. Complete 30-second server
heap low-water windows range 55–77 MiB without monotonic growth; five minutes cannot exclude leaks.

To test causality independently of process age, fresh processes reopen disposable copies of the
early/late backups. Each process performs the normal 20-turn warmup, then measures 100 turns.
The candidate adds only a non-unique index on `session_turn_attempts(operation_id)`, on the
late database copy before warmup. Five unprofiled processes per condition alternate forward and
reverse condition order. No samples are discarded, including the slower first early-state run.

| Database state                  |   Burst median (range) | Server CPU median | History p95 median | Completion p95 median |
| ------------------------------- | ---------------------: | ----------------: | -----------------: | --------------------: |
| Early snapshot                  | 1,448 ms (1,342–2,034) |          1,799 ms |             149 ms |                967 ms |
| Late snapshot                   | 1,725 ms (1,652–1,740) |          2,060 ms |             161 ms |              1,089 ms |
| Late snapshot, diagnostic index | 1,363 ms (1,325–1,667) |          1,654 ms |             145 ms |                909 ms |

On the same late state, the diagnostic index lowers median elapsed time about 21%, CPU 20% and
completion p95 17%. Ranges overlap slightly and five processes do not establish a production SLO.
The early-state range is wide; the useful causal comparison is the same late snapshot with and
without the index. Restored early-like performance in a fresh process also supports database
size as the primary cause of this observed drift, rather than process age alone.

Three additional CPU/SQL processes per condition confirm the mechanism. Median attempt lookup
time per 100 turns is 19.1 ms on early state, 297.5 ms on late state and 1.85 ms on indexed late
state. Separate EXPLAIN checks on disposable late-state copies confirm the indexed plan:
`SEARCH session_turn_attempts USING INDEX diagnostic_attempt_operation (operation_id=?)`.
Total native SQL time falls 708→390 ms on late state. Instrumented elapsed
medians are 1795→1450 ms; these are diagnostic timings and remain separate from unprofiled results.
The index's insertion/update overhead is included in both end-to-end comparisons.

The next production change should add a **non-unique** operation-id index through the schema and
a migration, validate upgraded databases and retry/recovery semantics, then repeat a sustained
run. This investigation does not add that index to application databases. Afterward, repeated
Drizzle query construction and the remaining history read/decoding work are candidates for a new
profile; this workload does not justify adding speculative execution-state indexes. Real provider
latency, UI rendering, much longer uptime and other workloads remain unmeasured here.

The soak, smoke, 15 unprofiled comparisons and nine CPU/SQL comparisons passed their existing
operation-success, per-session ordering/non-overlap and listener-cleanup assertions. The soak
ended with zero outstanding work/listeners and 8,608 retained changes/session. Both backup
journals match their persisted retention counters and pass SQLite integrity checks. No application
code changed after the retention commit, so this step adds only profiling documentation.

Ignored local evidence is in `performance-results/long-session-profile/`: `manifest.json` records
the frozen runtime hashes, `comparison.json` summarizes results, `validation.json` records backup
integrity/counter checks and index plans, `detailed-300s/` contains both
profiles/SQL plans/backups and the soak, and `control-states/` / `diagnostic-states/` contain every
comparison. The local drivers are `profile-long.mjs`, `compare-states.mjs` and `analyze.py`.
Re-run against the frozen artifacts sequentially:

```sh
node performance-results/long-session-profile/profile-long.mjs detailed-300s 300 1
node performance-results/long-session-profile/compare-states.mjs detailed-300s control 5
node performance-results/long-session-profile/compare-states.mjs detailed-300s diagnostic 3
python performance-results/long-session-profile/analyze.py
```

## Indexed turn-attempt lookup — October 21, 2026

The production schema now declares the non-unique `session_turn_attempts_operation` index on
`session_turn_attempts(operation_id)`. Migration `0050_session_attempt_operation_index` adds it
without rebuilding tables or rewriting attempts. Multiple attempts can still refer to the same
operation. The migration regression seeds interrupted/completed attempts for one operation at
historical schema boundaries, checks their preservation and the index's non-unique definition,
and verifies that the worker's lookup uses the index. Existing retry/recovery behavior is unchanged.

This comparison uses separate frozen compiled runtimes and **copied** migration directories:
before has 50 migrations through `0049`, after has 51 through `0050`. Server/shared hashes match;
production core JavaScript differs only in `db/schema.js`. Dependencies, client, synthetic provider
and workload are held constant. Node 24.22.0 / i3-8130U captures run sequentially without concurrent
builds or tests. Both versions get fresh five-minute captures with 20 sessions, 200 initial history
events/session, 100 turns/batch, persistent SSE connections and disabled telemetry. CPU/SQL windows
cover five batches after the first ten batches and after 270 seconds. Exports and database backups
happen outside those windows; whole-run throughput includes profiling overhead.

| Five-minute diagnostic metric           |         Before |          After |
| --------------------------------------- | -------------: | -------------: |
| Completed turns                         |         23,000 |         26,400 |
| Batch median, first→last fifth          | 1,164→1,421 ms | 1,136→1,109 ms |
| Completion p95 median, first→last fifth |     756→903 ms |     739→730 ms |
| History p95 median, first→last fifth    |     113→130 ms |     115→111 ms |
| Event-loop delay p99                    |         152 ms |         107 ms |
| Final retained changes/session          |          9,208 |         10,000 |

Elapsed time was 300.1/301.0 seconds, yielding about 14% more turns/second after indexing. The
before run's batch drift was +22%; the indexed run's late batches were slightly faster than its
early batches. Different throughput produces different database sizes, and the two runs have a
fixed before/after order. These are diagnostic observations rather than production capacity SLOs.

| CPU/SQL capture metric, per 100 turns | Before early | Before late | After early | After late |
| ------------------------------------- | -----------: | ----------: | ----------: | ---------: |
| Average elapsed                       |     1,223 ms |    1,492 ms |    1,233 ms |   1,196 ms |
| Server CPU                            |     1,389 ms |    1,582 ms |    1,400 ms |   1,272 ms |
| Attempt lookup native time            |      14.9 ms |    307.4 ms |     1.43 ms |    1.87 ms |
| Retention prune native time           |      8.35 ms |     8.18 ms |     8.49 ms |    8.37 ms |
| Attempts at window end                |        1,520 |      21,520 |       1,520 |     24,420 |

All windows make the same 500 attempt lookups. Captured plans change from
`SCAN session_turn_attempts` to `SEARCH session_turn_attempts USING INDEX session_turn_attempts_operation
(operation_id=?)`. The indexed late capture stays near early lookup cost despite a larger table.
SQLite self CPU samples fall 667→353 ms/100 turns between late windows; Drizzle remains near
345/347 ms and validation near 107/108 ms. Profiler-start frames are excluded and sampled durations
agree with measured windows within 5 ms. No broad short-session speedup is established: early
end-to-end timings differ by less than 1%.

Fresh-process comparisons use copies of the **same pre-index late snapshot** (21,520 attempts).
The after runtime applies its actual `0050` migration during setup; the before runtime retains
`0049`. No diagnostic indexes or SQL overrides are injected. Both get the normal 20-turn warmup
before each 100-turn measurement. Variant order alternates by repetition, with one predeclared
discarded process per variant followed by five unprofiled measurements and three separate CPU/SQL
measurements per variant. Index creation is outside the timed workload; index maintenance is included.

| Unprofiled metric, five-process median |         Before |          After |
| -------------------------------------- | -------------: | -------------: |
| 100-turn elapsed                       |       1,706 ms |       1,363 ms |
| Elapsed range                          | 1,660–1,789 ms | 1,330–1,375 ms |
| Server CPU                             |       2,035 ms |       1,672 ms |
| History p95                            |         164 ms |         144 ms |
| Completion p95                         |       1,062 ms |         910 ms |

At equal database size, elapsed time improves 20%, CPU 18%, history p95 12% and completion p95
14%. All measured samples are retained; only the declared warmup processes are excluded. Five
processes on one desktop do not establish production confidence intervals. The separate three-run
CPU/SQL medians show attempt lookup time 315.3→1.95 ms/100 turns and total native SQL time
720→403 ms. Their instrumented elapsed medians are 1808→1490 ms; those timings are kept separate
from the unprofiled table. Actual migration/index maintenance therefore reproduces the earlier
diagnostic-index result.

Both five-minute runs drained every batch and released all listeners. The indexed run reached
exactly 10,000 retained entries in all 20 sessions, while completing more turns. Peak sampled RSS
was 485/490 MiB and complete 30-second heap low-water windows ranged 56–91/57–86 MiB; profiling
exports affect these samples and this run does not establish a memory improvement or leak freedom.
Both late-window database snapshots and both early snapshots pass SQLite integrity/foreign-key
checks, preserve exact journal/counter agreement and contain the expected migration/index state.

All 1049 Node tests across 173 files and all 11 architecture regression tests passed. Workspace
types, architecture governance and lint/formatting passed. Architecture regressions were rerun
with normal child-process permissions after sandboxed fixture commands returned empty output.
The two five-minute captures, ten measured unprofiled comparisons and six
measured CPU/SQL comparisons passed operation success, FIFO/non-overlap and listener cleanup
assertions. Four additional comparison processes were predeclared warmups and also passed. No
real provider or developer database was used. Remaining CPU work is largely steady Drizzle query
construction/mapping and history reading/decoding; other workloads and longer production uptime
need their own profiles before choosing another change.

Local ignored evidence is under `performance-results/attempt-index-comparison/`: `manifest.json`
pins the two runtimes/migration sets, `comparison.json` summarizes every capture, `validation.json`
records database/index checks, and `before-profile/`, `after-profile/`, `control/` and `diagnostic/`
retain raw samples, query plans and profiles. Reproduce sequentially against those frozen artifacts:

```sh
node performance-results/attempt-index-comparison/profile-long.mjs before-profile 300 1 before
node performance-results/attempt-index-comparison/profile-long.mjs after-profile 300 1 after
node performance-results/attempt-index-comparison/compare-state.mjs control 5
node performance-results/attempt-index-comparison/compare-state.mjs diagnostic 3
python performance-results/attempt-index-comparison/analyze.py
node performance-results/attempt-index-comparison/validate.mjs
```

## Prepared turn and acceptance queries — October 21, 2026

Starting from indexed runtime `0f13ed8`, the remaining ordinary queued-turn SQL shapes now use
connection-owned prepared statements. The operation store handles duplicate checks, acceptance
session/queue reads, attempt lookup and guarded completion. Scoped rewind reconciliation reuses
its query while retaining the existing transaction and cancellation policy. Acceptance receipts
have their own statement factory. One `SessionTurnStore` per runtime is shared by dispatch, turn
execution and skill-catalog delivery. Session/provider/receipt projections contain only required
fields; statements retain no result cache. Compaction and provider settings remain fresh reads.
Every update rebinds its values and column-encoded timestamps. No schema or migration changes.

The before/after snapshots have identical migration directories (51 migrations), dependencies,
server JavaScript and shared JavaScript. The server's incremental build metadata differs and is
excluded from the executable-code equality check. Captures use Node 24.22.0 on the same i3-8130U
and run sequentially without concurrent builds/tests. The synthetic workload uses 20 sessions,
20 chunks/turn, persistent SSE connections and disabled telemetry.

Five unprofiled processes per version reopen disposable copies of the same indexed database
with 24,420 attempts. Each warms 20 turns and measures 100. Variant order alternates independently
by repetition; one predeclared warmup process per version is discarded, with all measured samples
retained. Three additional CPU/SQL processes per version use the same snapshot and ordering rule.

| Unprofiled metric, five-process median |         Before |      After |
| -------------------------------------- | -------------: | ---------: |
| 100-turn elapsed                       |       1,349 ms |     917 ms |
| Elapsed range                          | 1,332–1,716 ms | 913–965 ms |
| Server CPU                             |       1,699 ms |   1,110 ms |
| History p95                            |         141 ms |     115 ms |
| Completion p95                         |         909 ms |     683 ms |

Elapsed time improves 32%, CPU 35%, history p95 18% and completion p95 25% at equal database size.
The slower before sample is retained. Five processes on one desktop do not establish production
SLOs or confidence intervals. These gains include prepared queries **and** narrower projections;
there is no separate ablation establishing the contribution of each.

| Separate CPU/SQL diagnostic, three-process median |   Before |    After |
| ------------------------------------------------- | -------: | -------: |
| Native prepares per 100 turns                     |    1,802 |        2 |
| Drizzle self CPU samples                          |   421 ms |    94 ms |
| SQLite self CPU samples                           |   369 ms |   283 ms |
| Validation self CPU samples                       |   152 ms |   150 ms |
| Total native SQL time, including prepare          |   410 ms |   295 ms |
| Instrumented elapsed                              | 1,525 ms | 1,046 ms |

The two residual prepares are bounded first-use history parent/size queries. Application query
construction in the optimized paths no longer repeats per turn. Native execution counts match
in every measured short diagnostic: 3,680 get, 400 all, 2,200 run and 2,000 transaction-control exec
calls per workload. Query plans retain the operation-id index. CPU categories are leaf samples,
not disjoint additions to inclusive application method totals. Instrumented timings remain
separate from the unprofiled table; validation/decoding policy is unchanged.

Fresh five-minute runs use the same 20 sessions and 200 initial history events/session. CPU/SQL
profiles cover five consecutive batches after the first ten batches and after 270 seconds.
Profile export and SQLite backups happen outside those windows; whole-run time includes them.

| Five-minute diagnostic metric           |         Before |        After |
| --------------------------------------- | -------------: | -----------: |
| Completed turns                         |         26,000 |       39,000 |
| Elapsed seconds                         |          300.3 |        301.3 |
| Batch median, first→last fifth          | 1,154→1,119 ms |   757→709 ms |
| Completion p95 median, first→last fifth |     755→735 ms |   560→517 ms |
| History p95 median, first→last fifth    |     114→114 ms |     92→85 ms |
| Event-loop delay p99 / max              |   109 / 329 ms | 118 / 544 ms |
| Peak sampled RSS                        |        480 MiB |      458 MiB |
| Final retained changes/session          |         10,000 |       10,000 |

The optimized run completes about 49% more turns/second, with lower typical batch and request
latency. The fixed before/after order, profiling overhead and different accumulated history sizes
limit capacity claims. Loop-delay p99/max increased in this capture: this is not an across-the-board
tail-latency improvement. All outliers remain in the report. Complete 30-second heap low-water
windows range about 59–88/58–73 MiB without monotonic growth; five minutes does not establish
leak freedom, and profiling exports contribute to memory measurements.

| Profile-window metric, per 100 turns | Before early | Before late | After early | After late |
| ------------------------------------ | -----------: | ----------: | ----------: | ---------: |
| Average elapsed                      |     1,230 ms |    1,181 ms |    1,127 ms |     840 ms |
| Server CPU                           |     1,408 ms |    1,275 ms |    1,059 ms |     853 ms |
| Native prepares                      |        1,800 |       1,800 |           0 |          0 |
| Drizzle self CPU samples             |       350 ms |      341 ms |      118 ms |      82 ms |
| Retention prune native time          |      8.00 ms |     8.05 ms |    10.04 ms |   17.79 ms |
| Attempts at window end               |        1,520 |      24,120 |       1,520 |     35,820 |

The after early window includes two slower batches (1,577/1,590 ms, versus 769–861 ms for its
other three); its 861 ms batch median and 1,127 ms normalized mean are both retained. This timing
variation is not assigned to a cause by these captures. Late indexed lookups remain cheap in
both variants. Retention pruning costs more in the optimized late window because its journal is
already at the cap and performs deletes; the before late window is still below the cap. Both
end with exactly 10,000 entries/session. Each window makes the same 500 attempt lookups. Native
preparation assertions verify 9,000→0 prepares per 500-turn window. CPU analysis excludes profiler
startup frames. Sampled durations agree with measured windows within 9 ms; the profiler remains
active during post-window process-resource sampling, adding about 8 ms in the after late capture.
These small margins remain in the diagnostic CPU samples.

All 1052 Node tests across 174 files passed, including new fresh-value/date, rollback, catalog
scope and receipt reuse checks. After compilation, all eight HTTP/SSE concurrency tests passed
again against the built runtime. Workspace types, architecture governance, all 11 architecture regression tests, lint and formatting
passed. Both soaks, ten measured unprofiled comparisons, six measured CPU/SQL comparisons and
four discarded warmup processes passed success, FIFO/non-overlap and listener cleanup assertions.
All four database backups pass SQLite integrity/foreign-key checks and exact retention-counter
agreement; both variants retain the same non-unique operation index and 51 migrations.

This measures the normal queued-turn/history workload with a synthetic provider and telemetry
disabled. Usage-dependent writes, exceptional recovery/configuration paths, execution-state
polling, provider latency and UI rendering need separate measurements. Remaining Drizzle time
includes row mapping and prepared-statement execution; this change does not remove all ORM cost.
Local ignored evidence is under `performance-results/drizzle-comparison/`: frozen variants,
`manifest.json`, `comparison.json`, `validation.json`, raw profiles and paired samples. Reproduce
sequentially against the frozen artifacts:

```sh
node performance-results/drizzle-comparison/compare-state.mjs control 5 performance-results/attempt-index-comparison/after-profile/late.db
node performance-results/drizzle-comparison/compare-state.mjs diagnostic 3 performance-results/attempt-index-comparison/after-profile/late.db
node performance-results/drizzle-comparison/profile-long.mjs before-profile 300 1 before
node performance-results/drizzle-comparison/profile-long.mjs after-profile 300 1 after
python performance-results/drizzle-comparison/analyze.py
node performance-results/drizzle-comparison/validate.mjs
```

## Event-loop delay investigation — October 21, 2026

The delay maxima in the preceding diagnostic soaks include measurement overhead. The CPU
analysis excludes profiler startup, but the soak's `monitorEventLoopDelay()` stays enabled during
startup, profile export, SQL diagnostics and database snapshots. Do not use those whole-run
maxima as application-only latency measurements.

This investigation leaves application code unchanged. Captures reopen disposable copies of the
same populated, indexed database (24,420 attempts and 126,100 events, or 6,305 events/session),
using the frozen optimized runtime committed as `53a6b27`. Each process warms 20 turns before
measurement. The workload retains 20 sessions, persistent SSE, 20 synthetic provider chunks/turn
and disabled telemetry. The client runs in another process. Legacy soak report metadata still
says 200 initial history events; the investigation manifest records the actual imported state.
No real provider or developer database participates.

A 45-second diagnostic explicitly times profiler startup, stop, export and database snapshots.
`Profiler.start` takes 282/246 ms and overlaps timer intervals of 286/255 ms: profiler startup
itself demonstrably stalls the loop. However, the run's 532 ms histogram maximum occurs later,
during the profiled workload, outside those startup/export/snapshot phases. Startup alone cannot
explain all the maxima, and the older 329/544 ms maxima cannot be assigned exact causes
retrospectively. Snapshot phases last 381/414 ms in total, including asynchronous backup; those
elapsed durations are not equivalent to continuous loop stalls.

Separate controls use no Inspector profiler or SQL/method wrappers, retaining only the ordinary
soak monitor, a 10 ms heartbeat and a GC observer. Three 30-second repetitions per condition
alternate the order of 200-row and 50-row history requests. Both conditions issue one history
request per input; only its requested row limit changes. All measured samples are retained.

| Three-process result    | 200-row history pages | 50-row history pages |
| ----------------------- | --------------------: | -------------------: |
| Loop-delay p99 median   |                101 ms |                57 ms |
| Loop-delay p99 range    |             93–113 ms |             56–60 ms |
| Maximum delay range     |            155–305 ms |           109–199 ms |
| Completed turns/process |           3,300–3,800 |          5,400–5,500 |

The smaller-page workload reduces median p99 about 43%, while completing more turns. This is
an attribution experiment, not an application change or a comparison at equal rows delivered:
50-row pages deliberately do less work. It establishes that concurrent history processing
materially affects loop delay; it does not select a new API/UI page size. Occasional larger
outliers remain in both conditions.

A separate 60-second capture instruments synchronous history, queue and event methods, native
SQL and history-response `JSON.stringify`. It also samples Linux main-thread runtime/runqueue
counters and GC entries. It completes 7,900 turns with delay p99/max of 101/147 ms. Among its 461
heartbeat intervals lasting at least 50 ms (30.17 seconds combined):

| Inclusive wall-time attribution       |    Time | Share of those intervals |
| ------------------------------------- | ------: | -----------------------: |
| History page reading/mapping/decoding | 17.44 s |                      58% |
| History response JSON serialization   |  4.51 s |                      15% |
| Both history stages                   | 21.94 s |                      73% |

Those intervals contain 6,498 history requests. Individual pages average about 2.62 ms for
reading/decoding and 0.68 ms for serialization across the full capture; bursts of many pages
accumulate before timers run again. For example, one 115 ms interval handles 20 pages, spending
83 ms in page processing and 22 ms serializing responses. The synchronous path includes prepared
SQLite reads, Drizzle row mapping, JSON decoding and both DB-row and wire-schema validation in
`parseEventRow`. Fastify falls back to `JSON.stringify` for this route's response. CPU samples
from the separate diagnostic also show row decoding/validation, native reads and serialization.
The attribution table contains inclusive wall times, including any GC or scheduler wait inside
those methods; native SQL and GC totals must not be added to it as disjoint CPU categories.

GC is a secondary contribution in this capture: 251 entries total 829 ms and the longest is
13 ms. No measured native SQL call reaches 10 ms. These observations do not support blaming a
single slow query, retention write or large GC pause for its 147 ms maximum. Scheduler contention
also matters: that maximum heartbeat interval includes 98 ms of main-thread runtime and 47 ms
waiting runnable for CPU. This does not identify which competing process caused the wait. The
unprofiled 305 ms outlier has no scheduler/method trace, so its precise decomposition remains
unknown. An interactive desktop and finite samples do not establish production worst-case bounds.

A separate five-minute control, with 200-row pages and no CPU/SQL profiler, completes 44,900
turns in 300.3 seconds. Loop-delay p99/max are 74.6/159.6 ms. The independent heartbeat's first
versus last minute has p99 of 83/70 ms and maxima of 160/87 ms; these are heartbeat statistics,
not reset-window values from the whole-run histogram. First/last fifth batch medians are
687/653 ms. No upward latency trend appears in this run as history grows. The longest GC entry
is 12.3 ms. All 20 sessions finish at exactly 10,000 retained changes, with no outstanding work
or leaked listeners. This provides an application baseline without the diagnostic phases; it
is a separate run, so the lower maximum cannot be attributed entirely to removing the profiler.
All nine measured captures pass the existing success, per-session FIFO/non-overlap and listener
cleanup assertions. Application source is unchanged, so no application test-suite rerun is
necessary for this documentation-only investigation.

The current UI already receives ordinary turn updates through SSE; it does not request a full
history page after every input. These captures intentionally stress history traffic. The finding
therefore applies most directly to concurrent history loads, scrolling and navigation, rather
than proving that every normal streamed turn incurs this cost. Snapshot/reconnect
serialization, telemetry-enabled operation, larger event bodies and real providers need their
own measurements.

The next application target is bounded history decoding and response serialization under
concurrent requests, preserving validation, fresh reads, ordering and cursor/parent semantics.
Evaluate work budgeting/yielding and codec/mapping cost before introducing workers or caches.
The 50-row control is evidence for that priority, not approval to reduce the user's history
window. Future baseline reports should keep CPU/SQL/snapshot diagnostics separate from the
application loop-delay window and report scheduler/GC context alongside large outliers.

Local ignored evidence and helpers are under `performance-results/event-loop-investigation/`:
`manifest.json`, `comparison.json`, `validation.json`, raw `trace.json`/`soak.json` per process,
and the separate `diagnostic/` CPU profiles and database backups. Both backups pass SQLite
integrity and foreign-key checks; the frozen executable JavaScript matches the current build. Reproduce sequentially with the existing frozen
runtime and database artifacts:

```sh
node performance-results/event-loop-investigation/run.mjs diagnostic 45 diagnostic 200
node performance-results/event-loop-investigation/sequence.mjs
python performance-results/event-loop-investigation/analyze.py
node performance-results/event-loop-investigation/validate.mjs
```

## Cooperative HTTP history responses — October 21, 2026

HTTP `/api/sessions/:id/events/page` now shares a cooperative work queue across requests within
one server's `SessionEventQueries` instance. This covers latest/backward pages and the
`aroundId`/`afterId` navigation windows. Each loop slice runs for roughly 2 ms or at most 128
iterator steps, then schedules another `setImmediate`. Jobs rotate between steps, so concurrent
requests share the budget rather than each claiming a full slice in the same turn.

The first step captures rows, parent anchors and cursors synchronously using the existing query
policy. No transaction, statement iterator or database view is held across an asynchronous yield.
Subsequent steps retain the same DB-row and wire-schema validation and encode events in batches
of at most eight events or 8,192 serialized UTF-16 code units before yielding. The character
threshold bounds normal encoded batches to roughly 24 KiB worst-case UTF-8, plus any final
indivisible event. This amortizes scheduler/request-context entry overhead across small batches. The final step assembles the already encoded events and cursor envelope.
Fastify sends that completed JSON string with the normal JSON content type. Validation or encoding
failure occurs before response headers/body are sent, preventing partially successful pages.
Disconnects cancel queued work and release their abort listeners and captured rows. Each job
uses an `AsyncResource` to preserve its submitting request context across shared scheduler slices;
completion/cancellation destroys that resource.

The synchronous query APIs remain available for transactional catch-up/snapshot consumers. This
change bounds the HTTP page endpoint; it does not convert SSE snapshot/replay or the legacy
unpaged history endpoint to cooperative processing. Live SSE/provider work benefits when page
requests stop monopolizing the shared loop. There is no result cache, worker, migration, reduced
page limit or truncated event. Cursor, UTF-8 byte-budget, parent-anchor and oversized-single-event
progress rules are preserved. The slice budget is cooperative rather than a hard latency limit:
a native SQLite call, one large JSON value, final string assembly, socket encoding, GC or OS
scheduling can exceed it. Other application work has its own event-loop costs.

The before runtime is committed `53a6b27`; the candidate freezes the application code described
above. Core/shared executable JavaScript, dependencies and all 51 copied migrations are identical.
All captures reopen disposable copies of the same indexed database with 24,420 attempts and
6,305 history events/session, warm 20 turns, then measure 20 concurrent sessions with persistent
SSE and 20 synthetic provider chunks/turn. Both versions request 200-row pages after each input,
with telemetry disabled. Unlike the earlier attribution experiment, this comparison delivers the
same page size in both conditions. The UI normally receives ordinary turn updates through SSE,
so this remains a stress workload for concurrent history traffic.

Initial prototype captures are archived and excluded after adding per-request async-context
preservation and then amortizing that overhead with bounded batches. Both variants receive fresh final short comparisons and fresh CPU profiles. The earlier
unchanged five-minute baseline is retained as a reference; host timing varied between stages,
so capacity comparisons use the fresh paired controls. Two five-second pilots are also excluded. Three fresh 30-second
processes per version alternate variant order by repetition; all measured samples, including
outliers, are retained. A separate five-minute candidate control checks sustained behavior. Additional
CPU profiles start before the measurement window and stop after the loop monitor and CPU/elapsed
counters have been captured; profiler startup/export are excluded from those counters. Controls
have no CPU profiler or SQL/method wrappers, only the soak monitor, 10 ms heartbeat and GC observer.
No builds or tests run concurrently with these captures.

The full 1,062-test Node suite across 176 files passes after the context correction. After the
final batching change, all 167 server tests across 37 files pass, including shared-budget fairness,
batch size/large-event yielding, cancellation/listener
cleanup, error isolation, exact JSON for every persisted event variant, page/window equivalence,
captured-row consistency across yields, fresh subsequent reads, UTF-8/oversized-event progress,
and corrupt-row HTTP errors without partial payloads. Workspace types, architecture governance,
all 11 architecture regressions and lint pass. Ownership records include the new queue/response
modules and their tests.

| Final three-process median                  | Before |  After |
| ------------------------------------------- | -----: | -----: |
| Loop-delay p99                              |  85 ms |  45 ms |
| Loop-delay maximum                          | 138 ms |  80 ms |
| First-output p95, median across batches     | 480 ms |  80 ms |
| Turn-completion p95, median across batches  | 523 ms | 106 ms |
| Acceptance p95, median across batches       |  81 ms |  38 ms |
| History-response p95, median across batches |  86 ms | 143 ms |
| Turns/second                                |    138 |    130 |
| Server CPU per 100 turns                    | 761 ms | 810 ms |

In these samples, loop-delay p99 falls about 47%, completion p95 80%, and first-output p95 83%.
History-response p95 increases about 66%, median throughput decreases 5%, and CPU per turn rises
6%. Spreading history work across loop turns lets acceptance/provider/SSE work progress sooner,
while history callers wait longer for a complete page. This is a responsiveness tradeoff, not a
uniform request-latency or capacity improvement. Batch p95 values are summarized by their median
across batches and then across processes, not pooled request p95s.

All final samples are retained. Baseline throughput ranges 110–141 turns/second versus 129–131
for the candidate; host conditions varied considerably across stages. The first final baseline
process is slower than the other two and remains included. Loop p99 ranges are 81–147/44–46 ms;
maximum ranges are 117–204/58–92 ms. The repeated runs support lower loop/request contention in
this workload, not precise production capacity estimates. Earlier per-row prototypes and their
counterexamples remain in the local evidence; they are excluded because application code changed,
not because individual measurements were inconvenient. One obsolete sustained capture was
explicitly terminated before completion and is not a successful measured run.

The client is closed loop: each session waits for its history response before sending the next
input. Longer history responses also pace subsequent inputs, so the completion/first-output gains
combine improved loop fairness with changed queue arrival timing. They do not mean 100 turns
finish 80% sooner; aggregate throughput is slightly lower in the median. Fixed-arrival-rate tests
and real provider workloads would be needed to isolate that effect or predict production gains.

The final five-minute candidate run completes 41,100 turns in 300.4 seconds with loop-delay
p99/max of 42.6/104.5 ms. First/last fifth batch medians are 735/710 ms. Every batch drains;
all 20 sessions end at exactly 10,000 retained changes, with zero outstanding work/listeners.
The earlier unchanged baseline completes 36,800 turns with p99/max of 123.6/232.1 ms and batch
medians of 727/1,207 ms in its first/last fifth. Because those sustained captures span different
host conditions, the higher candidate turn count is not evidence of a capacity gain or proof
that the baseline's late slowdown was database growth. Use the fresh paired controls for the
throughput/CPU tradeoff. The candidate's own run shows no upward latency trend over five minutes.

Memory remains a limitation. Periodic sampled RSS peaks at 505 MiB in the candidate versus
442 MiB in the earlier baseline; these omit the final sample after heartbeat-trace export.
Complete 30-second natural-GC heap low-water windows range 55–103 MiB versus 52–74 MiB. The
candidate's last two windows rise to 95/103 MiB despite major GC activity, so this is not evidence
of leak freedom or a memory improvement. Sampled heap includes in-flight responses, changing
history state and diagnostic buffers; the cause of the higher late heap is not isolated by
this capture. Queue cleanup assertions pass, but retained-heap analysis and longer runs remain
follow-up work. The candidate's largest GC entry is 16.4 ms.

Separate fresh 10-second CPU profiles cover 1,400 baseline turns and 1,200 candidate turns.
Normalized leaf samples retain similar native SQLite/validation costs (245/76 versus 263/81 ms
per 100 turns). Fastify serialization self samples fall 64→0.4 ms/100 turns because JSON encoding
moves into the cooperative response pipeline; that pipeline accounts for 90 ms/100 turns,
including encoding, generator/scheduler work. This is relocated work, not eliminated serialization
CPU. GC self samples rise 12→22 ms/100 turns in these diagnostics. These are wall-time samples
from separate instrumented processes, not disjoint additions to inclusive method timings or a
replacement for the unprofiled CPU comparison. Recorded profile windows exclude profiler startup
and export; sample coverage agrees with their recorded measurement spans.

All ten final measured captures pass existing receipt/content, FIFO/non-overlap, queue-drain and
listener-cleanup assertions, totaling 104,300 turns. An independent HTTP comparison reopens the
same database without submitting new turns and verifies identical status, JSON content type,
body length and SHA-256 for 24 latest/backward/forward/empty/missing-target cases across three
sessions. These compare the frozen baseline with the final implementation, independently of
refactored helper reuse in unit tests.

Local ignored evidence is under `performance-results/bounded-history-comparison/`:
`manifest.json`, `comparison.json`, `validation.json`, frozen runtimes/copied migrations,
`control-*`, `long-*`, `cpu-*`, wire-response fingerprints and check logs. Superseded captures
and code remain in `prototype/`, `context-per-row/`, `variants/prototype/` and
`variants/context-per-row/`; they are excluded from the final summary. To repeat against the
frozen artifacts sequentially (without overlapping builds/tests):

```sh
node performance-results/bounded-history-comparison/run.mjs long-before 300 before control
node performance-results/bounded-history-comparison/batched-sequence.mjs
python performance-results/bounded-history-comparison/analyze.py
node performance-results/bounded-history-comparison/validate.mjs
```

## History memory investigation — October 21, 2026

The cooperative history implementation was committed as `4a3edb4` (`perf: bound history
response work across requests`). The follow-up investigation compares that executable with
`53a6b27`, using the frozen runtime and copied migrations from the preceding experiment.
No application changes were made during this investigation.

The higher resident memory is reproducible, but an accumulating application heap was not
reproduced over 40,000 turns. The evidence points to more temporary allocation, substantially
more promotion into old space, and V8 retaining memory capacity for reuse. These observations
apply to the synthetic workload below; they do not establish leak freedom for arbitrary
providers, payloads, telemetry configurations, or longer runs.

### Controls and retained heap

Each main capture starts from a fresh copy of the same database: 20 sessions with 6,305 events
per session, 200-row history requests, 20 provider chunks per turn, and 20 persistent SSE
connections. HTTP/JSON/SSE clients run in a separate process; telemetry is disabled. Each
version completes exactly 40,000 measured turns, rather than comparing different turn counts
within a time limit. The original FIFO, receipt, content, non-overlap, operation drain, journal
retention, and listener checks remain enabled.

The new probe appends one-second memory/heap-space samples and drained-batch samples to JSONL.
It keeps aggregate GC counters, rather than retaining a ten-millisecond trace array. The
previous sustained traces contained 9,018 baseline timer records and 21,473 candidate records,
with three additional objects per record. That adds unequal diagnostic overhead; it does not
explain the entire resident-memory increase.

The equal-turn controls have no snapshots or forced GC during load. At the final drained
checkpoint, three explicit collections separated by loop turns measure the surviving heap.
A separate candidate capture uses the same collection protocol at warmup and every 10,000
turns, with heap snapshots at warmup and completion.

| Measurement                                     |     Before | Cooperative history |
| ----------------------------------------------- | ---------: | ------------------: |
| Peak periodic RSS, natural-GC control           | 446.81 MiB |          468.51 MiB |
| Peak periodic used heap, natural-GC control     | 257.74 MiB |          246.99 MiB |
| Final drained heap after explicit collection    |  45.13 MiB |           45.22 MiB |
| Collected heap after clients close              |  44.18 MiB |           44.24 MiB |
| Peak old-space capacity during periodic samples | 196.92 MiB |          212.67 MiB |
| Peak allocated glibc arena bytes (`uordblks`)   |  22.02 MiB |           22.19 MiB |

The candidate's separate collected checkpoints were 45.72 MiB after warmup, then 44.59,
44.86, 44.93, and 45.11 MiB after 10,000, 20,000, 30,000, and 40,000 turns. Raw heap samples
between collections were much higher. The two final 95/103 MiB low-water windows in the
previous experiment were not reproduced as growing retained heap. In the fresh candidate
natural-GC control, minimum sampled heap across successive 10,000-turn windows was 71.42,
52.26, 49.63, and 63.72 MiB. A timed low-water sample remains sensitive to GC phase and active
requests, including when major collections occur within the same window.

Warm and late candidate heap snapshots contain 803 nodes named `Promise`, 21 named
`IncomingMessage`, 21 named `ServerResponse`, and seven named `AsyncResource` in both captures.
These are snapshot name cohorts, including relevant constructors/prototypes, rather than
counts of active requests. Persistent SSE requests account for the HTTP objects' retaining
paths. The snapshot's total node self size increases by 829,129 bytes (0.79 MiB), including
V8 weak metadata and ordinary objects/numbers retained by the benchmark entry module. The
new HTTP history work has drained; the report does not interpret runtime metadata as a
request leak. Snapshot self size includes native backing stores and differs from
`process.memoryUsage().heapUsed`.

### Allocation lifetime and resident capacity

Separate, sequential 5,000-turn diagnostic captures enable V8 `--trace-gc-nvp` only during
measured load. Main-isolate GC records are delimited by explicit start/end markers. These
instrumented runs explain allocation behavior; their latency and throughput are not compared
with the normal benchmark.

| V8-reported load diagnostic                         |     Before | Cooperative history |
| --------------------------------------------------- | ---------: | ------------------: |
| Allocated bytes, normalized to 100 turns            | 186.93 MiB |          207.93 MiB |
| Bytes promoted by minor collections, per 100 turns  |   5.52 MiB |           16.28 MiB |
| Mean surviving new-space bytes per minor collection |   2.00 MiB |            5.43 MiB |
| Minor / major collection count, 5,000 turns         |    151 / 3 |             218 / 6 |
| Peak reported V8 pooled chunk count                 |        201 |                 331 |

Reported allocation rises about 11%, while minor-GC promotion rises about 2.95 times.
These counters include application, runtime, and probe allocations and stop at the final
reported collection; they are not precise allocation totals for an individual function.
Together with the source structure, they support the explanation that spreading work across
loop turns keeps temporary objects alive through more collections. Several requests can
hold captured raw rows and encoded fragments simultaneously. The shared queue bounds CPU
work per slice, but does not impose an active-page or byte admission limit.

At 20,000 drained turns, old-space capacity was 154.17 MiB before and 185.42 MiB after,
while total used heap was similar (124.90 versus 127.74 MiB). This is consistent with the
additional RSS being substantially runtime capacity, rather than additional permanently
reachable session history. The snapshots and GC counters establish the retained-heap and
promotion behavior; they do not attribute every promoted object to the history helper.

A local diagnostic addon reads glibc `mallinfo2()` and calls `malloc_trim(0)` only after the
load ends. In the equal-turn controls, trimming reduces RSS by 8.50 MiB before and 8.69 MiB
after, leaving most of the difference intact. These allocator statistics exclude V8 mappings
and other allocations; SQLite's global memory counter is unavailable because its symbol is
not exported by this Node executable.

The short diagnostics also inspect the Pino transport worker. Its used heap stays near
6.9–7.0 MiB from warmup to completion in both versions. After ordinary explicit GC and
native trimming, Inspector `HeapProfiler.collectGarbage` reduces resident memory from
429.62 to 143.66 MiB before and from 462.23 to 143.79 MiB after. Main-isolate heap capacity
also contracts from roughly 183 MiB to 46–47 MiB. This demonstrates substantial reclaimable
runtime capacity; it is not a reason to add forced GC or native allocator trimming to the
server. The separate snapshot capture is excluded from RSS comparison because snapshots
alter collection, heap capacity, and resident memory substantially.

### Next optimization and validation

The next change should control the amount of active history work, preserving the existing
shared CPU budget. Evaluate an active-page or byte admission budget before capturing rows,
then release consumed raw-row references as batches finish where ownership permits. Keep
the response validation/error contract intact. Compare several limits under the same
20-session workload to choose the responsiveness/memory tradeoff; a fixed limit has not yet
been selected or implemented. Pending-request admission and individual oversized events
also need explicit behavior when defining a strict total memory bound.

Five completed captures cover 130,000 turns and 1,300 drained-batch checkpoints. Every
checkpoint has zero history jobs and no scheduled history slice; SSE listeners remain at
20 during load and return to zero after clients close. Every completed capture passes the
existing operation/content checks and retains 10,000 journal entries per session. The
fixture/database remains owned during the final close sample, so this is a steady-state
retention investigation rather than a database-disposal test.

Artifacts are in ignored `performance-results/history-memory-investigation/`: runtime/seed
provenance in `manifest.json`, streamed samples in each run's `memory.jsonl`, natural controls
in `natural-before/` and `natural-after/`, snapshot diagnostics in `retained-after/`, GC traces
in `gc-before/` and `gc-after/`, and summaries/validation in `analysis.json`, `gc-summary.json`,
and `validation.json`. Failed diagnostic attempts are retained and explicitly excluded:
one requested statistics from a closing worker, one output directory was moved before its
process exited, and an overlapping restart was stopped. All short diagnostics used above
were rerun sequentially and exited successfully.

Reproduction on this Linux/glibc host, using the frozen executable snapshots and original
seed database retained from the preceding experiment:

```sh
cc -shared -fPIC -O2 -I "$NVM_DIR/versions/node/v24.22.0/include/node" performance-results/history-memory-investigation/allocator.c -o performance-results/history-memory-investigation/allocator.node -ldl
node performance-results/history-memory-investigation/run.mjs <fresh-before-label> before 40000 natural
node performance-results/history-memory-investigation/run.mjs <fresh-after-label> after 40000 natural
node performance-results/history-memory-investigation/sequence.mjs
python performance-results/history-memory-investigation/analyze.py
python performance-results/history-memory-investigation/gc-summary.py
python performance-results/history-memory-investigation/validate.py
```

Use fresh output directories and run captures sequentially. `sequence.mjs` uses the
`gc-before`/`gc-after` labels, so preserve those existing artifacts elsewhere before rerunning.
The reused soak JSON template still reports `historyEventsPerSession: 200` and a nominal
`seconds: 3600`; actual seed size and fixed-turn termination are pinned in the manifest and
runner. Diagnostic GC, snapshot, and probe I/O costs make these timings unsuitable for new
latency or capacity claims. Current native-allocator measurements require Linux/glibc and
matching Node headers; they introduce no application dependency.

## History row lifetime — October 22, 2026

The cooperative HTTP response builder now consumes its private captured rows as it encodes
them. One in-place reversal lets it pop rows in wire order without copying the remaining
array on each batch. Completed rows no longer stay referenced behind unfinished batches.
A `finally` block clears remaining rows and encoded fragments on completion, cancellation,
or validation failure. Captured-row ownership is explicit in the helper's contract.

The API, pagination/parent/cursor behavior, per-page byte budget, eight-event/8,192-code-unit
batch bounds, shared CPU budget, request async context, and complete-error-before-headers
behavior remain. Synchronous history/SSE readers keep their existing behavior. This change
reduces temporary-data lifetime; it does not add request admission limits or compact payloads.

Frozen baseline `4a3edb4` and the candidate differ in one production JavaScript file, plus
its test file. Core/shared JavaScript, copied migrations, dependencies and client code match.
Every ordinary capture uses a fresh copy of the same late database (6,305 events/session),
20 sessions, 200-row history requests, 20 synthetic provider chunks/turn and 20 persistent
SSE connections. Clients run separately; telemetry is disabled. Builds and tests finish
before captures begin. No production database/provider is used.

### Responsiveness and allocation diagnostics

Three fresh 30-second controls per version alternate order by repetition. They use common
one-second streamed memory probes and aggregate GC counters, with no CPU profiler or forced
collection. Values are medians across processes; request metrics are medians of each batch's
p95 values, not fleet percentiles.

| Control metric                       |    Before |     After |
| ------------------------------------ | --------: | --------: |
| Completed turns/second               |    134.05 |    135.01 |
| CPU per 100 turns                    | 786.95 ms | 779.64 ms |
| History response p95                 | 134.57 ms | 133.85 ms |
| First output p95                     |  75.48 ms |  74.70 ms |
| Completion p95                       | 101.34 ms | 101.08 ms |
| Event-loop delay p99                 |  44.04 ms |  42.21 ms |
| Event-loop delay max, process median |  59.47 ms |  61.18 ms |

These results show broadly unchanged throughput and request latency. Throughput ranges overlap
(120.22–136.21 before; 133.83–138.23 after), as do loop-p99 ranges (41.98–48.33 ms before;
41.55–43.32 ms after). All samples, including the slower first baseline, are retained. Short-run
peak periodic RSS also overlaps: 447.07–469.63 MiB before and 445.13–462.38 MiB after.

Separate 5,000-turn diagnostics enable main-isolate V8 NVP tracing during load. Reported
allocated bytes are nearly unchanged: 207.56→206.72 MiB per 100 turns. Bytes promoted by minor
collections fall 16.28→12.87 MiB per 100 turns, about 21%. Mean surviving new-space bytes per
minor collection fall 5.41→4.54 MiB. This supports shorter temporary-object lifetimes rather
than a substantial reduction in object construction. The trace counters include application,
runtime and probe work, end at the last reported collection, and come from one process per
version; these instrumented timings are excluded from ordinary latency comparisons.

### Sustained and paused-page memory

One 40,000-turn capture per version uses natural GC throughout load, followed by explicit
collection after latency/CPU counters have stopped. The candidate runs first, then the
baseline; ordering and single-process sampling limit capacity/memory conclusions.

| Equal-turn memory metric            |     Before |      After |
| ----------------------------------- | ---------: | ---------: |
| Measured turns                      |     40,000 |     40,000 |
| Peak periodic RSS                   | 468.42 MiB | 469.05 MiB |
| Peak periodic used heap             | 263.65 MiB | 252.49 MiB |
| Peak periodic old-space capacity    | 213.67 MiB | 205.92 MiB |
| Final drained heap after collection |  45.19 MiB |  45.16 MiB |
| Collected heap after clients close  |  44.21 MiB |  44.21 MiB |

RSS is effectively unchanged in this workload. Lower promotion and sampled heap do not
establish an overall resident-memory improvement. V8's capacity/pooling behavior still
matters, and one-second samples can miss brief peaks. Both runs drain every batch, retain
exactly 10,000 journal entries/session and release all SSE listeners. Neither shows growing
collected heap at the final checkpoint. These captures do not establish leak freedom for
other providers, payloads or longer sessions.

A separate paused-page diagnostic isolates live data from resident capacity. In three fresh
processes per version with alternating order, it creates 20 response generators, each owning
100 text rows with 8 KiB ASCII content per row. It pauses after 50 encoded rows/page and
collects between phases. The large encoded rows each consume a batch, so both versions have
identical progress and retain the same encoded output at the midpoint.

Median collected heap after capturing all rows is effectively equal (29.82 MiB each). At the
half-encoded checkpoint it is 38.27 MiB before and 30.23 MiB after, about 8.03 MiB less live
heap. The original keeps raw rows alongside their encoded replacements; the candidate has
released the processed rows. This is an artificial paused-generator ownership diagnostic,
not an HTTP latency, provider-throughput or application RSS claim. It demonstrates why the
change can matter more for large pages even when ordinary-workload peak RSS barely moves.

### Validation and artifacts

All 1,065 Node tests across 176 files, 11 architecture regressions, workspace type/dependency
checks, changed-file lint/formatting and dependency/server builds pass. Tests cover incremental
snapshot consumption, output order, batch limits and cleanup after cancellation or a corrupt
later row. Twenty-four real HTTP cases are byte-identical between frozen versions, including
parent/cursor/window/empty/not-found cases.

Ten completed ordinary/GC/sustained captures cover 114,300 measured turns and 1,143 drained-batch
checkpoints; the 100-turn harness smoke is excluded. Six additional paused-page processes
pass. No measured captures are discarded. All successful workload runs verify receipt/content,
FIFO/non-overlap, operation drain, retention and listener cleanup. Production executables still
match the frozen candidate after verification.

Ignored artifacts live in `performance-results/history-row-lifetime-comparison/`. The manifest
pins source, runtime and seed provenance; `comparison.json` contains every completed run,
control medians/ranges and GC summaries; `validation.json` records invariants, paused-page
medians and tool hashes. `checks/` preserves test/type/build/architecture output. Both runtime
snapshots contain copied migration directories, with dependency links only for node_modules.

With those retained local snapshots and seed database, run captures sequentially using fresh
labels (the runner rejects existing directories):

```sh
node performance-results/history-row-lifetime-comparison/run.mjs rerun-before before control 30
node performance-results/history-row-lifetime-comparison/run.mjs rerun-after after control 30
node performance-results/history-row-lifetime-comparison/run.mjs rerun-memory-before before memory 40000
node performance-results/history-row-lifetime-comparison/run.mjs rerun-memory-after after memory 40000
```

`sequence.mjs` records the original alternating controls, GC diagnostics and sustained captures;
`paused-sequence.mjs` records the ownership diagnostic. Preserve their existing fixed-label
outputs before rerunning. The reused soak template still labels initial history as 200 rows
and fixed-turn modes as 3,600 seconds; actual seed size, termination and instrumentation are
pinned in `manifest.json` and `run.mjs`. `analyze.py` and `validate.py` regenerate the original
comparison and invariants. No forced collection is added to application code.
