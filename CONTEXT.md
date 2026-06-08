# Agent Control Context

This context describes the execution runtime, session lifecycle, and provider registry for integrating coding agents via the Agent Client Protocol (ACP).

## Language

**Session**:
An interaction session between a project workspace and a selected agent provider, persisting event history and executing the agent process.
_Avoid_: Run, execution, task

**Provider**:
An agent implementation registered in the provider registry, configured with launch commands, version info, and capabilities.
_Avoid_: Agent, executor, runner

**Agent Runtime**:
The process spawn and communication bridge implementing the Agent Client Protocol (ACP) over standard I/O stream connection.
_Avoid_: Agent connection, transport handle

**Resuscitation**:
The transparent rebuilding and reconnection of an agent runtime process when a message is sent to a session whose process has exited or crashed.
_Avoid_: Restart, revive, reconnect

**Archiving**:
The state of a session where its physical workspace (Git worktree) is deleted from disk to reclaim resources, while keeping its database record and event history intact for read-only viewing.
_Avoid_: Deleting, destroying, clearing history.

