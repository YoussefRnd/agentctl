// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ApprovalCard } from './ApprovalCard';
import type { ACPEventApprovalRequestData } from '@agentctl/shared';

function renderApprovalCard(data: ACPEventApprovalRequestData) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ApprovalCard
        eventId={42}
        data={data}
        onApprove={() => {
          /* noop */
        }}
        onDeny={() => {
          /* noop */
        }}
      />,
    );
  });
  return { root, container };
}

const approvalData = (
  overrides: Partial<ACPEventApprovalRequestData> = {},
): ACPEventApprovalRequestData => ({
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
      (b) => b.textContent === 'Approve',
    );
    expect(approveButton).toBeDefined();
    expect(document.activeElement).not.toBe(approveButton);

    act(() => {
      root.unmount();
    });
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
