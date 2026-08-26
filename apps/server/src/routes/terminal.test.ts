import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import os from 'node:os';

describe('Interactive Terminal WebSocket Route', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  let serverPort: number;

  beforeEach(async () => {
    db = createDatabase(':memory:');

    // Create test project and session in DB
    const [project] = await db
      .insert(projects)
      .values({
        id: 'test-proj-1',
        name: 'Test Project',
        path: os.tmpdir(),
        repoRoot: os.tmpdir(),
      })
      .returning();

    await db.insert(sessions).values({
      id: 'test-sess-1',
      projectId: project.id,
      title: 'Test Session',
      status: 'idle',
      branch: 'main',
      worktreePath: os.tmpdir(),
      taskSlug: 'test-task',
      baseCommit: '000000',
      agent: 'mock',
      selectedProvider: 'mock',
    });

    const testEnv = parseServerEnv({
      AGENTCTL_SECRET: 'test-secret',
      AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
      AGENTCTL_SESSION_SALT: 'test-session-sal',
      PORT: '0',
    });

    app = await buildApp({
      db,
      env: testEnv,
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    serverPort = typeof address === 'object' && address ? address.port : 0;
  });

  afterEach(async () => {
    await app.close();
  });

  test('connects to terminal websocket and streams shell output', async () => {
    const startupToken = app.authManager.getStartupToken();
    const wsUrl = `ws://127.0.0.1:${serverPort}/api/sessions/test-sess-1/terminal/ws?token=${startupToken}`;

    const ws = new WebSocket(wsUrl);

    const messages: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        // Connected!
      };

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw) as { type?: string; data?: string };
          if (msg.type === 'data' && msg.data) {
            messages.push(msg.data);
            if (messages.join('').includes('Agentctl Interactive Shell')) {
              // Shell banner received! Send an echo command
              ws.send(JSON.stringify({ type: 'input', data: 'echo "LIVE_TERMINAL_OK"\n' }));
            }
            if (messages.join('').includes('LIVE_TERMINAL_OK')) {
              ws.close();
              resolve();
            }
          }
        } catch (err) {
          reject(err);
        }
      };

      ws.onerror = (err) => {
        reject(err);
      };

      setTimeout(() => {
        if (!messages.join('').includes('LIVE_TERMINAL_OK')) {
          ws.close();
          resolve(); // Finish without hanging
        }
      }, 3000);
    });

    expect(messages.join('')).toContain('Agentctl Interactive Shell');
  });

  test('supports concurrent distinct terminal tabs with termId query param', async () => {
    const startupToken = app.authManager.getStartupToken();
    const wsUrl1 = `ws://127.0.0.1:${serverPort}/api/sessions/test-sess-1/terminal/ws?token=${startupToken}&termId=tab-1`;
    const wsUrl2 = `ws://127.0.0.1:${serverPort}/api/sessions/test-sess-1/terminal/ws?token=${startupToken}&termId=tab-2`;

    const ws1 = new WebSocket(wsUrl1);
    const ws2 = new WebSocket(wsUrl2);

    let tab1Init = false;
    let tab2Init = false;

    await new Promise<void>((resolve, reject) => {
      ws1.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw) as { type?: string; termId?: string };
          if (msg.type === 'init' && msg.termId === 'tab-1') {
            tab1Init = true;
            if (tab1Init && tab2Init) {
              ws1.close();
              ws2.close();
              resolve();
            }
          }
        } catch (err) {
          reject(err);
        }
      };

      ws2.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw) as { type?: string; termId?: string };
          if (msg.type === 'init' && msg.termId === 'tab-2') {
            tab2Init = true;
            if (tab1Init && tab2Init) {
              ws1.close();
              ws2.close();
              resolve();
            }
          }
        } catch (err) {
          reject(err);
        }
      };

      setTimeout(() => {
        ws1.close();
        ws2.close();
        resolve();
      }, 3000);
    });

    expect(tab1Init).toBe(true);
    expect(tab2Init).toBe(true);
  });
});
