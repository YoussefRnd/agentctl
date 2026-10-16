import { and, eq, desc, sql, type SQL } from 'drizzle-orm';
import { projects, sessions, sessionEvents, type DbClient } from '@agentctl/core/db';
import { searchContract, type SearchEventType, type SearchResultItem } from '@agentctl/shared';
import type { z } from 'zod';

export function extractEventSearchableText(type: string, data: unknown): string {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return extractEventSearchableText(type, parsed);
    } catch {
      return data;
    }
  }
  if (!data || typeof data !== 'object') return '';

  const obj = data as Record<string, unknown>;
  if (type === 'text') {
    return typeof obj.content === 'string' ? obj.content : '';
  }

  if (type === 'tool_call') {
    return [obj.name, obj.title, obj.arguments, obj.rawInput, obj.content, obj.rawOutput]
      .filter((value) => value != null)
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      .join(' ');
  }

  return JSON.stringify(obj);
}

export function categorizeSearchEvent(
  type: string,
  data: Record<string, unknown> | null,
): SearchEventType | null {
  if (type === 'tool_call') return 'tool';
  if (type !== 'text') return null;
  if (data?.role === 'user') return 'user';
  if (data?.role === 'thought') return 'thought';
  return 'agent';
}

export function createSearchSnippet(
  text: string,
  query: string,
): { snippet: string; matchIndices: [number, number] } {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    return {
      snippet: text.slice(0, 120),
      matchIndices: [0, 0],
    };
  }

  const snippetRadius = 45;
  const start = Math.max(0, index - snippetRadius);
  const end = Math.min(text.length, index + query.length + snippetRadius);
  const rawSnippet = text.substring(start, end);

  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const formattedSnippet = `${prefix}${rawSnippet}${suffix}`;

  const matchStart = prefix.length + (index - start);
  const matchEnd = matchStart + query.length;

  return {
    snippet: formattedSnippet,
    matchIndices: [matchStart, matchEnd],
  };
}

export class SearchQueries {
  constructor(private readonly db: DbClient) {}
  async search(
    query: z.infer<typeof searchContract.searchEvents.query>,
  ): Promise<SearchResultItem[]> {
    const { q, type, projectId, sessionId, limit = 25 } = query;
    const cleanQ = q.trim();
    if (!cleanQ) {
      return [] as SearchResultItem[];
    }

    const searchableText = sql<string>`
        CASE
          WHEN json_valid(${sessionEvents.data}) = 0 THEN ${sessionEvents.data}
          WHEN ${sessionEvents.type} = 'text'
            THEN coalesce(json_extract(${sessionEvents.data}, '$.content'), '')
          WHEN ${sessionEvents.type} = 'tool_call'
            THEN
              coalesce(json_extract(${sessionEvents.data}, '$.name'), '') || ' ' ||
              coalesce(json_extract(${sessionEvents.data}, '$.title'), '') || ' ' ||
              coalesce(json_extract(${sessionEvents.data}, '$.arguments'), '') || ' ' ||
              coalesce(json_extract(${sessionEvents.data}, '$.rawInput'), '') || ' ' ||
              coalesce(json_extract(${sessionEvents.data}, '$.content'), '') || ' ' ||
              coalesce(json_extract(${sessionEvents.data}, '$.rawOutput'), '')
          ELSE ''
        END
      `;
    const conditions: SQL[] = [
      sql`${sessionEvents.type} IN ('text', 'tool_call')`,
      sql`instr(lower(${searchableText}), lower(${cleanQ})) > 0`,
    ];
    const eventRole = sql<string | null>`
        CASE
          WHEN json_valid(${sessionEvents.data}) = 1
            THEN json_extract(${sessionEvents.data}, '$.role')
          ELSE NULL
        END
      `;

    if (sessionId) conditions.push(eq(sessionEvents.sessionId, sessionId));
    if (projectId) conditions.push(eq(sessions.projectId, projectId));

    if (type && type !== 'all') {
      if (type === 'tool') {
        conditions.push(eq(sessionEvents.type, 'tool_call'));
      } else {
        conditions.push(eq(sessionEvents.type, 'text'));
        if (type === 'user' || type === 'thought') {
          conditions.push(sql`${eventRole} = ${type}`);
        } else {
          conditions.push(sql`coalesce(${eventRole}, 'provider') NOT IN ('user', 'thought')`);
        }
      }
    }

    const rows = await this.db
      .select({
        eventId: sessionEvents.id,
        eventType: sessionEvents.type,
        eventData: sessionEvents.data,
        eventCreatedAt: sessionEvents.createdAt,
        sessionId: sessions.id,
        sessionTitle: sessions.title,
        sessionTaskSlug: sessions.taskSlug,
        projectId: sessions.projectId,
        projectName: projects.name,
      })
      .from(sessionEvents)
      .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
      .leftJoin(projects, eq(sessions.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(sessionEvents.id))
      .limit(limit);

    const results: SearchResultItem[] = [];

    for (const row of rows) {
      let parsedData: Record<string, unknown> | null = null;
      try {
        parsedData = JSON.parse(row.eventData) as Record<string, unknown>;
      } catch {
        parsedData = null;
      }

      const category = categorizeSearchEvent(row.eventType, parsedData);
      if (!category) continue;
      const text = extractEventSearchableText(row.eventType, parsedData ?? row.eventData);
      if (!text || !text.toLowerCase().includes(cleanQ.toLowerCase())) {
        continue;
      }

      const { snippet, matchIndices } = createSearchSnippet(text, cleanQ);

      results.push({
        eventId: row.eventId,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle || row.sessionTaskSlug || 'Untitled Session',
        projectId: row.projectId,
        projectName: row.projectName ?? 'Unknown Project',
        eventType: category,
        snippet,
        matchIndices,
        createdAt: row.eventCreatedAt
          ? new Date(row.eventCreatedAt).toISOString()
          : new Date().toISOString(),
      });
    }

    return results;
  }
}
