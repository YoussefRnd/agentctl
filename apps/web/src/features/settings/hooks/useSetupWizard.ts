import { useSettings } from '../../../hooks/useSettings';

export function useSetupWizard() {
  const { settings, isLoading, updateSettings } = useSettings();

  const markDone = async () => {
    await updateSettings({
      onboardingCompleted: true,
    });
  };

  return {
    showWizard: !isLoading && !!settings && !settings.onboardingCompleted,
    markDone,
    isLoading,
  };
}
