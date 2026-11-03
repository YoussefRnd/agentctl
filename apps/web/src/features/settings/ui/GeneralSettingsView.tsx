import { useTheme, useAppVersion } from '@/shared';
import { useProviders } from '@/features/providers';
import { useUpdate } from '@/features/updates';
import { useSettings } from '../api/useSettings';
import { useNotificationStore } from '../../../shared/stores/useNotificationStore';
import { requestNotificationPermission } from '../../../shared/lib/notifications';
import { useState, useEffect } from 'react';
import { GeneralSettingsPresentation } from './GeneralSettingsPresentation';

export function GeneralSettingsView() {
  const theme = useTheme();
  const { settings, updateSettings, isLoading: isLoadingSettings, isUpdating } = useSettings();
  const providersApi = useProviders(null);
  const notifications = useNotificationStore();
  const update = useUpdate();
  const version = useAppVersion();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  useEffect(() => {
    if ('Notification' in window) setPermission(Notification.permission);
  }, []);
  const handleRequestPermission = async () => {
    setPermission(await requestNotificationPermission());
  };
  return (
    <GeneralSettingsPresentation
      theme={theme}
      settings={settings}
      updateSettings={updateSettings}
      providers={providersApi.providers}
      isLoadingProviders={providersApi.isLoadingProviders}
      isLoadingSettings={isLoadingSettings}
      isUpdating={isUpdating}
      notificationsEnabled={notifications.enabled}
      notifyOnCompletion={notifications.notifyOnCompletion}
      notifyOnAttention={notifications.notifyOnAttention}
      setNotificationsEnabled={notifications.setEnabled}
      setNotifyOnCompletion={notifications.setNotifyOnCompletion}
      setNotifyOnAttention={notifications.setNotifyOnAttention}
      permission={permission}
      handleRequestPermission={handleRequestPermission}
      update={{ ...update, version }}
    />
  );
}
