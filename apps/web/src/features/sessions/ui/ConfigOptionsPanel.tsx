import { useId, useMemo, useState } from 'react';
import { useSession } from '../model/SessionConfigContext';
import {
  getAgentConfigCategory,
  resolveAgentFeatures,
  type AgentConfigOption,
} from '@agentctl/shared';
import { Select, cn, Spinner } from '@agentctl/ui';

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
  const activeProvider = sessionData?.capabilities.find(
    (provider) => provider.id === sessionData.session.selectedProvider,
  );
  const supportsDynamicConfig = resolveAgentFeatures(activeProvider).configuration.options;

  const visibleOptions = useMemo(() => {
    const filterSet = new Set(filterCategories);
    return configOptions.filter((option) => !filterSet.has(getAgentConfigCategory(option)));
  }, [configOptions, filterCategories]);

  if (visibleOptions.length === 0 || !supportsDynamicConfig) return null;

  const handleUpdate = (id: string, value: string) => {
    setUpdatingId(id);
    void setSessionConfigOption(id, value).finally(() => {
      setUpdatingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="border-border/30 text-text-main border-b pb-3 text-xs font-semibold">
        Agent Configuration
      </h3>
      <div className="divide-border/30 divide-y">
        {visibleOptions.map((option) => (
          <ConfigOptionRow
            key={option.id}
            option={option}
            onChange={(value) => handleUpdate(option.id, value)}
            disabled={!!updatingId}
            isUpdating={updatingId === option.id}
          />
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
  const optionId = useId();
  const labelId = `${optionId}-label`;
  const descriptionId = `${optionId}-description`;
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1 basis-36">
          <div className="flex items-center gap-1.5">
            <span id={labelId} className="text-text-main text-xs font-medium">
              {option.name}
            </span>
            {isUpdating && <Spinner aria-hidden="true" className="icon-inline" />}
          </div>
          {description && (
            <p id={descriptionId} className="text-text-muted mt-1 text-[11px] leading-relaxed">
              {description}
            </p>
          )}
        </div>

        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={description ? descriptionId : undefined}
          className="border-border/40 bg-surface-secondary/40 flex shrink-0 items-center rounded-lg border p-0.5"
        >
          {binaryOptions.map((opt) => {
            const isSelected =
              String(option.currentValue).toLowerCase() === opt.value.toLowerCase();
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'focus-visible:ring-accent cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors select-none focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-50',
                  isSelected
                    ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-xs'
                    : 'text-text-muted hover:text-text-main border-transparent',
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
    <div className="relative space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between">
        <label htmlFor={optionId} className="text-text-main text-xs font-medium">
          {option.name}
        </label>
        {isUpdating && <Spinner aria-hidden="true" className="icon-inline" />}
      </div>

      <Select
        id={optionId}
        value={typeof option.currentValue === 'string' ? option.currentValue : ''}
        onChange={onChange}
        disabled={disabled}
        options={(option.options ?? []).map((opt) => ({
          value: opt.value,
          label: opt.name,
        }))}
        triggerClassName="h-8.5 rounded-lg border-border/40 bg-surface-secondary/50 hover:bg-surface-secondary text-xs font-medium"
      />

      {description && <p className="text-text-muted text-[11px] leading-relaxed">{description}</p>}
    </div>
  );
}
