import { eq, desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import path from 'node:path';
import { projects, sessions, type DbClient } from '@agentctl/core/db';
import type { GitRepositoryAccess } from '@agentctl/core/git';
import { projectsContract, sessionRowSchema, createTaskSlug } from '@agentctl/shared';
import type { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import type { EventBus } from '../../utils/event-bus.js';
import type { SessionService } from '../session-service.js';
import type { ProjectDirectory } from './project-directory.js';

export type OpenProjectInput = z.infer<typeof projectsContract.openProject.body>;

/** Owns the open/reuse/create workflow and publishes changes after persistence. */
export class ProjectService {
  constructor(
    private readonly db: DbClient,
    private readonly directories: ProjectDirectory,
    private readonly repositories: Pick<GitRepositoryAccess, 'resolveRepository'>,
    private readonly sessions: Pick<SessionService, 'createSession'>,
    private readonly events: Pick<EventBus, 'publishState'>,
  ) {}

  async open(body: OpenProjectInput) {
    const normalizedPath = await this.directories.resolve(body.path, async () => {
      const knownProjects = await this.db.select({ path: projects.path }).from(projects);
      return knownProjects.map((p) => p.path);
    });
    const repoInfo = await this.repositories
      .resolveRepository(normalizedPath)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        throw new AppError(`Cannot open folder: ${msg}`, 400);
      });

    const repoRoot = repoInfo.isGitRepo ? repoInfo.repoRoot : null;
    const subdir = repoInfo.isGitRepo ? repoInfo.workdirPrefix : '';

    const existing = await this.db
      .select()
      .from(projects)
      .where(eq(projects.path, normalizedPath))
      .limit(1);

    let project;
    let projectChanged = false;
    if (existing.length > 0) {
      project = existing[0];

      if (project.repoRoot === null && repoRoot !== null) {
        const [updated] = await this.db
          .update(projects)
          .set({ repoRoot, subdir })
          .where(eq(projects.id, project.id))
          .returning();
        project = updated;
        projectChanged = true;
      }
    } else {
      const projectName = path.basename(normalizedPath);
      const projectId = crypto.randomUUID();

      const [createdProject] = await this.db
        .insert(projects)
        .values({
          id: projectId,
          name: projectName,
          path: normalizedPath,
          repoRoot,
          subdir,
        })
        .returning();
      project = createdProject;
      projectChanged = true;
    }

    if (body.startSession === false) {
      if (projectChanged) this.events.publishState({ topics: ['projects'] });
      return {
        project: { id: project.id, name: project.name, path: project.path },
        session: null,
        created: projectChanged,
      };
    }

    const existingSessions = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, project.id))
      .orderBy(desc(sessions.updatedAt))
      .limit(1);

    if (existingSessions.length > 0) {
      if (projectChanged) {
        this.events.publishState({ topics: ['projects'] });
      }
      return {
        project: { id: project.id, name: project.name, path: project.path },
        session: sessionRowSchema.parse(existingSessions[0]),
        created: false,
      };
    }

    const session = await this.sessions.createSession({
      projectId: project.id,
      providerId: body.agent,
      taskSlug: createTaskSlug(body.taskSlug),
      mode: body.mode,
    });
    this.events.publishState({
      topics: ['projects', 'session'],
      sessionId: session.id,
    });

    return {
      project: { id: project.id, name: project.name, path: project.path },
      session: session,
      created: true,
    };
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
    this.events.publishState({ topics: ['projects'] });
  }
}
