# ACP adapter

This package translates ACP wire behavior into the product contracts in `../agent`.
Protocol method names, `_meta`, SDK types, capability-shape compatibility, and extension
routing stay here. Session, provider, API, and UI code depend on `AgentDriver`, `AgentSession`,
and `AgentUpdate`.

The adapter targets SDK 1.7.0 (v1 schema 1.24.1 and v2 schema 2.0.0-alpha.7).
ACP v1 is stable; v2 is a draft implemented through the SDK's experimental entry point.
Automatic selection defaults to stable v1. Opt into draft v2 with a profile's Protocol
setting or `AGENTCTL_ACP_PROTOCOL=v2`. To enable automatic v2 negotiation with v1 fallback,
set `AGENTCTL_ACP_V2_ENABLED=true`. Only initialization incompatibility triggers fallback;
authentication and runtime failures do not.

When upgrading `@agentclientprotocol/sdk`, run the ACP and core tests and review occurrences of
`unstable_`, `extMethod`, and `_meta` inside this package. These identifiers should not be added
outside this directory.

## Protocol boundaries

- Require the version returned by initialization to match the selected adapter.
- Send optional session fields and MCP transports only when negotiated. V2 stdio
  servers require a `type` discriminator; SSE endpoints must never be relabeled as HTTP.
- Scope native session IDs and terminal ownership to their connection. IDs returned
  by different provider processes are independent, including replacement connections.
- Preserve request cancellation signals through permissions, elicitations, and client
  operations. A cancelled terminal wait does not release or kill the terminal.
- Sending session cancellation also cancels pending permission and elicitation callbacks
  for that session, including its children. Other sessions retain their own request signals.
- Closing a session settles its pending prompt, prevents further prompts, and releases
  connection-owned resources. Persistent session close and metadata operations have deadlines;
  foreground work is not limited by a metadata request deadline.
- Process event listeners belong to individual sessions and are removed on shutdown.
  Terminal diagnostics record input byte counts without logging input contents.
- Select only permission option IDs supplied by the agent. Control connections cancel
  permission requests and expose URL authentication consent, without filesystem access.
- ACP filesystem paths are absolute, and read offsets are one-based. Extensions have
  their own validation and must not change standard ACP request semantics.
- Use SDK validation for native child announcements and directed messages. The stream wrapper
  only tracks setup/replay boundaries and rejects child dependencies within one batch. V1
  session clients advertise `subagents: {}` through SDK client capabilities.
- Build known v2 variants with literal tags and matching payloads. SDK 1.7 permits unknown
  variants received from peers and custom tags starting with `_`; shared prompt/elicitation
  builders return only their supported known variants.
- Publish v2 command snapshots returned by new, fork, and resume, including empty lists.
- Apply updates in order and retain persistence errors until completion is checked.
  Update queues and pre-setup buffers are bounded by `transport/limits.ts`; overflow fails
  completion instead of silently reporting success after losing updates. Unknown session
  traffic cannot block updates for an active session.
  V1 prompt completion comes from the prompt response. V2 prompt responses identify the
  inserted user message; foreground completion comes from an idle update with a stop reason.
  A foreground error fails the attempt without retiring a healthy connection. SDK 1.7 strips
  the idle state's error payload; `v2/state-error-compatibility.ts` preserves valid JSON-RPC
  error details through decoding without sending additional wire fields.
- Apply full message replacements and chunks by native message ID. Echoes of an accepted
  local user message update its existing row, and empty configuration lists clear state.
  V2 user updates received before acceptance are buffered and reconciled by the accepted ID;
  identical content from another client cannot claim the local message.
  An explicit prompt rejection marks delivery failed; a lost response remains uncertain.
- V2 diffs use their structured file operations as the source of truth and render an optional
  patch. Binary files, directories, symlinks, moves, and copies do not require text patches.
- Preserve cancelled and unfamiliar plan statuses and priorities through persistence and UI.

The transport tests use SDK peers to exercise wire requests, cancellation, and unsupported
methods, plus early prompt acceptance, transport loss, shutdown, bounded buffering, and
unresponsive metadata requests. Provider behavior is tested manually; there is no
live-provider smoke runner.

References: [v1 protocol](https://agentclientprotocol.com/protocol/v1/overview),
[request cancellation](https://agentclientprotocol.com/protocol/v1/cancellation),
[v2 prompt lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle), and
[v2 session setup](https://agentclientprotocol.com/protocol/v2/session-setup).
