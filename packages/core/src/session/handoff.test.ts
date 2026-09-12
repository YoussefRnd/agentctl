import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../db/index.js';
import { SessionEventStore } from './event-store.js';
import { projects, sessions } from '../db/schema.js';
import {
  redactSensitiveText,
  extractReferencedFiles,
  formatHandoffDocument,
  findAgentGeneratedHandoff,
  generateHandoffDocument,
} from './handoff.js';
import type { DbClient } from '../db/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('handoff logic', () => {
  describe('redactSensitiveText', () => {
    it('redacts API keys and tokens', () => {
      // prettier-ignore
      const input = 'Here is my OpenAI key: sk-abc123xyz4567890123456 and token: ghp_123456789012345678901234567890123456';
      const output = redactSensitiveText(input);
      expect(output).not.toContain('sk-abc');
      expect(output).not.toContain('ghp_123');
      expect(output).toContain('[REDACTED_API_KEY]');
    });

    it('redacts Authorization bearer headers', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const output = redactSensitiveText(input);
      expect(output).toBe('Authorization: Bearer [REDACTED_TOKEN]');
    });
  });

  describe('extractReferencedFiles', () => {
    it('extracts unique paths from tool calls while ignoring node_modules', () => {
      const events = [
        { type: 'tool_call', data: { path: 'src/index.ts' } },
        { type: 'tool_call', data: { filePath: 'src/utils.ts' } },
        { type: 'tool_call', data: { TargetFile: 'src/index.ts' } },
        { type: 'tool_call', data: { path: 'node_modules/foo/bar.js' } },
      ];
      const files = extractReferencedFiles(events);
      expect(files).toEqual(['src/index.ts', 'src/utils.ts']);
    });
  });

  describe('formatHandoffDocument', () => {
    it('formats fallback context without guessing target skills', () => {
      const doc = formatHandoffDocument({
        sessionId: 'test-sess',
        sourceProvider: 'claude-acp',
        targetProvider: 'codex',
        sessionTitle: 'Build nav animation',
        nextSessionFocus: 'Finish the spring curves',
        recentTurns: [
          { role: 'User', text: 'Please build a navbar with smooth animations' },
          { role: 'Assistant', text: 'I updated Navbar.tsx with motion values' },
        ],
        referencedFiles: ['src/Navbar.tsx'],
      });

      expect(doc).toContain('# Agent Handoff Document');
      expect(doc).toContain('claude-acp');
      expect(doc).toContain('codex');
      expect(doc).toContain('## Next Session Focus');
      expect(doc).toContain('Finish the spring curves');
      expect(doc).toContain('src/Navbar.tsx');
      expect(doc).toContain('## Suggested Skills');
      expect(doc).toContain('does not infer skills');
      expect(doc).toContain('## Instructions for Next Agent');
    });
  });

  describe('findAgentGeneratedHandoff', () => {
    it('reads a source-agent handoff and restricts its permissions', async () => {
      const filePath = path.join(os.tmpdir(), `handoff-agent-${Date.now()}.md`);
      await fs.writeFile(filePath, '# Source agent handoff\n');

      const result = await findAgentGeneratedHandoff(
        [`Wrote the document to \`${filePath}\`.`],
        'source-session',
      );

      expect(result).toMatchObject({
        filePath,
        sourceSessionId: 'source-session',
        source: 'skill',
      });
      expect(result?.content).toContain('Source agent handoff');
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
      await fs.unlink(filePath).catch(() => {});
    });

    it('does not adopt an unrelated handoff file from the shared temp directory', async () => {
      const unrelatedPath = path.join(os.tmpdir(), `unrelated-handoff-${Date.now()}.md`);
      await fs.writeFile(unrelatedPath, '# Another session\n');

      const result = await findAgentGeneratedHandoff([], 'source-session');

      expect(result).toBeNull();
      await fs.unlink(unrelatedPath).catch(() => {});
    });
  });

  describe('generateHandoffDocument with real in-memory DB', () => {
    let db: DbClient;

    beforeEach(async () => {
      db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-handoff',
        name: 'test-project',
        path: '/tmp/test',
      });
      await db.insert(sessions).values({
        id: 'sess-handoff',
        projectId: 'proj-handoff',
        branch: 'main',
        worktreePath: '/tmp/test',
        taskSlug: 'test-slug',
        agent: 'claude-acp',
        title: 'Refactor auth',
        status: 'idle',
        selectedProvider: 'claude-acp',
        baseCommit: 'hash',
      });
    });

    it('generates a file in temp directory with conversation content', async () => {
      const store = new SessionEventStore(db, { publish() {} });
      await store.append(
        'sess-handoff',
        'text',
        { text: 'Refactor auth service', role: 'user' },
        null,
      );
      await store.append('sess-handoff', 'tool_call', { path: 'src/auth/service.ts' }, null);

      const result = await generateHandoffDocument(db, 'sess-handoff', 'codex', {
        nextSessionFocus: 'Finish token refresh',
      });

      expect(result.filePath).toContain('agentctl-handoff-sess-handoff');
      expect(result.source).toBe('generated');
      const fileContent = await fs.readFile(result.filePath, 'utf-8');
      expect(fileContent).toContain('Refactor auth service');
      expect(fileContent).toContain('src/auth/service.ts');
      expect(fileContent).toContain('Finish token refresh');

      // Cleanup temp file
      await fs.unlink(result.filePath).catch(() => {});
    });
  });
});
