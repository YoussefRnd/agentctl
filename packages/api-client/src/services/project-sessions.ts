import type { DriverDiscovery, SessionRow } from '@agentctl/shared';
import { apiClient } from '../api-client.js';

export interface SidebarProject {
  id: string;
  name: string;
  path: string;
  sessions: Pick<
    SessionRow,
    'id' | 'title' | 'taskSlug' | 'branch' | 'status' | 'updatedAt' | 'createdAt'
  >[];
}

export interface OpenProjectResponse {
  project: { id: string; name: string; path: string };
  session: SessionRow;
  created: boolean;
}

export function getReadyDriverId(drivers: DriverDiscovery[]) {
  return drivers.find((driver) => driver.status === 'ready')?.id ?? 'opencode';
}

export function createTaskSlug(prefix = 'new-session') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${timestamp}`;
}

export async function openProjectSession(path: string, drivers: DriverDiscovery[]) {
  return apiClient.fetch<OpenProjectResponse>('/api/projects/open', {
    method: 'POST',
    body: JSON.stringify({
      path,
      agent: getReadyDriverId(drivers),
      taskSlug: createTaskSlug('new-session'),
    }),
  });
}

export async function createProjectSession(projectId: string, drivers: DriverDiscovery[]) {
  return apiClient.fetch<SessionRow>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      agent: getReadyDriverId(drivers),
      taskSlug: createTaskSlug('new-session'),
    }),
  });
}
