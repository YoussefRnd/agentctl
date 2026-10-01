import { useState, useEffect, useMemo, useCallback } from 'react';
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

const EFFORT_ORDER = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

function explicitEffortOptions(options: AgentConfigOption['options']) {
  const levels = options?.filter((item) => item.value !== 'default') ?? [];
  // Some providers advertise levels in descending order. Preserve their order for unknown values.
  if (levels.every((item) => EFFORT_ORDER.includes(item.value as (typeof EFFORT_ORDER)[number]))) {
    return [...levels].sort(
      (a, b) =>
        EFFORT_ORDER.indexOf(a.value as (typeof EFFORT_ORDER)[number]) -
        EFFORT_ORDER.indexOf(b.value as (typeof EFFORT_ORDER)[number]),
    );
  }
  return levels;
}

export function ThinkingEffortControl({
  option,
  onChange,
  disabled = false,
  isUpdating = false,
  debounceMs = 150,
}: {
  option: AgentConfigOption | undefined;
  onChange: (value: string) => void | Promise<void>;
  disabled?: boolean;
  isUpdating?: boolean;
  debounceMs?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localIndex, setLocalIndex] = useState<number | null>(null);
  const options = option?.options;
  const levels = useMemo(() => explicitEffortOptions(options), [options]);
  const defaultOption = options?.find((item) => item.value === 'default');
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

  const sendSelection = useCallback(
    (value: string) => {
      try {
        void Promise.resolve(onChange(value)).catch(() => setLocalIndex(null));
      } catch {
        setLocalIndex(null);
      }
    },
    [onChange],
  );

  // Debounce API calls when sliding quickly to prevent out-of-order race conditions.
  useEffect(() => {
    if (localIndex === null || debounceMs === 0) return;
    const timer = setTimeout(() => {
      const selectedOption = levels[localIndex];
      if (selectedOption && selectedOption.value !== currentValue) {
        sendSelection(selectedOption.value);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [localIndex, levels, currentValue, sendSelection, debounceMs]);

  if (!option || !options?.length) return null;

  const currentIndex = levels.findIndex((item) => item.value === currentValue);
  const isDefaultSelected = localIndex === null && currentValue === defaultOption?.value;
  const displayIndex = localIndex ?? Math.max(0, currentIndex);
  const maxVal = Math.max(0, levels.length - 1);
  const progress = maxVal > 0 ? displayIndex / maxVal : 0;

  const selectLevel = (value: string) => {
    const nextIdx = Number.parseInt(value, 10);
    if (!Number.isNaN(nextIdx) && nextIdx >= 0 && nextIdx <= maxVal) {
      setLocalIndex(nextIdx);
      if (debounceMs === 0) sendSelection(levels[nextIdx].value);
    }
  };

  const activeOptionName =
    localIndex !== null
      ? (levels[localIndex]?.name ?? levels[0]?.name)
      : (options.find((item) => item.value === currentValue)?.name ?? options[0].name);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || isUpdating}
          aria-label={`Thinking effort: ${activeOptionName}`}
          className={cn(
            'motion-disclosure group flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
            'border-border/25 bg-surface-secondary/35 text-text-muted hover:border-border/50 hover:bg-surface-secondary/70 hover:text-text-main focus-visible:ring-accent/50 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-40',
            isOpen ? 'bg-accent/20 text-accent border-accent/50' : '',
          )}
        >
          <span className="grid text-center text-xs font-medium">
            {/* Reserve the widest label so changing effort does not move the popover anchor. */}
            {options.map((item) => (
              <span
                key={item.value}
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 whitespace-nowrap"
              >
                {item.name}
              </span>
            ))}
            <span className="col-start-1 row-start-1 whitespace-nowrap">{activeOptionName}</span>
          </span>
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
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-main shrink-0 text-xs font-bold tracking-tight">
              Thinking Effort
            </span>
            <div className="flex min-w-0 items-center gap-2 text-[11px]">
              {!isDefaultSelected && (
                <span className="text-accent truncate font-mono font-bold">{activeOptionName}</span>
              )}
              {defaultOption && (
                <button
                  type="button"
                  disabled={disabled || isUpdating}
                  aria-label="Use provider default"
                  aria-pressed={isDefaultSelected}
                  title="Use provider default"
                  onClick={() => {
                    setLocalIndex(null);
                    if (currentValue !== defaultOption.value) sendSelection(defaultOption.value);
                  }}
                  className={cn(
                    'focus-visible:ring-accent/50 shrink-0 rounded-full border px-2 py-0.5 font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40',
                    isDefaultSelected
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border/30 text-text-muted hover:border-border/50 hover:text-text-main',
                  )}
                >
                  Default
                </button>
              )}
            </div>
          </div>

          {levels.length > 1 && (
            <>
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
                      width: `${(isDefaultSelected ? 0 : progress * 100).toString()}%`,
                    }}
                  />

                  {/* Active Track Overlay */}
                  <div
                    className="absolute top-0 bottom-0 left-0 rounded-md transition-colors duration-300"
                    style={{
                      width: `${(isDefaultSelected ? 0 : progress * 100).toString()}%`,
                      ...ACTIVE_GRID_STYLE,
                    }}
                  />

                  {/* Custom Thumb - Math-aligned to stay perfectly centered within track bounds */}
                  {!isDefaultSelected && levels.length > 0 && (
                    <div
                      data-testid="thinking-effort-thumb"
                      className="absolute top-1/2 h-6 w-3.5 -translate-y-1/2 rounded-[4px] border-white bg-white shadow-lg transition-transform duration-300"
                      style={{
                        left: `calc(${(progress * 100).toString()}% - ${(progress * 14).toString()}px)`,
                      }}
                    />
                  )}

                  {/* Invisible Range Input - Enabled during updates for smooth slide gesture */}
                  <input
                    type="range"
                    disabled={disabled || levels.length < 2}
                    min="0"
                    max={maxVal}
                    step="1"
                    value={displayIndex}
                    aria-label="Thinking effort level"
                    aria-valuetext={
                      isDefaultSelected ? 'Provider default' : levels[displayIndex]?.name
                    }
                    onChange={(event) => selectLevel(event.currentTarget.value)}
                    onClick={(event) => {
                      // A range already at zero does not fire change when Default switches to Low.
                      if (isDefaultSelected) selectLevel(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      if (
                        isDefaultSelected &&
                        ['Home', 'ArrowRight', 'ArrowUp'].includes(event.key)
                      ) {
                        event.preventDefault();
                        setLocalIndex(0);
                        if (debounceMs === 0) sendSelection(levels[0].value);
                      }
                    }}
                    className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
            </>
          )}
          {levels.length === 1 && (
            <button
              type="button"
              disabled={disabled || isUpdating}
              aria-pressed={currentValue === levels[0].value}
              onClick={() => sendSelection(levels[0].value)}
              className="border-border/40 text-text-muted hover:text-text-main rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
            >
              {levels[0].name}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
