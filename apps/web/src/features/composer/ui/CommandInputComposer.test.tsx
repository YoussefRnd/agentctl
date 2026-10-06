// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from 'react';
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

function renderComposer(
  supportsImageAttachments: boolean,
  handleAttachClick = vi.fn(),
  extra: Partial<ComponentProps<typeof CommandInputComposer>> = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  function update(overrides: Partial<ComponentProps<typeof CommandInputComposer>> = {}) {
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
          {...extra}
          {...overrides}
        />,
      );
    });
  }
  update();

  return { container, handleAttachClick, update };
}

it('keeps typing focus when suggestions open and preserves command keyboard selection', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const setActiveCommandIndex = vi.fn();
  const handleInputChange = vi.fn();
  const handleSelectCommand = vi.fn();
  const commands = [{ name: 'first' }, { name: 'second' }];
  const { container, update } = renderComposer(true, vi.fn(), {
    input: '/',
    filteredCommands: commands,
    setActiveCommandIndex,
    handleInputChange,
    handleSelectCommand,
  });
  const input = container.querySelector('textarea')!;
  input.focus();
  await act(async () => update({ flags: { showSlashMenu: true } }));
  expect(document.activeElement).toBe(input);
  const suggestions = document.querySelector('[aria-label="Slash commands"]')!;
  expect(suggestions).not.toBeNull();
  expect(container.contains(suggestions)).toBe(false);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(setActiveCommandIndex).toHaveBeenCalledWith(1);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(handleInputChange).toHaveBeenCalledWith('/first');
  await act(async () => suggestions.querySelectorAll('button')[1].click());
  expect(handleSelectCommand).toHaveBeenCalledWith(commands[1]);
});

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
