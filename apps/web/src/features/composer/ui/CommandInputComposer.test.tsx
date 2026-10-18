// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
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

function contextState(
  overrides: Partial<
    NonNullable<ComponentProps<typeof CommandInputComposer>['contextAutocomplete']>
  > = {},
) {
  return {
    isOpen: true,
    setIsOpen: vi.fn(),
    items: [
      {
        id: 'file:src/server.ts',
        type: 'file' as const,
        title: 'server.ts',
        subtitle: 'src/server.ts',
        value: 'src/server.ts',
      },
    ],
    isLoading: false,
    searchError: false,
    query: 'serv',
    listboxId: 'context-list',
    syncSelection: vi.fn(),
    activeIndex: 0,
    setActiveIndex: vi.fn(),
    filterType: 'all' as const,
    setFilterType: vi.fn(),
    attachedContexts: [],
    selectItem: vi.fn(),
    addAttachedContext: vi.fn(),
    removeAttachedContext: vi.fn(),
    clearAttachedContexts: vi.fn(),
    resolveAttachedContexts: async () => null,
    handleKeyDown: vi.fn(() => false),
    ...overrides,
  };
}

it('links context suggestions to the textarea and keeps focus through pointer selection', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const context = contextState();
  const { container, update } = renderComposer(true, vi.fn(), {
    input: '@serv',
    contextAutocomplete: { ...context, isOpen: false },
  });
  const input = container.querySelector('textarea')!;
  input.focus();
  await act(async () => update({ contextAutocomplete: context }));
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-controls')).toBe('context-list');
  expect(input.getAttribute('aria-activedescendant')).toBe('context-list-option-0');
  const option = document.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(option.getAttribute('aria-label')).toContain('src/server.ts');
  expect(option.querySelector('mark')?.textContent).toBe('serv');
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => {
    option.dispatchEvent(event);
    option.click();
  });
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(context.selectItem).toHaveBeenCalledWith(context.items[0]);
});

it('shows attachment status and accessible context filters', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const context = contextState();
  await act(async () =>
    renderComposer(true, vi.fn(), {
      contextAutocomplete: { ...context, attachedContexts: context.items },
    }),
  );
  const option = document.querySelector('[role="option"]')!;
  expect(option.textContent).toContain('Attached');
  expect(option.getAttribute('aria-label')).toContain('already attached');
  const all = document.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!;
  expect(all.textContent).toBe('All');
  const files = [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find(
    (button) => button.textContent === 'Files',
  )!;
  act(() => files.click());
  expect(context.setFilterType).toHaveBeenCalledWith('file');
});

it('shows distinct searching, empty, and failed search feedback', async () => {
  const context = contextState({ items: [], isLoading: true });
  let update!: ReturnType<typeof renderComposer>['update'];
  await act(async () => {
    ({ update } = renderComposer(true, vi.fn(), { contextAutocomplete: context }));
  });
  const content = () => document.querySelector('[aria-label="Context suggestions"]')!.textContent;
  expect(content()).toContain('Searching workspace');
  await act(async () => update({ contextAutocomplete: { ...context, isLoading: false } }));
  expect(content()).toContain('No matches for');
  await act(async () =>
    update({ contextAutocomplete: { ...context, isLoading: false, searchError: true } }),
  );
  expect(content()).toContain('Couldn’t search this workspace');
});

function press(input: HTMLTextAreaElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  act(() => input.dispatchEvent(event));
  return event;
}

it('highlights slash matches and exposes descriptions, categories, and argument hints', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const { container } = renderComposer(true, vi.fn(), {
    flags: { showSlashMenu: true },
    input: '/trm',
    filteredCommands: [
      {
        name: 'terminal',
        description: 'Open a terminal',
        category: 'View',
        input: { hint: 'command' },
      },
    ],
  });
  await act(async () => {});
  const input = container.querySelector('textarea')!;
  const listbox = document.getElementById(input.getAttribute('aria-controls')!)!;
  expect(listbox.getAttribute('role')).toBe('listbox');
  expect(
    document
      .getElementById(input.getAttribute('aria-activedescendant')!)
      ?.getAttribute('aria-selected'),
  ).toBe('true');
  const option = listbox.querySelector('[role="option"]')!;
  expect(
    [...option.querySelector('p')!.querySelectorAll('mark')]
      .map((mark) => mark.textContent)
      .join(''),
  ).toBe('trm');
  expect(option.textContent).toContain('Open a terminal');
  expect(option.textContent).toContain('Input: command');
  expect(option.textContent).toContain('View');
});

it('dismisses slash suggestions without changing the prompt and reopens on a new query', async () => {
  const handleInputChange = vi.fn();
  const { container, update } = renderComposer(true, vi.fn(), {
    flags: { showSlashMenu: true },
    input: '/term',
    filteredCommands: [{ name: 'terminal' }],
    handleInputChange,
  });
  await act(async () => {});
  const input = container.querySelector('textarea')!;
  expect(press(input, 'Escape').defaultPrevented).toBe(true);
  expect(handleInputChange).not.toHaveBeenCalled();
  expect(input.value).toBe('/term');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('[aria-label="Slash commands"]')).toBeNull();
  await act(async () => update({ input: '/termi' }));
  expect(document.querySelector('[aria-label="Slash commands"]')).not.toBeNull();
});

it('shows unmatched slash queries and prevents accidental submission', async () => {
  const handleSubmit = vi.fn();
  const { container } = renderComposer(true, vi.fn(), {
    flags: { showSlashMenu: true },
    input: '/missing',
    handleSubmit,
  });
  await act(async () => {});
  expect(document.querySelector('[aria-label="Slash commands"]')?.textContent).toContain(
    'No commands match “missing”',
  );
  const input = container.querySelector('textarea')!;
  expect(press(input, 'Enter').defaultPrevented).toBe(true);
  expect(handleSubmit).not.toHaveBeenCalled();
  expect(press(input, 'Escape').defaultPrevented).toBe(true);
  expect(input.getAttribute('aria-expanded')).toBe('false');
});

it('keeps Shift+Enter and Shift+Tab available while slash suggestions are open', async () => {
  const handleInputChange = vi.fn();
  const handleSubmit = vi.fn();
  const { container } = renderComposer(true, vi.fn(), {
    flags: { showSlashMenu: true },
    input: '/',
    filteredCommands: [{ name: 'terminal' }],
    handleInputChange,
    handleSubmit,
  });
  await act(async () => {});
  const input = container.querySelector('textarea')!;
  expect(press(input, 'Enter', true).defaultPrevented).toBe(false);
  expect(press(input, 'Tab', true).defaultPrevented).toBe(false);
  expect(handleInputChange).not.toHaveBeenCalled();
  expect(handleSubmit).not.toHaveBeenCalled();
});

it('completes command arguments with Tab and submits a completed command with Enter', async () => {
  const handleInputChange = vi.fn();
  const handleSubmit = vi.fn();
  const { container, update } = renderComposer(true, vi.fn(), {
    flags: { showSlashMenu: true },
    input: '/pl',
    filteredCommands: [{ name: 'plan', input: { hint: 'task' } }],
    handleInputChange,
    handleSubmit,
  });
  await act(async () => {});
  const input = container.querySelector('textarea')!;
  press(input, 'Tab');
  expect(handleInputChange).toHaveBeenCalledWith('/plan ');
  await act(async () => update({ input: '/terminal', filteredCommands: [{ name: 'terminal' }] }));
  press(input, 'Enter');
  expect(handleSubmit).toHaveBeenCalledOnce();
});
