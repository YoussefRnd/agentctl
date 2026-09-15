import { queryOptions } from '@tanstack/react-query';
import { apiClient, type SidebarProject } from '@agentctl/api-client';

export const projectQueries = {
  all: () =>
    queryOptions({
      queryKey: ['projects'] as const,
      queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
    }),
};
