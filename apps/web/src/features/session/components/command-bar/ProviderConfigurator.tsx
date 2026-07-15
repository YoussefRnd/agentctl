import { useState, useEffect } from 'react';
import { Zap, Brain, Settings, ChevronUp } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import { ProviderPicker } from '../ProviderPicker';
import { CommandDropdown } from './CommandDropdown';
import { useSession } from '../../../../contexts/SessionContext';
import type { ProviderDiscovery, SessionWithCapabilities } from '@agentctl/shared';
import { ConfigOptionsPanel } from '../ConfigOptionsPanel';

const PRIMARY_CONFIG_CATEGORIES = ['model', 'mode', 'thought_level'] as const;

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
}) {
  return (
    <div className="relative">
      <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            aria-label="Select AI provider"
            aria-expanded={isOpen}
            className={cn(
              'focus-visible:ring-accent/50 flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
              isOpen
                ? 'bg-accent/20 text-accent border-accent/50'
                : 'hover:bg-text-main/5 text-text-muted hover:text-text-main',
              isLoading && 'pointer-events-none opacity-50',
            )}
          >
            {isLoading ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : activeProvider?.agent?.icon ? (
              <img src={activeProvider.agent.icon} alt="" className="h-3.5 w-3.5 object-contain" />
            ) : (
              <Zap
                className={cn('h-3.5 w-3.5 transition-all duration-200', isOpen && 'fill-accent')}
              />
            )}
            <span className="max-w-[120px] truncate text-[10px] font-bold tracking-widest uppercase">
              {isLoading ? '...' : (selectedModelId ?? selectedProviderLabel)}
            </span>
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
          />
        </PopoverContent>
      </Popover>
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

  // Reset local drag state when option configuration updates externally
  useEffect(() => {
    setLocalIndex(null);
  }, [currentValue, options]);

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
  const displayIndex = localIndex ?? activeIndex;
  const isMaxEffort = displayIndex === options.length - 1;
  const maxVal = options.length > 1 ? options.length - 1 : 1;

  const activeOptionName = options[displayIndex]?.name ?? currentValue;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextIndex = parseInt(e.target.value, 10);
    setLocalIndex(nextIndex);
  };

  const inactiveGridStyle = {
    backgroundImage: `linear-gradient(90deg, #181825 1.5px, transparent 1.5px), linear-gradient(0deg, #181825 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.07))`,
    backgroundSize: '5px 5px, 5px 5px, 100% 100%',
  };

  const activeGridStyle = {
    backgroundImage: `linear-gradient(90deg, #181825 1.5px, transparent 1.5px), linear-gradient(0deg, #181825 1.5px, transparent 1.5px), linear-gradient(90deg, #3b82f6, #cba6f7)`,
    backgroundSize: '5px 5px, 5px 5px, 100% 100%',
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isUpdating}
          className={cn(
            'group flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-200',
            'text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:ring-accent/50 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-40',
            isOpen ? 'bg-accent/20 text-accent border-accent/50' : '',
          )}
        >
          <Brain
            className={cn(
              'h-3.5 w-3.5 transition-all duration-300',
              isMaxEffort ? 'text-accent' : 'text-text-muted',
            )}
          />
          <span className="max-w-[150px] truncate text-[10px] font-bold tracking-widest uppercase">
            {activeOptionName}
          </span>
          <ChevronUp
            className={cn(
              'text-text-muted/50 h-3 w-3 transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="border-border/20 bg-brand-mantle w-[280px] rounded-xl border p-4.5 shadow-2xl"
      >
        <div className="flex flex-col gap-3 font-sans text-xs">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <span className="text-text-muted/60">Effort</span>
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
              <div className="absolute inset-0 rounded-md" style={inactiveGridStyle} />

              {/* Ambient Glow Backdrop - Dynamic soft glow casting colors behind the active grid */}
              <div
                className="to-accent/30 pointer-events-none absolute top-1/2 left-0 h-5 -translate-y-1/2 bg-gradient-to-r from-blue-500/20 blur-md transition-all duration-300"
                style={{
                  width: `${((displayIndex / maxVal) * 100).toString()}%`,
                }}
              />

              {/* Active Track Overlay */}
              <div
                className="absolute top-0 bottom-0 left-0 rounded-md transition-all duration-300"
                style={{
                  width: `${((displayIndex / maxVal) * 100).toString()}%`,
                  ...activeGridStyle,
                }}
              />

              {/* Custom Thumb - Math-aligned to stay perfectly centered within track bounds */}
              <div
                className="absolute top-1/2 h-6 w-3.5 -translate-y-1/2 rounded-[4px] border-white bg-white shadow-lg transition-all duration-300"
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
      value={modeOption?.currentValue ?? agentPersona ?? availableAgentPersonas[0]}
      disabled={isUpdating}
      variant="toolbar"
      onChange={(val) => {
        if (modeOption) {
          void setSessionConfigOption(modeOption.id, val);
        } else {
          void setAgentPersona(val);
        }
      }}
      icon={<Zap className="text-accent h-3.5 w-3.5" />}
      options={
        modeOption
          ? modeOption.options.map((o) => ({ value: o.value, label: o.name }))
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
            'group border-border/10 text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:ring-accent/50 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border transition-all duration-300 focus-visible:ring-2 focus-visible:outline-none',
            isOpen ? 'bg-accent/10 text-accent border-accent/40' : '',
          )}
          title="Advanced Settings"
        >
          <Settings className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-[320px] rounded-xl p-4 shadow-2xl">
        <div className="custom-scrollbar max-h-[400px] overflow-y-auto pr-1">
          <ConfigOptionsPanel filterCategories={[...PRIMARY_CONFIG_CATEGORIES]} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
