import { test, describe, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.js';
import { projects, sessions, mcpServers, sessionEvents } from '../db/schema.js';
import { ManagedSession } from './managed-session.js';
import { SessionEventStore } from './event-store.js';
import { McpGateway } from '../mcp/mcp-gateway.js';
import type { AgentPermissionResponse, AgentSession } from '../agent/types.js';

interface SessionWithPending {
  pendingApprovals: Map<string, (response: AgentPermissionResponse) => void>;
}

describe('MCP Permissions Routing', () => {
  test('routes permission checks based on overrides and policies correctly', async () => {
    const db = createDatabase(':memory:');
    const eventStore = new SessionEventStore(db, {
      publish: () => {
        // noop
      },
    });
    const gateway = new McpGateway(db);

    await db.insert(projects).values({ id: 'proj-p', name: 'Proj', path: '/tmp/proj' });
    await db.insert(sessions).values({
      id: 'sess-p',
      projectId: 'proj-p',
      branch: 'main',
      worktreePath: '/tmp/proj',
      taskSlug: 'test',
      agent: 'test',
      selectedProvider: 'test',
      baseCommit: 'hash',
      approvalMode: 'auto_approve',
    });

    // Server with granular tool permissions overrides
    await db.insert(mcpServers).values({
      id: 'mock-srv',
      name: 'Mock',
      enabled: true,
      approvalPolicy: 'always_prompt',
      toolPermissions: JSON.stringify({
        safe_tool: 'auto_approve',
        blocked_tool: 'deny',
      }),
    });

    // Server with auto_approve_all policy
    await db.insert(mcpServers).values({
      id: 'auto-srv',
      name: 'Auto Server',
      enabled: true,
      approvalPolicy: 'auto_approve_all',
      toolPermissions: '{}',
    });

    // Server with deny_all policy
    await db.insert(mcpServers).values({
      id: 'deny-srv',
      name: 'Deny Server',
      enabled: true,
      approvalPolicy: 'deny_all',
      toolPermissions: '{}',
    });

    const runtimeHandle = {
      id: 'acp-test',
      history: 'fresh',
      closed: new Promise<void>(() => {
        // noop
      }),
      onError: () => {
        // noop
      },
      onClose: () => {
        // noop
      },
    } as unknown as AgentSession;

    const session = new ManagedSession(
      'sess-p',
      runtimeHandle,
      db,
      eventStore,
      '/tmp/proj',
      undefined,
      undefined,
      gateway,
    );

    // 1. Check Tool-Level Auto-Approve Override
    const resSafe = await session.handleRequestPermission({
      permissionId: 'p1',
      toolCall: { name: 'mock-srv__safe_tool', toolCallId: 't1' },
      options: [],
    });
    expect(resSafe.allowed).toBe(true);

    // 2. Check Tool-Level Deny Override
    const resBlock = await session.handleRequestPermission({
      permissionId: 'p2',
      toolCall: { name: 'mock-srv__blocked_tool', toolCallId: 't2' },
      options: [],
    });
    expect(resBlock.allowed).toBe(false);

    // 3. Fallback to Server Policy: auto_approve_all
    const resAutoAll = await session.handleRequestPermission({
      permissionId: 'p3',
      toolCall: { name: 'auto-srv__any_tool', toolCallId: 't3' },
      options: [],
    });
    expect(resAutoAll.allowed).toBe(true);

    // 4. Fallback to Server Policy: deny_all
    const resDenyAll = await session.handleRequestPermission({
      permissionId: 'p4',
      toolCall: { name: 'deny-srv__any_tool', toolCallId: 't4' },
      options: [],
    });
    expect(resDenyAll.allowed).toBe(false);

    // Verify audit logs for denied tools
    const loggedEvents = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.type, 'approval_request'));

    interface ApprovalRequestEvent {
      name: string;
      toolCallId: string;
      requiresApproval: boolean;
      request: unknown;
      status: string;
    }

    const deniedEvents = loggedEvents
      .map((e) => JSON.parse(e.data) as ApprovalRequestEvent)
      .filter((d) => d.status === 'denied');

    expect(deniedEvents).toHaveLength(2);
    expect(deniedEvents).toContainEqual({
      name: 'request_permission',
      toolCallId: 't2',
      requiresApproval: true,
      request: {
        permissionId: 'p2',
        toolCall: { name: 'mock-srv__blocked_tool', toolCallId: 't2' },
        options: [],
      },
      status: 'denied',
    });
    expect(deniedEvents).toContainEqual({
      name: 'request_permission',
      toolCallId: 't4',
      requiresApproval: true,
      request: {
        permissionId: 'p4',
        toolCall: { name: 'deny-srv__any_tool', toolCallId: 't4' },
        options: [],
      },
      status: 'denied',
    });

    // 5. Fallback to Server Policy: always_prompt
    const promptPromise = session.handleRequestPermission({
      permissionId: 'p5',
      toolCall: { name: 'mock-srv__other_tool', toolCallId: 't5' },
      options: [],
    });

    // Wait a short duration to let async DB queries/operations inside handleRequestPermission complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify it added to pending approvals rather than returning immediately
    const sessionWithPending = session as unknown as SessionWithPending;
    const pendingApprovalsMap = sessionWithPending.pendingApprovals;
    expect(pendingApprovalsMap.size).toBe(1);

    // Manually resolve the prompt promise through the pending approval callback
    const [, resolveFn] = Array.from(pendingApprovalsMap.entries())[0];
    resolveFn({ allowed: true });

    const resPrompt = await promptPromise;
    expect(resPrompt.allowed).toBe(true);
  });
});
