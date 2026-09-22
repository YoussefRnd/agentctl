import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

describe('Parallel Subagents & Swarms API', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const sessionId = '20000000-0000-4000-8000-000000000001';
  const childSessionId = '30000000-0000-4000-8000-000000000001';
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  let testDir: string;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-swarms-'));

    execSync(
      'git init -b main && git config user.email "test@test.com" && git config user.name "Test"',
      {
        cwd: testDir,
        stdio: 'ignore',
      },
    );
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'console.log("main branch");\n');
    execSync('git add . && git commit -m "initial commit"', { cwd: testDir, stdio: 'ignore' });
    const baseCommit = execSync('git rev-parse HEAD', { cwd: testDir, encoding: 'utf8' }).trim();

    const [project] = await db
      .insert(projects)
      .values({
        id: projectId,
        name: 'Swarm Project',
        path: testDir,
        repoRoot: testDir,
      })
      .returning();

    await db.insert(sessions).values({
      id: sessionId,
      projectId: project.id,
      title: 'Main Orchestrator Session',
      status: 'idle',
      branch: 'main',
      worktreePath: testDir,
      taskSlug: 'orchestrator-task',
      baseCommit,
      agent: 'mock',
      selectedProvider: 'mock',
    });

    const testEnv = parseServerEnv({
      AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
      AGENTCTL_SESSION_SALT: 'test-session-sal',
      PORT: '0',
    });

    const sessionManager = {
      createSession: vi.fn(
        async ({ taskSlug }: { taskSlug: string; providerId?: string; mode: string }) => {
          await db.insert(sessions).values({
            id: childSessionId,
            projectId,
            title: taskSlug,
            status: 'idle',
            mode: 'worktree',
            branch: `agent-${taskSlug}`,
            worktreePath: path.join(testDir, '.worktrees', taskSlug),
            taskSlug,
            baseCommit,
            agent: 'mock',
            selectedProvider: 'mock',
          });
          return { sessionId: childSessionId };
        },
      ),
      handleClientMessage: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn(),
      stopAll: vi.fn().mockResolvedValue(undefined),
    };

    app = await buildApp({
      db,
      sessionManager: sessionManager as unknown as SessionManager,
      env: testEnv,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('POST /api/sessions/:id/agents spawns a background agent in an isolated workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/agents`,
      payload: {
        prompt: 'Build auth module in parallel',
        title: 'Auth Agent',
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as {
      session: { id: string; title: string; mode: string; branch: string };
    };

    expect(body.session.title).toBe('Auth Agent');
    expect(body.session.mode).toBe('worktree');
    expect(body.session.branch).toContain('agent-');
  });

  test('GET /api/sessions/:id/check-merge detects clean merges and conflicts', async () => {
    // Create a clean parallel branch in git
    execSync('git checkout -b clean-feature && git commit --allow-empty -m "clean feature"', {
      cwd: testDir,
      stdio: 'ignore',
    });
    execSync('git checkout main', { cwd: testDir, stdio: 'ignore' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/check-merge?branch=clean-feature`,
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      canMerge: boolean;
      hasConflicts: boolean;
      conflictingFiles: string[];
    };

    expect(body.canMerge).toBe(true);
    expect(body.hasConflicts).toBe(false);
    expect(body.conflictingFiles.length).toBe(0);
  });
});
