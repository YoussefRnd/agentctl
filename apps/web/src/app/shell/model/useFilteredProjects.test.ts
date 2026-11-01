import { expect, it } from 'vite-plus/test';
import type { SidebarProject } from '@agentctl/shared';
import { filterProjects } from './useFilteredProjects';

it('keeps pins in saved order above recent sessions, with archive and search filters intact', () => {
  const session = (id: string, activity: number, pinnedAt?: Date, status = 'idle') => ({
    id,
    title: id,
    branch: 'feature/sidebar',
    lastActivityAt: new Date(activity),
    pinnedAt,
    status,
  });
  const projects = [
    {
      name: 'Project',
      sessions: [
        session('recent', 900),
        session('pin-b', 100, new Date(200)),
        session('pin-a', 50, new Date(100)),
        session('archived', 1000, new Date(1), 'archived'),
      ],
    },
  ] as SidebarProject[];
  const result = filterProjects(projects, { searchQuery: '', showArchived: false });
  expect(result[0].sessions.map((s) => s.id)).toEqual(['pin-a', 'pin-b', 'recent']);
  expect(projects[0].sessions[0].id).toBe('recent');
  expect(
    filterProjects(projects, { searchQuery: 'feature/sidebar', showArchived: true })[0].sessions[0]
      .id,
  ).toBe('archived');
  expect(filterProjects(projects, { searchQuery: 'missing', showArchived: false })).toEqual([]);
});
