# OpenTelemetry

AgentCtl has opt-in OpenTelemetry traces, metrics and logs for the standalone server, the Electron
embedded server, durable agent turns, provider prompt calls and Electron startup. It is disabled by default. The API is inert
until a host explicitly starts its SDK; merely importing core or server modules starts no exporter.

## Local development

Start the pinned Collector/Grafana development backend (Docker Compose required):

```sh
pnpm telemetry:up
AGENTCTL_TELEMETRY=1 pnpm dev:web
# Or, for the desktop main process and its embedded server:
AGENTCTL_TELEMETRY=1 pnpm dev:desktop
```

Open [Grafana](http://127.0.0.1:3001). Anonymous access has the Viewer role. In Explore, choose
Tempo and filter `service.name` to `agentctl-server`, `agentctl-desktop-server`, or
`agentctl-desktop`. Traced HTTP responses, including raw SSE streams, include `x-trace-id` for looking up the request.
Choose Prometheus to inspect metrics. Choose Loki and filter `service_name` to inspect logs.
Operational log records include trace/span IDs; Grafana can open the associated Tempo trace. The backend already contains HTTP RED dashboards.

The Collector listens on `http://127.0.0.1:4318`; both published ports bind only to loopback.
`AGENTCTL_GRAFANA_PORT` and `AGENTCTL_OTLP_PORT` can change the Compose ports. If the OTLP port
changes, set `OTEL_EXPORTER_OTLP_ENDPOINT` to match when launching AgentCtl.

```sh
pnpm telemetry:logs
pnpm telemetry:down
```

The stack disables Grafana analytics/update checks and anonymous usage reporting in Tempo,
Loki and Pyroscope. Container logs rotate at 10 MB with three files. Prometheus uses seven-day
and 512 MB block-retention limits; its WAL and the other stores also occupy the data volume.
Startup waits at most 120 seconds for the image's healthcheck after the container starts.

Stopping the stack retains its named data volume. To permanently remove local telemetry data,
run `docker compose -f observability/compose.yaml down --volumes`. This all-in-one image is for local development,
not a production deployment. Any OTLP HTTP/protobuf backend can replace it without changing code.

## Configuration

| Variable                                                                                                        | Behavior                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTCTL_TELEMETRY=1`                                                                                          | Explicitly enables the process SDK. Other values leave it disabled.                                                                           |
| `OTEL_SDK_DISABLED=true`                                                                                        | Disables telemetry even when AgentCtl's flag is enabled.                                                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                                   | Base OTLP URL, default `http://127.0.0.1:4318`; `/v1/traces`, `/v1/metrics` and `/v1/logs` are appended.                                      |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Optional complete per-signal URLs.                                                                                                            |
| `OTEL_EXPORTER_OTLP_HEADERS` and per-signal header variables                                                    | Standard OTLP authentication headers, consumed by the exporters. Keep credentials in the environment.                                         |
| `AGENTCTL_TELEMETRY_SAMPLE_RATIO`                                                                               | Fraction of new root traces sampled, between 0 and 1, default 1. Upstream sampling decisions are respected; metrics and logs are not sampled. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` and per-signal protocol variables                                                 | If set, must be `http/protobuf`.                                                                                                              |

Invalid configuration disables telemetry with a generic diagnostic; it does not stop the app or
print configuration values. Endpoint URLs cannot contain embedded credentials. Service names
are fixed to the three roles above. Each SDK run has a random `service.instance.id` so concurrent
processes and restarts produce distinct metric series without collecting host or user identifiers.
Host/process/environment resource detection is deliberately disabled, including
`OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME` overrides.

## Signals and data policy

| Signal                                | Exported data                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP server spans                     | Method, registered route template, status code, duration and trace context. No raw URL or query.                                                               |
| `agent.turn` spans                    | Dispatch, acceptance and first-output events; success/error/cancelled outcome and total duration.                                                              |
| `http.server.request.duration`        | Histogram in seconds, with method, route template and status code.                                                                                             |
| Queue send/process and provider spans | SQLite queue acceptance/processing and ACP v1/v2 prompt calls, linked to the originating HTTP trace; bounded operation/adapter classifications.                |
| Operational logs                      | Severity, fixed event names, bounded outcome/connection classifications, and trace/span IDs.                                                                   |
| `agentctl.queue.wait.duration`        | Time since the persisted operation creation timestamp at claim, in seconds.                                                                                    |
| `agentctl.turn.duration`              | Total executor duration in seconds, including finalization, grouped by outcome.                                                                                |
| `agentctl.turn.phase.duration`        | Existing preparation, acceptance, first-output and completion timings in seconds. Unknown phases stay absent. Completion measures dispatch-to-provider-result. |
| `agentctl.agent.connection.events`    | Connection lifecycle/fallback counts with bounded adapter, reason, path and intent classifications; no provider IDs.                                           |
| `agentctl.desktop.startup.duration`   | Existing process/app-ready, server-ready and window-ready milestones in seconds.                                                                               |

Prometheus translates metric names to underscores and adds unit/bucket suffixes; for example,
`http_server_request_duration_seconds_bucket` and `agentctl_turn_duration_seconds_bucket`.
HTTP duration buckets follow OpenTelemetry's standard 5 ms–10 s boundaries; AgentCtl operation
duration buckets range from 5 ms to 10 minutes. In Prometheus, these queries show
HTTP p95 latency by route and completed turns by outcome:

```promql
histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket[5m])))
sum by (agentctl_turn_outcome) (increase(agentctl_turn_duration_seconds_count[5m]))
```

Attributes are allowlisted. Prompts, responses, thought/tool/terminal contents, credentials,
request/response bodies, headers, workspace paths, provider/session/attempt IDs and raw exception
messages/stacks are not exported. Only W3C `traceparent` is extracted; baggage and `tracestate`
are not collected. Error spans have a status code without an exception description.

## Trace continuity and logs

The normal trace path is:

```text
HTTP request
  session.queue.send (producer)
    session.queue.process (consumer)
      agent.turn
        agent.provider.prompt (client)
