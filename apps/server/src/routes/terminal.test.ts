import { test, expect, describe, beforeEach, afterEach } from 'vite-plus/test';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import os from 'node:os';

describe('Interactive Terminal WebSocket Route', () => {
  const desktopCapability = 'terminal-test-desktop-capability';
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
      NODE_ENV: 'production',
      AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
      AGENTCTL_SESSION_SALT: 'test-session-sal',
      PORT: '0',
    });

    app = await buildApp({
      db,
      env: testEnv,
      embedded: true,
      desktopCapability,
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    serverPort = typeof address === 'object' && address ? address.port : 0;
  });

  afterEach(async () => {
    await app.close();
  });

  test('connects to terminal websocket and streams shell output', async () => {
    const wsUrl = `ws://127.0.0.1:${serverPort}/api/sessions/test-sess-1/terminal/ws`;

    const ws = new WebSocket(wsUrl, [`agentctl.desktop.${desktopCapability}`]);
    let receivedEcho = false;

    await new Promise<void>((resolve, reject) => {
      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw) as { type?: string; data?: string };
          if (msg.type === 'init') {
            ws.send(JSON.stringify({ type: 'input', data: 'echo "LIVE_TERMINAL_OK"\n' }));
          } else if (msg.type === 'data' && msg.data?.includes('LIVE_TERMINAL_OK')) {
            receivedEcho = true;
            ws.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      };

      ws.onerror = (err) => {
        reject(err);
      };

      setTimeout(() => {
        if (!receivedEcho) {
          ws.close();
          reject(new Error('Timed out waiting for terminal echo'));
        }
      }, 3000);
    });

    expect(receivedEcho).toBe(true);
  });

  test('supports concurrent distinct terminal tabs with termId query param', async () => {
    const wsUrl1 = `ws://127.0.0.1:${serverPort}/api/sessions/test-sess-1/terminal/ws?termId=tab-1`;
    const wsUrl2 = `ws://127.0.0.1:${serverPort}/api/sessions/test-sess-1/terminal/ws?termId=tab-2`;

    const ws1 = new WebSocket(wsUrl1, [`agentctl.desktop.${desktopCapability}`]);
    const ws2 = new WebSocket(wsUrl2, [`agentctl.desktop.${desktopCapability}`]);

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
