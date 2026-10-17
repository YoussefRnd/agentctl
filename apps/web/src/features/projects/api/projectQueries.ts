import { projectKeys } from '@/shared/lib/queryKeys';
import { queryOptions } from '@tanstack/react-query';
import { apiClient, type SidebarProject } from '@agentctl/api-client';

export const projectQueries = {
  all: () =>
    queryOptions({
      queryKey: projectKeys.all,
      queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
      staleTime: 2_000,
      refetchOnWindowFocus: true,
    }),
};
