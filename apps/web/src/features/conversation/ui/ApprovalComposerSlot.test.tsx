// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { ApprovalComposerSlot } from './ApprovalComposerSlot';

const approval = {
  id: 42,
  data: {
    message: 'Approve this action?',
    request: {
      toolCall: { name: 'fetch', arguments: { url: 'https://example.com' } },
    },
  },
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ApprovalComposerSlot', () => {
  it('replaces the composer during approval and restores its draft afterward', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const render = (pending: boolean) => {
      act(() => {
        root.render(
          <ApprovalComposerSlot
            approval={pending ? approval : undefined}
            onApprove={onApprove}
            onDeny={onDeny}
          >
            <input aria-label="Message draft" defaultValue="" />
          </ApprovalComposerSlot>,
        );
      });
    };

    render(false);
    const draft = container.querySelector<HTMLInputElement>('input')!;
    draft.value = 'Keep this draft';

    render(true);
    expect(container.querySelector('[role="region"]')).not.toBeNull();
    expect(draft.closest('[hidden]')).not.toBeNull();
    expect(container.querySelector('input')).toBe(draft);

    render(false);
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(draft.closest('[hidden]')).toBeNull();
    expect(container.querySelector('input')).toBe(draft);
    expect(draft.value).toBe('Keep this draft');

    act(() => root.unmount());
  });
});
