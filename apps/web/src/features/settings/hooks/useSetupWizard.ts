import { useSettings } from '../../../hooks/useSettings';

export function useSetupWizard() {
	const { settings, isLoading, updateSettings } = useSettings();

	const markDone = async (defaultDriverId?: string | null) => {
		await updateSettings({
			onboardingCompleted: true,
			defaultDriverId: defaultDriverId ?? settings?.defaultDriverId ?? null,
		});
	};

	return {
		showWizard: !isLoading && !!settings && !settings.onboardingCompleted,
		markDone,
		isLoading,
	};
}
