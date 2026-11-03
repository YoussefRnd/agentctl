import { ProvidersSettingsPresentation } from './ProvidersSettingsPresentation';
import { McpSettingsPresentation } from './McpSettingsPresentation';
const noop = () => undefined;
const pendingProvidersApi = {
  providers: [],
  registry: [],
  isLoadingProviders: true,
  isLoadingRegistry: true,
  syncProviders: noop,
  isSyncing: false,
  installProvider: noop,
  cancelInstall: noop,
  isInstalling: false,
  installingProviderId: null,
  removeProvider: noop,
  isRemoving: false,
  removingProviderId: null,
  logoutProvider: noop,
  updateProviderConfig: noop,
  isUpdatingConfig: false,
  login: noop,
  isLoggingIn: false,
  refreshProvider: noop,
  isRefreshing: false,
  providersError: null,
  registryError: null,
  retryProviders: noop,
  retryRegistry: noop,
};
const pendingMcpApi = {
  mcpServers: [],
  isLoading: true,
  addMcpServer: noop,
  isAdding: false,
  updateMcpServer: noop,
  isUpdating: false,
  deleteMcpServer: noop,
  isDeleting: false,
};
import { SkeletonSurface } from '@agentctl/ui';
import { useTheme } from '@/shared';
import { useUpdate } from '@/features/updates';
import type { SystemSettings } from '@agentctl/shared';
import { useNotificationStore } from '@/shared/stores/useNotificationStore';
import { GeneralSettingsPresentation } from './GeneralSettingsPresentation';
import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';

export function SettingsContentSkeleton({
  themeMode = 'system',
  settings,
}: {
  themeMode?: 'light' | 'dark' | 'system';
  settings?: SystemSettings;
}) {
  const tab = useSettingsOverlayStore((state) => state.settingsTab);
  const theme = useTheme();
  const notifications = useNotificationStore();
  const update = useUpdate();
  return (
    <SkeletonSurface message="Loading settings…">
      {tab === 'general' ? (
        <GeneralSettingsPresentation
          theme={{ ...theme, themeMode }}
          settings={settings}
          providers={[]}
          updateSettings={async () => undefined}
          notificationsEnabled={notifications.enabled}
          notifyOnCompletion={notifications.notifyOnCompletion}
          notifyOnAttention={notifications.notifyOnAttention}
          setNotificationsEnabled={() => undefined}
          setNotifyOnCompletion={() => undefined}
          setNotifyOnAttention={() => undefined}
          permission={typeof Notification === 'undefined' ? 'default' : Notification.permission}
          handleRequestPermission={async () => undefined}
          update={{ ...update, version: '' }}
        />
      ) : tab === 'providers' ? (
        <ProvidersSettingsPresentation
          settings={settings}
          providersApi={pendingProvidersApi}
          exportDiagnostics={async () => undefined}
          invalidateProfiles={async () => undefined}
        />
      ) : (
        <McpSettingsPresentation api={pendingMcpApi} tools={[]} />
      )}
    </SkeletonSurface>
  );
}
