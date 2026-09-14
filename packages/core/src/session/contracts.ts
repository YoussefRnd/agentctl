import type {
  SessionEvent,
  SessionEventMetadata,
  SessionEventPayload,
  SessionStatus,
} from '@agentctl/shared';
import type { SessionEventDbRow } from '../db/zod-schemas.js';

export interface SessionEventStoreLike {
  append<T extends SessionEvent['type']>(
    sessionId: string,
    type: T,
    data: SessionEventPayload<T>,
    parentEventId?: number | null,
    metadata?: SessionEventMetadata | null,
  ): Promise<number>;
  getEvent(eventId: number): Promise<{ id: number; type: string; data: unknown } | null>;
  update(eventId: number, data: unknown, metadata?: SessionEventMetadata | null): Promise<void>;
  updateSilently(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
  ): Promise<void>;
  publishTransient(event: SessionEventDbRow, delta?: string): void;
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
