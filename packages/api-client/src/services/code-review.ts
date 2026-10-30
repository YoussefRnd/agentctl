import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';
import {
  codeReviewRunSchema,
  type StartCodeReview,
  type ResolveReviewFinding,
} from '@agentctl/shared';

export async function listCodeReviews(sessionId: string, signal?: AbortSignal, before?: string) {
  const response = await api.listCodeReviews({
    params: { id: sessionId },
    query: { before },
    fetchOptions: { signal },
  });
  assertApiStatus(response, 200, 'Could not load saved reviews');
  return {
    runs: response.body.runs.map((run) => codeReviewRunSchema.parse(run)),
    nextCursor: response.body.nextCursor,
  };
}
export async function startCodeReview(sessionId: string, body: StartCodeReview) {
  const response = await api.startCodeReview({ params: { id: sessionId }, body });
  assertApiStatus(response, 202, 'Could not start review');
  return response.body;
}
export async function cancelCodeReview(sessionId: string, reviewId: string) {
  const response = await api.cancelCodeReview({ params: { id: sessionId, reviewId }, body: {} });
  assertApiStatus(response, 200, 'Could not cancel review');
}
export async function resolveCodeReviewFinding(
  sessionId: string,
  reviewId: string,
  findingId: string,
  body: ResolveReviewFinding,
) {
  const response = await api.resolveCodeReviewFinding({
    params: { id: sessionId, reviewId, findingId },
    body,
  });
  assertApiStatus(response, 200, 'Could not update finding');
}

export async function listReviewChecks(
  sessionId: string,
  reviewId: string,
  signal?: AbortSignal,
  before?: string,
) {
  const response = await api.listReviewChecks({
    params: { id: sessionId, reviewId },
    query: { before },
    fetchOptions: { signal },
  });
  assertApiStatus(response, 200, 'Could not load verification checks');
  return response.body;
}
export async function getReviewCheck(
  sessionId: string,
  reviewId: string,
  checkId: string,
  signal?: AbortSignal,
) {
  const response = await api.getReviewCheck({
    params: { id: sessionId, reviewId, checkId },
    fetchOptions: { signal },
  });
  assertApiStatus(response, 200, 'Could not load check output');
  return response.body;
}
export async function runReviewCheck(
  sessionId: string,
  reviewId: string,
  body: import('@agentctl/shared').RunReviewCheck,
) {
  const response = await api.runReviewCheck({ params: { id: sessionId, reviewId }, body });
  assertApiStatus(response, 202, 'Could not start check');
  return response.body;
}
export async function cancelReviewCheck(sessionId: string, reviewId: string, checkId: string) {
  const response = await api.cancelReviewCheck({
    params: { id: sessionId, reviewId, checkId },
    body: {},
  });
  assertApiStatus(response, 200, 'Could not cancel check');
}
export async function confirmReviewFindingEvidence(
  sessionId: string,
  reviewId: string,
  findingId: string,
  body: import('@agentctl/shared').ConfirmFindingEvidence,
) {
  const response = await api.confirmReviewFindingEvidence({
    params: { id: sessionId, reviewId, findingId },
    body,
  });
  assertApiStatus(response, 200, 'Could not save finding evidence');
}

export async function getCodeReviewFile(
  sessionId: string,
  reviewId: string,
  path: string,
  signal?: AbortSignal,
) {
  const response = await api.getCodeReviewFile({
    params: { id: sessionId, reviewId },
    query: { path },
    fetchOptions: { signal },
  });
  assertApiStatus(response, 200, 'Could not load captured review code');
  return response.body;
}

export async function prepareReviewFindingHandoff(
  sessionId: string,
  reviewId: string,
  findingId: string,
  body: import('@agentctl/shared').PrepareReviewHandoff,
  signal?: AbortSignal,
) {
  const response = await api.prepareReviewFindingHandoff({
    params: { id: sessionId, reviewId, findingId },
    body,
    fetchOptions: { signal },
  });
  assertApiStatus(response, 200, 'Could not prepare finding request');
  return response.body;
}

export async function updateWalkthroughProgress(
  sessionId: string,
  reviewId: string,
  body: import('@agentctl/shared').UpdateWalkthroughProgress,
) {
  const response = await api.updateWalkthroughProgress({
    params: { id: sessionId, reviewId },
    body,
  });
  assertApiStatus(response, 200, 'Could not save walkthrough progress');
  return response.body;
}
export async function prepareWalkthroughQuestion(
  sessionId: string,
  reviewId: string,
  position: number,
  signal?: AbortSignal,
) {
  const response = await api.prepareWalkthroughQuestion({
    params: { id: sessionId, reviewId, position },
    body: {},
    fetchOptions: { signal },
  });
  assertApiStatus(response, 200, 'Could not prepare section question');
  return response.body;
}
