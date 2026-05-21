import { eq } from 'drizzle-orm';
import { sessions, projects } from '../db/schema.js';
import type { DbClient, ACPSession } from './acp-session.js';
import type { WorktreeManager } from '../git/worktree-manager.js';
import type { DriverRegistry } from './acp-driver-registry.js';
import type { SessionManager } from './session-manager.js';

export interface CreateSessionParams {
  projectId: string;
  driverId: string;
  taskSlug: string;
}

export class SessionOrchestrator {
  constructor(
    private db: DbClient,
    private worktreeManager: WorktreeManager,
    private driverRegistry: DriverRegistry,
    private sessionManager: SessionManager,
  ) {}

  async create(params: CreateSessionParams): Promise<ACPSession> {
    const { projectId, driverId, taskSlug } = params;

    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const driver = await this.driverRegistry.ensureDriverReady(driverId, { force: false });
    if (driver.status !== 'ready' && driver.status !== 'needs_auth') {
      throw new Error(`Selected agent is not ready: ${driverId}`);
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

    const selection = driver.resolveDefaultSelection();

    await this.db.insert(sessions).values({
      id: sessionId,
      projectId,
      branch,
      worktreePath,
      agent: driverId,
      status: 'idle',
      taskSlug,
      baseCommit,
      ...selection,
    });

    const launch = driver.getLaunchConfig(
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
