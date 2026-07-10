import { useMemo, useState } from 'react';
import { useSession } from '../../../contexts/SessionContext';
import type { ACPConfigOption } from '@agentctl/shared';
import { Select } from '@agentctl/ui';
import { Loader2, Info } from 'lucide-react';

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
    const groups: Record<string, ACPConfigOption[]> = {};
    configOptions.forEach((opt) => {
      const cat = opt.category ?? 'other';
      // Filter out if category OR id is in the list
      if (filterCategories.includes(cat) || filterCategories.includes(opt.id)) return;

      groups[cat] ??= [];
      groups[cat].push(opt);
    });
    return groups;
  }, [configOptions, filterCategories]);

  if (configOptions.length === 0) return null;

  const handleUpdate = (id: string, value: string) => {
    setUpdatingId(id);
    void setSessionConfigOption(id, value).finally(() => {
      setUpdatingId(null);
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-top-2 mb-6 duration-500">
      <div className="mb-3">
        <h3 className="text-text-muted/45 text-[9px] font-bold tracking-[0.2em] uppercase">
          ::AGENT_CONFIGURATION
        </h3>
      </div>

      <div className="space-y-4">
        {Object.entries(groupedOptions).map(([category, options]) => (
          <div key={category} className="space-y-3">
            {category !== 'other' && (
              <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                ::{category.replace('_', ' ')}
              </span>
            )}
            <div className="grid gap-3">
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
  option: ACPConfigOption;
  onChange: (value: string) => void;
  disabled: boolean;
  isUpdating: boolean;
}

function ConfigOptionRow({ option, onChange, disabled, isUpdating }: ConfigOptionRowProps) {
  const currentOption = option.options.find((o) => o.value === option.currentValue);

  return (
    <div className="group relative">
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-text-muted/80 group-hover:text-text-main text-[10px] font-bold transition-colors">
          {option.name}
        </label>
        {isUpdating && <Loader2 size={10} className="text-accent animate-spin" />}
      </div>

      <Select
        value={option.currentValue}
        onChange={onChange}
        disabled={disabled}
        options={option.options.map((opt) => ({
          value: opt.value,
          label: opt.name,
        }))}
        triggerClassName="h-8 rounded-lg"
      />

      {(option.description != null || currentOption?.description != null) && (
        <div className="mt-1.5 flex items-start gap-1.5 px-1 opacity-60 transition-opacity hover:opacity-100">
          <Info size={10} className="text-accent/60 mt-0.5 flex-shrink-0" />
          <p className="text-text-muted text-[9px] leading-relaxed font-medium">
            {currentOption?.description ?? option.description}
          </p>
        </div>
      )}
    </div>
  );
}
