import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { SubagentChatView } from './SubagentChatView';
import type { SubagentGroup } from '../lib/subagentBlockUtils';

vi.mock('@/shared/markdown/ui/StreamingMarkdown', () => ({
  StreamingMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));
const event = (id: number, type: string, data: unknown): SessionEventRow =>
  ({
    id,
    sessionId: 'parent',
    type,
    data,
    createdAt: new Date(1700000000000 + id * 1000),
  }) as SessionEventRow;

test('renders live child activity, terminals and sibling navigation without parent providers or control APIs', () => {
  const sibling: SubagentGroup = {
    subagentEvent: event(9, 'subagent_update', {
      subagentId: 'sibling',
      native: true,
      name: 'Sibling',
      status: 'completed',
    }),
    childEvents: [],
  };
  const group: SubagentGroup = {
    subagentEvent: event(1, 'subagent_update', {
      subagentId: 'child',
      native: true,
      name: 'Review',
      status: 'running',
    }),
    childEvents: [
      event(2, 'tool_call', {
        toolCallId: 'read',
        name: 'read_file',
        kind: 'read',
        title: 'Read module',
        arguments: { path: '/src/module.ts' },
        status: 'in_progress',
      }),
      event(3, 'approval_request', {
        status: 'pending',
        request: {
          toolCall: { name: 'read_file' },
          options: [{ optionId: 'once', label: 'Approve once', kind: 'allow_once' }],
        },
      }),
      event(4, 'text', { role: 'provider', content: 'Child response' }),
      event(5, 'text', {
        role: 'session',
        content: 'Ask sibling',
        senderSessionId: 'child',
        recipientSessionId: 'sibling',
        transcriptSessionId: 'child',
      }),
      event(6, 'terminal_created', { terminalId: 'terminal', command: 'pnpm check' }),
      event(7, 'terminal_output', {
        terminalId: 'terminal',
        operation: 'replace',
        data: 'check output',
      }),
      event(8, 'terminal_exit', { terminalId: 'terminal', code: 0 }),
    ],
  };
  const select = vi.fn();
  const reviewApproval = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (connected: boolean) =>
    root.render(
      <SubagentChatView
        group={group}
        groups={[group, sibling]}
        onBack={vi.fn()}
        onSelect={select}
        onReviewApproval={reviewApproval}
        showThinking
        isConnected={connected}
        isStreaming
      />,
    );
  try {
    act(() => render(true));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
    expect(container.textContent).toContain('Read /src/module.ts');
    expect(container.textContent).toContain('Child response');
    expect(container.textContent).toContain('check output');
    expect(container.textContent).toContain('Exit 0');
    expect(container.querySelector('textarea, input')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Approve once',
      ),
    ).toBe(false);
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Sibling')!
        .click(),
    );
    expect(select).toHaveBeenCalledWith(sibling);
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Review approval in chat')!
        .click(),
    );
    expect(reviewApproval).toHaveBeenCalledOnce();
    act(() => render(false));
    expect(container.textContent).toContain('Disconnected');
    expect(disconnect).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
