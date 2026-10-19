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

Completion starts at client submission and ends after runtime execution/finalization. First output
ends when the loopback SSE client parses the first provider text for that prompt. It is not paint
latency. SSE batches may combine chunks; the harness reconstructs and verifies complete output
instead of assuming one network frame per chunk. It also requires usable bounded history pages,
unique durable receipts, completed operations and listener cleanup before accepting a sample.

Loopback clients share the server process. CPU, memory and event-loop measurements therefore
include the load generator, SSE parsing and the in-process telemetry receiver. These are comparative
application-workload measurements, not isolated server resource costs or a maximum-capacity claim.
Peak memory is sampled every 20 ms and can miss short spikes. No forced garbage collection is used;
RSS is not a live-object or leak measurement. Within-run p95 from five turns is usually the maximum;
it must not be presented as a production p95. Compare the three-run distributions as well as medians.

Reports include Node/OS/CPU, commit, dirty state and a source/lockfile hash. `summary.md` contains
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

Verified locally on Linux x64, Node v24.22.0, Intel Core i3-8130U with four logical CPUs.
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

The next profiling target is the increased acceptance/history/turn latency under the 20-session
workload. These measurements do not isolate SQL, validation, serialization or client-side load
generation as the cause. Collect CPU profiles and comparable repeat captures before selecting
an optimization or setting a latency budget.

Validation: the full suite passed 1,560 tests across 274 files. Final focused checks passed all
23 observability/concurrency tests and all eight concurrency cases again after rebuilding the
fixture. All 11 architecture regressions (including fixture cache invalidation), workspace types,
lint/formatting and builds passed. All 15 provisioned dashboard queries executed successfully
against the local stack with recent metric data. Native startup, IPC, shutdown and startup-failure
cleanup also passed with telemetry enabled. Hosted CI has been configured but was not triggered.
