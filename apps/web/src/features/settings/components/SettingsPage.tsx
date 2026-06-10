import { useSearchParams } from 'react-router-dom';
import { ProviderCard } from './ProviderCard';
import { useProviders } from '../../../hooks/useProviders';
import { useTheme } from '../../../contexts/ThemeProvider';
import { Loader2, RefreshCw, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button, GlassPanel } from '@agentctl/ui';

interface ThemeOption {
  id: string;
  name: string;
  description: string;
  type: 'dark' | 'light';
  colors: {
    bg: string;
    surface: string;
    text: string;
    accent: string;
  };
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'mocha',
    name: 'Mocha (Dark)',
    description: 'Traditional cozy Catppuccin dark theme',
    type: 'dark',
    colors: { bg: '#11111b', surface: '#1e1e2e', text: '#cdd6f4', accent: '#cba6f7' },
  },
  {
    id: 'macchiato',
    name: 'Macchiato',
    description: 'Warm medium-dark Catppuccin theme',
    type: 'dark',
    colors: { bg: '#181926', surface: '#24273a', text: '#cad3f5', accent: '#8aadf4' },
  },
  {
    id: 'frappe',
    name: 'Frappé',
    description: 'Balanced medium-dark Catppuccin theme',
    type: 'dark',
    colors: { bg: '#232634', surface: '#303446', text: '#c6d0f5', accent: '#ca9ee6' },
  },
  {
    id: 'latte',
    name: 'Latte (Light)',
    description: 'Crisp and clean light Catppuccin theme',
    type: 'light',
    colors: { bg: '#dce0e8', surface: '#eff1f5', text: '#4c4f69', accent: '#8839ef' },
  },
];

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'providers';
  const { theme: currentTheme, setTheme } = useTheme();

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

  if (activeTab === 'theme') {
    return (
      <div className="relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-6">
        <div className="relative z-10 mb-8">
          <h1 className="text-2xl font-black tracking-widest text-text-main uppercase">
            SETTINGS::THEME_UNIFICATION
          </h1>
          <p className="text-text-muted mt-1 text-[11px] font-bold tracking-tight uppercase opacity-60">
            CHOOSE_VISUAL_AESTHETICS_AND_THEME_VARIATIONS
          </p>
        </div>

        <div className="relative z-10 grid gap-4 sm:grid-cols-2">
          {THEME_OPTIONS.map((themeOpt) => {
            const isSelected = currentTheme === themeOpt.id || (currentTheme === 'oled-glass' && themeOpt.id === 'mocha');
            return (
              <button
                key={themeOpt.id}
                onClick={() => {
                  setTheme(themeOpt.id);
                  toast.success(`Theme updated to ${themeOpt.name}`);
                }}
                className="text-left w-full focus:outline-none"
              >
                <GlassPanel
                  className={`h-full p-5 rounded-2xl border transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] cursor-pointer ${
                    isSelected
                      ? 'border-accent/40 bg-accent/5 shadow-[0_8px_32px_rgba(203,166,247,0.15)]'
                      : 'border-border/50 bg-surface/30 hover:border-accent/20 hover:bg-surface/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-text-main text-sm font-extrabold tracking-tight">
                        {themeOpt.name}
                      </h3>
                      <p className="text-text-muted mt-1 text-[11px] font-bold leading-normal opacity-85">
                        {themeOpt.description}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="bg-accent text-brand-crust flex h-5 w-5 items-center justify-center rounded-full">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    )}
                  </div>

                  {/* Palette Preview */}
                  <div className="mt-6 flex items-center justify-between border-t border-border/10 pt-4">
                    <div className="flex gap-1.5">
                      <span
                        className="h-4 w-4 rounded-full border border-white/10 shadow-sm"
                        style={{ backgroundColor: themeOpt.colors.bg }}
                        title="Background"
                      />
                      <span
                        className="h-4 w-4 rounded-full border border-white/10 shadow-sm"
                        style={{ backgroundColor: themeOpt.colors.surface }}
                        title="Surface"
                      />
                      <span
                        className="h-4 w-4 rounded-full border border-white/10 shadow-sm"
                        style={{ backgroundColor: themeOpt.colors.text }}
                        title="Text"
                      />
                      <span
                        className="h-4 w-4 rounded-full border border-white/10 shadow-sm"
                        style={{ backgroundColor: themeOpt.colors.accent }}
                        title="Accent"
                      />
                    </div>
                    <span className="text-[9px] font-mono font-bold tracking-widest uppercase opacity-40">
                      {themeOpt.type}
                    </span>
                  </div>
                </GlassPanel>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-6">
      <div className="relative z-10 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-widest text-text-main uppercase">
            SETTINGS::PROVIDERS
          </h1>
          <p className="text-text-muted mt-1 text-[11px] font-bold tracking-tight uppercase opacity-60">
            CONFIGURE_ACTIVE_AI_PROVIDER_PIPELINES
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            syncProviders(undefined, {
              onSuccess: () => {
                toast.success('Agents synced successfully!');
              },
              onError: (err) => {
                toast.error(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
              },
            });
          }}
          disabled={isSyncing}
          className="group flex items-center gap-2 h-9 px-4 rounded-xl text-[11px] font-bold tracking-widest uppercase"
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
                  activate(id, {
                    onSuccess: () => {
                      toast.success('Agent activated successfully!');
                    },
                    onError: (err) => {
                      toast.error(`Activation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    },
                  });
                }}
                onToggle={(id, enabled) => {
                  toggleProvider(
                    { providerId: id, enabled },
                    {
                      onSuccess: () => {
                        toast.success('Provider selection updated successfully.');
                      },
                      onError: (err) => {
                        toast.error(`Toggle failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                      },
                    }
                  );
                }}
                onResync={() => {
                  syncProviders(undefined, {
                    onSuccess: () => {
                      toast.success('Agents synced successfully!');
                    },
                    onError: (err) => {
                      toast.error(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    },
                  });
                }}
                onUpdateConfig={(id, customEnv) => {
                  updateProviderConfig(
                    { providerId: id, customEnv },
                    {
                      onSuccess: () => {
                        toast.success('Provider configuration updated.');
                      },
                      onError: (err) => {
                        toast.error(`Update failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                      },
                    }
                  );
                }}
                isUpdatingConfig={isUpdatingConfig}
              />
            ))}
            {providers.length === 0 && (
              <GlassPanel className="p-8 text-center border-dashed">
                <div className="text-text-muted text-[10px] font-bold tracking-widest uppercase opacity-30">
                  NO_PROVIDERS_DETECTED
                </div>
              </GlassPanel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


