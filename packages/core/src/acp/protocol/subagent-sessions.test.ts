import { describe, expect, it, vi } from 'vitest';
import type { AgentSessionCallbacks, AgentUpdate } from '../../agent/types.js';
import { AcpSubagentSessions, type SubagentNotification } from './subagent-sessions.js';

function harness() {
  const events: AgentUpdate[] = [];
  const callbacks: AgentSessionCallbacks = {
    onUpdate: (event) => {
      events.push(event);
    },
    onRequestPermission: vi.fn(async () => ({ allowed: true })),
    onRequestElicitation: vi.fn(async () => ({ action: 'decline' as const })),
  };
  const roots = new Map([
    ['root', { callbacks, cwd: '/tmp' }],
    ['other', { callbacks, cwd: '/other' }],
  ]);
  const router = new AcpSubagentSessions((id) => {
    const context = roots.get(id);
    if (!context) throw new Error('Unknown root');
    return context;
  });
  const announce = (
    id: string,
    parent = 'root',
    patch: Record<string, unknown> = {},
    historical = false,
  ) =>
    router.update(
      {
        sessionId: parent,
        update: { sessionUpdate: 'subagent_update', sessionId: id, ...patch },
      } as SubagentNotification,
      historical,
    );
  const message = (sessionId: string, update: Record<string, unknown>) =>
    router.update({
      sessionId,
      update: { sessionUpdate: 'session_message', messageId: 'm', ...update },
    } as SubagentNotification);
  return { router, events, roots, callbacks, announce, message };
}

describe('ACP native child sessions', () => {
  it('releases one root, its descendants and directed messages while preserving another root', async () => {
    const { router, announce, message, roots } = harness();
    await announce('child');
    await announce('grandchild', 'child');
    await announce('other-child', 'other');
    await message('grandchild', { content: [{ type: 'text', text: 'retained' }] });
    await message('other-child', { content: [{ type: 'text', text: 'sibling' }] });
    router.resolve('grandchild');
    expect(router.releaseRoot('root').size).toBeGreaterThan(0);
    roots.delete('root');
    expect(() => router.resolve('grandchild')).toThrow();
    expect(router.isChild('child')).toBe(false);
    expect(router.isChild('other-child')).toBe(true);
    expect(router.snapshot()).toMatchObject({ children: 1, messages: 1 });
    router.releaseRoot('other');
    expect(router.snapshot()).toEqual({ children: 0, messages: 0, bytes: 0 });
  });

  it('fails bounded retention without changing previously retained ownership', async () => {
    const { callbacks } = harness();
    // The actual root resolver distinguishes root and child IDs.
    const bounded = new AcpSubagentSessions(
      (id) => {
        if (id !== 'root') throw new Error('Unknown root');
        return { callbacks };
      },
      { children: 1, messages: 1, bytes: 128 },
    );
    await bounded.update({
      sessionId: 'root',
      update: { sessionUpdate: 'subagent_update', sessionId: 'c' },
    });
    const before = bounded.snapshot();
    await expect(
      bounded.update({
        sessionId: 'root',
        update: { sessionUpdate: 'subagent_update', sessionId: 'd' },
      }),
    ).rejects.toThrow('entity limit');
    await expect(
      bounded.update({
        sessionId: 'root',
        update: {
          sessionUpdate: 'session_message',
          messageId: 'm',
          content: [{ type: 'text', text: 'x'.repeat(256) }],
        },
      }),
    ).rejects.toThrow('byte budget');
    expect(bounded.snapshot()).toEqual(before);
  });
  it('routes nested children to isolated callbacks while preserving the root security context', async () => {
    const { router, events, announce, callbacks } = harness();
    await announce('child');
    await announce('grandchild', 'child');
    const context = router.resolve('grandchild');
    expect(context.cwd).toBe('/tmp');
    expect(router.resolve('grandchild').callbacks).toBe(context.callbacks);
    await context.callbacks.onUpdate({ type: 'text', text: 'Child reply' });
    expect(events.at(-1)).toEqual({
      type: 'subagent_event',
      subagentId: 'grandchild',
      event: { type: 'text', text: 'Child reply' },
    });
    const abort = new AbortController();
    await context.callbacks.onRequestPermission(
      { permissionId: 'p', toolCall: { name: 'write' } },
      abort.signal,
    );
    expect(callbacks.onRequestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ subagentId: 'grandchild' }),
      abort.signal,
    );
    await context.callbacks.onRequestElicitation!(
      { id: 'e', mode: 'form', message: 'Choose' },
      abort.signal,
    );
    expect(callbacks.onRequestElicitation).toHaveBeenCalledWith(
      expect.objectContaining({ subagentId: 'grandchild' }),
      abort.signal,
    );
  });

  it('rejects missing announcements, self-parenting, reparenting, root reuse and cycles', async () => {
    const { router, announce } = harness();
    expect(() => router.resolve('missing')).toThrow();
    await expect(announce('root')).rejects.toThrow();
    await expect(announce('other')).rejects.toThrow();
    await announce('a');
    await announce('b', 'a');
    await expect(announce('a', 'other')).rejects.toThrow();
    await expect(announce('a', 'b')).rejects.toThrow();
    await expect(announce('unowned', 'missing')).rejects.toThrow();
  });

  it('uses tri-state replacement patches and retains unfamiliar work-state payloads', async () => {
    const { events, announce } = harness();
    await announce('c', 'root', {
      title: 'Investigator',
      description: 'Tests',
      capabilities: { cancel: {}, custom: {} },
      state: { state: 'idle', stopReason: 'error', error: { code: -1, message: 'Failed' } },
    });
    await announce('c', 'root', { state: { state: 'running' }, capabilities: { cancel: {} } });
    let latest = events.at(-1);
    expect(latest).toMatchObject({
      association: {
        title: 'Investigator',
        state: { state: 'running' },
        capabilities: { cancel: {} },
      },
    });
    expect(latest?.type === 'subagent_update' && latest.association.state).not.toHaveProperty(
      'stopReason',
    );
    expect(
      latest?.type === 'subagent_update' && latest.association.capabilities,
    ).not.toHaveProperty('custom');
    await announce('c', 'root', {
      title: null,
      description: null,
      capabilities: null,
      state: { state: '_future', data: { detail: 1 } },
    });
    expect(events.at(-1)).toMatchObject({
      association: {
        title: null,
        description: null,
        capabilities: null,
        state: { state: '_future', data: { detail: 1 } },
      },
    });
    await announce('c', 'root', { state: null });
    expect(events.at(-1)).toMatchObject({ association: { state: null } });
  });

  it('never promotes historical state or capabilities through a later label/state update', async () => {
    const { router, events, announce } = harness();
    await announce(
      'c',
      'root',
      { capabilities: { cancel: {} }, state: { state: 'running' } },
      true,
    );
    expect(events.at(-1)).toMatchObject({ association: { historical: true } });
    await announce('c', 'root', { title: 'Renamed' });
    expect(events.at(-1)).toMatchObject({
      association: { historical: false, state: null, capabilities: null },
    });
    await announce(
      'd',
      'root',
      { capabilities: { cancel: {} }, state: { state: 'running' } },
      true,
    );
    await router.state('d', { state: 'idle', stopReason: 'cancelled' });
    expect(events.at(-1)).toMatchObject({
      association: {
        historical: false,
        capabilities: null,
        state: { state: 'idle', stopReason: 'cancelled' },
      },
    });
  });

  it('checks root liveness again for child requests', async () => {
    const { router, roots, announce } = harness();
    await announce('c');
    router.resolve('c');
    roots.delete('root');
    expect(() => router.resolve('c')).toThrow();
  });

  it('keeps roster labels independent of child conversation metadata', async () => {
    const { router, announce, events } = harness();
    await announce('c', 'root', { title: 'Roster title' });
    await router
      .resolve('c')
      .callbacks.onUpdate({ type: 'session_info_update', title: 'Conversation title' });
    await announce('c', 'root', { state: { state: 'idle' } });
    expect(events.at(-1)).toMatchObject({
      association: { title: 'Roster title', state: { state: 'idle' } },
    });
  });
});

