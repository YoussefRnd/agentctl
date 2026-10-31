import type { ClientInferResponseBody } from '@ts-rest/core';
import type { apiContract } from '@agentctl/shared';
import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';
import { sessionEventDetailSchema } from '@agentctl/shared';
import { apiClient } from '../api-client.js';

export async function fetchSessionEventDetail(
  sessionId: string,
  eventId: number,
  signal?: AbortSignal,
) {
  const result = sessionEventDetailSchema.parse(
    await apiClient.fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/events/${eventId}/detail`,
      { signal },
    ),
  );
  if (result.event.sessionId !== sessionId || result.event.id !== eventId || result.event.details)
    throw new Error('Invalid event detail response');
  return result.event;
}

export async function rewindSession(
  sessionId: string,
  eventId: number,
  mode: 'conversation' | 'files' | 'fork',
): Promise<ClientInferResponseBody<typeof apiContract.rewindSession, 200>> {
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

export async function restoreSnapshot(
  sessionId: string,
  snapshotHash: string,
): Promise<ClientInferResponseBody<typeof apiContract.restoreSnapshot, 200>> {
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
): Promise<ClientInferResponseBody<typeof apiContract.previewSnapshotDiff, 200>> {
  const res = await api.previewSnapshotDiff({
    params: { id: sessionId, eventId },
  });
  assertApiStatus(res, 200, 'Failed to preview snapshot');
  return res.body;
}
