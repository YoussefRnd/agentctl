// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vite-plus/test';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SubagentBlock } from './SubagentBlock';
import { SubagentChatView } from './SubagentChatView';
import { useSubagentStore } from '../model/useSubagentStore';
import { getSubagentGroupKey, type SubagentGroup } from '../lib/subagentBlockUtils';
import type { SessionEventRow } from '@agentctl/shared';

beforeEach(() => {
  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
});

function createMockGroup(
  id: string,
  name: string,
  scope: string,
  status: 'spawning' | 'running' | 'completed' | 'failed',
  summary?: string,
  childEvents: SessionEventRow[] = [],
): SubagentGroup {
  return {
    subagentEvent: {
      id: Math.floor(Math.random() * 10000),
      sessionId: 'sess-1',
      type: 'subagent_update',
      data: {
        subagentId: id,
        name,
        scope,
        status,
        result: summary ? { summary, tokensUsed: 350 } : undefined,
      },
      createdAt: new Date('2026-08-25T03:00:00Z'),
    },
    childEvents,
  };
}

function renderSubagentBlock(groups: SubagentGroup[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SubagentBlock subagentGroups={groups} />);
  });
  return { root, container };
}

afterEach(() => {
  document.body.innerHTML = '';
  useSubagentStore.getState().setActiveSubagentId(null);
});

describe('SubagentBlock (Unexpanded in chat feed)', () => {
  it('renders live tool execution title in realtime while running', () => {
    const groups: SubagentGroup[] = [
      createMockGroup('sa-1', 'Test Runner', 'Run unit tests', 'running', undefined, [
        {
          id: 101,
          sessionId: 'sess-1',
          type: 'tool_call',
          data: {
            name: 'execute_command',
            kind: 'execute',
            status: 'in_progress',
            arguments: { command: 'pnpm test' },
          },
          createdAt: new Date('2026-08-25T03:00:01Z'),
        },
      ]),
    ];

    const { root, container } = renderSubagentBlock(groups);

    expect(container.textContent).toContain('Test Runner');
    expect(container.textContent).not.toContain('Run unit tests');
    expect(container.textContent).toContain('pnpm test');

    act(() => {
      root.unmount();
    });
  });

  it('selects a subagent within its owning session', () => {
    const group = createMockGroup('sa-1', 'Build Specialist', 'Compile packages', 'completed');
    const { root, container } = renderSubagentBlock([group]);

    const card = container.querySelector('button');
    expect(card).toBeDefined();

    act(() => {
      (card as HTMLElement)?.click();
    });

    expect(useSubagentStore.getState().activeSubagentId).toBe(getSubagentGroupKey(group));
    expect(useSubagentStore.getState().activeSessionId).toBe('sess-1');

    act(() => {
      root.unmount();
    });
  });
});

describe('SubagentChatView (Expanded subagent view)', () => {
  it('renders task, explicit status, and one result with a close control', () => {
    const group = createMockGroup(
      'sa-1',
      'Research Codebase',
      'Find all database models in the project',
      'completed',
      'Found 12 database models in src/db/schema.ts',
    );

    let backClicked = false;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <SubagentChatView
          group={group}
          onBack={() => {
            backClicked = true;
          }}
        />,
      );
    });

    // Top header
    expect(document.querySelector('[aria-label="Back to parent conversation"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Completed');

    // The full assignment stays available in a collapsed disclosure.
    expect(document.body.textContent).toContain('Original assignment');
    expect(document.body.textContent).toContain('Find all database models in the project');

    // Response rendered like main chat
    expect(document.body.textContent).toContain('Found 12 database models in src/db/schema.ts');

    // No failure/success state badges
    expect(document.body.textContent).not.toContain('FAILED');
    expect(document.body.textContent).not.toContain('SUCCESS');

    // Clicking back button triggers onBack
    const backBtn = document.querySelector(
      '[aria-label="Back to parent conversation"]',
    ) as HTMLButtonElement;
    expect(backBtn).toBeDefined();

    act(() => {
      backBtn?.click();
    });

    expect(backClicked).toBe(true);

    act(() => {
      root.unmount();
    });
  });
});
