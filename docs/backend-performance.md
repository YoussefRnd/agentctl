# Backend, concurrency and native startup baselines

Run these alongside the existing [browser performance safeguards](performance.md). They measure
different parts of AgentCtl; their durations must not be added together.

## Commands

```sh
pnpm perf:backend
pnpm perf:desktop
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
identical between variants. Runs alternated before/after order within each workload, repetition
and telemetry mode. There were no concurrent builds or tests during measurement; the existing
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
