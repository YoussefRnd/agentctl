// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandInputComposer } from './CommandInputComposer';

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
});

function renderComposer(supportsImageAttachments: boolean, handleAttachClick = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <CommandInputComposer
        input=""
        handleInputChange={() => undefined}
        setIsFocused={() => undefined}
        handleSubmit={() => undefined}
        handlePaste={() => undefined}
        handleDrop={() => undefined}
        handleAttachClick={handleAttachClick}
        supportsImageAttachments={supportsImageAttachments}
        textareaRef={createRef<HTMLTextAreaElement>()}
        filteredCommands={[]}
        activeCommandIndex={0}
        setActiveCommandIndex={() => undefined}
        commandRefs={{ current: [] }}
        handleSelectCommand={() => undefined}
        attachments={[]}
        removeAttachment={() => undefined}
        retryAttachment={() => undefined}
      />,
    );
  });

  return { container, handleAttachClick };
}

describe('CommandInputComposer attachment capability', () => {
  it('disables image attachment when the provider does not advertise image prompts', () => {
    const { container, handleAttachClick } = renderComposer(false);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Attach image"]');

    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe('This agent does not support image attachments');
    button?.click();
    expect(handleAttachClick).not.toHaveBeenCalled();
  });

  it('allows image attachment when the provider advertises image prompts', () => {
    const { container, handleAttachClick } = renderComposer(true);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Attach image"]');

    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(handleAttachClick).toHaveBeenCalledOnce();
  });
});
