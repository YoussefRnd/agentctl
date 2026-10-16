import { generateGitText } from '@agentctl/core';
import type { AgentDriver } from '@agentctl/core';
import type { DbClient } from '@agentctl/core/db';
import { projects, sessions } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
import {
  buildGitTextContext,
  resolveGitTextGenerationSelection,
  type GitRepositoryAccess,
  type GitWorkingCopyOperations,
  type GitBranchOperations,
  type GitRemoteOperations,
  type GitPullRequestOperations,
} from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { SessionManager } from '@agentctl/core/session';
import { canMutateWorkspace, sessionGitContract } from '@agentctl/shared';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { refreshProjectRepository } from './project-repository.js';
import { publishWorkspaceChange } from './session-state-events.js';
import type { EventBus } from '../utils/event-bus.js';
import type { SessionService } from './session-service.js';

export class SessionGitOperations {
  private readonly generatingDrafts = new Set<string>();
  constructor(
    private readonly db: DbClient,
    private readonly workspaces: Pick<GitRepositoryAccess, 'resolveRepository'> &
      GitWorkingCopyOperations &
      Pick<GitBranchOperations, 'getMergePreview'> &
      GitRemoteOperations &
      Pick<GitPullRequestOperations, 'createPullRequest'>,
    private readonly manager: Pick<SessionManager, 'runWorkspaceCommand'>,
    private readonly sessions: Pick<SessionService, 'getSnapshotService'>,
    private readonly providers: ProviderRegistry,
    private readonly events: Pick<EventBus, 'publishState'>,
    private readonly textDriver: AgentDriver,
  ) {}
  private async context(id: string, required = true) {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
    if (!session) throw new AppError('Session not found', 404);
    const savedProject = await this.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });
    if (!savedProject) throw new AppError('Project not found', 404);
    const project = await refreshProjectRepository(this.db, this.workspaces, savedProject);
    if (project.repoRoot !== savedProject.repoRoot) publishWorkspaceChange(this.events, id);
    if (required && !canMutateWorkspace(session.status))
      throw new AppError('Git changes require an idle workspace', 400);
    if (required && !project.repoRoot) throw new AppError('Project is not a Git repository', 400);
    return { session, project };
  }
  private async mutate<T>(
    id: string,
    action: string,
    operation: (context: Awaited<ReturnType<SessionGitOperations['context']>>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.manager.runWorkspaceCommand(id, { action }, async () => {
        const context = await this.context(id);
        try {
          return await operation(context);
        } finally {
          publishWorkspaceChange(this.events, id);
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error instanceof Error ? error.message : String(error), 400);
    }
  }
  async preview(
    id: string,
    query: z.infer<typeof sessionGitContract.getSessionMergePreview.query>,
  ) {
    const { session, project } = await this.context(id);
    if (session.mode !== 'worktree')
      throw new AppError('Only worktree sessions merge into a destination branch', 400);
    const result = await this.workspaces.getMergePreview(
      project.repoRoot!,
      session.worktreePath,
      session.branch,
      query.targetBranch ?? session.baseBranch ?? 'main',
    );
    if (
      result.hasMergeHead &&
      query.targetBranch &&
      query.targetBranch !== (session.baseBranch ?? 'main')
    )
      throw new AppError(
        `Finish or abort the pending merge into ${session.baseBranch ?? 'main'} before choosing another destination.`,
        400,
      );
    return result;
  }
  async review(id: string, query: z.infer<typeof sessionGitContract.getSessionReview.query>) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, id),
    });
    if (!session) throw new AppError('Session not found', 404);
    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });
    if (!project) throw new AppError('Project not found', 404);

    const snapshotService = this.sessions.getSnapshotService();
    if (query.fromHash && query.toHash && query.filePath) {
      const files = await snapshotService.getCheckpointDiffFiles(
        session.worktreePath,
        query.fromHash,
        query.toHash,
        query.filePath,
      );
      return { files };
    }
    const review = await snapshotService.getReview(session.worktreePath, session.baseCommit, {
      includeDiffs: query.includeDiffs !== 'false',
      filePath: query.filePath,
      scope: query.scope,
    });
    return review;
  }
  async status(id: string) {
    const { session, project } = await this.context(id, false);
    if (!project.repoRoot) {
      return {
        isRepo: false,
        branch: null,
        hasPrimaryRemote: false,
        remoteName: null,
        remoteProvider: null,
        upstreamBranch: null,
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      };
    }
    const status = await this.workspaces.getTrackingStatus(project.repoRoot, session.worktreePath);
    return status;
  }
  async generateDraft(id: string, body: z.infer<typeof sessionGitContract.generateGitDraft.body>) {
    if (this.generatingDrafts.has(id))
      throw new AppError('A draft is already being generated for this session.', 400);
    this.generatingDrafts.add(id);
    try {
      const { session, project } = await this.context(id);
      const { provider, modelId } = resolveGitTextGenerationSelection(this.providers, session);
      const cwd = session.worktreePath || project.repoRoot!;
      const context = await buildGitTextContext(cwd, body);
      const effort = provider.resolveDefaultSelection().selectedThinkingEffort;
      const launch = provider.getLaunchConfig(modelId, effort);
      const draft = await generateGitText(
        this.textDriver,
        launch,
        {
          providerId: provider.id,
          selectedModel: modelId,
          selectedThinkingEffort: effort,
          customModels: provider.toDiscovery().customModels,
          features: provider.features,
        },
        context.prompt,
        body.kind,
      );
      const latest = await buildGitTextContext(cwd, body);
      if (latest.fingerprint !== context.fingerprint)
        throw new Error(
          'The selected changes changed while generating. Generate a new draft for the latest changes.',
        );
      return draft;
    } finally {
      this.generatingDrafts.delete(id);
    }
  }

  stageFile(id: string, file: string) {
    return this.mutate(id, 'stageFile', ({ session, project }) =>
      this.workspaces.stageFile(project.repoRoot!, session.worktreePath, file),
    );
  }
  revertFile(id: string, file: string) {
    return this.mutate(id, 'revertFile', ({ session, project }) =>
      this.workspaces.revertFile(project.repoRoot!, session.worktreePath, file),
    );
  }
  unstageFile(id: string, file: string) {
    return this.mutate(id, 'unstageFile', ({ session, project }) =>
      this.workspaces.unstageFile(project.repoRoot!, session.worktreePath, file),
    );
  }
  stageAll(id: string) {
    return this.mutate(id, 'stageAll', ({ session, project }) =>
      this.workspaces.stageAll(project.repoRoot!, session.worktreePath),
    );
  }
  unstageAll(id: string) {
    return this.mutate(id, 'unstageAll', ({ session, project }) =>
      this.workspaces.unstageAll(project.repoRoot!, session.worktreePath),
    );
  }
  commit(id: string, message: string, includeUnstaged?: boolean) {
    return this.mutate(id, 'commit', ({ session, project }) =>
      this.workspaces.commit(project.repoRoot!, session.worktreePath, message, includeUnstaged),
    );
  }
  push(id: string) {
    return this.mutate(id, 'push', ({ session, project }) =>
      this.workspaces.push(project.repoRoot!, session.worktreePath),
    );
  }
  pull(id: string) {
    return this.mutate(id, 'pull', ({ session, project }) =>
      this.workspaces.pull(project.repoRoot!, session.worktreePath),
    );
  }
  fetch(id: string) {
    return this.mutate(id, 'fetch', ({ session, project }) =>
      this.workspaces.fetch(project.repoRoot!, session.worktreePath),
    );
  }
  createPullRequest(id: string, body: z.infer<typeof sessionGitContract.createPullRequest.body>) {
    return this.mutate(id, 'createPullRequest', ({ session, project }) =>
      this.workspaces.createPullRequest(project.repoRoot!, session.worktreePath, body),
    );
  }
}
