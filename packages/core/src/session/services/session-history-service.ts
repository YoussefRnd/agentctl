import { eq, asc, desc } from 'drizzle-orm';
import {
  sessions,
  sessionEvents,
  sessionProviderContexts,
  sessionEventChanges,
} from '../../db/schema.js';
import type { SessionEventDbRow } from '../../db/zod-schemas.js';
import type { SessionEvent, SessionMode, ThinkingEffort } from '@agentctl/shared';
import { resolveAgentSessionId } from '../agent-session-id.js';
import { sessionEventCodecs } from '../../db/json-codecs.js';
import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { SessionEventRepository } from '../persistence/session-event-repository.js';
import type { SessionRuntimeRegistry } from '../runtime/session-runtime-registry.js';
import type { SessionWorkspace } from '../../workspace/session-workspace.js';
import type { SessionLauncher } from './session-launcher.js';

export interface RewindBackup {
  undoSnapshotHash?: string;
  deletedEvents: SessionEventDbRow[];
  eventId: number;
  restoredFiles?: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    additions?: number;
    deletions?: number;
  }>;
}

export interface SessionHistoryDependencies {
  db: DbClient;
  logger: Logger;
  eventRepository: Pick<
    SessionEventRepository,
    'append' | 'backupAndDeleteEventsAfter' | 'getEventWithMetadata' | 'restoreEvents'
  >;
  runtimeRegistry: Pick<
    SessionRuntimeRegistry,
    'getSession' | 'getRepositoryService' | 'stopSessionAndWait'
  >;
  sessionWorkspace: Pick<SessionWorkspace, 'establish'>;
  launcher: Pick<
    SessionLauncher,
    'resolveLaunchParameters' | 'resolveSessionProviderAndParameters'
  >;
  startSession: SessionLauncher['startSession'];
  restartSession: SessionLauncher['restartSession'];
  createForkSession: SessionHistoryService['createForkSession'];
}

export class SessionHistoryService {
  private rewindBackups = new Map<string, RewindBackup>();

  constructor(private readonly deps: SessionHistoryDependencies) {}

  clearRewindBackup(sessionId: string): void {
    this.rewindBackups.delete(sessionId);
  }

  async createForkSession(
    sourceRecord: {
      id: string;
      projectId: string;
      taskSlug: string;
      mode: string;
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort: ThinkingEffort;
      contextLimit: number;
      project: { path: string; repoRoot: string | null; subdir: string };
    },
    eventsToCopy: {
      type: SessionEvent['type'];
      data: unknown;
      parentEventId: number | null;
      metadata: string | null;
    }[],
    forkFromAgentSessionId?: string,
  ): Promise<string> {
    const context = await this.deps.sessionWorkspace.establish(
      sourceRecord.projectId,
      `${sourceRecord.taskSlug}-fork`,
      {
        mode: sourceRecord.mode as SessionMode,
        agent: sourceRecord.selectedProvider,
        selectedProvider: sourceRecord.selectedProvider,
        selectedModel: sourceRecord.selectedModel,
        selectedThinkingEffort: sourceRecord.selectedThinkingEffort as ThinkingEffort,
        contextLimit: sourceRecord.contextLimit > 0 ? sourceRecord.contextLimit : 0,
        title: `${sourceRecord.taskSlug}-fork`,
      },
    );

    const forkSessionId = context.sessionId;
    const worktreePath = context.worktreePath;

    for (const evt of eventsToCopy) {
      const parsedData = sessionEventCodecs.parseData(evt.type, evt.data);
      const parsedMetadata = sessionEventCodecs.parseMetadata(evt.metadata);
      await this.deps.eventRepository.append(
        forkSessionId,
        evt.type as SessionEvent['type'],
        parsedData,
        evt.parentEventId,
        parsedMetadata,
      );
    }

    const { launch, selection } = await this.deps.launcher.resolveLaunchParameters(
      sourceRecord.selectedProvider,
      sourceRecord.selectedModel,
      sourceRecord.selectedThinkingEffort as ThinkingEffort,
    );

    try {
      const runtime = await this.deps.startSession(
        forkSessionId,
        worktreePath,
        launch.command,
        launch.args,
        launch.env,
        selection.selectedModel,
        selection.selectedThinkingEffort,
        selection.features,
        selection.resolvedThinkingConfigId,
        forkFromAgentSessionId
          ? { kind: 'fork', sessionId: forkFromAgentSessionId }
          : { kind: 'new' },
        selection.resolvedModelConfigId,
      );
      if (forkFromAgentSessionId && !runtime.requiresHistoryContext && runtime.nativeSessionId) {
        const lastCopiedEvent = await this.deps.db
          .select({ sequence: sessionEventChanges.sequence })
          .from(sessionEventChanges)
          .where(eq(sessionEventChanges.sessionId, forkSessionId))
          .orderBy(desc(sessionEventChanges.sequence))
          .limit(1);
        await this.deps.db
          .insert(sessionProviderContexts)
          .values({
            sessionId: forkSessionId,
            providerId: sourceRecord.selectedProvider,
            nativeSessionId: runtime.nativeSessionId,
            throughSequence: lastCopiedEvent[0]?.sequence ?? 0,
            status: 'delivered',
          })
          .onConflictDoNothing();
      }
    } catch (error) {
      await this.deps.db
        .update(sessions)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(sessions.id, forkSessionId));
      await this.deps.eventRepository.append(forkSessionId, 'status', {
        status: 'error',
        title: error instanceof Error ? error.message : 'Failed to start forked session',
      });
      throw error;
    }

