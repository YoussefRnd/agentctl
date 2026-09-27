import { useState, useEffect } from 'react';
import { ChevronUp } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import type { AgentConfigOption } from '@agentctl/shared';

const INACTIVE_GRID_STYLE = {
  backgroundImage: `linear-gradient(90deg, #181825 1.5px, transparent 1.5px), linear-gradient(0deg, #181825 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.07))`,
  backgroundSize: '5px 5px, 5px 5px, 100% 100%',
};

const ACTIVE_GRID_STYLE = {
  backgroundImage: `linear-gradient(90deg, #181825 1.5px, transparent 1.5px), linear-gradient(0deg, #181825 1.5px, transparent 1.5px), linear-gradient(90deg, #3b82f6, #cba6f7)`,
  backgroundSize: '5px 5px, 5px 5px, 100% 100%',
};

export function ThinkingEffortControl({
  option,
  onChange,
  disabled = false,
  isUpdating = false,
  debounceMs = 150,
}: {
  option: AgentConfigOption | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  isUpdating?: boolean;
  debounceMs?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localIndex, setLocalIndex] = useState<number | null>(null);
  const options = option?.options;
  const currentValue = option?.currentValue;
  const selectionKey = JSON.stringify([
    option?.id,
    currentValue,
    options?.map((item) => item.value),
  ]);
  const [previousSelectionKey, setPreviousSelectionKey] = useState(selectionKey);
  if (previousSelectionKey !== selectionKey) {
    setPreviousSelectionKey(selectionKey);
    setLocalIndex(null);
  }

  // Debounce API calls when sliding quickly to prevent out-of-order race conditions
  useEffect(() => {
    if (localIndex === null || debounceMs === 0) return;
    const timer = setTimeout(() => {
      const selectedOption = options?.[localIndex];
      if (selectedOption && selectedOption.value !== currentValue) onChange(selectedOption.value);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [localIndex, options, currentValue, onChange, debounceMs]);

  if (!option || !options?.length) return null;

  const currentIndex = options.findIndex((opt) => opt.value === currentValue);
  const activeIndex = currentIndex !== -1 ? currentIndex : 0;
  const displayIndex = localIndex !== null ? localIndex : activeIndex;

  const maxVal = Math.max(0, options.length - 1);
  const progress = maxVal > 0 ? displayIndex / maxVal : 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextIdx = Number.parseInt(e.target.value, 10);
    if (!Number.isNaN(nextIdx) && nextIdx >= 0 && nextIdx <= maxVal) {
      setLocalIndex(nextIdx);
      if (debounceMs === 0) onChange(options[nextIdx].value);
    }
  };

  const activeOptionName = options[displayIndex]?.name ?? options[0].name;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || isUpdating}
          className={cn(
            'motion-disclosure group flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
            'border-border/25 bg-surface-secondary/35 text-text-muted hover:border-border/50 hover:bg-surface-secondary/70 hover:text-text-main focus-visible:ring-accent/50 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-40',
            isOpen ? 'bg-accent/20 text-accent border-accent/50' : '',
          )}
        >
          <span className="text-xs font-medium">{activeOptionName}</span>
          <ChevronUp
            className={cn(
              'text-text-muted/60 h-3.5 w-3.5 transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="border-border/50 bg-brand-mantle/95 flex w-[280px] flex-col gap-4 rounded-xl border p-4 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-text-main text-xs font-bold tracking-tight">Thinking Effort</span>
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold">
              <span className="text-text-muted">Level:</span>
              <span className="text-accent">{activeOptionName}</span>
            </div>
          </div>

          {/* Subheader labels */}
          <div className="text-text-muted/50 flex justify-between text-[11px] font-semibold">
            <span>Faster</span>
            <span>Smarter</span>
          </div>

          {/* Slider Container */}
          <div key={options.length} className="relative mt-0.5 px-0.5">
            {/* Custom Track */}
            <div className="relative flex h-5 w-full items-center">
              {/* Background Inactive Track */}
              <div className="absolute inset-0 rounded-md" style={INACTIVE_GRID_STYLE} />

              {/* Ambient Glow Backdrop - Dynamic soft glow casting colors behind the active grid */}
              <div
                className="to-accent/30 pointer-events-none absolute top-1/2 left-0 h-5 -translate-y-1/2 bg-gradient-to-r from-blue-500/20 blur-md transition-colors duration-300"
                style={{
                  width: `${(progress * 100).toString()}%`,
                }}
              />

              {/* Active Track Overlay */}
              <div
                className="absolute top-0 bottom-0 left-0 rounded-md transition-colors duration-300"
                style={{
                  width: `${(progress * 100).toString()}%`,
                  ...ACTIVE_GRID_STYLE,
                }}
              />

              {/* Custom Thumb - Math-aligned to stay perfectly centered within track bounds */}
              <div
                className="absolute top-1/2 h-6 w-3.5 -translate-y-1/2 rounded-[4px] border-white bg-white shadow-lg transition-transform duration-300"
                style={{
                  left: `calc(${(progress * 100).toString()}% - ${(progress * 14).toString()}px)`,
                }}
              />

              {/* Invisible Range Input - Enabled during updates for smooth slide gesture */}
              <input
                type="range"
                disabled={disabled || maxVal === 0}
                min="0"
                max={maxVal}
                step="1"
                value={displayIndex}
                aria-label="Thinking effort level"
                onChange={handleSliderChange}
                className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
