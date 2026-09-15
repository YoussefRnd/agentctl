// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import React, { useRef, useState } from 'react';
import { useContextAutocomplete } from './useContextAutocomplete';

vi.mock('@agentctl/api-client', () => ({
  searchContext: vi.fn(),
  resolveContext: vi.fn(),
}));

import { searchContext, resolveContext } from '@agentctl/api-client';
const mockedSearch = vi.mocked(searchContext);
const mockedResolve = vi.mocked(resolveContext);

describe('useContextAutocomplete', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it('triggers autocomplete and fetches suggestions when @ is typed', async () => {
    mockedSearch.mockResolvedValue([
      {
        id: 'file:src/server.ts',
        type: 'file',
        title: 'server.ts',
        subtitle: 'src/server.ts',
        value: 'src/server.ts',
      },
    ]);

    let hookResult: ReturnType<typeof useContextAutocomplete> | undefined;

    function Harness() {
      const [input, setInput] = useState('@serv');
      const textareaRef = useRef<HTMLTextAreaElement>(null);

      hookResult = useContextAutocomplete({
        sessionId: 'sess-123',
        input,
        setInput,
        textareaRef,
      });

      return (
        <div>
          <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} />
          <button
            type="button"
            data-testid="select-btn"
            onClick={() => {
              if (hookResult?.items[0]) {
                hookResult.selectItem(hookResult.items[0]);
              }
            }}
          >
            Select
          </button>
        </div>
      );
    }

    await act(async () => {
      root?.render(<Harness />);
    });

    expect(hookResult?.isOpen).toBe(true);

    // Wait for debounced search
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(mockedSearch).toHaveBeenCalledWith('sess-123', 'serv', 'all');
    expect(hookResult?.items.length).toBe(1);
    expect(hookResult?.items[0]?.title).toBe('server.ts');

    // Test selection
    const btn = container?.querySelector('[data-testid="select-btn"]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    expect(hookResult?.attachedContexts.length).toBe(1);
    expect(hookResult?.attachedContexts[0]?.id).toBe('file:src/server.ts');
  });

  it('resolves attached context references properly', async () => {
    mockedResolve.mockResolvedValue({
      formattedContent: '### Context Attachment: `src/server.ts`',
      items: [{ id: 'file:src/server.ts', type: 'file', title: 'server.ts', size: 100 }],
    });

    let hookResult: ReturnType<typeof useContextAutocomplete> | undefined;

    function Harness() {
      const [input, setInput] = useState('');
      const textareaRef = useRef<HTMLTextAreaElement>(null);

      hookResult = useContextAutocomplete({
        sessionId: 'sess-123',
        input,
        setInput,
        textareaRef,
      });

      return <textarea ref={textareaRef} value={input} readOnly />;
    }

    await act(async () => {
      root?.render(<Harness />);
    });

    act(() => {
      hookResult?.selectItem({
        id: 'file:src/server.ts',
        type: 'file',
        title: 'server.ts',
        subtitle: 'src/server.ts',
        value: 'src/server.ts',
      });
    });

    let resolvedResult: unknown;
    await act(async () => {
      resolvedResult = await hookResult?.resolveAttachedContexts();
    });

    expect(mockedResolve).toHaveBeenCalledWith('sess-123', [
      { type: 'file', value: 'src/server.ts', path: 'src/server.ts', target: undefined },
    ]);
    expect((resolvedResult as any).formattedContent).toContain('Context Attachment');
  });
});
