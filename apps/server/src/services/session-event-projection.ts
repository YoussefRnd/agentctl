import { createHash } from 'node:crypto';
import {
  normalizeFileChanges,
  structuredDiffSchema,
  type SessionEventRow,
  type SessionEventToolCallData,
} from '@agentctl/shared';

import { eventDetailRevision } from './session-event-revision.js';
export { eventDetailRevision } from './session-event-revision.js';

function lineCount(text: string | null | undefined): number {
  if (!text) return 0;
  let count = 1;
  for (let offset = text.indexOf('\n'); offset !== -1; offset = text.indexOf('\n', offset + 1))
    count++;
  return count;
}

function ordinaryTool(data: SessionEventToolCallData): boolean {
  // Delegation payloads also form the subagent transcript. Keep them complete.
  if (data.kind === 'subagent' || data.kind === 'task') return false;
  const delegation =
    /^(task|tasks|subagent|subagents|invoke_subagents?|start_subagents?|run_subagents?|spawn_agents?|spawn_subagents?|create_subagents?|delegate(?:_task|_agent|_to_agent)?|dispatch_(?:agents?|subagents?)|parallel_agents?|fork_(?:agents?|subagents?))$/;
  const label = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^(?:run(?:ning)?|call(?:ing)?|exec(?:uting)?)\s+/, '')
      .replace(/[?!.]+$/, '')
      .replace(/^[a-z0-9_-]+[.:/]/, '')
      .replace(/^(?:mcp|builtin)__/, '');
  if (delegation.test(label(data.name)) || delegation.test(label(data.title ?? ''))) return false;
  // Providers may report delegation as an ordinary kind, with routing in arguments.
  for (const input of [data.arguments, data.rawInput]) {
    const serialized = JSON.stringify(input);
    if (
      serialized &&
      /"(?:subagents?|Subagents|agents?|tasks?|subagent_type|agent_type|agent_name|target_agent|role|Role|TypeName|typeName)\\*"/.test(
        serialized,
      )
    )
      return false;
  }
  return (
    ['read', 'search', 'fetch', 'execute', 'edit', 'delete', 'create'].includes(data.kind ?? '') ||
    /^(read|write|edit|multiedit|multi_edit|grep|glob|search|bash|exec|shell|terminal)$/i.test(
      data.name,
    )
  );
}

type NormalizeDiff = typeof normalizeFileChanges;

function projectTool(
  data: SessionEventToolCallData,
  normalizeDiff: NormalizeDiff,
): SessionEventToolCallData {
  const { rawOutput: _output, content, effects, ...rest } = data;
  const diffs = (content ?? []).flatMap((block) => {
    if (block.type !== 'diff') return [];
    const diff = structuredDiffSchema.safeParse(block);
    return diff.success ? [diff.data] : [];
  });
  const fileChanges = diffs.flatMap((diff) => normalizeDiff(diff));
  // Preserve legacy output metadata used by file-change summaries, without its bodies.
  const raw = data.rawOutput;
  const metadata = raw && typeof raw === 'object' && 'metadata' in raw ? raw.metadata : undefined;
  const meta =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : undefined;
  const outputMetadata = meta
    ? {
        ...(typeof meta.filepath === 'string' ? { filepath: meta.filepath } : {}),
        ...(typeof meta.exists === 'boolean' ? { exists: meta.exists } : {}),
        ...(meta.diff ? { diff: true } : {}),
        ...(meta.filediff &&
        typeof meta.filediff === 'object' &&
        'file' in meta.filediff &&
        typeof meta.filediff.file === 'string'
          ? { filediff: { file: meta.filediff.file } }
          : {}),
        ...(meta.display && typeof meta.display === 'object'
          ? {
              display: {
                ...('path' in meta.display && typeof meta.display.path === 'string'
                  ? { path: meta.display.path }
                  : {}),
                ...('type' in meta.display && typeof meta.display.type === 'string'
                  ? { type: meta.display.type }
                  : {}),
              },
            }
          : {}),
      }
    : undefined;
  return {
    ...rest,
    ...(outputMetadata && Object.keys(outputMetadata).length
      ? { rawOutput: { metadata: outputMetadata } }
      : {}),
    ...(content
      ? {
          content: content.flatMap<NonNullable<SessionEventToolCallData['content']>[number]>(
            (block) =>
              block.type === 'terminal'
                ? [{ type: 'terminal' as const, terminalId: block.terminalId }]
                : block.type === 'diff' && typeof block.path === 'string'
                  ? [
                      {
                        type: 'diff' as const,
                        path: block.path,
                        stats: block.stats ?? {
                          additions: lineCount(block.newText),
                          deletions: lineCount(block.oldText),
                        },
                      },
                    ]
                  : [],
          ),
        }
      : {}),
    ...(effects
      ? {
          effects: effects.map((effect) =>
            effect.type === 'file_modified' && (effect.stats || effect.oldText || effect.newText)
              ? {
                  type: effect.type,
                  path: effect.path,
                  stats: effect.stats ?? {
                    additions: lineCount(effect.newText),
                    deletions: lineCount(effect.oldText),
                  },
                }
              : effect,
          ),
        }
      : {}),
    ...(diffs.length ? { fileChanges } : {}),
  };
}

