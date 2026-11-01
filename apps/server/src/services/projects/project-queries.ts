import { and, eq, sql, isNull, inArray, or } from 'drizzle-orm';
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
    // Summarize root activity without shipping transcripts or issuing a query per session.
    const activityRows = await this.db
      .select({
        sessionId: sessionEvents.sessionId,
        hasUserActivity: sql<number>`max(case when ${sessionEvents.type} = 'text'
          and json_extract(${sessionEvents.data}, '$.role') = 'user' then 1 else 0 end)`,
        latestActivityEventId: sql<number>`max(case when
        (${sessionEvents.type} = 'text' and json_extract(${sessionEvents.data}, '$.role') = 'provider')
        or (${sessionEvents.type} = 'approval_request' and json_extract(${sessionEvents.data}, '$.requiresApproval') = 1)
        or (${sessionEvents.type} = 'status' and json_extract(${sessionEvents.data}, '$.status') in
          ('turn_end', 'prompt_failed', 'runtime_error', 'elicitation_requested')
          and coalesce(json_extract(${sessionEvents.data}, '$.diagnosticOnly'), 0) = 0)
        then ${sessionEvents.id} else 0 end)`,
        turnStartedId: sql<number>`max(case when json_extract(${sessionEvents.data}, '$.status') = 'turn_started' then ${sessionEvents.id} else 0 end)`,
        turnEndId: sql<number>`max(case when json_extract(${sessionEvents.data}, '$.status') = 'turn_end' then ${sessionEvents.id} else 0 end)`,
        failedId: sql<number>`max(case when json_extract(${sessionEvents.data}, '$.status') = 'turn_end'
        and json_extract(${sessionEvents.data}, '$.stopReason') = 'error' then ${sessionEvents.id} else 0 end)`,
        stoppedId: sql<number>`max(case when json_extract(${sessionEvents.data}, '$.status') = 'turn_end'
        and json_extract(${sessionEvents.data}, '$.stopReason') in ('cancelled', 'canceled') then ${sessionEvents.id} else 0 end)`,
        inputId: sql<number>`max(case when json_extract(${sessionEvents.data}, '$.status') = 'elicitation_requested'
        and not exists (select 1 from session_events response
          where response.session_id = session_events.session_id and response.type = 'status'
          and json_extract(response.data, '$.status') = 'elicitation_responded'
          and json_extract(response.data, '$.elicitationId') = json_extract(session_events.data, '$.elicitation.id'))
        then ${sessionEvents.id} else 0 end)`,
      })
      .from(sessionEvents)
      .where(
        and(
          or(
            isNull(sessionEvents.parentEventId),
            eq(sessionEvents.type, 'approval_request'),
            and(
              eq(sessionEvents.type, 'status'),
              sql`json_extract(${sessionEvents.data}, '$.status') = 'elicitation_requested'`,
            ),
          ),
          inArray(sessionEvents.type, ['text', 'status', 'approval_request']),
        ),
      )
      .groupBy(sessionEvents.sessionId);
    const activityBySession = new Map(activityRows.map((row) => [row.sessionId, row]));

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
              hasUserActivity: Boolean(activityBySession.get(session.id)?.hasUserActivity),
              latestActivityEventId: activityBySession.get(session.id)?.latestActivityEventId ?? 0,
              sidebarActivity: (() => {
                const activity = activityBySession.get(session.id);
                if (session.status === 'needs_attention') return 'approval';
                if (session.status === 'error') return 'failed';
                if (session.status === 'running')
                  return activity &&
                    activity.inputId > Math.max(activity.turnStartedId, activity.turnEndId)
                    ? 'input'
                    : 'working';
                if (!activity?.turnEndId) return 'idle';
                if (activity.turnEndId === activity.failedId) return 'failed';
                if (activity.turnEndId === activity.stoppedId) return 'stopped';
                return 'completed';
              })(),
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
