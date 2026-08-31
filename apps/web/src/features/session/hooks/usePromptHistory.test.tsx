// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import { usePromptHistory } from './usePromptHistory';
import type { ACPEventRow } from '@agentctl/shared';

describe('usePromptHistory', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    localStorage.clear();
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
    container = null;
    root = null;
  });

  it('records prompt and navigates up/down with draft retention', () => {
    let hookResult: ReturnType<typeof usePromptHistory> | undefined;

    function TestComponent() {
      hookResult = usePromptHistory();
      return null;
    }

    act(() => {
      root?.render(<TestComponent />);
    });

    expect(hookResult).toBeDefined();

    act(() => {
      hookResult?.recordPrompt('first command');
      hookResult?.recordPrompt('second command');
    });

    expect(hookResult?.history).toEqual(['first command', 'second command']);

    // Navigate up from draft
    let text: string | null = null;
    act(() => {
      text = hookResult?.navigateUp('my draft', true) ?? null;
    });
    expect(text).toBe('second command');

    act(() => {
      text = hookResult?.navigateUp('second command', true) ?? null;
    });
    expect(text).toBe('first command');

    // Navigate down restores newer entries then draft
    act(() => {
      text = hookResult?.navigateDown('first command') ?? null;
    });
    expect(text).toBe('second command');

    act(() => {
      text = hookResult?.navigateDown('second command') ?? null;
    });
    expect(text).toBe('my draft');
  });

  it('merges initial session events into prompt history', () => {
    const mockEvents: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 'test-1',
        type: 'text',
        data: { role: 'user', content: 'fix the bug' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 'test-1',
        type: 'text',
        data: { role: 'provider', content: 'working on it' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 'test-1',
        type: 'text',
        data: { role: 'user', content: 'run tests' },
        createdAt: new Date(),
      },
    ];

    let hookResult: ReturnType<typeof usePromptHistory> | undefined;

    function TestComponent() {
      hookResult = usePromptHistory(mockEvents);
      return null;
    }

    act(() => {
      root?.render(<TestComponent />);
    });

    expect(hookResult?.history).toContain('fix the bug');
    expect(hookResult?.history).toContain('run tests');
    expect(hookResult?.history).not.toContain('working on it');
  });
});
