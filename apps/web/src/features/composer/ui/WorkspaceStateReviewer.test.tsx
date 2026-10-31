// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { CommandBarFooter, ContextWindowPopover } from './WorkspaceStateReviewer';
import type { SessionWithCapabilities } from '@agentctl/shared';

const roots: Root[] = [];
const gitState = vi.hoisted(() => ({
  isRepo: true,
  branch: null as string | null,
  hasPrimaryRemote: false,
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
}));
vi.mock('@/shared/workspace/useGitStatus', () => ({
  useGitStatus: () => ({ gitStatus: gitState }),
}));
vi.mock('@/features/sessions', () => ({
  useSessionWorkspace: () => ({ reviewData: { files: [] }, isPushing: false, isPulling: false }),
}));

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
  gitState.branch = null;
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
      planArtifacts: overrides.planArtifacts ?? [],
    },
    capabilities: [],
  };
}

describe('CommandBarFooter branch label', () => {
  function renderFooter(savedBranch: string) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <CommandBarFooter
          isLoadingSession={false}
          sessionData={createSessionData({ branch: savedBranch })}
          isSwitchingMode={false}
          switchMode={vi.fn()}
          isSwitchingBranch={false}
          switchBranch={vi.fn()}
          branches={[]}
          approvalControl={null}
        />,
      );
    });
    return container;
  }
  it('uses live Git status instead of the stale saved HEAD label', () => {
    gitState.branch = 'master';
    expect(renderFooter('HEAD').textContent).toContain('master');
    expect(document.body.textContent).not.toContain('HEAD');
  });
  it('labels a genuine detached checkout clearly', () => {
    gitState.branch = 'HEAD';
    expect(renderFooter('main').textContent).toContain('Detached HEAD');
  });
  it('keeps the saved branch while Git status is loading', () => {
    expect(renderFooter('dev').textContent).toContain('dev');
  });
});

describe('ContextWindowPopover', () => {
  function renderMeter(overrides: Partial<SessionWithCapabilities['session']>) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        <ContextWindowPopover sessionData={createSessionData(overrides)} isLoading={false} />,
      ),
    );
    const button = container.querySelector('button')!;
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    return { button, content: document.body.textContent ?? '' };
  }
  it('uses reported context occupancy even when turn consumption exceeds the context window', () => {
    const { button, content } = renderMeter({
      totalTokens: 1581561,
      contextUsedTokens: 161651,
      contextLimit: 200000,
      sessionMetrics: {
        totalTokens: 1581561,
        lastTurn: { totalTokens: 1581561, cachedReadTokens: 1564544 },
      },
    });
    expect(button.textContent).toContain('81%');
    expect(content).toContain('161.7K / 200.0K tokens');
    expect(content).toContain('80.8%');
    expect(content).toContain('Last turn consumption');
    expect(content).toContain('1.6M tokens');
    expect(content).not.toContain('100.0%');
  });
  it('formats million-token context limits as M', () => {
    const { content } = renderMeter({ contextUsedTokens: 70400, contextLimit: 1000000 });
    expect(content).toContain('70.4K / 1M tokens');
    expect(content).not.toContain('1000.0K');
  });
  it('shows available consumption fields without deriving a context count or guessing a total', () => {
    const { content } = renderMeter({
      contextUsedTokens: null,
      sessionMetrics: { lastTurn: { inputTokens: 11785, outputTokens: 2382 } },
    });
    expect(content).toContain('Last turn consumption');
    expect(content).toContain('Input11.8K tokens');
    expect(content).toContain('Output2.4K tokens');
    expect(content).toContain('Unavailable');
    expect(content).not.toContain('%');
    expect(content).not.toContain('Total');
  });
  it.each([undefined, null])(
    'does not infer occupancy from legacy totals or capacity (occupancy=%s)',
    (contextUsedTokens) => {
      const { button, content } = renderMeter({
        contextUsedTokens,
        totalTokens: 1581561,
        contextLimit: 200000,
        sessionMetrics: { totalTokens: 1581561, contextLimit: 200000 },
      });
      expect(button.getAttribute('aria-label')).toBe('Context usage unavailable');
      expect(button.textContent).toContain('—');
      expect(content).toContain('The provider has not reported current context usage.');
      expect(content).not.toContain('1.6M');
      expect(content).not.toContain('%');
    },
  );
  it('does not borrow a stale metrics capacity when a provider reports occupancy without capacity', () => {
    const { content } = renderMeter({
      contextUsedTokens: 33044,
      contextLimit: 0,
      sessionMetrics: { contextLimit: 200000 },
    });
    expect(content).toContain('33.0K tokens');
    expect(content).toContain('Context capacity unavailable.');
    expect(content).not.toContain('200.0K');
    expect(content).not.toContain('%');
  });
  it('distinguishes a reported empty context from unavailable usage', () => {
    const { content } = renderMeter({
      contextUsedTokens: 0,
      contextLimit: 200000,
      sessionMetrics: { reportedCost: { amount: 0, currency: 'USD' } },
    });
    expect(content).toContain('0 / 200.0K tokens');
    expect(content).toContain('0.0%');
    expect(content).not.toContain('Unavailable');
    expect(content).toContain('USD 0.00');
  });
  it('does not substitute a legacy zero estimate for an unreported cost', () => {
    const { content } = renderMeter({ estimatedCost: 0, sessionMetrics: { estimatedCost: 0 } });
    expect(content).toContain('Provider reported cost');
    expect(content).toContain('SessionUnavailable');
    expect(content).not.toContain('$0');
    expect(content).not.toContain('USD');
  });
  it('preserves different session and turn currencies without combining amounts', () => {
    const { content } = renderMeter({
      sessionMetrics: {
        reportedCost: { amount: 0.42, currency: 'EUR' },
        lastTurn: { cost: { amount: 0.05, currency: 'CAD' } },
      },
    });
    expect(content).toContain('SessionEUR 0.42');
    expect(content).toContain('Last turnCAD 0.05');
    expect(content).not.toContain('0.47');
  });
  it('does not display a positive tiny charge as zero', () => {
    const { content } = renderMeter({
      sessionMetrics: { reportedCost: { amount: 0.00000012, currency: 'credits' } },
    });
    expect(content).toContain('credits 1.20e-7');
  });
});
