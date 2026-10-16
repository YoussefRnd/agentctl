import { and, eq, sql } from 'drizzle-orm';
import { projects, sessionEvents, sessions, type DbClient } from '@agentctl/core/db';
import { projectsContract, sessionRowSchema } from '@agentctl/shared';
import type { z } from 'zod';

export type ProjectListQuery = z.infer<typeof projectsContract.getProjects.query>;

/** Read-model assembly stays independent of HTTP and workspace lifecycle. */
export class ProjectQueries {
  constructor(private readonly db: DbClient) {}

  async list(query: ProjectListQuery) {
    const { search, gitOnly, sortBy = 'lastActive', sortOrder = 'desc' } = query;
    const allProjects = await this.db.select().from(projects);
    const allSessions = await this.db.select().from(sessions);
    const sessionsWithUserActivity = new Set(
      (
        await this.db
          .selectDistinct({ sessionId: sessionEvents.sessionId })
          .from(sessionEvents)
          .where(
            and(
              eq(sessionEvents.type, 'text'),
              sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
            ),
          )
      ).map((row) => row.sessionId),
    );

    const sessionsByProject = new Map<string, typeof allSessions>();
    for (const session of allSessions) {
      const group = sessionsByProject.get(session.projectId);
      if (group) group.push(session);
      else sessionsByProject.set(session.projectId, [session]);
    }

    let mapped = allProjects.map((p) => {
      const projSessions = sessionsByProject.get(p.id) ?? [];
      const lastSessionUpdate = projSessions.reduce(
        (latest, session) => Math.max(latest, session.lastActivityAt.getTime()),
        p.createdAt.getTime(),
      );

      return {
        ...p,
        isGitRepo: p.repoRoot !== null,
        sessions: projSessions
          .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
          .map((session) =>
            sessionRowSchema.parse({
              ...session,
              hasUserActivity: sessionsWithUserActivity.has(session.id),
            }),
          ),
        lastActiveTime: lastSessionUpdate,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      mapped = mapped.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          p.sessions.some(
            (s: { title?: string | null; taskSlug?: string | null; branch?: string | null }) =>
              (s.title ?? s.taskSlug ?? s.branch ?? '').toLowerCase().includes(q),
          ),
      );
    }

    if (gitOnly === 'true') {
      mapped = mapped.filter((p) => p.isGitRepo);
    }

    mapped.sort((a, b) => {
      let valA: string | number;
      let valB: string | number;

      if (sortBy === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortBy === 'createdAt') {
        valA = a.createdAt.getTime();
        valB = b.createdAt.getTime();
      } else {
        valA = a.lastActiveTime;
        valB = b.lastActiveTime;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return mapped;
  }
}
