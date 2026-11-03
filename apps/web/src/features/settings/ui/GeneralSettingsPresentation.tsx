import { GeneralSettingsLayout } from './GeneralSettingsLayout';
import { GitGenerationSettingsPanel } from './GitGenerationSettingsPanel';
import type { useTheme } from '@/shared';
import type {
  ProviderDiscovery,
  SystemSettings,
  PatchSettings,
  FontConfig,
} from '@agentctl/shared';
import type { UpdateState } from '@/electron';
import { Select, Switch } from '@agentctl/ui';
import { Sun, Moon, Monitor } from 'lucide-react';
import { getLightThemes, getDarkThemes } from '../../../shared/lib/theme-registry';
import { ThemeSelect } from './ThemeSelect';
import { FontSettingsPanel } from './FontSettingsPanel';
import { UpdateSettingsPresentation } from './UpdateSettingsPresentation';

type Theme = ReturnType<typeof useTheme>;
export interface GeneralSettingsPresentationProps {
  theme: Pick<
    Theme,
    'themeMode' | 'setThemeMode' | 'lightTheme' | 'darkTheme' | 'setLightTheme' | 'setDarkTheme'
  >;
  settings?: SystemSettings;
  providers: ProviderDiscovery[];
  isLoadingProviders?: boolean;
  isLoadingSettings?: boolean;
  isUpdating?: boolean;
  updateSettings: (patch: PatchSettings) => Promise<unknown>;
  notificationsEnabled: boolean;
  notifyOnCompletion: boolean;
  notifyOnAttention: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  setNotifyOnCompletion: (value: boolean) => void;
  setNotifyOnAttention: (value: boolean) => void;
  permission: NotificationPermission;
  handleRequestPermission: () => Promise<unknown>;
  update: { state: UpdateState; version: string; check: () => void; install: () => void };
}

/** Presentation only; the live container owns queries, permissions and update services. */
export function GeneralSettingsPresentation({
  theme: { themeMode, setThemeMode, lightTheme, darkTheme, setLightTheme, setDarkTheme },
  settings,
  providers,
  isLoadingProviders = false,
  isLoadingSettings = false,
  isUpdating = false,
  updateSettings,
  notificationsEnabled,
  notifyOnCompletion,
  notifyOnAttention,
  setNotificationsEnabled,
  setNotifyOnCompletion,
  setNotifyOnAttention,
  permission,
  handleRequestPermission,
  update,
}: GeneralSettingsPresentationProps) {
  const enabledProviders = providers.filter((p) => p.installState !== 'not_installed');

  return (
    <GeneralSettingsLayout
      themeMode={themeMode}
      slots={{
        themeMode: (
          <div
            className="border-border/40 bg-surface/40 flex max-w-full flex-wrap gap-1 rounded-lg border p-1"
            role="group"
            aria-label="Theme mode"
          >
            {[
              { mode: 'system' as const, label: 'System', icon: Monitor },
              { mode: 'dark' as const, label: 'Dark', icon: Moon },
              { mode: 'light' as const, label: 'Light', icon: Sun },
            ].map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                aria-pressed={themeMode === mode}
                onClick={() => setThemeMode(mode)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
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
        ),
        lightTheme: (
          <ThemeSelect themes={getLightThemes()} value={lightTheme} onChange={setLightTheme} />
        ),
        darkTheme: (
          <ThemeSelect themes={getDarkThemes()} value={darkTheme} onChange={setDarkTheme} />
        ),
        defaultProvider: (
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
        ),
        notifications: (
          <div className="flex items-center gap-3">
            {permission === 'default' && (
              <button
                type="button"
                onClick={() => {
                  void handleRequestPermission();
                }}
                className="bg-accent text-brand-crust label-3xs cursor-pointer rounded-md px-2.5 py-1 font-semibold transition-opacity hover:opacity-90"
              >
                Request Permission
              </button>
            )}
            <Switch
              checked={notificationsEnabled}
              onCheckedChange={setNotificationsEnabled}
              size="md"
            />
          </div>
        ),
        showThinking: (
          <Switch
            checked={settings?.showThinking ?? false}
            onCheckedChange={(checked) => {
              void updateSettings({ showThinking: checked });
            }}
            size="md"
          />
        ),
        defaultToWorktree: (
          <Switch
            checked={settings?.defaultToWorktree ?? true}
            onCheckedChange={(checked) => {
              void updateSettings({ defaultToWorktree: checked });
            }}
            size="md"
          />
        ),
        notifyOnCompletion: (
          <Switch
            checked={notificationsEnabled && notifyOnCompletion}
            disabled={!notificationsEnabled}
            onCheckedChange={setNotifyOnCompletion}
            size="md"
          />
        ),
        notifyOnAttention: (
          <Switch
            checked={notificationsEnabled && notifyOnAttention}
            disabled={!notificationsEnabled}
            onCheckedChange={setNotifyOnAttention}
            size="md"
          />
        ),
        gitGeneration: (
          <GitGenerationSettingsPanel
            value={settings?.gitTextGeneration ?? null}
            providers={providers}
            disabled={isLoadingSettings || isUpdating || isLoadingProviders}
            onChange={(gitTextGeneration) => updateSettings({ gitTextGeneration })}
          />
        ),
        typography: (
          <FontSettingsPanel
            fontConfig={settings?.fontConfig}
            onUpdate={(fontPartial) => {
              void updateSettings({
                fontConfig: fontPartial as FontConfig,
              });
            }}
          />
        ),
        updates: <UpdateSettingsPresentation {...update} />,
        notificationBadge: (
          <>
            {permission === 'denied' && (
              <span className="text-danger bg-danger/10 border-danger/20 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                Blocked in OS/Browser
              </span>
            )}
            {permission === 'granted' && (
              <span className="text-success bg-success/10 border-success/20 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                Allowed
              </span>
            )}
          </>
        ),
      }}
    />
  );
}
