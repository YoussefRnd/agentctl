import { useMemo } from 'react';
import type { SidebarProject } from '@agentctl/api-client';

export interface FilterOptions {
  searchQuery: string;
  showArchived: boolean;
}

function filterProjects(projects: SidebarProject[], options: FilterOptions): SidebarProject[] {
  const { searchQuery, showArchived } = options;

  const visibleProjects = projects.map((p) => {
    const validSessions = p.sessions.filter((s) => showArchived || s.status !== 'archived');
    const sortedSessions = validSessions.toSorted((a, b) => {
      const timeA = new Date(a.updatedAt ?? a.createdAt).getTime();
      const timeB = new Date(b.updatedAt ?? b.createdAt).getTime();
      return timeB - timeA;
    });

    return {
      ...p,
      sessions: sortedSessions,
    };
  });

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
