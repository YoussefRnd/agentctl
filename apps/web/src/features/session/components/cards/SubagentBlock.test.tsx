// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SubagentBlock } from './SubagentBlock';
import { SubagentChatView } from '../SubagentChatView';
import { useUIStore } from '@/shared';
import type { SubagentGroup } from './subagentBlockUtils';
import type { ACPEventRow } from '@agentctl/shared';

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
  childEvents: ACPEventRow[] = [],
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
  useUIStore.getState().setActiveSubagent(null);
});

describe('SubagentBlock (Unexpanded in chat feed)', () => {
  it('renders clean title, task, time, without icons or # IDs', () => {
    const groups: SubagentGroup[] = [
      createMockGroup(
        'sa-12345678',
        'Research Codebase',
        'Analyze auth middleware implementation',
        'completed',
      ),
    ];

    const { root, container } = renderSubagentBlock(groups);

    // Title and task rendered
    expect(container.textContent).toContain('Research Codebase');
    expect(container.textContent).toContain('Analyze auth middleware implementation');

    // No # hash or tool-cal IDs
    expect(container.textContent).not.toContain('#sa-123');
    expect(container.textContent).not.toContain('#tool-cal');

    // No success or failure text badges
    expect(container.textContent).not.toContain('FAILED');
    expect(container.textContent).not.toContain('SUCCESS');

    act(() => {
      root.unmount();
    });
  });

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
    expect(container.textContent).toContain('Run unit tests');
    expect(container.textContent).toContain('pnpm test');

    act(() => {
      root.unmount();
    });
  });

  it('activates subagent when clicked to replace main view', () => {
    const group = createMockGroup('sa-1', 'Build Specialist', 'Compile packages', 'completed');
    const { root, container } = renderSubagentBlock([group]);

    const card = container.querySelector('[role="button"]');
    expect(card).toBeDefined();

    act(() => {
      (card as HTMLElement)?.click();
    });

    const activeSubagent = useUIStore.getState().activeSubagent;
    expect(activeSubagent).toBeDefined();
    expect((activeSubagent?.subagentEvent.data as { name?: string })?.name).toBe(
      'Build Specialist',
    );

    act(() => {
      root.unmount();
    });
  });
});

describe('SubagentChatView (Expanded subagent view)', () => {
  it('renders header with back button, task prompt, and response without state badges', () => {
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
    expect(container.textContent).toContain('Back to session');

    // What agent told the subagent (Task prompt)
    expect(container.textContent).toContain('Task prompt');
    expect(container.textContent).toContain('Find all database models in the project');

    // Response rendered like main chat
    expect(container.textContent).toContain('Found 12 database models in src/db/schema.ts');

    // No failure/success state badges
    expect(container.textContent).not.toContain('FAILED');
    expect(container.textContent).not.toContain('SUCCESS');

    // Clicking back button triggers onBack
    const backBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Back to session'),
    );
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
