// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { createRoot } from 'react-dom/client';
import { act, useRef, useState } from 'react';
import {
  useContextAutocomplete,
  type UseContextAutocompleteReturn,
} from './useContextAutocomplete';
import { searchContext, resolveContext, type ContextItem } from '@agentctl/api-client';

vi.mock('@agentctl/api-client', () => ({ searchContext: vi.fn(), resolveContext: vi.fn() }));
const mockedSearch = vi.mocked(searchContext);
const mockedResolve = vi.mocked(resolveContext);
const file: ContextItem = {
  id: 'file:src/server.ts',
  type: 'file',
  title: 'server.ts',
  subtitle: 'src/server.ts',
  value: 'src/server.ts',
};
const otherFile: ContextItem = {
  ...file,
  id: 'file:README.md',
  title: 'README.md',
  subtitle: 'README.md',
  value: 'README.md',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useContextAutocomplete', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let result: UseContextAutocompleteReturn;
  let changeInput: (input: string) => void;

  function mount(input = '@serv', sessionId = 'sess-123', projectId?: string) {
    function Harness() {
      const [value, setInput] = useState(input);
      changeInput = setInput;
      const textareaRef = useRef<HTMLTextAreaElement>(null);
      result = useContextAutocomplete({
        sessionId,
        projectId,
        input: value,
        setInput,
        textareaRef,
      });
      return (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setInput(event.target.value)}
          onSelect={result.syncSelection}
          onKeyDown={result.handleKeyDown}
        />
      );
    }
    act(() => root.render(<Harness />));
  }

  function edit(input: string, cursor = input.length) {
    act(() => changeInput(input));
    const textarea = container.querySelector('textarea')!;
    act(() => {
      textarea.setSelectionRange(cursor, cursor);
      result.syncSelection();
    });
  }

  async function search() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
  }

  function key(key: string) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => container.querySelector('textarea')!.dispatchEvent(event));
    return event;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedSearch.mockResolvedValue([file]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('debounces typing and passes an abort signal to search', async () => {
    mount();
    edit('@server');
    expect(result.isLoading).toBe(true);
    expect(mockedSearch).not.toHaveBeenCalled();
    await search();
    expect(mockedSearch).toHaveBeenCalledOnce();
    expect(mockedSearch).toHaveBeenCalledWith(
      'sess-123',
      'server',
      'all',
      'sessions',
      expect.any(AbortSignal),
    );
    expect(result.items).toEqual([file]);
  });

  it('attaches once, removes the query, and allows another mention', async () => {
    mount();
    await search();
    key('Enter');
    expect(result.attachedContexts).toEqual([file]);
    expect(container.querySelector('textarea')!.value).toBe('');
    expect(result.isOpen).toBe(false);
    edit('@serv');
    expect(result.isOpen).toBe(true);
    await search();
    key('Tab');
    expect(result.attachedContexts).toEqual([file]);
  });

  it('cancels an obsolete request and ignores responses arriving out of order', async () => {
    const first = deferred<ContextItem[]>();
    const second = deferred<ContextItem[]>();
    mockedSearch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mount();
    await search();
    const signal = mockedSearch.mock.calls[0][4]!;
    edit('@readme');
    expect(signal.aborted).toBe(true);
    expect(result.items).toEqual([]);
    await search();
    await act(async () => second.resolve([otherFile]));
    await act(async () => first.resolve([file]));
    expect(result.items).toEqual([otherFile]);
    expect(result.isLoading).toBe(false);
  });

  it('does not select stale results or submit with Enter during a new search', async () => {
    mount();
    await search();
    edit('@read');
    expect(result.items).toEqual([]);
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(result.attachedContexts).toEqual([]);
  });

  it('dismisses with Escape while searching and with no matches', async () => {
    mockedSearch.mockResolvedValue([]);
    mount();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(result.isOpen).toBe(false);
    edit('@missing');
    await search();
    expect(result.items).toEqual([]);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(result.isOpen).toBe(false);
  });

  it('reuses recent queries and refreshes after the cache expires', async () => {
    mount();
    await search();
    edit('@read');
    await search();
    edit('@serv');
    expect(result.items).toEqual([file]);
    expect(mockedSearch).toHaveBeenCalledTimes(2);
    edit('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });
    edit('@serv');
    await search();
    expect(mockedSearch).toHaveBeenCalledTimes(3);
  });

  it('searches the selected project before a session exists', async () => {
    mount('@serv', '', 'proj-123');
    await search();
    expect(mockedSearch).toHaveBeenCalledWith(
      'proj-123',
      'serv',
      'all',
      'projects',
      expect.any(AbortSignal),
    );
  });

  it('wraps keyboard navigation and selects the highlighted item', async () => {
    mockedSearch.mockResolvedValue([file, otherFile]);
    mount();
    await search();
    key('ArrowUp');
    expect(result.activeIndex).toBe(1);
    key('ArrowDown');
    expect(result.activeIndex).toBe(0);
    key('ArrowDown');
    key('Tab');
    expect(result.attachedContexts).toEqual([otherFile]);
  });

  it('follows cursor movement and preserves text after a selected mention', async () => {
    mount('Review @serv carefully');
    expect(result.isOpen).toBe(false);
    edit('Review @serv carefully', 12);
    expect(result.query).toBe('serv');
    await search();
    key('Enter');
    expect(container.querySelector('textarea')!.value).toBe('Review  carefully');
    expect(result.attachedContexts).toEqual([file]);
  });

  it('does not treat cursor position zero as the end of the input', () => {
    mount();
    edit('@serv', 0);
    expect(result.isOpen).toBe(false);
  });

  it('ignores email addresses and text selections, and accepts a tab boundary', () => {
    mount('me@example.com');
    expect(result.isOpen).toBe(false);
    edit('Review\t@serv');
    expect(result.isOpen).toBe(true);
    act(() => {
      container.querySelector('textarea')!.setSelectionRange(7, 12);
      result.syncSelection();
    });
    expect(result.isOpen).toBe(false);
  });

  it('distinguishes a search failure from no matches and recovers on another query', async () => {
    mockedSearch.mockRejectedValueOnce(new Error('Offline'));
    mount();
    await search();
    expect(result.searchError).toBe(true);
    expect(result.isLoading).toBe(false);
    edit('@readme');
    await search();
    expect(result.searchError).toBe(false);
    expect(result.items).toEqual([file]);
  });

  it('does not attach while an IME composition is in progress', async () => {
    mount();
    await search();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => container.querySelector('textarea')!.dispatchEvent(event));
    expect(result.attachedContexts).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('resolves attached references and can resolve only dynamic Git context', async () => {
    const git: ContextItem = {
      id: 'git:diff',
      type: 'git',
      title: 'Git Diff',
      subtitle: 'Working tree',
      value: 'diff',
    };
    mockedResolve.mockResolvedValue({ formattedContent: 'Git diff', items: [] });
    mount('');
    act(() => {
      result.addAttachedContext(file);
      result.addAttachedContext(git);
    });
    await act(async () => {
      await result.resolveAttachedContexts();
    });
    expect(mockedResolve).toHaveBeenLastCalledWith('sess-123', [
      { type: 'file', value: 'src/server.ts', path: 'src/server.ts', target: undefined },
      { type: 'git', value: 'diff', path: undefined, target: 'diff' },
    ]);
    await act(async () => {
      await result.resolveAttachedContexts([git]);
    });
    expect(mockedResolve).toHaveBeenLastCalledWith('sess-123', [
      { type: 'git', value: 'diff', path: undefined, target: 'diff' },
    ]);
  });
});
