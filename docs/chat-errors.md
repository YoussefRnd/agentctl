# Chat Errors

## Pipeline

Provider adapters preserve protocol evidence in `AgentError`. The session layer normalizes it
into the versioned `ChatError` contract in `packages/shared`, persists the failure, and exposes
the same payload through conversation events and session execution state. Chat uses one
`TurnErrorCard` presenter for both turn and independent runtime failures.

## Delivery Safety

Category and delivery certainty are independent. Categories are selected from explicit driver
kinds, structured provider codes/data, then a centralized text fallback. Text matching never
establishes rejection.

- Preparation failures are `not_sent`.
- Explicit insertion rejection is `rejected`.
- Provider acknowledgement or correlated output establishes `accepted`.
- A dispatched request with no acceptance or rejection evidence is `unknown`.

Only `not_sent` and `rejected` attempts offer a manual retry. Accepted and unknown input is never
automatically replayed. This implementation deliberately adds no automatic provider retries;
future backoff must require safe replay or provider-supported idempotency.

## Ownership

The durable queue worker owns thrown failures for accepted send commands. The turn executor
owns foreground errors returned by a provider and legacy direct prompts. Runtime errors during
an active attempt are diagnostic-only, while independent runtime errors remain visible.

Each attempt has a stable failure ID. The UI deduplicates by that ID, with attempt/input-based
fallbacks only for legacy events. A historical failure must not suppress a newer fallback.
Queue draining stops after a failed turn, including foreground failures that do not throw.
Explicit cancellation or retirement must not create a new error for the removed attempt.

## Public Data

Public errors contain safe guidance, recovery actions, bounded/redacted provider details,
provider/attempt/message identity, and optional protocol code/retry delay. They exclude arbitrary
provider `data` and stderr. Full process diagnostics remain in server logs. Legacy persisted
strings are sanitized for presentation without rewriting history or guessing new delivery states.

Provider settings uses the existing settings flow. Refresh reads session/events/execution state;
it does not resend input. A confirmed rejection retry creates a new command receipt and preserves
the original attempt's audit trail.

## Adding Providers

Normalize errors at the adapter boundary and supply delivery evidence only when the protocol
guarantees it. Preserve numeric/string codes and structured causes. Add fixtures for pre-dispatch,
insertion rejection, failure after acknowledgement/output, disconnect, and cancellation. Assertions
must cover recovery actions, durable queue state, redaction, and exactly one visible error.
