# ACP adapter

## What is ACP?

The [Agent Client Protocol](https://agentclientprotocol.com/) (ACP) is an open
JSON-RPC protocol between coding agents and clients. The agent owns execution
(spawning, tools, sessions); the client displays progress and approves
sensitive actions. It complements MCP: ACP is agent↔client, MCP is
agent↔tools/data.

## How AgentCtl uses it

This package translates ACP wire behavior into the product contracts in
`../agent`. Protocol method names, `_meta`, SDK types, capability-shape
compatibility, and extension routing stay here. Session, provider, API, and UI
code depend on `AgentDriver`, `AgentSession`, and `AgentUpdate`.

The core loop per turn:

1. `session/new` (or resume) → `session/prompt`
2. Stream `session/update` events (messages, tool calls, plans, terminals)
3. Answer permission requests via the approval policy
4. Persist events through the session projector; stream to clients over SSE

ACP v1 remains the default adapter. The draft v2 adapter is opt-in per provider by setting
`AGENTCTL_ACP_PROTOCOL=v2` (or `2`) in that provider's environment. The selector keeps both
versions side by side while v2 is experimental. Diagnostics record the choice as
`adapter_selected` with `acp-v1` or `acp-v2`.

## Layout

- `protocol/` — wire shapes: events, prompt, session params, permissions,
  filesystem, terminals, client handlers, usage normalization
- `transport/` — process spawning and lifecycle, persistent connections,
  capability caching, path security, stream debugging
- `v2/` — draft v2 runtime and events (opt-in, see above)
- `driver.ts` / `runtime.ts` / `types.ts` — version selection and the
  `AgentDriver` implementation

When upgrading `@agentclientprotocol/sdk`, run the ACP and core tests and review occurrences of
`unstable_`, `extMethod`, and `_meta` inside this package. These identifiers should not be added
outside this directory.
