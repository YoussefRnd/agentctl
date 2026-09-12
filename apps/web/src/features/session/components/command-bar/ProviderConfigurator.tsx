import { useState, useEffect } from 'react';
import { Settings, ChevronUp, AlertCircle } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import { AgentIcon } from '@/shared';
import { ProviderPicker } from '../ProviderPicker';
import { CommandDropdown } from './CommandDropdown';
import { useSession } from '../../../../contexts/SessionContext';
import type { ProviderDiscovery, SessionWithCapabilities } from '@agentctl/shared';
import { ConfigOptionsPanel } from '../ConfigOptionsPanel';

const PRIMARY_CONFIG_CATEGORIES = ['model', 'mode', 'thought_level'] as const;

const INACTIVE_GRID_STYLE = {
  backgroundImage: `linear-gradient(90deg, #181825 1.5px, transparent 1.5px), linear-gradient(0deg, #181825 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.07))`,
  backgroundSize: '5px 5px, 5px 5px, 100% 100%',
};

const ACTIVE_GRID_STYLE = {
  backgroundImage: `linear-gradient(90deg, #181825 1.5px, transparent 1.5px), linear-gradient(0deg, #181825 1.5px, transparent 1.5px), linear-gradient(90deg, #3b82f6, #cba6f7)`,
  backgroundSize: '5px 5px, 5px 5px, 100% 100%',
};

