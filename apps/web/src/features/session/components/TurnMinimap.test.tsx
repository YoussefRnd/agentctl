// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TurnMinimap } from './TurnMinimap';
import type { ConversationTurn } from '../lib/turnMinimapGrouping';

const mockTurns: ConversationTurn[] = [
  {
    id: 'turn-1',
    turnIndex: 0,
    userEvent: {
      id: 1,
      sessionId: 'sess-1',
      type: 'text',
      data: { role: 'user', content: 'How do I add minimap?' },
      createdAt: new Date('2026-08-29T04:00:00.000Z'),
    },
    userPrompt: 'How do I add minimap?',
    agentEvents: [],
    turnSummary: 'Here is how you add a turn minimap scrubber.',
    diffStats: { additions: 42, deletions: 12, filesCount: 2 },
    modelName: 'GPT-5.6 Sol',
    providerName: 'Zed',
    userName: 'YoussefRnd',
    timestamp: '2026-08-29T04:00:00.000Z',
    isStreaming: false,
  },
  {
    id: 'turn-2',
    turnIndex: 1,
    userEvent: {
      id: 2,
      sessionId: 'sess-1',
      type: 'text',
      data: { role: 'user', content: 'What model are you?' },
      createdAt: new Date('2026-08-29T04:05:00.000Z'),
    },
    userPrompt: 'What model are you?',
    agentEvents: [],
    turnSummary: 'I am Codex, an AI coding assistant.',
    diffStats: { additions: 0, deletions: 0, filesCount: 0 },
    modelName: 'GPT-5.6 Sol',
    providerName: 'Zed',
    userName: 'YoussefRnd',
    timestamp: '2026-08-29T04:05:00.000Z',
    isStreaming: false,
  },
];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TurnMinimap', () => {
  it('renders a tick for each conversation turn', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelectTurn = vi.fn();

    act(() => {
      root.render(
        <TurnMinimap turns={mockTurns} activeTurnIndex={0} onSelectTurn={onSelectTurn} />,
      );
    });

    const buttons = document.querySelectorAll('button[aria-label^="Turn "]');
    expect(buttons).toHaveLength(2);

    act(() => {
      root.unmount();
    });
  });

  it('triggers onSelectTurn when a tick is clicked', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelectTurn = vi.fn();

    act(() => {
      root.render(
        <TurnMinimap turns={mockTurns} activeTurnIndex={0} onSelectTurn={onSelectTurn} />,
      );
    });

    const secondTick = document.querySelectorAll(
      'button[aria-label^="Turn "]',
    )[1] as HTMLButtonElement;
    expect(secondTick).toBeDefined();

    act(() => {
      secondTick.click();
    });

    expect(onSelectTurn).toHaveBeenCalledTimes(1);
    expect(onSelectTurn).toHaveBeenCalledWith(mockTurns[1]);

    act(() => {
      root.unmount();
    });
  });
});
