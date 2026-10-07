import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import type { SessionTurnState } from '@/features/sessions';
import { AgentResponse } from './AgentResponse';

const state = vi.hoisted(() => ({ turn: null as SessionTurnState | null }));
vi.mock('@/features/sessions', () => ({
  useSession: () => ({ sessionData: { session: { status: 'idle' } }, reviewData: null }),
  useSessionTurnState: () => state.turn,
  useSessionExecution: () => undefined,
}));
vi.mock('@/features/settings', () => ({
  useSettings: () => ({ settings: { showThinking: false } }),
}));
vi.mock('@/features/subagents', () => ({
  extractSubagentGroups: () => [],
  SubagentBlock: () => null,
}));
vi.mock('@/features/review', () => ({ extractTurnChanges: () => ({ files: [] }) }));
vi.mock('./TurnChangesCard', () => ({ TurnChangesCard: () => null }));
vi.mock('./StreamingMarkdown', () => ({
  StreamingMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));
const container = document.createElement('div');
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

test('shows waiting through idle refreshes, progresses to real activity, and removes the indicator at completion', () => {
  root = createRoot(container);
  state.turn = { phase: 'starting', startedAt: new Date(), canCancel: true };
  act(() => root.render(<AgentResponse events={[]} isActive isStreaming />));
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Waiting for response');
  expect(container.querySelector('[aria-expanded]')).toBeNull();
  state.turn = { ...state.turn, phase: 'waiting' };
  act(() => root.render(<AgentResponse events={[]} isActive isStreaming isConnected={false} />));
  expect(container.textContent).toContain('Waiting for response');
  const tool: SessionEventRow = {
    id: 2,
    sessionId: 's',
    type: 'tool_call',
    data: { name: 'read', status: 'in_progress', kind: 'read', title: 'Read file' },
    createdAt: new Date(),
  };
  state.turn = { ...state.turn, phase: 'active' };
  act(() => root.render(<AgentResponse events={[tool]} isActive isStreaming />));
  expect(container.textContent).not.toContain('Waiting for response');
  expect(container.textContent).toContain('Running 1 tool');
  state.turn = null;
  const response: SessionEventRow = {
    id: 3,
    sessionId: 's',
    type: 'text',
    data: { role: 'provider', content: 'Hello back' },
    createdAt: new Date(),
  };
  act(() => root.render(<AgentResponse events={[response]} isActive />));
  expect(container.textContent).toContain('Hello back');
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test('displays a clear provider error alongside existing activity without retry details', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T13:59:00Z'));
  root = createRoot(container);
  state.turn = {
    phase: 'retrying',
    startedAt: new Date(),
    canCancel: true,
    retry: {
      attempt: 2,
      nextRetryAt: '2026-10-05T13:59:05Z',
      message: 'Provider request failed with HTTP 504',
      httpStatus: 504,
    },
  };
  const response: SessionEventRow = {
    id: 3,
    sessionId: 's',
    type: 'text',
    data: { role: 'provider', content: 'Earlier response' },
    createdAt: new Date(),
  };
  act(() => root.render(<AgentResponse events={[response]} isActive isStreaming />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Provider error');
  expect(container.textContent).toContain('The provider timed out (HTTP 504).');
  expect(container.textContent).not.toContain('attempt');
  expect(container.textContent).not.toContain('Retry');
  expect(container.textContent).toContain('Earlier response');
  act(() => vi.advanceTimersByTime(5000));
  expect(container.textContent).toContain('The provider timed out (HTTP 504).');
  expect(container.textContent).not.toContain('Retry');
  state.turn = { ...state.turn, phase: 'waiting', retry: undefined };
  act(() => root.render(<AgentResponse events={[]} isActive isStreaming />));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('Waiting for response');
});
