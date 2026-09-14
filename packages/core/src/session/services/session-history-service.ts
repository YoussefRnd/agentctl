import { eq, asc, desc } from 'drizzle-orm';
import { sessions, sessionEvents } from '../../db/schema.js';
import type { SessionEventDbRow } from '../../db/zod-schemas.js';
import type { SessionEvent, SessionMode, ThinkingEffort } from '@agentctl/shared';
import {
  findAgentGeneratedHandoff,
  generateHandoffDocument,
  scheduleHandoffCleanup,
  type HandoffResult,
} from '../handoff.js';
import { resolveAgentSessionId } from '../agent-session-id.js';
import { sessionEventCodecs } from '../../db/json-codecs.js';
import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { SessionEventStore } from '../event-store.js';
import type { SessionStateMachine } from '../state-machine.js';
import type { SessionWorkspace } from '../../git/session-workspace.js';
import type { SessionLauncher } from './session-launcher.js';
import type { ManagedSession } from '../managed-session.js';

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
  eventStore: SessionEventStore;
  stateMachine: SessionStateMachine;
  sessionWorkspace: SessionWorkspace;
  launcher: SessionLauncher;
  startSession: SessionLauncher['startSession'];
  restartSession: SessionLauncher['restartSession'];
  createForkSession: SessionHistoryService['createForkSession'];
  updateSessionConfig(
    sessionId: string,
    params: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort: ThinkingEffort;
    },
    options?: { forceNewAgentSession?: boolean },
  ): Promise<ManagedSession | null>;
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
      selectedThinkingEffort: string;
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
      await this.deps.eventStore.append(
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
      await this.deps.startSession(
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
    } catch (error) {
      await this.deps.db
        .update(sessions)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(sessions.id, forkSessionId));
      await this.deps.eventStore.append(forkSessionId, 'status', {
        status: 'error',
        title: error instanceof Error ? error.message : 'Failed to start forked session',
      });
      throw error;
    }

    return forkSessionId;
  }

  async handoffSession(
    sessionId: string,
    targetProvider: string,
    targetModel?: string,
    nextSessionFocus?: string,
  ): Promise<{
    sessionId: string;
    handoffFilePath: string;
    initialPrompt: string;
    handoffSource: HandoffResult['source'];
  }> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (sessionRecord.status === 'running') {
      throw new Error('Wait for the current agent turn to finish before switching providers');
    }
    if (sessionRecord.selectedProvider === targetProvider) {
      throw new Error(`Session is already using provider: ${targetProvider}`);
    }

    const { providerId: resolvedProviderId, selection } =
      await this.deps.launcher.resolveSessionProviderAndParameters(
        sessionRecord.projectId,
        targetProvider,
        targetModel,
        sessionRecord.selectedThinkingEffort as ThinkingEffort,
      );

    const latestEventRows = await this.deps.db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(desc(sessionEvents.id))
      .limit(1);
    const latestEventId = latestEventRows[0]?.id ?? 0;

    let handoffResult: HandoffResult | null = null;
    try {
      const sourceSession =
        this.deps.stateMachine.getSession(sessionId) ?? (await this.deps.restartSession(sessionId));
      const focusParts = [`Continue this work with ${resolvedProviderId}.`];
      if (nextSessionFocus?.trim()) {
        focusParts.push(nextSessionFocus.trim());
      }
      await sourceSession.prompt(focusParts.join(' '), undefined, undefined, {
        purpose: 'provider-handoff',
      });
      await sourceSession.flushAll();

      const generatedEvents = await this.deps.db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(desc(sessionEvents.id));
      const responseTexts = generatedEvents
        .filter((event) => event.id > latestEventId && event.type === 'text')
        .map((event) => {
          const data = sessionEventCodecs.text(event.data);
          return data.role === 'provider' ? (data.content ?? data.text ?? '') : '';
        })
        .filter((text) => text.length > 0);
      handoffResult = await findAgentGeneratedHandoff(responseTexts, sessionId);
    } catch (error) {
      this.deps.logger.warn(error, 'The source agent could not produce a handoff document');
    }

    handoffResult ??= await generateHandoffDocument(this.deps.db, sessionId, resolvedProviderId, {
      nextSessionFocus,
      maxEventId: latestEventId,
    });

    const sessionBeforeSwitch = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (sessionBeforeSwitch?.status === 'running') {
      scheduleHandoffCleanup(handoffResult.filePath);
      throw new Error('The source agent started another turn before the handoff could complete');
    }

    const sourceSelection = {
      selectedProvider: sessionRecord.selectedProvider,
      selectedModel: sessionRecord.selectedModel,
      selectedThinkingEffort: sessionRecord.selectedThinkingEffort as ThinkingEffort,
    };
    const initialPrompt = `Continue the work from the attached handoff context.${
      nextSessionFocus && nextSessionFocus.trim().length > 0
        ? ` Focus for this session: ${nextSessionFocus.trim()}`
        : ''
    }`;

    try {
      const targetSession = await this.deps.updateSessionConfig(
        sessionId,
        {
          selectedProvider: resolvedProviderId,
          selectedModel: selection.selectedModel,
          selectedThinkingEffort: selection.selectedThinkingEffort,
        },
        { forceNewAgentSession: true },
      );
      if (!targetSession) {
        throw new Error(`Failed to start target provider: ${resolvedProviderId}`);
      }

      await this.deps.eventStore.append(
        sessionId,
        'status',
        {
          status: 'context_handoff',
          title: `Handoff from ${sessionRecord.selectedProvider} to ${resolvedProviderId}`,
          handoffFilePath: handoffResult.filePath,
          handoffSource: handoffResult.source,
        },
        null,
      );
      await targetSession.prompt(initialPrompt, undefined, handoffResult.content);
    } catch (error) {
      await this.deps.stateMachine.stopSessionAndWait(sessionId).catch(() => undefined);
      await this.deps
        .updateSessionConfig(sessionId, sourceSelection)
        .catch((rollbackError: unknown) => {
          this.deps.logger.error(
            rollbackError,
            'Failed to restore source provider after handoff failed',
          );
        });
      throw error;
    } finally {
      scheduleHandoffCleanup(handoffResult.filePath);
    }

    return {
      sessionId,
      handoffFilePath: handoffResult.filePath,
      initialPrompt,
      handoffSource: handoffResult.source,
    };
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

    if (sessionRecord.status === 'running') {
      if (mode !== 'fork') {
        this.deps.stateMachine.stopSession(sessionId);
        await this.deps.db
          .update(sessions)
          .set({ status: 'idle', updatedAt: new Date() })
          .where(eq(sessions.id, sessionId));
      }
    }

    let undoSnapshotHash: string | undefined;
    let restoredFiles:
      Array<{ path: string; status: 'added' | 'modified' | 'deleted' }> | undefined;
    if (mode !== 'fork') {
      const event = await this.deps.eventStore.getEventWithMetadata(sessionId, eventId);
      if (!event) {
        throw new Error(`Event not found: ${String(eventId)}`);
      }

      const metadata = event.metadata as { snapshotHash?: string } | undefined;

      if (mode === 'files') {
        if (!metadata?.snapshotHash) {
          throw new Error(
            'No snapshot hash available for file rewind. This project may not be a git repo.',
          );
        }

        const snapshotService = this.deps.stateMachine.getSnapshotService();
        const projectPath =
          sessionRecord.mode === 'worktree'
            ? sessionRecord.worktreePath
            : sessionRecord.project.path;

        const restore = await snapshotService.restoreFiles(projectPath, metadata.snapshotHash);
        undoSnapshotHash = restore.backupHash;
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

      const activeSource = this.deps.stateMachine.getSession(sessionId);
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

    const deletedEvents = await this.deps.eventStore.backupAndDeleteEventsAfter(sessionId, eventId);
    this.rewindBackups.set(sessionId, {
      undoSnapshotHash,
      deletedEvents,
      eventId,
      restoredFiles,
    });
    this.deps.stateMachine.stopSession(sessionId);

    void this.deps.restartSession(sessionId).catch((err: unknown) => {
      this.deps.logger.error({ err, sessionId }, 'Failed to restart session after rewind');
    });

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

    if (backup.undoSnapshotHash) {
      const snapshotService = this.deps.stateMachine.getSnapshotService();
      const projectPath =
        sessionRecord.mode === 'worktree' && sessionRecord.worktreePath
          ? sessionRecord.worktreePath
          : sessionRecord.project.path;

      await snapshotService.restoreFiles(projectPath, backup.undoSnapshotHash);
    }

    if (backup.deletedEvents && backup.deletedEvents.length > 0) {
      await this.deps.eventStore.restoreEvents(sessionId, backup.deletedEvents);
    }

    this.rewindBackups.delete(sessionId);
    this.deps.stateMachine.stopSession(sessionId);

    void this.deps.restartSession(sessionId).catch((err: unknown) => {
      this.deps.logger.error({ err, sessionId }, 'Failed to restart session after undo rewind');
    });
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

    const event = await this.deps.eventStore.getEventWithMetadata(sessionId, eventId);
    if (!event) {
      throw new Error(`Event not found: ${String(eventId)}`);
    }

    const metadata = sessionEventCodecs.metadata(event.metadata);

    if (!metadata.snapshotHash) {
      return { hasSnapshot: false, files: [] };
    }

    const snapshotService = this.deps.stateMachine.getSnapshotService();
    const projectPath =
      sessionRecord.mode === 'worktree' ? sessionRecord.worktreePath : sessionRecord.project.path;

    const patches = await snapshotService.diff(projectPath, metadata.snapshotHash);
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
    const snapshotService = this.deps.stateMachine.getSnapshotService();
    const projectPath =
      sessionRecord.mode === 'worktree' && sessionRecord.worktreePath
        ? sessionRecord.worktreePath
        : sessionRecord.project.path;

    const restore = await snapshotService.restoreFiles(projectPath, snapshotHash);
    return { backupHash: restore.backupHash };
  }
}
