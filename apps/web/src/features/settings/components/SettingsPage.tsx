import { useSearchParams } from 'react-router-dom';
import { ProviderCard } from './ProviderCard';
import { useProviders } from '../../../hooks/useProviders';
import { useTheme } from '../../../contexts/ThemeProvider';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button, Switch, Select, Card } from '@agentctl/ui';
import { useSettings } from '../../../hooks/useSettings';
import { McpSettings } from './McpSettings';
import { getLightThemes, getDarkThemes } from '../../../data/theme-registry';
import { ThemeSelect } from './ThemeSelect';

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'providers';
  const { themeMode, setThemeMode, lightTheme, darkTheme, setLightTheme, setDarkTheme } =
    useTheme();
  const { settings, updateSettings } = useSettings();

  const {
    providers,
    activate,
    syncProviders,
    isLoadingProviders,
    isSyncing,
    toggleProvider,
    updateProviderConfig,
    isUpdatingConfig,
  } = useProviders(null);

  if (activeTab === 'mcp') {
    return <McpSettings />;
  }

  if (activeTab === 'general') {
    const enabledProviders = providers.filter((p) => p.enabled);

    return (
      <div className="relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-6">
        <div className="relative z-10 mb-8">
          <h1 className="text-text-main text-2xl font-black tracking-widest uppercase">
            SETTINGS::GENERAL
          </h1>
          <p className="text-text-muted mt-1 text-[11px] font-bold tracking-tight uppercase opacity-60">
            CONFIGURE_GENERAL_APPLICATION_PREFERENCES
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          {/* Theme mode selector */}
          <Card className="hover:border-accent/20 flex flex-row items-center justify-between px-5 py-4">
            <div className="mr-4 min-w-0 flex-1">
              <p className="text-text-main text-[13px] font-bold tracking-tight">Theme mode</p>
              <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">
                {themeMode === 'system'
                  ? 'Automatically switches between light and dark themes based on your system preference'
                  : themeMode === 'light'
                    ? 'Always use the selected light theme'
                    : 'Always use the selected dark theme'}
              </p>
            </div>
            <div className="border-border/30 bg-surface/40 flex shrink-0 gap-1 rounded-xl border p-1">
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setThemeMode(mode);
                  }}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-all ${
                    themeMode === mode
                      ? 'bg-accent text-brand-crust shadow-sm'
                      : 'text-text-muted hover:text-text-main hover:bg-surface/60'
                  }`}
                >
                  {mode === 'system' ? 'Follow system' : mode}
                </button>
              ))}
            </div>
          </Card>

          {/* Light theme dropdown */}
          {(themeMode === 'light' || themeMode === 'system') && (
            <Card className="hover:border-accent/20 flex flex-row items-center justify-between px-5 py-4">
              <div>
                <p className="text-text-main text-[13px] font-bold tracking-tight">Light theme</p>
                <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">
                  Theme used for light appearance
                </p>
              </div>
              <ThemeSelect themes={getLightThemes()} value={lightTheme} onChange={setLightTheme} />
            </Card>
          )}

          {/* Dark theme dropdown */}
          {(themeMode === 'dark' || themeMode === 'system') && (
            <Card className="hover:border-accent/20 flex flex-row items-center justify-between px-5 py-4">
              <div>
                <p className="text-text-main text-[13px] font-bold tracking-tight">Dark theme</p>
                <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">
                  Theme used for dark appearance
                </p>
              </div>
              <ThemeSelect themes={getDarkThemes()} value={darkTheme} onChange={setDarkTheme} />
            </Card>
          )}

          <Card className="hover:border-accent/20 flex flex-row items-center justify-between px-5 py-4">
            <div>
              <p className="text-text-main text-[13px] font-bold tracking-tight">
                Default agent provider
              </p>
              <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">
                The fallback agent provider to use when creating new sessions
              </p>
            </div>
            <div className="w-52">
              <Select
                value={settings?.defaultProviderId ?? ''}
                onChange={(value) => {
                  void updateSettings({ defaultProviderId: value || null });
                }}
                disabled={isLoadingProviders}
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
          </Card>

          <Card className="hover:border-accent/20 flex flex-row items-center justify-between px-5 py-4">
            <div>
              <p className="text-text-main text-[13px] font-bold tracking-tight">Show thinking</p>
              <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">
                Automatically expand thinking content while the agent is reasoning
              </p>
            </div>
            <Switch
              checked={settings?.showThinking ?? false}
              onCheckedChange={(checked) => {
                void updateSettings({ showThinking: checked });
              }}
              size="md"
            />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-6">
      <div className="relative z-10 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-text-main text-2xl font-black tracking-widest uppercase">
            SETTINGS::PROVIDERS
          </h1>
          <p className="text-text-muted mt-1 text-[11px] font-bold tracking-tight uppercase opacity-60">
            CONFIGURE_ACTIVE_AI_PROVIDER_PIPELINES
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            syncProviders();
          }}
          disabled={isSyncing}
          className="group flex h-9 items-center gap-2 rounded-xl px-4 text-[11px] font-bold tracking-widest uppercase"
        >
          {isSyncing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3 transition-transform duration-500 group-hover:rotate-180" />
          )}
          SYNC_ALL
        </Button>
      </div>

      <div className="relative z-10 space-y-3">
        {isLoadingProviders ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl border border-white/5 bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onActivate={(id) => {
                  activate(id);
                }}
                onToggle={(id, enabled) => {
                  toggleProvider({ providerId: id, enabled });
                }}
                onResync={() => {
                  syncProviders();
                }}
                onUpdateConfig={(id, updates) => {
                  updateProviderConfig({ providerId: id, ...updates });
                }}
                isUpdatingConfig={isUpdatingConfig}
              />
            ))}
            {providers.length === 0 && (
              <Card className="border-dashed p-8 text-center">
                <div className="text-text-muted text-[10px] font-bold tracking-widest uppercase opacity-30">
                  NO_PROVIDERS_DETECTED
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
