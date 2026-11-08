import { apiClient } from '../api-client.js';
import type { ClientInferRequest } from '@ts-rest/core';
import type { apiContract } from '@agentctl/shared';
import {
  type SessionRow,
  type SessionWithCapabilities,
  type SessionMode,
  createTaskSlug,
} from '@agentctl/shared';
import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';

export type InitialSessionSettings = Pick<
  ClientInferRequest<typeof apiContract.createSession>['body'],
  'taskSlug' | 'selectedModel' | 'selectedThinkingEffort' | 'approvalMode' | 'agentPersona'
>;

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

export async function patchSession(
  sessionId: string,
  data: NonNullable<ClientInferRequest<typeof apiContract.patchSession>['body']>,
): Promise<SessionWithCapabilities> {
  const res = await api.patchSession({
    params: { id: sessionId },
    body: data,
  });
  assertApiStatus(res, 200, 'Failed to update session');
  return res.body;
}

export async function spawnParallelAgent(
  parentSessionId: string,
  params: ClientInferRequest<typeof apiContract.spawnParallelAgent>['body'],
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

export async function updateSessionProvider(
  sessionId: string,
  providerId: string,
  modelId?: string,
): Promise<{ success: boolean }> {
  await patchSession(sessionId, { providerId, modelId });
  return { success: true };
}

export async function undoDiscardSession(sessionId: string): Promise<{ success: boolean }> {
  const res = await api.undoDiscard({ params: { id: sessionId }, body: {} });
  assertApiStatus(res, 200, 'Failed to undo discard');
  return res.body;
}

export async function respondToElicitation(
  sessionId: string,
  elicitationId: string,
  response: import('@agentctl/shared').ElicitationResponse,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/elicitations/${encodeURIComponent(elicitationId)}/respond`,
    { method: 'POST', body: JSON.stringify(response), signal },
  );
}
