import { useSettings } from '../../../hooks/useSettings';

export function useSetupWizard() {
  const { settings, isLoading, updateSettings } = useSettings();

  const markDone = async (defaultProviderId?: string | null) => {
    await updateSettings({
      onboardingCompleted: true,
      defaultProviderId: defaultProviderId ?? settings?.defaultProviderId ?? null,
    });
  };

  return {
    showWizard: !isLoading && !!settings && !settings.onboardingCompleted,
    markDone,
    isLoading,
  };
}
