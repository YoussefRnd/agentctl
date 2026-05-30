import {
  type ProviderDiscovery,
  type SessionRow,
  type SessionMode,
  getReadyProviderId,
  createTaskSlug,
} from '@agentctl/shared';
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

export async function openProjectSession(path: string, providers: ProviderDiscovery[]) {
  return apiClient.fetch<OpenProjectResponse>('/api/projects/open', {
    method: 'POST',
    body: JSON.stringify({
      path,
      agent: getReadyProviderId(providers),
      taskSlug: createTaskSlug('new-session'),
    }),
  });
}

export async function createProjectSession(projectId: string, providers: ProviderDiscovery[]) {
  return apiClient.fetch<SessionRow>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      agent: getReadyProviderId(providers),
      taskSlug: createTaskSlug('new-session'),
    }),
  });
}

export async function stageReviewFile(sessionId: string, filePath: string) {
  return apiClient.fetch<{ success: boolean }>(`/api/sessions/${sessionId}/review/stage`, {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
}

export async function revertReviewFile(sessionId: string, filePath: string) {
  return apiClient.fetch<{ success: boolean }>(`/api/sessions/${sessionId}/review/revert`, {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
}

export async function switchSessionMode(sessionId: string, mode: SessionMode) {
  return apiClient.fetch<{ success: boolean }>(`/api/sessions/${sessionId}/mode`, {
    method: 'PATCH',
    body: JSON.stringify({ mode }),
  });
}
