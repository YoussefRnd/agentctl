import { useMemo } from 'react';
import type { SidebarProject } from '@agentctl/api-client';

export interface FilterOptions {
  searchQuery: string;
  showArchived: boolean;
}

function filterProjects(projects: SidebarProject[], options: FilterOptions): SidebarProject[] {
  const { searchQuery, showArchived } = options;

  const visibleProjects = projects.map((p) => ({
    ...p,
    sessions: p.sessions.filter((s) => showArchived || s.status !== 'archived'),
  }));

  if (!searchQuery) {
    return visibleProjects;
  }

  const lowQuery = searchQuery.toLowerCase();

  return visibleProjects.filter(
    (p) =>
      p.name.toLowerCase().includes(lowQuery) ||
      p.sessions.some((s) =>
        (s.title || s.taskSlug || s.branch || '').toLowerCase().includes(lowQuery),
      ),
  );
}

export function useFilteredProjects(
  projects: SidebarProject[],
  options: FilterOptions,
): SidebarProject[] {
  const { searchQuery, showArchived } = options;

  return useMemo(() => {
    return filterProjects(projects, { searchQuery, showArchived });
  }, [projects, searchQuery, showArchived]);
}
