import type { GitStatus, CreatePullRequestBody, CreatePullRequestResult } from '@agentctl/shared';
import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';

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
