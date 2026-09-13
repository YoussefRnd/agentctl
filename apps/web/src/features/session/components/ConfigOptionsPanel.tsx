import { useMemo, useState } from 'react';
import { useSession } from '../../../contexts/SessionContext';
import type { AgentConfigOption } from '@agentctl/shared';
import { Select, cn } from '@agentctl/ui';
import { Loader2 } from 'lucide-react';

const DEFAULT_FILTER_CATEGORIES: string[] = [];

export function ConfigOptionsPanel({
  filterCategories = DEFAULT_FILTER_CATEGORIES,
}: {
  filterCategories?: string[];
}) {
  const { sessionData, setSessionConfigOption } = useSession();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const configOptions = useMemo(
    () => sessionData?.session.sessionConfigOptions ?? [],
    [sessionData],
  );

  const groupedOptions = useMemo(() => {
    const filterSet = new Set(filterCategories);
    const groups: Record<string, AgentConfigOption[]> = {};
    for (const opt of configOptions) {
      const cat = opt.category ?? 'other';
      // Filter out if category OR id is in the list
      if (filterSet.has(cat) || filterSet.has(opt.id)) continue;

      groups[cat] ??= [];
      groups[cat].push(opt);
    }
    return groups;
  }, [configOptions, filterCategories]);

  if (configOptions.length === 0) return null;

  const handleUpdate = (id: string, value: string) => {
    setUpdatingId(id);
    void setSessionConfigOption(id, value).finally(() => {
      setUpdatingId(null);
    });
  };

  const hasMultipleCategories = Object.keys(groupedOptions).length > 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Clean Minimal Header matching ThinkingEffort */}
      <div className="flex items-center justify-between">
        <span className="text-text-main text-xs font-bold tracking-tight">Agent Configuration</span>
      </div>

      <div className="space-y-3">
        {Object.entries(groupedOptions).map(([category, options]) => (
          <div key={category} className="space-y-2">
            {hasMultipleCategories && category !== 'other' && (
              <span className="text-text-muted/50 text-[10px] font-semibold tracking-wider uppercase">
                {category.replace(/_/g, ' ')}
              </span>
            )}
            <div className="space-y-2">
              {options.map((opt) => (
                <ConfigOptionRow
                  key={opt.id}
                  option={opt}
                  onChange={(val) => {
                    handleUpdate(opt.id, val);
                  }}
                  disabled={!!updatingId}
                  isUpdating={updatingId === opt.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ConfigOptionRowProps {
  option: AgentConfigOption;
  onChange: (value: string) => void;
  disabled: boolean;
  isUpdating: boolean;
}

function ConfigOptionRow({ option, onChange, disabled, isUpdating }: ConfigOptionRowProps) {
  const currentOption = (option.options ?? []).find((o) => o.value === option.currentValue);
  const description = currentOption?.description ?? option.description;

  const isCompactBinary =
    option.type === 'boolean' ||
    (option.options != null &&
      option.options.length === 2 &&
      option.options.every((o) => o.name.length <= 10));

  if (isCompactBinary) {
    const binaryOptions =
      option.options && option.options.length === 2
        ? option.options
        : [
            { value: 'false', name: 'Off' },
            { value: 'true', name: 'On' },
          ];

    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-text-main text-xs font-medium tracking-tight">{option.name}</span>
            {isUpdating && <Loader2 size={11} className="text-accent animate-spin" />}
          </div>
          {description && (
            <p className="text-text-muted/60 mt-0.5 text-[11px] leading-snug font-normal">
              {description}
            </p>
          )}
        </div>

        <div className="border-border/40 bg-surface-secondary/40 flex shrink-0 items-center rounded-lg border p-0.5">
          {binaryOptions.map((opt) => {
            const isSelected =
              String(option.currentValue).toLowerCase() === opt.value.toLowerCase();
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all select-none',
                  isSelected
                    ? 'bg-accent/20 text-accent border-accent/40 border font-semibold shadow-xs'
                    : 'text-text-muted hover:text-text-main border border-transparent',
                )}
              >
                {opt.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="group relative space-y-1.5 py-1">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={`config-${option.id}`}
          className="text-text-main text-xs font-medium tracking-tight"
        >
          {option.name}
        </label>
        {isUpdating && <Loader2 size={11} className="text-accent animate-spin" />}
      </div>

      <Select
        id={`config-${option.id}`}
        value={typeof option.currentValue === 'string' ? option.currentValue : ''}
        onChange={onChange}
        disabled={disabled}
        options={(option.options ?? []).map((opt) => ({
          value: opt.value,
          label: opt.name,
        }))}
        triggerClassName="h-8.5 rounded-lg border-border/40 bg-surface-secondary/50 hover:bg-surface-secondary text-xs font-medium"
      />

      {description && (
        <p className="text-text-muted/60 px-0.5 text-[11px] leading-snug font-normal">
          {description}
        </p>
      )}
    </div>
  );
}
