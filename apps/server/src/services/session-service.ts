import type { DbClient } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { WorktreeManager } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { FastifyBaseLogger } from 'fastify';
import { sessionsContract } from '@agentctl/shared';
import type { z } from 'zod';
import type { SessionCommands } from './session-commands.js';
import type { SessionGitService } from './session-git-service.js';
import type { NativeSessionImportService } from './native-session-import-service.js';
import { createSessionServices } from '../composition/session-services.js';

/** Stable application facade; owners and dependency construction live in focused modules. */
export class SessionService {
  private readonly parts: ReturnType<typeof createSessionServices>;
  constructor(
    db: DbClient,
    private readonly manager: SessionManager,
    workspaces: WorktreeManager,
    providers: ProviderRegistry,
    logger: FastifyBaseLogger,
  ) {
    this.parts = createSessionServices(db, manager, workspaces, providers, logger, (params) =>
      this.createSession(params),
    );
  }
  getSessions() {
    return this.parts.queries.list();
  }
  getExecution(sessionId: string) {
    return this.parts.queries.execution(sessionId);
  }
  async getSessionWithCapabilities(sessionId: string) {
    const session = await this.parts.queries.findDetail(sessionId);
    await this.parts.reconciler.reconcile(session);
    return this.parts.queries.withCapabilities(session);
  }
  importNativeSession(...args: Parameters<NativeSessionImportService['importNativeSession']>) {
    return this.parts.nativeImport.importNativeSession(...args);
  }
  listBranches(...args: Parameters<SessionGitService['listBranches']>) {
    return this.parts.git.listBranches(...args);
  }
  checkoutBranch(...args: Parameters<SessionGitService['checkoutBranch']>) {
    return this.parts.git.checkoutBranch(...args);
  }
  mergeSessionBranch(...args: Parameters<SessionGitService['mergeSessionBranch']>) {
    return this.parts.git.mergeSessionBranch(...args);
  }
  checkMergeBranch(...args: Parameters<SessionGitService['checkMergeBranch']>) {
    return this.parts.git.checkMergeBranch(...args);
  }
  createSession(...args: Parameters<SessionCommands['createSession']>) {
    return this.parts.commands.createSession(...args);
  }
  updateSessionProvider(...args: Parameters<SessionCommands['updateSessionProvider']>) {
    return this.parts.commands.updateSessionProvider(...args);
  }
  switchMode(...args: Parameters<SessionCommands['switchMode']>) {
    return this.parts.commands.switchMode(...args);
  }
  updateApprovalMode(...args: Parameters<SessionCommands['updateApprovalMode']>) {
    return this.parts.commands.updateApprovalMode(...args);
  }
  finalizeSession(...args: Parameters<SessionCommands['finalizeSession']>) {
    return this.parts.commands.finalizeSession(...args);
  }
  deleteSession(...args: Parameters<SessionCommands['deleteSession']>) {
    return this.parts.commands.deleteSession(...args);
  }
  archiveSession(...args: Parameters<SessionCommands['archiveSession']>) {
    return this.parts.commands.archiveSession(...args);
  }
  restartSession(...args: Parameters<SessionCommands['restartSession']>) {
    return this.parts.commands.restartSession(...args);
  }
  cancelSession(...args: Parameters<SessionCommands['cancelSession']>) {
    return this.parts.commands.cancelSession(...args);
  }
  writeTerminalInput(...args: Parameters<SessionCommands['writeTerminalInput']>) {
    return this.parts.commands.writeTerminalInput(...args);
  }
  rewindSession(...args: Parameters<SessionCommands['rewindSession']>) {
    return this.parts.commands.rewindSession(...args);
  }
  undoRewind(...args: Parameters<SessionCommands['undoRewind']>) {
    return this.parts.commands.undoRewind(...args);
  }
  previewSnapshotDiff(...args: Parameters<SessionCommands['previewSnapshotDiff']>) {
    return this.parts.commands.previewSnapshotDiff(...args);
  }
  restoreSnapshot(...args: Parameters<SessionCommands['restoreSnapshot']>) {
    return this.parts.commands.restoreSnapshot(...args);
  }
  spawnParallelAgent(...args: Parameters<SessionCommands['spawnParallelAgent']>) {
    return this.parts.commands.spawnParallelAgent(...args);
  }
  renameSession(...args: Parameters<SessionCommands['renameSession']>) {
    return this.parts.commands.renameSession(...args);
  }
  respondToElicitation(...args: Parameters<SessionCommands['respondToElicitation']>) {
    return this.parts.commands.respondToElicitation(...args);
  }
  getRepositoryService() {
    return this.manager.getRepositoryService();
  }

  getSnapshotService(...args: Parameters<SessionCommands['getSnapshotService']>) {
    return this.parts.commands.getSnapshotService(...args);
  }

  async patchSession(id: string, body: z.infer<typeof sessionsContract.patchSession.body>) {
    if (
      body.pinned !== undefined ||
      body.settled !== undefined ||
      body.lastReadEventId !== undefined
    )
      await this.parts.commands.updateSidebarState(id, body);
    if (body.title !== undefined) await this.renameSession(id, body.title);
    if (body.mode !== undefined) await this.switchMode(id, body.mode);
    if (body.approvalMode !== undefined) await this.updateApprovalMode(id, body.approvalMode);
    if (body.providerId !== undefined)
      await this.updateSessionProvider(id, {
        selectedProvider: body.providerId,
        selectedModel: body.modelId ?? '',
        selectedThinkingEffort: body.thinkingEffort,
      });
    if (body.persona !== undefined) await this.manager.setAgentPersona(id, body.persona);
    if (body.configId !== undefined && body.configValue !== undefined)
      await this.manager.setConfigOption(id, body.configId, body.configValue);
    if (body.branch !== undefined) await this.checkoutBranch(id, body.branch);
    if (
      Object.keys(body).every(
        (key) => key === 'pinned' || key === 'settled' || key === 'lastReadEventId',
      )
    ) {
      // Sidebar preferences must never restore worktrees or reconnect a provider.
      return this.parts.queries.withCapabilities(await this.parts.queries.findDetail(id));
    }
    return this.getSessionWithCapabilities(id);
  }
}
