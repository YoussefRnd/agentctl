// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
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
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('TurnMinimap', () => {
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

it('selects the latest full turn and handler when unchanged previews skip rendering', () => {
  const container = document.createElement('div'),
    root = createRoot(container);
  const oldHandler = vi.fn(),
    currentHandler = vi.fn();
  act(() =>
    root.render(<TurnMinimap turns={mockTurns} activeTurnIndex={null} onSelectTurn={oldHandler} />),
  );
  const latest = { ...mockTurns[0], agentEvents: [mockTurns[1].userEvent] };
  act(() =>
    root.render(
      <TurnMinimap
        turns={[latest, mockTurns[1]]}
        activeTurnIndex={null}
        onSelectTurn={currentHandler}
      />,
    ),
  );
  act(() => (container.querySelector('button') as HTMLButtonElement).click());
  expect(oldHandler).not.toHaveBeenCalled();
  expect(currentHandler).toHaveBeenCalledExactlyOnceWith(latest);
  act(() => root.unmount());
});

function renderPointerMinimap() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  act(() =>
    root.render(<TurnMinimap turns={mockTurns} activeTurnIndex={0} onSelectTurn={onSelect} />),
  );
  const rail = container.querySelector('[aria-label="Conversation turn timeline minimap"]')!;
  vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 120,
    left: 200,
    right: 232,
    height: 20,
    width: 32,
    x: 200,
    y: 100,
    toJSON: () => ({}),
  });
  Object.assign(rail, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  });
  const pointer = (type: string, x = 220, y = 105, pointerType = 'mouse') => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
    });
    act(() => rail.dispatchEvent(event));
  };
  const flushFrame = () => act(() => frame?.(0));
  const expectResting = () => {
    for (const tick of container.querySelectorAll('button[aria-label^="Turn "] > span')) {
      expect((tick as HTMLElement).style.transform).toBe('scale(0.5, 1)');
    }
  };
  const expectHovered = () => {
    expect((container.querySelector('button > span') as HTMLElement).style.transform).not.toBe(
      'scale(0.5, 1)',
    );
  };
  return {
    container,
    root,
    onSelect,
    pointer,
    flushFrame,
    cancelFrame,
    expectResting,
    expectHovered,
  };
}

it('keeps focused and active ticks flat when the pointer is elsewhere', () => {
  const view = renderPointerMinimap();
  act(() => (view.container.querySelector('button') as HTMLButtonElement).focus());
  view.expectResting();
  expect(view.container.querySelector('button[aria-current="location"] > span')).toHaveProperty(
    'style.opacity',
    '1',
  );
  act(() => view.root.unmount());
});

it('clears hover on pointer exit, including a pending animation frame', () => {
  const view = renderPointerMinimap();
  view.pointer('pointermove');
  view.flushFrame();
  view.expectHovered();
  view.pointer('pointermove', 220, 115);
  view.pointer('pointerout', 100, 115);
  view.expectResting();
  expect(view.cancelFrame).toHaveBeenCalled();
  view.flushFrame();
  view.expectResting();
  act(() => view.root.unmount());
});

it('keeps captured scrubbing functional without enlarging ticks outside the rail', () => {
  const view = renderPointerMinimap();
  view.pointer('pointerdown');
  view.pointer('pointermove');
  view.flushFrame();
  view.expectHovered();
  view.onSelect.mockClear();
  view.pointer('pointermove', 100, 140);
  view.expectResting();
  view.pointer('pointerup', 100, 140);
  view.flushFrame();
  view.expectResting();
  expect(view.onSelect).toHaveBeenCalledExactlyOnceWith(mockTurns[1]);
  act(() => view.root.unmount());
});

it('clears hover when a captured pointer is released outside without another move', () => {
  const view = renderPointerMinimap();
  view.pointer('pointermove');
  view.flushFrame();
  view.expectHovered();
  view.pointer('pointerdown');
  view.pointer('pointerup', 100, 140);
  view.expectResting();
  expect(view.onSelect).toHaveBeenCalledExactlyOnceWith(mockTurns[1]);
  act(() => view.root.unmount());
});

it.each(['pointercancel', 'lostpointercapture'])('clears hover when %s ends a drag', (event) => {
  const view = renderPointerMinimap();
  view.pointer('pointerdown');
  view.pointer('pointermove');
  view.flushFrame();
  view.expectHovered();
  view.onSelect.mockClear();
  view.pointer(event);
  view.expectResting();
  view.pointer('pointerup');
  expect(view.onSelect).not.toHaveBeenCalled();
  act(() => view.root.unmount());
});

it('clears hover and dragging when the window loses focus', () => {
  const view = renderPointerMinimap();
  view.pointer('pointerdown');
  view.pointer('pointermove');
  view.flushFrame();
  view.expectHovered();
  view.onSelect.mockClear();
  act(() => window.dispatchEvent(new Event('blur')));
  view.expectResting();
  view.pointer('pointerup');
  expect(view.onSelect).not.toHaveBeenCalled();
  act(() => view.root.unmount());
});

it('does not leave hover enlargement after touch input', () => {
  const view = renderPointerMinimap();
  view.pointer('pointerdown', 220, 105, 'touch');
  view.pointer('pointermove', 220, 115, 'touch');
  view.pointer('pointerup', 220, 115, 'touch');
  view.flushFrame();
  view.expectResting();
  expect(view.onSelect).toHaveBeenCalledExactlyOnceWith(mockTurns[1]);
  act(() => view.root.unmount());
});
