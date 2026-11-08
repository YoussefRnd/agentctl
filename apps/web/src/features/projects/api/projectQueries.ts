import { projectKeys } from '@/shared/lib/queryKeys';
import { queryOptions } from '@tanstack/react-query';
import { api, type SidebarProject } from '@agentctl/api-client';

type ProjectQuery = NonNullable<NonNullable<Parameters<typeof api.getProjects>[0]>['query']>;
export type ProjectSort = NonNullable<ProjectQuery['sortBy']>;
export const DEFAULT_PROJECT_SORT: ProjectSort = 'lastActive';

function projectListOptions(sortBy: ProjectSort = DEFAULT_PROJECT_SORT, gitOnly = false) {
  const isDefault = sortBy === DEFAULT_PROJECT_SORT && !gitOnly;
  return queryOptions({
    queryKey: isDefault ? projectKeys.all : projectKeys.list(sortBy, gitOnly),
    queryFn: async (): Promise<SidebarProject[]> => {
      const response = await api.getProjects({
        query: { sortBy, gitOnly: gitOnly ? 'true' : 'false' },
      });
      if (response.status !== 200) throw new Error('Failed to fetch projects');
      return response.body;
    },
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });
}

export const projectQueries = {
  all: () => projectListOptions(),
  list: projectListOptions,
};