describe('ACP session-directed messages', () => {
  it('appends chunks, accepts later participant metadata, replaces/clears content and does not forward messages', async () => {
    const { router, announce, message, events, callbacks } = harness();
    await announce('c');
    await message('root', {
      sessionUpdate: 'session_message_chunk',
      content: { type: 'text', text: 'First ' },
      _meta: { chunk: true },
    });
    await message('root', {
      sessionUpdate: 'session_message_chunk',
      content: { type: 'text', text: 'second' },
    });
    await message('root', {
      senderSessionId: 'root',
      recipientSessionId: 'c',
      _meta: { message: true },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'session_message',
      content: 'First second',
      metadata: { message: true },
      senderSessionId: 'root',
      recipientSessionId: 'c',
    });
    await message('root', {
      content: [{ type: 'text', text: 'Replacement' }],
      senderSessionId: null,
    });
    expect(events.at(-1)).toMatchObject({ content: 'Replacement', senderSessionId: 'root' });
    await message('root', { content: null, _meta: null });
    expect(events.at(-1)).toMatchObject({ content: '', metadata: null });
    expect(router.isChild('c')).toBe(true);
    expect(callbacks.onRequestPermission).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'subagent_event')).toHaveLength(0); // no invented incoming view
  });

  it('scopes equal message IDs to their transcripts and rejects conflicting identities', async () => {
    const { announce, message, events } = harness();
    await announce('c');
    await message('root', {
      senderSessionId: 'root',
      recipientSessionId: 'c',
      content: [{ type: 'text', text: 'Outgoing' }],
    });
    await message('c', {
      senderSessionId: 'root',
      recipientSessionId: 'c',
      content: [{ type: 'text', text: 'Observed incoming' }],
    });
    expect(events.at(-1)).toMatchObject({
      type: 'subagent_event',
      subagentId: 'c',
      event: { type: 'session_message', content: 'Observed incoming' },
    });
    await expect(message('root', { senderSessionId: 'c' })).rejects.toThrow();
    await expect(
      message('root', { messageId: 'bad', senderSessionId: 'other', recipientSessionId: 'c' }),
    ).rejects.toThrow();
    await expect(
      message('root', { messageId: 'missing', recipientSessionId: 'unannounced' }),
    ).rejects.toThrow();
  });
});
