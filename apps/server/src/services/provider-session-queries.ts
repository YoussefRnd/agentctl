import { eq, and } from 'drizzle-orm';
import path from 'node:path';
import { projects, nativeSessionImports, type DbClient } from '@agentctl/core/db';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { providersContract } from '@agentctl/shared';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

export class ProviderSessionQueries {
  constructor(
    private readonly db: DbClient,
    private readonly providers: Pick<ProviderRegistry, 'listNativeSessions'>,
  ) {}
  async list(
    providerId: string,
    query: z.infer<typeof providersContract.listNativeSessions.query>,
  ) {
    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, query.projectId),
    });
    if (!project) throw new AppError('Project not found', 404);
    const page = await this.providers.listNativeSessions(providerId, project.path, query.cursor);
    const imports = await this.db
      .select()
      .from(nativeSessionImports)
      .where(
        and(
          eq(nativeSessionImports.projectId, project.id),
          eq(nativeSessionImports.providerId, providerId),
          eq(nativeSessionImports.completed, true),
        ),
      );
    const sessions = page.sessions.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (
        typeof row.sessionId !== 'string' ||
        typeof row.cwd !== 'string' ||
        path.resolve(row.cwd) !== path.resolve(project.path)
      )
        return [];
      return [
        {
          sessionId: row.sessionId,
          cwd: row.cwd,
          title: typeof row.title === 'string' ? row.title : undefined,
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
          importedSessionId: imports.find((item) => item.nativeSessionId === row.sessionId)
            ?.sessionId,
        },
      ];
    });
    return { sessions, nextCursor: page.nextCursor };
  }
}
