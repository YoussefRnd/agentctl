import { useTheme } from '../../../contexts/ThemeProvider';
import { useProviders } from '../../../hooks/useProviders';
import { useSettings } from '../../../hooks/useSettings';
import { Card, Select, Switch } from '@agentctl/ui';
import { Sun, Moon, Monitor } from 'lucide-react';
import { getLightThemes, getDarkThemes } from '../../../shared/lib/theme-registry';
import { ThemeSelect } from './ThemeSelect';
import { FontSettingsPanel } from './FontSettingsPanel';
import { UpdateSettingsCard } from './UpdateSettingsCard';
import type { FontConfig } from '@agentctl/shared';

export function GeneralSettingsView() {
  const { themeMode, setThemeMode, lightTheme, darkTheme, setLightTheme, setDarkTheme } =
    useTheme();
  const { settings, updateSettings } = useSettings();
  const providersApi = useProviders(null);

  const enabledProviders = providersApi.providers.filter((p) => p.installState !== 'not_installed');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-text-main text-lg font-bold">General Settings</h2>
        <p className="text-text-muted mt-0.5 text-xs">
          Manage your application appearance, agent behavior, and typography.
        </p>
      </div>

      {/* Appearance Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Appearance
        </h3>
        <Card className="divide-border/30 divide-y overflow-hidden px-5 py-2">
          {/* Theme Mode Segmented Control */}
          <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Theme Mode</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                {themeMode === 'system'
                  ? 'Automatically match your operating system theme'
                  : themeMode === 'light'
                    ? 'Always use light theme appearance'
                    : 'Always use dark theme appearance'}
              </p>
            </div>
            <div className="border-border/40 bg-surface/40 flex shrink-0 gap-1 rounded-xl border p-1">
              {[
                { mode: 'system' as const, label: 'System', icon: Monitor },
                { mode: 'dark' as const, label: 'Dark', icon: Moon },
                { mode: 'light' as const, label: 'Light', icon: Sun },
              ].map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setThemeMode(mode)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    themeMode === mode
                      ? 'bg-accent text-brand-crust shadow-sm'
                      : 'text-text-muted hover:text-text-main hover:bg-surface/60'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Light Theme Select */}
          {(themeMode === 'light' || themeMode === 'system') && (
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-text-main text-[13px] font-semibold">Light Theme</p>
                <p className="text-text-muted mt-0.5 text-[11px]">
                  Color scheme used for light mode
                </p>
              </div>
              <ThemeSelect themes={getLightThemes()} value={lightTheme} onChange={setLightTheme} />
            </div>
          )}

          {/* Dark Theme Select */}
          {(themeMode === 'dark' || themeMode === 'system') && (
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-text-main text-[13px] font-semibold">Dark Theme</p>
                <p className="text-text-muted mt-0.5 text-[11px]">
                  Color scheme used for dark mode
                </p>
              </div>
              <ThemeSelect themes={getDarkThemes()} value={darkTheme} onChange={setDarkTheme} />
            </div>
          )}
        </Card>
      </div>

      {/* Agent Defaults Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Agent Defaults
        </h3>
        <Card className="divide-border/30 divide-y overflow-hidden px-5 py-2">
          {/* Default Provider */}
          <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Default Agent Provider</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Fallback provider pre-selected when creating new sessions
              </p>
            </div>
            <div className="w-52">
              <Select
                value={settings?.defaultProviderId ?? ''}
                onChange={(value) => {
                  void updateSettings({ defaultProviderId: value || null });
                }}
                disabled={providersApi.isLoadingProviders}
                options={[
                  { value: '', label: 'Select default provider...' },
                  ...enabledProviders.map((p) => ({
                    value: p.id,
                    label: p.label,
                  })),
                ]}
                placeholder="Select default provider..."
              />
            </div>
          </div>

          {/* Show Thinking */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Auto-Expand Thinking</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Automatically show reasoning thought streams while the agent is generating
              </p>
            </div>
            <Switch
              checked={settings?.showThinking ?? false}
              onCheckedChange={(checked) => {
                void updateSettings({ showThinking: checked });
              }}
              size="md"
            />
          </div>
        </Card>
      </div>

      {/* Typography Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Typography
        </h3>
        <FontSettingsPanel
          fontConfig={settings?.fontConfig}
          onUpdate={(fontPartial) => {
            void updateSettings({
              fontConfig: fontPartial as FontConfig,
            });
          }}
        />
      </div>

      {/* Updates Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Software Updates
        </h3>
        <UpdateSettingsCard />
      </div>
    </div>
  );
}
