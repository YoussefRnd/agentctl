import { useState, useCallback, useEffect, useLayoutEffect, useRef, memo } from 'react';
import type { ConversationTurn } from '../lib/turnMinimapGrouping';
import { TurnPreviewPopover } from './TurnPreviewPopover';
import { Tooltip } from '@agentctl/ui';

interface TurnMinimapProps {
  turns: ConversationTurn[];
  activeTurnIndex: number | null;
  onSelectTurn: (turn: ConversationTurn) => void;
}

const Tick = memo(
  function Tick({
    turn,
    index,
    active,
    strength,
    hovering,
    onSelect,
    onFocus,
    onBlur,
  }: {
    turn: ConversationTurn;
    index: number;
    active: boolean;
    strength: number;
    hovering: boolean;
    onSelect: (index: number) => void;
    onFocus: (index: number) => void;
    onBlur: () => void;
  }) {
    const bright = active || strength > 0.08;
    return (
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-end [&>span]:h-full [&>span]:w-full">
        <Tooltip
          content={<TurnPreviewPopover turn={turn} />}
          side="left"
          delayDuration={150}
          className="rounded-lg border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          <button
            type="button"
            onClick={(event) => {
              if (event.detail === 0) onSelect(index);
            }}
            onFocus={() => onFocus(index)}
            onBlur={onBlur}
            className="focus-visible:outline-accent relative flex h-full w-full cursor-pointer items-center justify-end px-1 focus-visible:outline"
            aria-label={`Turn ${index + 1}`}
            aria-current={active ? 'location' : undefined}
          >
            <span
              style={{
                width: 22,
                height: 1.5,
                maxHeight: '50%',
                transform: `scale(${(hovering ? 10 / 22 : 0.5) + strength * (12 / 22)}, ${1 + strength / 3})`,
                backgroundColor: bright ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                opacity: active ? 1 : (hovering ? 0.25 : 0.35) + strength * 0.75,
              }}
              className="pointer-events-none block origin-right rounded-full transition-[transform,opacity,background-color] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            />
          </button>
        </Tooltip>
      </div>
    );
  },
  (previous, next) => {
    // Ticks display a preview, not the full event array. Selection reads the latest
    // committed turn separately so skipped previews never return stale events.
    const a = previous.turn,
      b = next.turn;
    return (
      previous.index === next.index &&
      previous.active === next.active &&
      previous.strength === next.strength &&
      previous.hovering === next.hovering &&
      previous.onSelect === next.onSelect &&
      previous.onFocus === next.onFocus &&
      previous.onBlur === next.onBlur &&
      a.id === b.id &&
      a.userPrompt === b.userPrompt &&
      a.turnSummary === b.turnSummary &&
      a.modelName === b.modelName &&
      a.providerName === b.providerName &&
      a.providerIcon === b.providerIcon &&
      a.diffStats.additions === b.diffStats.additions &&
      a.diffStats.deletions === b.diffStats.deletions &&
      a.diffStats.filesCount === b.diffStats.filesCount
    );
  },
);

export const TurnMinimap = memo(function TurnMinimap({
  turns,
  activeTurnIndex,
  onSelectTurn,
}: TurnMinimapProps) {
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingPositionRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const didScrubRef = useRef(false);
  const lastScrubIndexRef = useRef<number | null>(null);
  const selectionRef = useRef({ turns, onSelectTurn });
  useLayoutEffect(() => {
    selectionRef.current = { turns, onSelectTurn };
  }, [turns, onSelectTurn]);
  const selectTick = useCallback((index: number) => {
    const latest = selectionRef.current;
    if (latest.turns[index]) latest.onSelectTurn(latest.turns[index]);
  }, []);

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current != null) window.clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = null;
  }, []);
  const handleFocus = useCallback(
    (index: number) => {
      clearHoverTimeout();
      setHoverPosition(index);
    },
    [clearHoverTimeout],
  );
  const handleLeave = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = window.setTimeout(() => setHoverPosition(null), 120);
  }, [clearHoverTimeout]);
  useEffect(
    () => () => {
      if (hoverTimeoutRef.current != null) window.clearTimeout(hoverTimeoutRef.current);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );
  const selectScrubPosition = useCallback(
    (position: number) => {
      const index = Math.max(0, Math.min(Math.round(position), turns.length - 1));
      if (index !== lastScrubIndexRef.current && turns[index]) {
        lastScrubIndexRef.current = index;
        onSelectTurn(turns[index]);
      }
    },
    [turns, onSelectTurn],
  );
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = railRef.current?.getBoundingClientRect();
      if (!rect?.height || !turns.length) return;
      clearHoverTimeout();
      pendingPositionRef.current = Math.max(
        0,
        Math.min(((event.clientY - rect.top) / rect.height) * turns.length - 0.5, turns.length - 1),
      );
      if (draggingRef.current) didScrubRef.current = true;
      if (frameRef.current != null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const position = pendingPositionRef.current;
        if (position == null) return;
        setHoverPosition(position);
        if (draggingRef.current && didScrubRef.current) selectScrubPosition(position);
      });
    },
    [turns.length, clearHoverTimeout, selectScrubPosition],
  );
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !turns.length) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      didScrubRef.current = false;
      lastScrubIndexRef.current = null;
    },
    [turns.length],
  );
  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = railRef.current?.getBoundingClientRect();
      if (draggingRef.current && rect?.height)
        selectScrubPosition(
          Math.max(
            0,
            Math.min(
              ((event.clientY - rect.top) / rect.height) * turns.length - 0.5,
              turns.length - 1,
            ),
          ),
        );
      draggingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [selectScrubPosition, turns.length],
  );
  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  if (!turns.length) return null;
  return (
    <div className="absolute inset-y-6 right-2 z-30 flex w-8 items-center justify-end select-none">
      <div
        ref={railRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerEnter={clearHoverTimeout}
        onPointerLeave={handleLeave}
        style={{ height: turns.length * 10 }}
        className="flex max-h-full w-full cursor-ns-resize touch-none flex-col items-end"
        aria-label="Conversation turn timeline minimap"
      >
        {turns.map((turn, index) => {
          const distance = hoverPosition == null ? Infinity : Math.abs(index - hoverPosition);
          const strength = distance < 3 ? Math.exp((-distance * distance) / 2) : 0;
          return (
            <Tick
              key={turn.id}
              turn={turn}
              index={index}
              active={index === activeTurnIndex}
              strength={strength}
              hovering={hoverPosition != null}
              onSelect={selectTick}
              onFocus={handleFocus}
              onBlur={handleLeave}
            />
          );
        })}
      </div>
    </div>
  );
});
