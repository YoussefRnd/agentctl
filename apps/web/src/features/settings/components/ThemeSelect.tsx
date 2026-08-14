import type { ThemeEntry } from '../../../shared/lib/theme-registry';
import { Select } from '@agentctl/ui';

interface ThemeSelectProps {
  themes: ThemeEntry[];
  value: string;
  onChange: (id: string) => void;
}

export function ThemeSelect({ themes, value, onChange }: ThemeSelectProps) {
  const options = themes.map((t) => ({
    value: t.id,
    label: t.name,
    element: (
      <div className="flex items-center">
        <span className="mr-2 flex shrink-0 gap-0.5">
          <span
            className="h-3 w-3 rounded-full border border-white/10"
            style={{ backgroundColor: t.colors.bg }}
          />
          <span
            className="h-3 w-3 rounded-full border border-white/10"
            style={{ backgroundColor: t.colors.surface }}
          />
          <span
            className="h-3 w-3 rounded-full border border-white/10"
            style={{ backgroundColor: t.colors.text }}
          />
          <span
            className="h-3 w-3 rounded-full border border-white/10"
            style={{ backgroundColor: t.colors.accent }}
          />
        </span>
        <span className="truncate">{t.name}</span>
      </div>
    ),
  }));

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Select theme"
      className="w-52"
    />
  );
}
