import type { SessionEventToolCallData } from '@agentctl/shared';

export function formatDuration(durationMs?: number | null): string {
  if (!durationMs || durationMs <= 0) return '';
  if (durationMs < 1000) return `${String(Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatShortPath(fullPath?: string): string {
  if (!fullPath) return '';
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return fullPath;
  return parts.slice(-3).join('/');
}

export function getToolDisplayInfo(
  tool: string,
  payload: SessionEventToolCallData,
): { icon: string; label: string; sublabel?: string; color: string; isCommand: boolean } {
  const args = payload.arguments ?? {};
  const kind = payload.kind;
  const title = payload.title;
  const locations = payload.locations ?? [];

  // 1. Canonical product tool-kind mapping
  if (kind === 'execute') {
    const rawCmd = args.CommandLine ?? args.command ?? args.cmd ?? args.input;
    const cmdText = (typeof rawCmd === 'string' && rawCmd) || title || tool;
    return {
      icon: 'terminal',
      label: cmdText,
      color: 'text-amber-400',
      isCommand: true,
    };
  }

  if (kind === 'edit') {
    const rawPath =
      (typeof args.TargetFile === 'string' && args.TargetFile) ||
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.path === 'string' && args.path) ||
      (typeof args.filePath === 'string' && args.filePath) ||
      (typeof args.file === 'string' && args.file) ||
      locations[0]?.path;
    return {
      icon: 'edit',
      label: rawPath ? `Edited ${formatShortPath(rawPath)}` : (title ?? 'Edited file'),
      sublabel: rawPath,
      color: 'text-purple-400',
      isCommand: false,
    };
  }

  if (kind === 'read') {
    const rawPath =
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.path === 'string' && args.path) ||
      (typeof args.filePath === 'string' && args.filePath) ||
      (typeof args.file === 'string' && args.file) ||
      locations[0]?.path;
    return {
      icon: 'file',
      label: rawPath ? `Read ${formatShortPath(rawPath)}` : (title ?? 'Read file'),
      sublabel: rawPath,
      color: 'text-emerald-400',
      isCommand: false,
    };
  }

  if (kind === 'search' || kind === 'fetch') {
    const rawQuery =
      (typeof args.Query === 'string' && args.Query) ||
      (typeof args.query === 'string' && args.query) ||
      (typeof args.Pattern === 'string' && args.Pattern) ||
      (typeof args.pattern === 'string' && args.pattern);
    const q = rawQuery ? `"${rawQuery}"` : '';
    return {
      icon: 'search',
      label: q ? `Searched ${q}` : (title ?? 'Search'),
      color: 'text-sky-400',
      isCommand: false,
    };
  }

  if (kind === 'move') {
    const rawPath =
      (typeof args.path === 'string' && args.path) ||
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.TargetFile === 'string' && args.TargetFile) ||
      locations[0]?.path;
    return {
      icon: 'file',
      label: rawPath ? `Moved ${formatShortPath(rawPath)}` : (title ?? 'Moved file'),
      sublabel: rawPath,
      color: 'text-brand-green',
      isCommand: false,
    };
  }

  if (kind === 'delete') {
    const rawPath =
      (typeof args.path === 'string' && args.path) ||
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.TargetFile === 'string' && args.TargetFile) ||
      locations[0]?.path;
    return {
      icon: 'trash',
      label: rawPath ? `Deleted ${formatShortPath(rawPath)}` : (title ?? 'Deleted file'),
      sublabel: rawPath,
      color: 'text-rose-400',
      isCommand: false,
    };
  }

  // 2. If provider provided a human-readable title directly:
  if (title && title.trim() && title.toLowerCase() !== 'tool') {
    const isCommand =
      typeof args.CommandLine === 'string' ||
      typeof args.command === 'string' ||
      title.startsWith('Run ') ||
      title.startsWith('Execute ');
    return {
      icon: isCommand ? 'terminal' : 'settings',
      label: title,
      color: isCommand ? 'text-amber-400' : 'text-text-muted',
      isCommand,
    };
  }

  // 3. Fallback to typed argument structure or tool name:
  const rawCmd = args.CommandLine ?? args.command ?? args.cmd;
  if (typeof rawCmd === 'string') {
    return {
      icon: 'terminal',
      label: rawCmd,
      color: 'text-amber-400',
      isCommand: true,
    };
  }

  const cleanName = (tool.startsWith('call_') ? tool.substring(5) : tool)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    icon: 'settings',
    label: cleanName || 'Tool Call',
    color: 'text-text-muted',
    isCommand: false,
  };
}

export function getCleanOutputText(rawOutput: unknown): string | null {
  if (rawOutput === null || rawOutput === undefined) return null;
  if (typeof rawOutput === 'string') return rawOutput.trim() || null;
  if (typeof rawOutput === 'object') {
    const rec = rawOutput as Record<string, unknown>;
    if (typeof rec.output === 'string') return rec.output.trim() || null;
    if (typeof rec.stdout === 'string') return rec.stdout.trim() || null;
    if (typeof rec.result === 'string') return rec.result.trim() || null;
    if (typeof rec.text === 'string') return rec.text.trim() || null;
    if (typeof rec.content === 'string') return rec.content.trim() || null;
    if (typeof rec.message === 'string') return rec.message.trim() || null;
    const str = JSON.stringify(rawOutput, null, 2);
    return str === '{}' ? null : str;
  }
  return String(rawOutput);
}
