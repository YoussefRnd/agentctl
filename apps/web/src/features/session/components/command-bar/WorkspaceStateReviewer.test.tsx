// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextWindowPopover } from './WorkspaceStateReviewer';
import type { SessionWithCapabilities } from '@agentctl/shared';

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
});

function createSessionData(
  overrides: Partial<SessionWithCapabilities['session']> = {},
): SessionWithCapabilities {
  return {
    session: {
      id: 'test-session-id',
      projectId: 'test-proj',
      worktreePath: '/tmp/test',
      branch: 'main',
      baseBranch: 'main',
      baseCommit: 'hash1',
      taskSlug: 'test-task',
      mode: 'local',
      status: 'idle',
      totalTokens: 33044,
      contextLimit: 200000,
      estimatedCost: 0,
      approvalMode: 'review',
      selectedProvider: { id: 'opencode', name: 'OpenCode' } as any,
      selectedModel: 'test-model',
      selectedThinkingEffort: 'medium',
      agentPersona: null,
      availableAgentPersonas: [],
      sessionConfigOptions: [],
      sessionMetrics: {},
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
      lastHeartbeat: null,
      agentSessionId: null,
      ...overrides,
      title: overrides.title ?? 'Test session',
      availableCommands: overrides.availableCommands ?? [],
      plan: overrides.plan ?? [],
    },
    capabilities: [],
  };
}

describe('ContextWindowPopover', () => {
  it('calculates and displays exact tokens and percentage when contextLimit is provided', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    const sessionData = createSessionData({
      totalTokens: 33044,
      contextLimit: 200000,
    });

    act(() => {
      root.render(<ContextWindowPopover sessionData={sessionData} isLoading={false} />);
    });

    const triggerButton = container.querySelector('button');
    expect(triggerButton).not.toBeNull();
    // 33044 / 200000 = 16.5% -> rounded on badge is 17%
    expect(triggerButton?.textContent).toContain('17%');

    // Click to open popover
    act(() => {
      triggerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const content = document.body.textContent ?? '';
    expect(content).toContain('33.0K / 200.0K tokens');
    expect(content).toContain('16.5%');
    expect(content).not.toContain('/ 1 tokens');
    expect(content).not.toContain('100.0%');
  });

  it('uses calculated context limit from sessionMetrics if session.contextLimit is 0', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    const sessionData = createSessionData({
      totalTokens: 33044,
      contextLimit: 0,
      sessionMetrics: {
        contextLimit: 200000,
      },
    });

    act(() => {
      root.render(<ContextWindowPopover sessionData={sessionData} isLoading={false} />);
    });

    const triggerButton = container.querySelector('button');
    expect(triggerButton?.textContent).toContain('17%');

    act(() => {
      triggerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const content = document.body.textContent ?? '';
    expect(content).toContain('33.0K / 200.0K tokens');
    expect(content).toContain('16.5%');
    expect(content).not.toContain('/ 1 tokens');
  });

  it('does not invent arbitrary fallbacks (like 128k or 1) when context limit is unmetered', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    const sessionData = createSessionData({
      totalTokens: 33044,
      contextLimit: 0,
      sessionMetrics: {},
    });

    act(() => {
      root.render(<ContextWindowPopover sessionData={sessionData} isLoading={false} />);
    });

    const triggerButton = container.querySelector('button');
    // Badge shows actual tokens instead of a fake percentage
    expect(triggerButton?.textContent).toContain('33.0K');

    act(() => {
      triggerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const content = document.body.textContent ?? '';
    expect(content).toContain('33.0K tokens');
    expect(content).toContain('—');
    expect(content).not.toContain('/ 128.0K');
    expect(content).not.toContain('/ 1 tokens');
    expect(content).not.toContain('100.0%');
  });
});
