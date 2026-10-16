import type { RepositoryService } from '../repository/repository-service.js';
import type { SnapshotService } from '../git/snapshot-service.js';
import type {
  SessionEvent,
  SessionEventMetadata,
  SessionEventPayload,
  SessionStatus,
  SessionNotice,
} from '@agentctl/shared';
import type { SessionEventDbRow } from '../db/zod-schemas.js';

export interface IEventBus {
  publish(event: unknown): void;
}

export interface SessionEventRepositoryLike {
  publishNotice?(notice: SessionNotice): void;
  append<T extends SessionEvent['type']>(
    sessionId: string,
    type: T,
    data: SessionEventPayload<T>,
    parentEventId?: number | null,
    metadata?: SessionEventMetadata | null,
  ): Promise<number>;
  findMessage?(
    sessionId: string,
    role: string,
    messageId: string,
    nativeSessionId?: string,
  ): Promise<
    { eventId: number; text: string; startedAt: number; parentEventId: number | null } | undefined
  >;
  getEvent(eventId: number): Promise<{ id: number; type: string; data: unknown } | null>;
  update(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
    clearFields?: readonly string[],
  ): Promise<void>;
  updateSilently(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
  ): Promise<void>;
  publishTransient(event: SessionEventDbRow, delta?: string): void;
}

export interface CheckpointServiceLike {
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
  ownsRuntime?(sessionId: string, runtimeId: string): boolean;
  transitionTo(
    sessionId: string,
    targetState: SessionStatus,
    context?: { runtimeId?: string },
  ): Promise<void>;
  getCheckpointService?(): CheckpointServiceLike | undefined;
}

/** The native service is retained only for legacy Git HTTP compatibility. */
export interface SessionRepositoryResources {
  repositories: Pick<RepositoryService, 'open'>;
  legacySnapshots: SnapshotService;
}