/** Keep messages, approvals, delegation and live tool inputs complete; defer ordinary output. */
export function compactHistoryEvent(
  event: SessionEventRow,
  normalizeDiff: NormalizeDiff = normalizeFileChanges,
  revision?: () => string,
): SessionEventRow {
  if (event.details || event.delta !== undefined) return event;
  if (event.type === 'terminal_output') {
    if (!event.data.data) return event;
    return {
      ...event,
      details: {
        revision: revision?.() ?? eventDetailRevision(event),
        outputBytes: Buffer.byteLength(event.data.data),
      },
      data: { ...event.data, data: '' },
    };
  }
  if (
    event.type !== 'tool_call' ||
    !ordinaryTool(event.data) ||
    !event.data.status ||
    ['pending', 'in_progress'].includes(event.data.status) ||
    (event.data.rawOutput === undefined &&
      !event.data.content?.length &&
      !event.data.effects?.some(
        (effect) => effect.type === 'file_modified' && (effect.oldText || effect.newText),
      ))
  )
    return event;
  return {
    ...event,
    details: { revision: revision?.() ?? eventDetailRevision(event) },
    data: projectTool(event.data, normalizeDiff),
  };
}

/** Per-app cache of small derived summaries. Never retains event rows or patch/output bodies. */
export class SessionEventProjection {
  private readonly summaries = new Map<string, string>();
  private summaryCharacters = 0;

  constructor(private readonly computeDiff: NormalizeDiff = normalizeFileChanges) {}

  private normalizeDiff: NormalizeDiff = (diff) => {
    const key = createHash('sha256')
      .update(JSON.stringify([diff.changes, diff.patch?.format]))
      .update('\0')
      .update(diff.patch?.text ?? '')
      .digest('hex');
    const cached = this.summaries.get(key);
    if (cached !== undefined) {
      this.summaries.delete(key);
      this.summaries.set(key, cached);
      // Fresh objects prevent callers from mutating shared summaries.
      return JSON.parse(cached) as ReturnType<NormalizeDiff>;
    }
    const changes = this.computeDiff(diff);
    const encoded = JSON.stringify(changes);
    if (encoded.length <= 4096) {
      this.summaries.set(key, encoded);
      this.summaryCharacters += encoded.length;
      while (this.summaries.size > 1024 || this.summaryCharacters > 262144) {
        const oldest = this.summaries.keys().next().value!;
        this.summaryCharacters -= this.summaries.get(oldest)!.length;
        this.summaries.delete(oldest);
      }
    }
    return changes;
  };

  compact = (event: SessionEventRow, revision?: () => string) =>
    compactHistoryEvent(event, this.normalizeDiff, revision);
}
