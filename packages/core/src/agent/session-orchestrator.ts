import { eq } from 'drizzle-orm';
import { sessions, projects } from '../db/schema.js';
import type { DbClient, ACPSession } from './acp-session.js';
import type { WorktreeManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { SessionManager } from './session-manager.js';
import type { ProviderName } from '@agentctl/shared';

export interface CreateSessionParams {
  projectId: string;
  providerId: string;
  taskSlug: string;
}

export class SessionOrchestrator {
  constructor(
    private db: DbClient,
    private worktreeManager: WorktreeManager,
    private providerRegistry: ProviderRegistry,
    private sessionManager: SessionManager,
  ) {}

  async create(params: CreateSessionParams): Promise<ACPSession> {
    const { projectId, providerId, taskSlug } = params;

    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const provider = await this.providerRegistry.ensureProviderReady(providerId, { force: false });
    if (provider.status !== 'ready' && provider.status !== 'needs_auth') {
      throw new Error(`Selected agent is not ready: ${providerId}`);
    }

    const sessionId = crypto.randomUUID();

    let branch = 'main';
    let worktreePath = project.path;
    let workspacePath = project.path;
    let baseCommit = 'none';

    if (project.repoRoot) {
      const worktree = await this.worktreeManager.create(
        project.repoRoot,
        sessionId,
        taskSlug,
        'main',
        project.subdir,
      );
      branch = worktree.branch;
      worktreePath = worktree.path;
      workspacePath = worktree.workspacePath;
      baseCommit = worktree.baseCommit;
    }

    const selection = provider.resolveDefaultSelection();

    await this.db.insert(sessions).values({
      id: sessionId,
      projectId,
      branch,
      worktreePath,
      agent: providerId,
      status: 'idle',
      taskSlug,
      baseCommit,
      selectedProvider: providerId as ProviderName,
      selectedModel: selection.selectedModel,
      selectedThinkingEffort: selection.selectedThinkingEffort,
    });

    const launch = provider.getLaunchConfig(
      selection.selectedModel,
      selection.selectedThinkingEffort,
    );

    return this.sessionManager.startSession(
      sessionId,
      workspacePath,
      launch.command,
      launch.args,
      launch.env,
    );
  }
}
