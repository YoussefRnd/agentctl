import { eq } from 'drizzle-orm';
import { sessions, projects, type DbClient } from '@agentctl/core/db';
import { AppError } from '../errors/app-error.js';

export class WorkspaceQueries {
  constructor(private readonly db: DbClient) {}
  async projectDirectory(id: string) {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project) throw new AppError('Project not found', 404);
    return project.path;
  }
  async sessionDirectory(id: string, purpose: 'context' | 'terminal') {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
    if (!session) throw new AppError(`Session not found: ${id}`, 404);
    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });
    return (
      session.worktreePath ||
      project?.repoRoot ||
      (purpose === 'context' ? project?.path : undefined) ||
      process.cwd()
    );
  }
}
