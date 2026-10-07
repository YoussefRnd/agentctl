import { lazy, Suspense } from 'react';
import { useSettings } from '../api/useSettings';
import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@agentctl/ui';

const SettingsDialog = lazy(() =>
  import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
);
const SetupWizard = lazy(() =>
  import('./SetupWizard').then((module) => ({ default: module.SetupWizard })),
);

export function SettingsOverlays() {
  const { settings, isLoading } = useSettings();
  const isOpen = useSettingsOverlayStore((s) => s.isSettingsOpen);
  const closeSettings = useSettingsOverlayStore((s) => s.closeSettings);
  return (
    <>
      {isOpen && (
        <Suspense
          fallback={
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) closeSettings();
              }}
            >
              <DialogContent>
                <DialogTitle>Settings</DialogTitle>
                <DialogDescription role="status">Loading settings…</DialogDescription>
              </DialogContent>
            </Dialog>
          }
        >
          <SettingsDialog />
        </Suspense>
      )}
      {!isLoading && settings && !settings.onboardingCompleted && (
        <Suspense fallback={null}>
          <SetupWizard />
        </Suspense>
      )}
    </>
  );
}
