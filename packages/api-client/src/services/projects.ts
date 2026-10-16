import { type SessionRow, type SessionMode, createTaskSlug } from '@agentctl/shared';
import { api } from '../api.js';
import { ApiError, assertApiStatus } from '../api-error.js';

export interface SidebarProject {
  id: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  sessions: Pick<
    SessionRow,
    | 'id'
    | 'title'
    | 'taskSlug'
    | 'branch'
    | 'status'
    | 'lastActivityAt'
    | 'updatedAt'
    | 'createdAt'
    | 'mode'
    | 'worktreePath'
    | 'hasUserActivity'
  >[];
}

export interface OpenProjectResponse {
  project: { id: string; name: string; path: string };
  session: SessionRow;
  created: boolean;
}

export async function openProjectSession(
  path: string,
  mode?: SessionMode,
  agent?: string,
): Promise<OpenProjectResponse> {
  const res = await api.openProject({
    body: {
      path,
      taskSlug: createTaskSlug('new-session'),
      ...(mode ? { mode } : {}),
      ...(agent ? { agent } : {}),
    },
  });
  assertApiStatus(res, 200, 'Failed to open project');
  if (!res.body.session) throw new ApiError('Failed to open project session', 500);
  return { ...res.body, session: res.body.session };
}

export async function openProjectFolder(path: string): Promise<OpenProjectResponse['project']> {
  const res = await api.openProject({ body: { path, startSession: false } });
  assertApiStatus(res, 200, 'Failed to open folder');
  return res.body.project;
}

export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
  const res = await api.deleteProject({
    params: { id: projectId },
  });
  if (res.status !== 204 && (res.status as number) !== 200) {
    assertApiStatus(res, 204, 'Failed to delete project');
  }
  return { success: true };
}
