import { test, describe, expect } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../db/index.js';
import { projects, sessions, mcpServers, sessionEvents } from '../../db/schema.js';
import { SessionRuntime } from './session-runtime.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { McpGateway } from '../../mcp/mcp-gateway.js';
import type { AgentSession } from '../../agent/types.js';

describe('MCP Permissions Routing', () => {
  test('routes permission checks based on overrides and policies correctly', async () => {
    const db = createDatabase(':memory:');
    type EventPayload = { id: number; type: string; data: string };
    const listeners: ((event: EventPayload) => void)[] = [];
    const eventBus = {
      publish: (event: unknown) => {
        for (const listener of listeners) {
          listener(event as EventPayload);
        }
      },
      waitForEvent: (type: string) => {
        return new Promise<EventPayload>((resolve) => {
          const cb = (evt: EventPayload) => {
            if (evt.type === type) {
              const idx = listeners.indexOf(cb);
              if (idx !== -1) listeners.splice(idx, 1);
              resolve(evt);
            }
          };
          listeners.push(cb);
        });
      },
    };
    const eventRepository = new SessionEventRepository(db, eventBus);
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

    const session = new SessionRuntime(
      'sess-p',
      runtimeHandle,
      db,
      eventRepository,
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
      requiresApproval: false,
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
      requiresApproval: false,
      request: {
        permissionId: 'p4',
        toolCall: { name: 'deny-srv__any_tool', toolCallId: 't4' },
        options: [],
      },
      status: 'denied',
    });

    // 5. Fallback to Server Policy: always_prompt
    const pendingApprovalPromise = eventBus.waitForEvent('approval_request');

    const promptPromise = session.handleRequestPermission({
      permissionId: 'p5',
      toolCall: { name: 'mock-srv__other_tool', toolCallId: 't5' },
      options: [],
    });

    const pendingEvent = await pendingApprovalPromise;
    expect(pendingEvent.id).toBeDefined();

    const pendingData = JSON.parse(pendingEvent.data) as ApprovalRequestEvent;
    expect(pendingData.status).toBe('pending');
    expect(pendingData.requiresApproval).toBe(true);

    // Yield microtask so handleRequestPermission registers pending approval after event append
    await Promise.resolve();

    // Resolve via public session method
    session.resolvePermission(String(pendingEvent.id), { allowed: true });

    const resPrompt = await promptPromise;
    expect(resPrompt.allowed).toBe(true);
  });
});
