---
name: handoff
description: Create a portable handoff document when work must continue in another agent session, provider, harness, directory, or parallel task.
metadata:
  managed-by: agentctl
  agentctl-purpose: provider-handoff
---

Write a handoff document summarizing the current conversation so a fresh agent can continue the work.

Save it to the temporary directory of the user's operating system, not the current workspace. Return the absolute path to the document when complete.

Include:

- The current task and state of the implementation.
- Important decisions, constraints, and rejected approaches.
- Remaining work and the intended focus of the next session.
- Validation already performed and any known failures.
- References to relevant files, commits, issues, plans, specifications, or other artifacts.
- A `Suggested Skills` section containing only skills that are actually available and relevant to the next agent.

Do not duplicate content already captured in other artifacts. Reference those artifacts by path or URL instead.

Redact secrets, credentials, tokens, passwords, and personally identifiable information.

If the user supplies arguments, treat them as the intended focus of the next session.