    return forkSessionId;
  }

  async rewindSession(
    sessionId: string,
    eventId: number,
    mode: 'conversation' | 'files' | 'fork',
  ): Promise<{
    forkSessionId?: string;
    undoSnapshotHash?: string;
    restoredFiles?: Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted';
      additions?: number;
      deletions?: number;
    }>;
  }> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let undoSnapshotHash: string | undefined;
    let restoredFiles:
      | Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>
      | undefined;
    if (mode !== 'fork') {
      const event = await this.deps.eventRepository.getEventWithMetadata(sessionId, eventId);
      if (!event) {
        throw new Error(`Event not found: ${String(eventId)}`);
      }

      const metadata = event.metadata as { snapshotHash?: string } | undefined;

      if (mode === 'files' && !metadata?.snapshotHash) {
        throw new Error('No checkpoint is available for file rewind in this workspace.');
      }
      if (mode === 'files' && metadata?.snapshotHash) {
        const repository = await this.deps.runtimeRegistry
          .getRepositoryService()
          .open(sessionRecord.worktreePath);
        if (!repository.info.capabilities.restore)
          throw new Error('This workspace does not support file restoration');
        await repository.importRevision(metadata.snapshotHash);
      }
      // Finish flushing the old runtime before deleting its history or accepting another turn.
      await this.deps.runtimeRegistry.stopSessionAndWait(sessionId);
      await this.deps.db
        .update(sessions)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(sessions.id, sessionId));

      if (mode === 'files' && metadata?.snapshotHash) {
        const repositories = this.deps.runtimeRegistry.getRepositoryService();
        const projectPath =
          sessionRecord.mode === 'worktree'
            ? sessionRecord.worktreePath
            : sessionRecord.project.path;

        const repository = await repositories.open(projectPath);
        const restore = await repository.restore(
          await repository.importRevision(metadata.snapshotHash),
        );
        undoSnapshotHash = restore.backup;
        restoredFiles = restore.restoredFiles;
      }
    }

    if (mode === 'fork') {
      const events = await this.deps.db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.id));

      const eventsToCopy = events.filter((e) => e.id <= eventId);

      const activeSource = this.deps.runtimeRegistry.getSession(sessionId);
      const canForkCurrentContext =
        sessionRecord.status === 'idle' &&
        eventsToCopy.length === events.length &&
        !activeSource?.requiresHistoryContext;
      const forkFromAgentSessionId = canForkCurrentContext
        ? (resolveAgentSessionId(
            sessionRecord.agentSessionId,
            sessionRecord.selectedProvider,
            sessionRecord.agent,
          ) ?? undefined)
        : undefined;
      const forkSessionId = await this.deps.createForkSession(
        sessionRecord,
        eventsToCopy,
        forkFromAgentSessionId,
      );

      return { forkSessionId };
    }

    const deletedEvents = await this.deps.eventRepository.backupAndDeleteEventsAfter(
      sessionId,
      eventId,
    );
    this.rewindBackups.set(sessionId, {
      undoSnapshotHash,
      deletedEvents,
      eventId,
      restoredFiles,
    });
    await this.deps.restartSession(sessionId, { resumeExisting: false });

    return { undoSnapshotHash, restoredFiles };
  }

  async undoRewind(sessionId: string): Promise<void> {
    const backup = this.rewindBackups.get(sessionId);
    if (!backup) {
      throw new Error('No rewind state available to undo');
    }

    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await this.deps.runtimeRegistry.stopSessionAndWait(sessionId);

    if (backup.undoSnapshotHash) {
      const repositories = this.deps.runtimeRegistry.getRepositoryService();
      const projectPath =
        sessionRecord.mode === 'worktree' && sessionRecord.worktreePath
          ? sessionRecord.worktreePath
          : sessionRecord.project.path;

      const repository = await repositories.open(projectPath);
      await repository.restore(await repository.importRevision(backup.undoSnapshotHash));
    }

    if (backup.deletedEvents && backup.deletedEvents.length > 0) {
      await this.deps.eventRepository.restoreEvents(sessionId, backup.deletedEvents);
    }

    this.rewindBackups.delete(sessionId);
    await this.deps.restartSession(sessionId, { resumeExisting: false });
  }

  async previewSnapshotDiff(
    sessionId: string,
    eventId: number,
  ): Promise<{
    hasSnapshot: boolean;
    files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
  }> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!sessionRecord) {
      throw new Error('Session not found');
    }

    const event = await this.deps.eventRepository.getEventWithMetadata(sessionId, eventId);
    if (!event) {
      throw new Error(`Event not found: ${String(eventId)}`);
    }

    const metadata = sessionEventCodecs.metadata(event.metadata);

    if (!metadata.snapshotHash) {
      return { hasSnapshot: false, files: [] };
    }

    const repositories = this.deps.runtimeRegistry.getRepositoryService();
    const projectPath =
      sessionRecord.mode === 'worktree' ? sessionRecord.worktreePath : sessionRecord.project.path;

    const repository = await repositories.open(projectPath);
    if (
      !repository.info.capabilities.checkpoints ||
      !repository.info.capabilities.comparisons ||
      !repository.info.capabilities.restore
    )
      return { hasSnapshot: false, files: [] };
    const baseline = await repository.importRevision(metadata.snapshotHash);
    const patches = (await repository.compare(baseline, await repository.capture())).files;
    return {
      hasSnapshot: true,
      files: patches.map((p) => ({
        path: p.path,
        status: p.status,
      })),
    };
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string): Promise<{ backupHash: string }> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const repositories = this.deps.runtimeRegistry.getRepositoryService();
    const projectPath =
      sessionRecord.mode === 'worktree' && sessionRecord.worktreePath
        ? sessionRecord.worktreePath
        : sessionRecord.project.path;

    const repository = await repositories.open(projectPath);
    const restore = await repository.restore(await repository.importRevision(snapshotHash));
    return { backupHash: restore.backup };
  }
}
