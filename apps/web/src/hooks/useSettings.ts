import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@agentctl/api-client';

export interface SystemSettings {
	onboardingCompleted: boolean;
	onboardingVersion: string | number;
	setupStep: string | null;
	defaultDriverId: string | null;
}

export function useSettings() {
	const queryClient = useQueryClient();

	const { data: settings, isLoading } = useQuery<SystemSettings>({
		queryKey: ['settings'],
		queryFn: () => apiClient.fetch<SystemSettings>('/api/settings'),
	});

	const updateSettingsMutation = useMutation({
		mutationFn: async (payload: Partial<SystemSettings>) => {
			return apiClient.fetch<SystemSettings>('/api/settings', {
				method: 'PATCH',
				body: JSON.stringify(payload),
			});
		},
		onSuccess: (data) => {
			queryClient.setQueryData(['settings'], data);
		},
		onError: (error: unknown) => {
			toast.error(error instanceof Error ? error.message : 'Failed to update settings');
		},
	});

	return {
		settings,
		isLoading,
		updateSettings: updateSettingsMutation.mutateAsync,
		isUpdating: updateSettingsMutation.isPending,
	};
}
