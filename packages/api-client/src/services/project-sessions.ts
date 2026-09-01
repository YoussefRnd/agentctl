import {
  type SearchEventType,
  type SessionRow,
  type SessionMode,
  createTaskSlug,
} from '@agentctl/shared';
import { api } from '../api.js';
import { ApiError } from '../api-error.js';

export interface SidebarProject {
  id: string;
  name: string;
  path: string;
  sessions: Pick<
    SessionRow,
    | 'id'
    | 'title'
    | 'taskSlug'
    | 'branch'
    | 'status'
    | 'updatedAt'
    | 'createdAt'
    | 'mode'
    | 'worktreePath'
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
  if (res.status !== 200) {
    throw new ApiError(`Failed to open project: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function createProjectSession(
  projectId: string,
  mode?: SessionMode,
  agent?: string,
): Promise<SessionRow> {
  const res = await api.createSession({
    body: {
      projectId,
      taskSlug: createTaskSlug('new-session'),
      ...(mode ? { mode } : {}),
      ...(agent ? { agent } : {}),
    },
  });
  if (res.status !== 201) {
    throw new ApiError(`Failed to create session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function stageReviewFile(
  sessionId: string,
  filePath: string,
): Promise<{ success: boolean }> {
  const res = await api.stageFile({
    params: { id: sessionId },
    body: { filePath },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to stage review file: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function revertReviewFile(
  sessionId: string,
  filePath: string,
): Promise<{ success: boolean }> {
  const res = await api.revertFile({
    params: { id: sessionId },
    body: { filePath },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to revert review file: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function unstageReviewFile(
  sessionId: string,
  filePath: string,
): Promise<{ success: boolean }> {
  const res = await api.unstageFile({
    params: { id: sessionId },
    body: { filePath },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to unstage review file: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function stageAllReviewFiles(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.stageAllFiles({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to stage all review files: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function unstageAllReviewFiles(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.unstageAllFiles({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to unstage all review files: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function commitWorkspaceChanges(
  sessionId: string,
  message: string,
): Promise<{ success: boolean }> {
  const res = await api.commitChanges({
    params: { id: sessionId },
    body: { message },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to commit workspace changes: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function pushWorkspaceChanges(
  sessionId: string,
): Promise<{ success: boolean; output: string }> {
  const res = await api.pushChanges({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to push changes: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function pullWorkspaceChanges(
  sessionId: string,
): Promise<{ success: boolean; output: string }> {
  const res = await api.pullChanges({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to pull changes: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function mergeSessionBranch(
  sessionId: string,
  branch: string,
): Promise<{ success: boolean }> {
  const res = await api.mergeSessionBranch({
    params: { id: sessionId },
    body: { branch },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to merge session branch: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function checkMergeBranch(
  sessionId: string,
  branch: string,
): Promise<{ canMerge: boolean; hasConflicts: boolean; conflictingFiles: string[] }> {
  const res = await api.checkMergeBranch({
    params: { id: sessionId },
    body: { branch },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to check merge branch: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function spawnParallelAgent(
  parentSessionId: string,
  params: {
    prompt: string;
    title?: string;
    taskSlug?: string;
    providerId?: string;
    modelId?: string;
  },
): Promise<{ session: SessionRow }> {
  const res = await api.spawnParallelAgent({
    params: { id: parentSessionId },
    body: params,
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to spawn background agent: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export const spawnSwarmSubagent = spawnParallelAgent;

export async function switchSessionMode(
  sessionId: string,
  mode: SessionMode,
): Promise<{ success: boolean }> {
  const res = await api.switchSessionMode({
    params: { id: sessionId },
    body: { mode },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to switch session mode: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function mergeSession(
  sessionId: string,
  commitMessage?: string,
): Promise<{ success: boolean }> {
  const res = await api.mergeSession({
    params: { id: sessionId },
    body: { commitMessage },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to merge session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function discardSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.discardSession({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to discard session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
  const res = await api.deleteProject({
    params: { id: projectId },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to delete project: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function deleteSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.deleteSession({
    params: { id: sessionId },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to delete session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function renameSession(
  sessionId: string,
  title: string,
): Promise<{ success: boolean }> {
  const res = await api.renameSession({
    params: { id: sessionId },
    body: { title },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to rename session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function archiveSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.archiveSession({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to archive session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function restoreSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.restoreSession({
    params: { id: sessionId },
    body: {},
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to restore session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function setApprovalMode(
  sessionId: string,
  approvalMode: 'review' | 'auto_approve' | 'yolo',
): Promise<{ success: boolean }> {
  const res = await api.setApprovalMode({
    params: { id: sessionId },
    body: { approvalMode },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to set approval mode: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function setAgentPersona(
  sessionId: string,
  persona: string,
): Promise<{ success: boolean }> {
  const res = await api.setAgentPersona({
    params: { id: sessionId },
    body: { persona },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to set agent persona: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function setSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string,
): Promise<{ success: boolean }> {
  const res = await api.setSessionConfigOption({
    params: { id: sessionId },
    body: { configId, value },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to set session config option: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function rewindSession(
  sessionId: string,
  eventId: number,
  mode: 'conversation' | 'files' | 'fork',
): Promise<{ success: boolean; forkSessionId?: string; undoSnapshotHash?: string }> {
  const res = await api.rewindSession({
    params: { id: sessionId },
    body: { eventId, mode },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to rewind session: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function restoreSnapshot(
  sessionId: string,
  snapshotHash: string,
): Promise<{ success: boolean; backupHash?: string }> {
  const res = await api.restoreSnapshot({
    params: { id: sessionId },
    body: { snapshotHash },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to restore snapshot: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function previewSnapshotDiff(
  sessionId: string,
  eventId: number,
): Promise<{
  hasSnapshot: boolean;
  files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
}> {
  const res = await api.previewSnapshotDiff({
    params: { id: sessionId, eventId },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to preview snapshot: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function updateSessionProvider(
  sessionId: string,
  providerId: string,
  modelId?: string,
): Promise<{ success: boolean }> {
  const res = await api.updateSessionProvider({
    params: { id: sessionId },
    body: { providerId, modelId },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to update session provider: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function sendTerminalInput(
  sessionId: string,
  terminalId: string,
  data: string,
): Promise<{ success: boolean }> {
  const res = await api.sendTerminalInput({
    params: { id: sessionId, terminalId },
    body: { data },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to send terminal input: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export { EDITORS, type EditorId, type EditorDefinition } from '@agentctl/shared';

export async function openInEditor(
  editor: string,
  targetPath: string,
): Promise<{ success: boolean; editor: string }> {
  const res = await api.openInEditor({
    body: { editor, path: targetPath },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to launch editor: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export async function getAvailableEditors(): Promise<string[]> {
  const res = await api.getAvailableEditors();
  if (res.status !== 200) {
    throw new ApiError(`Failed to get available editors: ${String(res.status)}`, res.status);
  }
  return res.body;
}

export type { SearchResultItem } from '@agentctl/shared';

export async function searchSessionEvents(params: {
  q: string;
  type?: 'all' | SearchEventType;
  projectId?: string;
  sessionId?: string;
  limit?: number;
}): Promise<import('@agentctl/shared').SearchResultItem[]> {
  const res = await api.searchEvents({
    query: {
      q: params.q,
      ...(params.type ? { type: params.type } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  if (res.status !== 200) {
    throw new ApiError(`Failed to search events: ${String(res.status)}`, res.status);
  }
  return res.body;
}
