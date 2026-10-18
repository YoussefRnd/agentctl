import { test, expect, describe, beforeEach, afterEach } from 'vite-plus/test';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

describe('Context Routes API', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  let testDir: string;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-context-routes-'));

    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
      cwd: testDir,
      stdio: 'ignore',
    });
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'server.ts'), 'export const port = 3000;\n');
    await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test-pkg"}\n');
    execSync('git add . && git commit -m "init"', { cwd: testDir, stdio: 'ignore' });

    const [project] = await db
      .insert(projects)
      .values({
        id: 'proj-context-1',
        name: 'Context Project',
        path: testDir,
        repoRoot: testDir,
      })
      .returning();

    await db.insert(sessions).values({
      id: 'sess-context-1',
      projectId: project.id,
      title: 'Context Test Session',
      status: 'idle',
      branch: 'main',
      worktreePath: testDir,
      taskSlug: 'context-task',
      baseCommit: '000000',
      agent: 'mock',
      selectedProvider: 'mock',
    });

    const testEnv = parseServerEnv({
      AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
      AGENTCTL_SESSION_SALT: 'test-session-sal',
      PORT: '0',
    });

    app = await buildApp({
      db,
      env: testEnv,
    });
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('GET /api/sessions/:id/context/search returns workspace files and git items', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/sess-context-1/context/search?q=server',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ title: string; type: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.title).toBe('server.ts');
  });

  test('POST /api/sessions/:id/context/resolve returns formatted markdown bundle', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/sess-context-1/context/resolve',
      payload: {
        items: [{ type: 'file', value: 'src/server.ts' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      formattedContent: string;
      items: Array<{ title: string; type: string }>;
    };
    expect(body.items.length).toBe(1);
    expect(body.items[0]?.title).toBe('server.ts');
    expect(body.formattedContent).toContain('Context Attachment: `src/server.ts`');
    expect(body.formattedContent).toContain('export const port = 3000;');
  });
  test('searches and resolves project context before any session exists', async () => {
    await db.delete(sessions);
    const search = await app.inject({
      method: 'GET',
      url: '/api/projects/proj-context-1/context/search?q=server',
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0].title).toBe('server.ts');
    const resolved = await app.inject({
      method: 'POST',
      url: '/api/projects/proj-context-1/context/resolve',
      payload: { items: [{ type: 'file', value: 'src/server.ts' }] },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().formattedContent).toContain('export const port = 3000;');
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
