import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSettingsOverlayStore } from '@/features/settings';

export function SettingsRoute() {
  const [searchParams] = useSearchParams();
  const openSettings = useSettingsOverlayStore((s) => s.openSettings);
  const requestedTab = searchParams.get('tab');
  const tab =
    requestedTab === 'providers' || requestedTab === 'mcp' || requestedTab === 'general'
      ? requestedTab
      : 'general';

  useEffect(() => {
    openSettings(tab);
  }, [openSettings, tab]);

  return <Navigate to="/" replace />;
}
