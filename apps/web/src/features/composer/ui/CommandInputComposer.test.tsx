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
  it('keeps attach button clickable when the provider does not advertise image prompts', () => {
    const { container, handleAttachClick } = renderComposer(false);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]');

    expect(button?.disabled).toBe(false);
    expect(button?.title).toBe('Attach file as context');
    act(() => button?.click());
    expect(handleAttachClick).toHaveBeenCalledOnce();
  });

  it('allows image attachment when the provider advertises image prompts', () => {
    const { container, handleAttachClick } = renderComposer(true);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]');

    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(handleAttachClick).toHaveBeenCalledOnce();
  });
});
