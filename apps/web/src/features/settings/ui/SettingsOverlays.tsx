import { useTheme } from '@/shared';
import { lazy, Suspense } from 'react';
import { useSettings } from '../api/useSettings';
import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';
import { SettingsDialogFrame } from './SettingsDialogFrame';
import { SettingsContentSkeleton } from './SettingsContentSkeleton';

const SettingsDialogContent = lazy(() =>
  import('./SettingsDialog').then((module) => ({ default: module.SettingsDialogContent })),
);
const SetupWizard = lazy(() =>
  import('./SetupWizard').then((module) => ({ default: module.SetupWizard })),
);

export function SettingsOverlays() {
  const { settings, isLoading } = useSettings();
  const { themeMode } = useTheme();
  const isOpen = useSettingsOverlayStore((s) => s.isSettingsOpen);
  return (
    <>
      {isOpen && (
        <SettingsDialogFrame>
          <Suspense
            fallback={<SettingsContentSkeleton themeMode={themeMode} settings={settings} />}
          >
            <SettingsDialogContent />
          </Suspense>
        </SettingsDialogFrame>
      )}
      {!isLoading && settings && !settings.onboardingCompleted && (
        <Suspense fallback={null}>
          <SetupWizard />
        </Suspense>
      )}
    </>
  );
}
