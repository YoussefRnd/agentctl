# ACP adapter

This package translates ACP wire behavior into the product contracts in `../agent`.
Protocol method names, `_meta`, SDK types, capability-shape compatibility, and extension
routing stay here. Session, provider, API, and UI code depend on `AgentDriver`, `AgentSession`,
and `AgentUpdate`.

ACP v1 remains the default adapter. The draft v2 adapter is opt-in per provider by setting
`AGENTCTL_ACP_PROTOCOL=v2` (or `2`) in that provider's environment. The selector keeps both
versions side by side while v2 is experimental.

When upgrading `@agentclientprotocol/sdk`, run the ACP and core tests and review occurrences of
`unstable_`, `extMethod`, and `_meta` inside this package. These identifiers should not be added
outside this directory.
