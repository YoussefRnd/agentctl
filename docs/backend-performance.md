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