```

The queue persists only a validated W3C `traceparent` (trace ID, parent span ID and sampling bit)
in a nullable `session_operations.traceparent` column. SQLite migration 0048 adds that column
without changing queued payloads. Processing restores the saved context even after the HTTP
response ends or the worker restarts. Duplicate acceptance retains the original context.
Legacy or invalid values start a new trace and never inherit another request's worker context.
Queue waiting time is a separate histogram; timestamps use the existing durable creation time.

Both ACP versions send the client span context as `_meta.traceparent` in prompt requests, as
specified by [ACP extensibility](https://agentclientprotocol.com/protocol/v1/extensibility).
Baggage and tracestate are omitted. Providers can continue the trace if they consume this
metadata and run their own instrumentation. AgentCtl records its client call through foreground
completion regardless of whether the provider has an SDK; it cannot create spans inside an
uninstrumented external process.

Structured operational logs cover queue acceptance/processing/failures, turn phases/outcomes,
provider prompt calls, connection diagnostics and SDK lifecycle. Fastify/Pino log calls also
bridge into OTLP with severity and active trace context. Only an explicit catalog of exact,
static messages retains its text; unrecognized messages become `Application log; details retained
locally`. Arbitrary object fields, bindings, interpolation arguments and exception details are
never copied. Operational event names and classifications are validated at runtime; extra fields
are stripped and invalid classifications are discarded. This covers injected core loggers that use Fastify's logger. Direct console writes,
stdout/stderr and raw provider process logs remain local. Trace sampling does not sample logs;
a log associated with an unsampled trace may have no stored trace to open.

The browser performance recorder remains local and browser telemetry is not enabled. Existing
local application logs and support diagnostics keep their current behavior.

## Ownership and reliability

Core's `observability` entry depends only on the trace/metrics and logs APIs; a dependency-cruiser rule rejects
SDK/exporter imports in core. The server's `telemetry` entry owns the SDK for Node and Electron
hosts. SDK construction is isolated from API ownership; partial startup failures release already-created
providers. SDKs load lazily, have one owner per process, and flush after server/session disposal or
desktop shutdown. No SDK is initialized by `buildApp()` itself.

Manual Fastify hooks support ESM and bundled Electron without loader patching. They close spans
once for ordinary responses, hijacked streams, disconnections and app shutdown. Disconnections
and server errors carry a bounded `error.type`; unmatched paths do not become route attributes. Export failures
do not fail application requests. Trace and log batches are each bounded to 512 queued records; span attributes
and events and metric cardinality are bounded. Export requests time out after one second and
shutdown waits at most two seconds, within the existing host shutdown watchdogs.

Integration tests use a real loopback OTLP protobuf receiver, exercise async trace context,
hijacked responses, delayed queue consumption, correlated log export, disabled mode, SDK ownership,
shutdown and an unavailable collector, and reject sensitive sentinels in actual exported payloads.
Queue regressions cover duplicate acceptance, recovery and corrupt/legacy context; ACP v1/v2
regressions inspect metadata received by their mock providers.

## Local verification

Verified on Linux on 2026-10-18. From a clean checkout, build before running tests: server
integration tests import compiled public workspace exports.

- `pnpm test --reporter=dot`: 1,551 tests in 272 files and 11 architecture regression scenarios passed.
- `pnpm check`: ownership coverage for 1,189 files, dependency boundaries, formatting, lint and all workspace types passed.
- Regression cases cover partial SDK initialization, synchronous/hung shutdown, real client disconnection, raw SSE trace headers, endpoint precedence and extra log-field filtering.
- All workspace/Electron builds and a frozen-lockfile install passed.
- Real Electron startup, IPC, embedded HTTP, shutdown and startup-failure smoke tests passed with telemetry disabled and enabled.
- An isolated HTTP request persisted a queued turn to a temporary SQLite file. A separate OS process reopened the database, recovered the turn and completed an ACP v1 prompt against a synthetic provider. Tempo returned all five spans with the exact parent-child chain above, and the outgoing provider metadata matched the client span. Producer and consumer resources had distinct anonymous instance IDs, and Prometheus exposed the standard HTTP buckets with separate instance labels.
- Loki returned nine correlated operational records for that trace. Prompt, raw path and arbitrary log-field sentinels were absent. The protobuf receiver integration tests also reject sensitive sentinels across all three signal payloads.

These checks use synthetic providers and isolated smoke data; they do not claim live-provider execution or production deployment verification.

References: [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/),
[Logs SDK](https://opentelemetry.io/docs/specs/otel/logs/sdk/),
[HTTP metric conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/),
[queue trace conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/),
[OTLP exporters](https://opentelemetry.io/docs/languages/js/exporters/), and
[Grafana's local development backend](https://grafana.com/docs/opentelemetry/docker-lgtm/).
