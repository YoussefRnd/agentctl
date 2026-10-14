import {
  type SearchEventType,
  type SessionRow,
  type SessionWithCapabilities,
  type SessionMode,
  type GitStatus,
  type CreatePullRequestBody,
  type CreatePullRequestResult,
  createTaskSlug,
  type ThinkingEffort,
} from '@agentctl/shared';
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

export interface InitialSessionSettings {
  taskSlug?: string;
  selectedModel?: string;
  selectedThinkingEffort?: ThinkingEffort;
  approvalMode?: 'review' | 'auto_approve' | 'yolo';
  agentPersona?: string;
}

export async function createProjectSession(
  projectId: string,
  mode?: SessionMode,
  agent?: string,
  settings: InitialSessionSettings = {},
): Promise<SessionRow> {
  const res = await api.createSession({
    body: {
      projectId,
      ...settings,
      taskSlug: createTaskSlug(settings.taskSlug || 'new-session'),
      ...(mode ? { mode } : {}),
      ...(agent ? { agent } : {}),
    },
  });
  assertApiStatus(res, 201, 'Failed to create session');
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
  assertApiStatus(res, 200, 'Failed to stage review file');
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
  assertApiStatus(res, 200, 'Failed to revert review file');
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
  assertApiStatus(res, 200, 'Failed to unstage review file');
  return res.body;
}

