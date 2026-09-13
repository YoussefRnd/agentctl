import type { SessionStatus } from '@agentctl/shared';
import type { ACPEventDbRow } from '../db/zod-schemas.js';

export interface SessionEventStoreLike {
  append(
    sessionId: string,
    type: string,
    data: unknown,
    parentEventId?: number | null,
    metadata?: unknown,
  ): Promise<number>;
  getEvent(eventId: number): Promise<{ id: number; type: string; data: unknown } | null>;
  update(eventId: number, data: unknown, metadata?: unknown): Promise<void>;
  updateSilently(eventId: number, data: unknown, metadata?: unknown): Promise<void>;
  publishTransient(event: ACPEventDbRow, delta?: string): void;
}

export interface SnapshotServiceLike {
  track(cwd: string): Promise<string | undefined>;
  getTurnChanges?(
    projectPath: string,
    fromHash: string,
    toHash?: string,
  ): Promise<{
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      status: 'added' | 'modified' | 'deleted';
    }>;
    totalAdditions: number;
    totalDeletions: number;
  }>;
}

export interface SessionStatusTransitioner {
  transitionTo(
    sessionId: string,
    targetState: SessionStatus,
    context?: Record<string, unknown>,
  ): Promise<void>;
  getSnapshotService?(): SnapshotServiceLike | undefined;
}
