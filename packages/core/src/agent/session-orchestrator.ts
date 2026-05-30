import { eq } from 'drizzle-orm';
import { sessions, projects } from '../db/schema.js';
import type { DbClient, ACPSession } from './acp-session.js';
import type { WorktreeManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { SessionManager } from './session-manager.js';
import type { ProviderName, SessionMode } from '@agentctl/shared';

export interface CreateSessionParams {
  projectId: string;
  providerId: string;
  taskSlug: string;
  mode?: SessionMode;
}

export class SessionOrchestrator {
  constructor(
    private db: DbClient,
    private worktreeManager: WorktreeManager,
    private providerRegistry: ProviderRegistry,
    private sessionManager: SessionManager,
  ) {}

  async create(params: CreateSessionParams): Promise<ACPSession> {
    const { projectId, providerId, taskSlug, mode } = params;

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
    let resolvedMode: SessionMode = mode ?? (project.repoRoot ? 'worktree' : 'local');

    if (project.repoRoot && resolvedMode === 'worktree') {
      try {
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('empty repository')) {
          // Fallback to local mode
          resolvedMode = 'local';
          worktreePath = project.path;
          workspacePath = project.path;
          baseCommit = 'none';
        } else {
          throw error;
        }
      }
    }

    if (resolvedMode === 'local') {
      // Local mode or fallback if no repoRoot or empty repo
      branch = 'main'; // TODO: or current branch if local
      worktreePath = project.path;
      workspacePath = project.path;
      baseCommit = 'none';
      resolvedMode = 'local';
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
      mode: resolvedMode,
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
