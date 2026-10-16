import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';

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
