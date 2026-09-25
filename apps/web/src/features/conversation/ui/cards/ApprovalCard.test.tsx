// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ApprovalCard } from './ApprovalCard';
import type { SessionEventApprovalRequestData } from '@agentctl/shared';

function renderApprovalCard(
  data: SessionEventApprovalRequestData,
  onApprove: (eventId: number, optionId?: string) => void = () => undefined,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ApprovalCard
        eventId={42}
        data={data}
        onApprove={onApprove}
        onDeny={() => {
          /* noop */
        }}
      />,
    );
  });
  return { root, container };
}

const approvalData = (
  overrides: Partial<SessionEventApprovalRequestData> = {},
): SessionEventApprovalRequestData => ({
  message: 'Approve this action?',
  request: {
    toolCall: {
      name: 'edit_file',
      arguments: { path: 'src/foo.ts' },
    },
  },
  ...overrides,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ApprovalCard', () => {
  it('does not steal focus to the Approve button on mount', () => {
    const { root } = renderApprovalCard(approvalData());

    const approveButton = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Approve once',
    );
    expect(approveButton).toBeDefined();
    expect(document.activeElement).not.toBe(approveButton);

    act(() => {
      root.unmount();
    });
  });

  it('shows native choices as matching buttons without a duplicate Deny button', () => {
    const onApprove = vi.fn();
    const { root, container } = renderApprovalCard(
      approvalData({
        message: 'Fetch: https://www.kimi.ai/blog/kimi-k3',
        request: {
          toolCall: { name: 'fetch', arguments: { url: 'https://www.kimi.ai/blog/kimi-k3' } },
          options: [
            {
              optionId: 'allow-always',
              label: 'Yes, always allow kimi.ai for this project',
              kind: 'allow_always',
            },
            { optionId: 'allow-once', label: 'Yes, allow once', kind: 'allow_once' },
            {
              optionId: 'choice-3',
              label: 'No, and tell Grok what to do differently',
              kind: 'reject_once',
            },
            {
              optionId: 'choice-4',
              label: 'No, never allow www.kimi.ai for this project',
              kind: 'reject_always',
            },
          ],
        },
      }),
      onApprove,
    );

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(4);
    expect(buttons.map((button) => button.textContent)).toEqual([
      'No, and tell Grok what to do differently',
      'No, never allow www.kimi.ai for this project',
      'Yes, allow once',
      'Yes, always allow kimi.ai for this project',
    ]);
    expect(new Set(buttons.map((button) => button.className)).size).toBe(1);
    expect(document.activeElement).toBe(buttons[0]);
    expect(container.textContent).toContain('https://www.kimi.ai/blog/kimi-k3');
    expect(container.textContent).not.toContain('Fetch: https://www.kimi.ai/blog/kimi-k3');
    expect(container.querySelector('details')?.open).toBe(false);

    act(() => buttons[0].click());
    expect(onApprove).toHaveBeenCalledWith(42, 'choice-3');
    act(() => buttons[3].click());
    expect(onApprove).toHaveBeenCalledWith(42, 'allow-always');

    act(() => root.unmount());
  });

  it('shows full arguments when the tool has no recognizable target', () => {
    const { root, container } = renderApprovalCard(
      approvalData({
        request: {
          toolCall: { name: 'custom_tool', arguments: { settings: { operation: 'inspect' } } },
        },
      }),
    );

    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.textContent).toContain('inspect');

    act(() => root.unmount());
  });

  it('focuses the Deny button on mount for safe keyboard navigation', () => {
    const { root } = renderApprovalCard(approvalData());

    const denyButton = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Deny',
    );
    expect(denyButton).toBeDefined();
    expect(document.activeElement).toBe(denyButton);

    act(() => {
      root.unmount();
    });
  });
});