export function ProviderPickerTrigger({
  isLoading,
  isOpen,
  onOpenChange,
  activeProvider,
  providers,
  selectedModelId,
  selectedProviderLabel,
  resolvedId,
  handleProviderSelect,
  sessionId,
  onOpenAuthModal,
}: {
  isLoading: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeProvider: ProviderDiscovery | undefined;
  providers: ProviderDiscovery[];
  selectedModelId: string | null | undefined;
  selectedProviderLabel: string;
  resolvedId: string | null;
  handleProviderSelect: (id: string, modelId?: string) => void;
  sessionId: string | null;
  onOpenAuthModal?: () => void;
}) {
  const needsAuth = activeProvider?.authState === 'needs_auth';

  const modelOption = activeProvider?.configOptions?.find(
    (opt) => opt.id === 'model' || opt.id === 'selectedModel',
  );
  const currentModelValue = selectedModelId ?? modelOption?.currentValue;
  const matchingModel = modelOption?.options?.find((o) => o.value === currentModelValue);
  const modelLabel =
    matchingModel?.name ?? (typeof currentModelValue === 'string' ? currentModelValue : null);

  const providerLabel = activeProvider?.label ?? selectedProviderLabel;
  const badgeLabel = isLoading
    ? 'Loading...'
    : modelLabel && modelLabel !== providerLabel
      ? `${providerLabel} · ${modelLabel}`
      : providerLabel;

  return (
    <div className="relative">
      {needsAuth ? (
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            if (onOpenAuthModal) {
              onOpenAuthModal();
            } else {
              onOpenChange(!isOpen);
            }
          }}
          className={cn(
            'flex h-8 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 text-xs font-medium text-amber-300 transition-colors duration-200 hover:bg-amber-500/25 focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
            isLoading && 'pointer-events-none opacity-50',
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="max-w-[200px] truncate text-xs font-medium">
            {providerLabel} · Needs API key
          </span>
        </button>
      ) : (
        <Popover open={isOpen} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isLoading}
              aria-label="Select AI provider"
              aria-expanded={isOpen}
              className={cn(
                'focus-visible:ring-accent/50 flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
                isOpen
                  ? 'bg-accent/20 text-accent border-accent/50'
                  : 'border-border/40 bg-surface-secondary/50 text-text-main hover:bg-surface-secondary hover:border-border/60',
                isLoading && 'pointer-events-none opacity-50',
              )}
            >
              {isLoading ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              ) : activeProvider?.agent?.icon ? (
                <img
                  src={activeProvider.agent.icon}
                  alt=""
                  className="h-3.5 w-3.5 object-contain"
                />
              ) : (
                <AgentIcon
                  className={cn(
                    'h-3.5 w-3.5 transition-colors duration-200',
                    isOpen && 'text-accent',
                  )}
                />
              )}
              <span className="max-w-[220px] truncate text-xs font-medium">{badgeLabel}</span>
              <ChevronUp
                className={cn('h-3 w-3 transition-transform duration-200', isOpen && 'rotate-180')}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            avoidCollisions={false}
            className="border-border w-[480px] overflow-hidden rounded-md p-0"
          >
            <ProviderPicker
              key={isOpen ? 'open' : 'closed'}
              sessionId={sessionId}
              isOpen={isOpen}
              onClose={() => {
                onOpenChange(false);
              }}
              providers={providers}
              selectedId={resolvedId}
              selectedModelId={selectedModelId ?? null}
              onSelect={handleProviderSelect}
              onOpenAuthModal={onOpenAuthModal}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function ThinkingEffortSelector({
  isLoading,
  sessionData,
  handleSetConfigOption,
  isUpdating,
}: {
  isLoading: boolean;
  sessionData: SessionWithCapabilities | null;
  handleSetConfigOption: (id: string, value: string) => Promise<void>;
  isUpdating: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localIndex, setLocalIndex] = useState<number | null>(null);

  const thinkingOption = sessionData?.session.sessionConfigOptions.find(
    (opt) => opt.category === 'thought_level',
  );
  const options = thinkingOption?.options;
  const currentValue = thinkingOption?.currentValue;

  const [prevCurrentValue, setPrevCurrentValue] = useState(currentValue);
  if (prevCurrentValue !== currentValue) {
    setPrevCurrentValue(currentValue);
    setLocalIndex(null);
  }

  // Debounce API calls when sliding quickly to prevent out-of-order race conditions
  useEffect(() => {
    if (localIndex === null) return;
    const timer = setTimeout(() => {
      const selectedOption = options?.[localIndex];
      if (selectedOption && selectedOption.value !== currentValue && thinkingOption) {
        void handleSetConfigOption(thinkingOption.id, selectedOption.value);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [localIndex, options, thinkingOption, currentValue, handleSetConfigOption]);

  if (isLoading || !sessionData?.session || !thinkingOption || !options) return null;

  const currentIndex = options.findIndex((opt) => opt.value === currentValue);
  const activeIndex = currentIndex !== -1 ? currentIndex : 0;
  const displayIndex = localIndex !== null ? localIndex : activeIndex;

  const maxVal = Math.max(0, options.length - 1);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextIdx = Number.parseInt(e.target.value, 10);
    if (!Number.isNaN(nextIdx) && nextIdx >= 0 && nextIdx <= maxVal) {
      setLocalIndex(nextIdx);
    }
  };

  const activeOptionName = options[displayIndex]?.name ?? currentValue;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isUpdating}
          className={cn(
            'group flex h-8 items-center gap-1.5 rounded-full border border-transparent px-2.5 transition-colors duration-200',
            'text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:ring-accent/50 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-40',
            isOpen ? 'bg-accent/20 text-accent border-accent/50' : '',
          )}
        >
          <span className="font-mono text-xs font-semibold">{activeOptionName}</span>
          <ChevronUp
            className={cn(
              'h-3.5 w-3.5 opacity-40 transition-transform duration-200',
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
                  width: `${((displayIndex / maxVal) * 100).toString()}%`,
                }}
              />

              {/* Active Track Overlay */}
              <div
                className="absolute top-0 bottom-0 left-0 rounded-md transition-colors duration-300"
                style={{
                  width: `${((displayIndex / maxVal) * 100).toString()}%`,
                  ...ACTIVE_GRID_STYLE,
                }}
              />

              {/* Custom Thumb - Math-aligned to stay perfectly centered within track bounds */}
              <div
                className="absolute top-1/2 h-6 w-3.5 -translate-y-1/2 rounded-[4px] border-white bg-white shadow-lg transition-transform duration-300"
                style={{
                  left: `calc(${((displayIndex / maxVal) * 100).toString()}% - ${((displayIndex / maxVal) * 14).toString()}px)`,
                }}
              />

              {/* Invisible Range Input - Enabled during updates for smooth slide gesture */}
              <input
                type="range"
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

export function AgentPersonaSelector({
  isLoading,
  sessionData,
  isUpdating,
  setAgentPersona,
}: {
  isLoading: boolean;
  sessionData: SessionWithCapabilities | null;
  isUpdating: boolean;
  setAgentPersona: (persona: string) => Promise<void>;
}) {
  const { setSessionConfigOption } = useSession();
  if (isLoading || !sessionData?.session) return null;

  const { agentPersona, availableAgentPersonas } = sessionData.session;

  const modeOption = sessionData.session.sessionConfigOptions.find(
    (opt) => opt.category === 'mode',
  );

  if (!modeOption && availableAgentPersonas.length === 0) return null;

  return (
    <CommandDropdown
      value={
        typeof modeOption?.currentValue === 'string'
          ? modeOption.currentValue
          : (agentPersona ?? availableAgentPersonas[0])
      }
      disabled={isUpdating}
      variant="toolbar"
      onChange={(val) => {
        if (modeOption) {
          void setSessionConfigOption(modeOption.id, val);
        } else {
          void setAgentPersona(val);
        }
      }}
      options={
        modeOption
          ? (modeOption.options ?? []).map((o) => ({ value: o.value, label: o.name }))
          : availableAgentPersonas.map((p) => ({
              value: p,
              label: p.charAt(0).toUpperCase() + p.slice(1),
            }))
      }
      side="top"
    />
  );
}

export function AdvancedSettingsPopover({ isLoading }: { isLoading: boolean }) {
  const { sessionData } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (isLoading || !sessionData?.session) return null;

  const hasAdditionalConfig = sessionData.session.sessionConfigOptions.some((opt) => {
    const cat = opt.category ?? 'other';
    return (
      !(PRIMARY_CONFIG_CATEGORIES as readonly string[]).includes(cat) &&
      !(PRIMARY_CONFIG_CATEGORIES as readonly string[]).includes(opt.id)
    );
  });

  if (!hasAdditionalConfig) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isLoading}
          className={cn(
            'group border-border/10 text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:ring-accent/50 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border transition-colors duration-300 focus-visible:ring-2 focus-visible:outline-none',
            isOpen ? 'bg-accent/10 text-accent border-accent/40' : '',
          )}
          title="Advanced Settings"
        >
          <Settings className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="border-border/50 bg-brand-mantle/95 w-[290px] rounded-xl border p-4 shadow-2xl backdrop-blur-xl"
      >
        <div className="custom-scrollbar max-h-[400px] overflow-y-auto pr-0.5">
          <ConfigOptionsPanel filterCategories={[...PRIMARY_CONFIG_CATEGORIES]} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
