import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq, asc } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { sessionEvents, sessions } from '../db/schema.js';
import {
  getContextTurnLimit,
  getGitCommandTimeoutMs,
  getGitMaxBufferBytes,
  getHandoffRetentionMs,
  getStaleHandoffAgeMs,
} from '../config/runtime-defaults.js';

export interface HandoffOptions {
  nextSessionFocus?: string;
  maxRecentTurns?: number;
  maxEventId?: number;
}

export type HandoffSource = 'skill' | 'generated';

export interface HandoffResult {
  filePath: string;
  content: string;
  sourceSessionId: string;
  source: HandoffSource;
}

const execFileAsync = promisify(execFile);

/**
 * Redact sensitive information (API keys, passwords, bearer tokens)
 */
export function redactSensitiveText(text: string): string {
  if (!text) return text;
  return text
    .replace(/(?:sk-|ant-|ghp_|gho_|github_pat_)[a-zA-Z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(
      /(["']?(?:password|passwd|secret|api_key|token|auth)["']?\s*[:=]\s*["'])([^"'\s]{4,})(["'])/gi,
      '$1[REDACTED]$3',
    );
}

/**
 * Extract referenced files from events (tool calls, file touches)
 */
export function extractReferencedFiles(events: { type: string; data: unknown }[]): string[] {
  const files = new Set<string>();
  for (const evt of events) {
    if (!evt.data) continue;
    let dataObj: unknown = evt.data;
    if (typeof dataObj === 'string') {
      try {
        dataObj = JSON.parse(dataObj);
      } catch {
        continue;
      }
    }
    if (typeof dataObj === 'object' && dataObj !== null) {
      const anyData = dataObj as Record<string, unknown>;
      const checkProp = (prop: unknown) => {
        if (typeof prop === 'string' && prop.trim().length > 0 && !prop.includes('\n')) {
          files.add(prop.trim());
        }
      };
      checkProp(anyData.path);
      checkProp(anyData.filePath);
      checkProp(anyData.TargetFile);
      checkProp(anyData.AbsolutePath);
      checkProp(anyData.file);
      checkProp(anyData.SearchPath);
    }
  }
  return Array.from(files).filter((f) => !f.includes('node_modules') && !f.includes('.git'));
}

function isInsideTempDirectory(filePath: string): boolean {
  const relative = path.relative(os.tmpdir(), path.resolve(filePath));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function extractMarkdownPaths(text: string): string[] {
  const candidates = new Set<string>();
  const quotedPath = /[`"']([^`"'\r\n]+\.md)[`"']/gi;
  const bareAbsolutePath = /((?:[A-Za-z]:[\\/]|\/)[^`"'\r\n<>]*?\.md)\b/gi;

  for (const match of text.matchAll(quotedPath)) {
    if (match[1]) candidates.add(match[1].trim());
  }
  for (const match of text.matchAll(bareAbsolutePath)) {
    if (match[1]) candidates.add(match[1].trim());
  }
  return Array.from(candidates);
}

async function readSecureHandoffFile(filePath: string): Promise<HandoffResult | null> {
  const resolvedPath = path.resolve(filePath);
  if (!isInsideTempDirectory(resolvedPath)) return null;

  try {
    const linkStat = await fs.lstat(resolvedPath);
    if (linkStat.isSymbolicLink()) return null;
    const realPath = await fs.realpath(resolvedPath);
    if (!isInsideTempDirectory(realPath)) return null;
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) return null;
    const content = redactSensitiveText(await fs.readFile(realPath, 'utf8'));
    await fs.writeFile(realPath, content, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(realPath, 0o600);
    return {
      filePath: realPath,
      content,
      sourceSessionId: '',
      source: 'skill',
    };
  } catch {
    return null;
  }
}

export async function findAgentGeneratedHandoff(
  responseTexts: string[],
  sourceSessionId: string,
): Promise<HandoffResult | null> {
  for (const text of responseTexts) {
    for (const candidate of extractMarkdownPaths(text)) {
      const result = await readSecureHandoffFile(candidate);
      if (result) return { ...result, sourceSessionId };
    }
  }

  // Only trust a path explicitly returned in this agent's response. Scanning the
  // shared temp directory can pick up a concurrent session's handoff document.
  return null;
}

async function removeStaleHandoffFiles(now = Date.now()): Promise<void> {
  try {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          !entry.isFile() ||
          !entry.name.startsWith('agentctl-handoff-') ||
          !entry.name.endsWith('.md')
        ) {
          return;
        }
        const filePath = path.join(os.tmpdir(), entry.name);
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > getStaleHandoffAgeMs()) {
          await fs.unlink(filePath).catch(() => undefined);
        }
      }),
    );
  } catch {
    // Cleanup must not prevent a handoff.
  }
}

export function scheduleHandoffCleanup(filePath: string, delayMs = getHandoffRetentionMs()): void {
  const timer = setTimeout(() => {
    void fs.unlink(filePath).catch(() => undefined);
  }, delayMs);
  timer.unref();
}

async function collectWorkspaceState(cwd: string | null | undefined): Promise<string | undefined> {
  if (!cwd) return undefined;

  const runGit = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        timeout: getGitCommandTimeoutMs(),
        maxBuffer: getGitMaxBufferBytes(),
      });
      return stdout.trim();
    } catch {
      return '';
    }
  };

  const [branch, status, diffStat] = await Promise.all([
    runGit(['branch', '--show-current']),
    runGit(['status', '--short', '--untracked-files=all']),
    runGit(['diff', '--stat']),
  ]);
  const lines = [
    branch ? `Branch: ${branch}` : '',
    status ? `Working tree:\n${status}` : 'Working tree: clean',
    diffStat ? `Diff summary:\n${diffStat}` : '',
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n\n') : undefined;
}

/**
 * Build the deterministic handoff used when the source agent has no handoff skill.
 */
export function formatHandoffDocument(params: {
  sessionId: string;
  sourceProvider: string;
  targetProvider: string;
  sessionTitle?: string;
  nextSessionFocus?: string;
  recentTurns: { role: string; text: string }[];
  referencedFiles: string[];
  workspaceState?: string;
}): string {
  const {
    sessionId,
    sourceProvider,
    targetProvider,
    sessionTitle,
    nextSessionFocus,
    recentTurns,
    referencedFiles,
    workspaceState,
  } = params;

  const sections: string[] = [];

  sections.push('# Agent Handoff Document');
  sections.push(
    `This fallback document transfers recent persisted context from session \`${sessionId}\` (${sourceProvider}) to ${targetProvider}.`,
  );

  if (sessionTitle) {
    sections.push(`**Task/Topic:** ${sessionTitle}`);
  }

  if (nextSessionFocus && nextSessionFocus.trim().length > 0) {
    sections.push(`## Next Session Focus\n${redactSensitiveText(nextSessionFocus.trim())}`);
  }

  sections.push('## Recent Conversation Context');
  if (recentTurns.length > 0) {
    const turnSummary = recentTurns
      .map((t) => `**${t.role}**: ${redactSensitiveText(t.text)}`)
      .join('\n\n');
    sections.push(turnSummary);
  } else {
    sections.push('_No previous conversation entries._');
  }

  if (workspaceState) {
    sections.push('## Workspace State');
    sections.push(`\`\`\`text\n${redactSensitiveText(workspaceState)}\n\`\`\``);
  }

  if (referencedFiles.length > 0) {
    sections.push('## Key References & Artifacts');
    sections.push(
      'The following files and paths were actively touched or referenced in the previous session (do not re-request them; inspect directly as needed):',
    );
    const fileList = referencedFiles
      .slice(0, 25)
      .map((f) => `- \`${f}\``)
      .join('\n');
    sections.push(fileList);
  }

  sections.push('## Suggested Skills');
  sections.push(
    '_The deterministic fallback does not infer skills. The target agent should use only registered skills relevant to the remaining work._',
  );

  sections.push('## Instructions for Next Agent');
  sections.push(
    `You are picking up from the work described above as ${targetProvider}.
1. Review the current state and focus on the Next Session Focus if specified.
2. Check the referenced paths and continue where the previous agent left off without asking the user to repeat past context.
3. Invoke suggested workflows only when they are available and relevant.`,
  );

  return sections.join('\n\n') + '\n';
}

/**
 * Generate the host-side fallback document in the OS temp directory.
 */
export async function generateHandoffDocument(
  db: DbClient,
  sessionId: string,
  targetProvider: string,
  options: HandoffOptions = {},
): Promise<HandoffResult> {
  const maxTurns = options.maxRecentTurns ?? getContextTurnLimit();

  const sessionRecord = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  const sourceProvider = sessionRecord?.selectedProvider ?? sessionRecord?.agent ?? 'agent';
  const sessionTitle = sessionRecord?.title ?? sessionRecord?.taskSlug;

  const allEvents = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.id));
  const maxEventId = options.maxEventId;
  const eligibleEvents =
    maxEventId === undefined ? allEvents : allEvents.filter((event) => event.id <= maxEventId);

  const conversationEntries: { role: string; text: string }[] = [];

  for (const row of eligibleEvents) {
    if (row.type !== 'text' || !row.data) continue;
    try {
      const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as {
        text?: string;
        content?: string;
        role?: string;
      };
      const textVal = (data.content ?? data.text)?.trim();
      if (!textVal) continue;

      if (data.role === 'user') {
        conversationEntries.push({ role: 'User', text: textVal });
      } else if (data.role !== 'thought') {
        conversationEntries.push({ role: 'Assistant', text: textVal });
      }
    } catch {
      // Ignore unparseable data
    }
  }

  const recentTurns = conversationEntries.slice(-maxTurns);
  const referencedFiles = extractReferencedFiles(eligibleEvents);
  const workspaceState = await collectWorkspaceState(sessionRecord?.worktreePath);

  const content = formatHandoffDocument({
    sessionId,
    sourceProvider,
    targetProvider,
    sessionTitle: sessionTitle ?? undefined,
    nextSessionFocus: options.nextSessionFocus,
    recentTurns,
    referencedFiles,
    workspaceState,
  });

  const tempFileName = `agentctl-handoff-${sessionId}-${Date.now()}.md`;
  const filePath = path.join(os.tmpdir(), tempFileName);

  await removeStaleHandoffFiles();
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });

  return {
    filePath,
    content,
    sourceSessionId: sessionId,
    source: 'generated',
  };
}
