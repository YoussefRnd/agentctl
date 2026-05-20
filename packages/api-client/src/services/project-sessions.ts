import { type DriverDiscovery, type SessionRow, getReadyDriverId, createTaskSlug } from '@agentctl/shared';
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
