import { useState, useCallback, useEffect, useRef, memo } from 'react';
import type { ConversationTurn } from '../lib/turnMinimapGrouping';
import { TurnPreviewPopover } from './TurnPreviewPopover';

interface TurnMinimapProps {
  turns: ConversationTurn[];
  activeTurnIndex: number | null;
  onSelectTurn: (turn: ConversationTurn) => void;
}

export const TurnMinimap = memo(function TurnMinimap({
  turns,
  activeTurnIndex,
  onSelectTurn,
}: TurnMinimapProps) {
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const hoverTimeoutRef = useRef<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current != null) {
        window.clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = useCallback((index: number) => {
    if (hoverTimeoutRef.current != null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredTurnIndex(index);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredTurnIndex(null);
    }, 120);
  }, []);

  const handleTickClick = useCallback(
    (turn: ConversationTurn) => {
      onSelectTurn(turn);
    },
    [onSelectTurn],
  );

  // Trackpad / Mouse drag scrubber
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (turns.length === 0 || !railRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);

      const rect = railRef.current.getBoundingClientRect();
      const relativeY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      const ratio = relativeY / rect.height;
      const targetIndex = Math.min(Math.floor(ratio * turns.length), turns.length - 1);
      setHoveredTurnIndex(targetIndex);
      onSelectTurn(turns[targetIndex]);
    },
    [turns, onSelectTurn],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || turns.length === 0 || !railRef.current) return;
      const rect = railRef.current.getBoundingClientRect();
      const relativeY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      const ratio = relativeY / rect.height;
      const targetIndex = Math.min(Math.floor(ratio * turns.length), turns.length - 1);
      setHoveredTurnIndex(targetIndex);
      onSelectTurn(turns[targetIndex]);
    },
    [isDragging, turns, onSelectTurn],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isDragging) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        setIsDragging(false);
      }
    },
    [isDragging],
  );

  if (turns.length === 0) {
    return null;
  }

  const activeTurn = hoveredTurnIndex != null ? turns[hoveredTurnIndex] : null;

  const getTickDimensions = (index: number) => {
    if (hoveredTurnIndex == null) {
      if (index === activeTurnIndex) {
        return {
          width: '11px',
          height: '1.5px',
          backgroundColor: '#ffffff',
          boxShadow: '0 0 6px rgba(255, 255, 255, 0.5)',
          opacity: 1,
        };
      }
      return {
        width: '11px',
        height: '1.5px',
        backgroundColor: 'rgba(163, 163, 163, 0.35)',
        boxShadow: 'none',
        opacity: 0.7,
      };
    }

    const distance = Math.abs(index - hoveredTurnIndex);

    if (distance === 0) {
      return {
        width: '22px',
        height: '2px',
        backgroundColor: '#ffffff',
        boxShadow: '0 0 8px rgba(255, 255, 255, 0.7)',
        opacity: 1,
      };
    }
    if (distance === 1) {
      return {
        width: '16px',
        height: '1.5px',
        backgroundColor: 'rgba(255, 255, 255, 0.75)',
        boxShadow: 'none',
        opacity: 0.85,
      };
    }
    if (distance === 2) {
      return {
        width: '13px',
        height: '1.5px',
        backgroundColor: 'rgba(255, 255, 255, 0.45)',
        boxShadow: 'none',
        opacity: 0.65,
      };
    }
    return {
      width: '10px',
      height: '1.5px',
      backgroundColor: 'rgba(163, 163, 163, 0.25)',
      boxShadow: 'none',
      opacity: 0.5,
    };
  };

  return (
    <div
      ref={railRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="absolute top-1/2 right-2 z-30 flex -translate-y-1/2 cursor-ns-resize touch-none flex-col items-end select-none"
      aria-label="Conversation turn timeline minimap"
    >
      {/* Ticks rail */}
      <div className="flex flex-col items-end gap-[3px] p-0.5">
        {turns.map((turn, index) => {
          const isHovered = index === hoveredTurnIndex;
          const tickStyle = getTickDimensions(index);

          return (
            <div
              key={turn.id}
              className="relative flex items-center justify-end"
              onMouseEnter={() => {
                handleMouseEnter(index);
              }}
              onMouseLeave={handleMouseLeave}
            >
              <button
                type="button"
                onClick={() => {
                  handleTickClick(turn);
                }}
                className="group relative flex cursor-pointer items-center justify-end px-1 py-[3px] focus:outline-none"
                aria-label={`Turn ${index + 1}`}
              >
                {/* Horizontal tick bar */}
                <span
                  style={tickStyle}
                  className="block rounded-full transition-all duration-150 ease-out"
                />
              </button>

              {/* Hover Popover */}
              {isHovered && activeTurn && (
                <div className="animate-in fade-in-0 zoom-in-95 absolute top-1/2 right-11 z-50 -translate-y-1/2 duration-100">
                  <TurnPreviewPopover turn={activeTurn} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