export async function stageAllReviewFiles(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.stageAllFiles({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to stage all review files');
  return res.body;
}

export async function unstageAllReviewFiles(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.unstageAllFiles({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to unstage all review files');
  return res.body;
}

export async function commitWorkspaceChanges(
  sessionId: string,
  message: string,
  includeUnstaged = false,
): Promise<{ success: boolean }> {
  const res = await api.commitChanges({
    params: { id: sessionId },
    body: { message, includeUnstaged },
  });
  assertApiStatus(res, 200, 'Failed to commit workspace changes');
  return res.body;
}

export async function pushWorkspaceChanges(
  sessionId: string,
): Promise<{ success: boolean; output: string }> {
  const res = await api.pushChanges({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to push changes');
  return res.body;
}

export async function pullWorkspaceChanges(
  sessionId: string,
): Promise<{ success: boolean; output: string }> {
  const res = await api.pullChanges({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to pull changes');
  return res.body;
}

export async function getGitStatus(sessionId: string): Promise<GitStatus> {
  const res = await api.getGitStatus({
    params: { id: sessionId },
  });
  assertApiStatus(res, 200, 'Failed to get Git status');
  return res.body;
}

export async function createPullRequest(
  sessionId: string,
  body: CreatePullRequestBody,
): Promise<CreatePullRequestResult> {
  const res = await api.createPullRequest({
    params: { id: sessionId },
    body,
  });
  assertApiStatus(res, 200, 'Failed to create pull request');
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
  assertApiStatus(res, 200, 'Failed to merge session branch');
  return res.body;
}

export async function patchSession(
  sessionId: string,
  data: {
    title?: string;
    mode?: SessionMode;
    approvalMode?: 'review' | 'auto_approve' | 'yolo';
    persona?: string;
    providerId?: string;
    modelId?: string;
    thinkingEffort?: 'low' | 'medium' | 'high';
    configId?: string;
    configValue?: string;
    branch?: string;
  },
): Promise<SessionWithCapabilities> {
  const res = await api.patchSession({
    params: { id: sessionId },
    body: data,
  });
  assertApiStatus(res, 200, 'Failed to update session');
  return res.body;
}

export async function checkMergeBranch(
  sessionId: string,
  branch: string,
): Promise<{ canMerge: boolean; hasConflicts: boolean; conflictingFiles: string[] }> {
  const res = await api.checkMergeBranch({
    params: { id: sessionId },
    query: { branch },
  });
  assertApiStatus(res, 200, 'Failed to check merge branch');
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
  assertApiStatus(res, 201, 'Failed to spawn background agent');
  return res.body;
}

export async function switchSessionMode(
  sessionId: string,
  mode: SessionMode,
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { mode });
  return { success: true };
}

export async function mergeSession(
  sessionId: string,
  commitMessage?: string,
  targetBranch?: string,
): Promise<{ success: boolean }> {
  const res = await api.mergeSession({
    params: { id: sessionId },
    body: { commitMessage, targetBranch },
  });
  assertApiStatus(res, 200, 'Failed to merge session');
  return res.body;
}

export async function discardSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.discardSession({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to discard session');
  return res.body;
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

export async function deleteSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.deleteSession({
    params: { id: sessionId },
  });
  if (res.status !== 204 && (res.status as number) !== 200) {
    assertApiStatus(res, 204, 'Failed to delete session');
  }
  return { success: true };
}

export async function renameSession(
  sessionId: string,
  title: string,
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { title });
  return { success: true };
}

export async function archiveSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.archiveSession({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to archive session');
  return res.body;
}

export async function restoreSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.restoreSession({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to restore session');
  return res.body;
}

export async function setApprovalMode(
  sessionId: string,
  approvalMode: 'review' | 'auto_approve' | 'yolo',
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { approvalMode });
  return { success: true };
}

export async function setAgentPersona(
  sessionId: string,
  persona: string,
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { persona });
  return { success: true };
}

export async function setSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string,
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { configId, configValue: value });
  return { success: true };
}

export async function rewindSession(
  sessionId: string,
  eventId: number,
  mode: 'conversation' | 'files' | 'fork',
): Promise<{
  success: boolean;
  forkSessionId?: string;
  undoSnapshotHash?: string;
  restoredFiles?: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    additions?: number;
    deletions?: number;
  }>;
}> {
  const res = await api.rewindSession({
    params: { id: sessionId },
    body: { eventId, mode },
  });
  assertApiStatus(res, 200, 'Failed to rewind session');
  return res.body;
}

export async function undoRewind(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.undoRewind({
    params: { id: sessionId },
    body: {},
  });
  assertApiStatus(res, 200, 'Failed to undo rewind');
  return res.body;
}

export async function handoffSession(
  sessionId: string,
  targetProvider: string,
  targetModel?: string,
  nextSessionFocus?: string,
): Promise<{
  sessionId: string;
  handoffFilePath: string;
  initialPrompt: string;
  handoffSource: 'skill' | 'generated';
}> {
  const res = await api.handoffSession({
    params: { id: sessionId },
    body: {
      targetProvider,
      targetModel,
      nextSessionFocus,
    },
  });
  assertApiStatus(res, 200, 'Failed to handoff session');
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
  assertApiStatus(res, 200, 'Failed to restore snapshot');
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
  assertApiStatus(res, 200, 'Failed to preview snapshot');
  return res.body;
}

export async function updateSessionProvider(
  sessionId: string,
  providerId: string,
  modelId?: string,
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { providerId, modelId });
  return { success: true };
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
  assertApiStatus(res, 200, 'Failed to send terminal input');
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
  assertApiStatus(res, 200, 'Failed to launch editor');
  return res.body;
}

export async function getAvailableEditors(): Promise<string[]> {
  const res = await api.getAvailableEditors();
  assertApiStatus(res, 200, 'Failed to get available editors');
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
  assertApiStatus(res, 200, 'Failed to search events');
  return res.body;
}

export async function fetchWorkspaceChanges(
  sessionId: string,
): Promise<{ success: boolean; output: string }> {
  const res = await api.fetchChanges({ params: { id: sessionId }, body: {} });
  assertApiStatus(res, 200, 'Failed to fetch changes');
  return res.body;
}

export async function createWorkspaceBranch(
  sessionId: string,
  name: string,
): Promise<{ success: boolean }> {
  const res = await api.createSessionBranch({ params: { id: sessionId }, body: { name } });
  assertApiStatus(res, 200, 'Failed to create branch');
  return res.body;
}

export async function undoDiscardSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.undoDiscard({ params: { id: sessionId }, body: {} });
  assertApiStatus(res, 200, 'Failed to undo discard');
  return res.body;
}

export async function generateGitDraft(
  sessionId: string,
  body:
    | { kind: 'commit'; includeUnstaged?: boolean }
    | { kind: 'merge'; targetBranch: string }
    | { kind: 'pr'; targetBranch: string },
): Promise<{ title: string; body: string }> {
  const res = await api.generateGitDraft({ params: { id: sessionId }, body });
  assertApiStatus(res, 200, 'Failed to generate draft');
  return res.body;
}
