import type { FastifyPluginCallback } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sessions, projects } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
interface WebSocketLike {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

export const terminalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/sessions/:id/terminal/ws',
    { websocket: true },
    async (socket: WebSocketLike, req) => {
      const { id: sessionId } = req.params as { id: string };
      const query = (req.query as { termId?: string }) || {};
      const termId = query.termId || '1';
      const terminalKey = `${sessionId}:${termId}`;

      // 1. Resolve session and workspace directory
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', error: `Session not found: ${sessionId}` }));
        socket.close();
        return;
      }

      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });

      const cwd = session.worktreePath || project?.repoRoot || process.cwd();

      // 2. Initialize or retrieve terminal session
      fastify.terminalService.getOrCreateTerminal(terminalKey, cwd);

      const defaultShell =
        process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
      const shellName = defaultShell.split('/').pop()?.split('\\').pop() || 'sh';

      // 3. Send initial metadata and history scrollback
      socket.send(JSON.stringify({ type: 'init', shell: shellName, cwd, termId }));

      const history = fastify.terminalService.getHistory(terminalKey);
      if (history) {
        socket.send(JSON.stringify({ type: 'data', data: history }));
      }

      // 4. Stream terminal data to WebSocket
      let commandMayChangeWorkspace = false;
      let workspaceChangeTimer: ReturnType<typeof setTimeout> | null = null;
      const markCommandInput = (data: string) => {
        if (data.includes('\n') || data.includes('\r')) {
          commandMayChangeWorkspace = true;
        }
      };
      const scheduleWorkspaceChange = () => {
        if (!commandMayChangeWorkspace) return;
        if (workspaceChangeTimer) clearTimeout(workspaceChangeTimer);
        workspaceChangeTimer = setTimeout(() => {
          workspaceChangeTimer = null;
          commandMayChangeWorkspace = false;
          fastify.eventBus.publishState({
            topics: ['projects', 'session', 'workspace'],
            sessionId,
          });
        }, 300);
      };

      const onData = (data: string) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'data', data }));
        }
        scheduleWorkspaceChange();
      };

      const onExit = (exitInfo: { code: number | null; signal: string | null }) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'exit',
              code: exitInfo.code,
              signal: exitInfo.signal,
            }),
          );
        }
      };

      fastify.terminalService.on(`data:${terminalKey}`, onData);
      fastify.terminalService.on(`exit:${terminalKey}`, onExit);

      // 5. Handle incoming WebSocket input
      socket.on('message', (rawMessage: Buffer | string) => {
        try {
          const text = rawMessage.toString();
          const trimmed = text.trim();

          // Try parsing JSON messages safely
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed) as {
                type?: string;
                data?: string;
                cols?: number;
                rows?: number;
              };

              if (
                (parsed.type === 'input' || parsed.type === 'data') &&
                typeof parsed.data === 'string'
              ) {
                markCommandInput(parsed.data);
                fastify.terminalService.writeInput(terminalKey, parsed.data);
                return;
              }

              if (
                parsed.type === 'resize' &&
                typeof parsed.cols === 'number' &&
                typeof parsed.rows === 'number'
              ) {
                fastify.terminalService.resizeTerminal(terminalKey, parsed.cols, parsed.rows);
                return;
              }

              if (parsed.type === 'restart') {
                fastify.terminalService.spawnTerminal(terminalKey, cwd);
                socket.send(
                  JSON.stringify({
                    type: 'data',
                    data: '\r\n\x1b[1;33m● Shell restarted\x1b[0m\r\n\r\n',
                  }),
                );
                return;
              }

              // Any other JSON message should be ignored (never sent to shell stdin)
              return;
            } catch {
              // Not valid JSON, fall through to raw string
            }
          }

          // Fallback to raw string input
          markCommandInput(text);
          fastify.terminalService.writeInput(terminalKey, text);
        } catch {
          // Ignored
        }
      });

      socket.on('close', () => {
        if (workspaceChangeTimer) clearTimeout(workspaceChangeTimer);
        if (commandMayChangeWorkspace) {
          fastify.eventBus.publishState({
            topics: ['projects', 'session', 'workspace'],
            sessionId,
          });
        }
        fastify.terminalService.off(`data:${terminalKey}`, onData);
        fastify.terminalService.off(`exit:${terminalKey}`, onExit);
      });
    },
  );

  fastify.get(
    '/providers/:id/auth/terminal/ws',
    { websocket: true },
    async (socket: WebSocketLike, req) => {
      const { id: providerId } = req.params as { id: string };
      const query = (req.query as { methodId?: string }) || {};
      const methodId = query.methodId;

      if (!methodId) {
        socket.send(JSON.stringify({ type: 'error', error: 'methodId query param required' }));
        socket.close();
        return;
      }

      if (!fastify.terminalService.supportsCommandTerminal()) {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: 'Interactive provider authentication is not supported on this platform yet',
          }),
        );
        socket.close();
        return;
      }

      const terminalKey = `auth:${providerId}:${methodId}:${randomUUID()}`;

      const coordinator = fastify.providerRegistry.getAuthCoordinator();
      const methods = coordinator.getAdvertisedAuthMethods(providerId);
      const targetMethod = methods.find((m) => m.id === methodId);

      if (!targetMethod || targetMethod.type !== 'terminal') {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: `Method ${methodId} is not an advertised terminal auth method`,
          }),
        );
        socket.close();
        return;
      }

      const cwd = process.cwd();
      const abortController = new AbortController();

      const onData = (data: string) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'data', data }));
        }
      };

      const onExit = (exitInfo: { code: number | null; signal: string | null }) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'exit',
              code: exitInfo.code,
              signal: exitInfo.signal,
            }),
          );
        }
      };

      fastify.terminalService.on(`data:${terminalKey}`, onData);
      fastify.terminalService.on(`exit:${terminalKey}`, onExit);

      void coordinator
        .runTerminalAuth(
          providerId,
          methodId,
          (command, args, env, signal) =>
            new Promise<{ exitCode: number }>((resolve, reject) => {
              if (socket.readyState === socket.OPEN) {
                socket.send(
                  JSON.stringify({ type: 'init', shell: command, cwd, termId: methodId }),
                );
              }
              try {
                const terminal = fastify.terminalService.spawnCommandTerminal(
                  terminalKey,
                  command,
                  args,
                  env,
                  cwd,
                );
                terminal.process.once('exit', (code) => resolve({ exitCode: code ?? 1 }));
                terminal.process.once('error', reject);
                signal.addEventListener(
                  'abort',
                  () => fastify.terminalService.killTerminal(terminalKey),
                  { once: true },
                );
              } catch (error) {
                reject(error);
              }
            }),
          { signal: abortController.signal },
        )
        .then(() => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'authenticated' }));
          }
        })
        .catch((error: unknown) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });

      socket.on('message', (rawMessage: Buffer | string) => {
        try {
          const text = rawMessage.toString();
          const trimmed = text.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed) as {
                type?: string;
                data?: string;
                cols?: number;
                rows?: number;
              };
              if (
                (parsed.type === 'input' || parsed.type === 'data') &&
                typeof parsed.data === 'string'
              ) {
                fastify.terminalService.writeInput(terminalKey, parsed.data);
                return;
              }
              if (
                parsed.type === 'resize' &&
                typeof parsed.cols === 'number' &&
                typeof parsed.rows === 'number'
              ) {
                fastify.terminalService.resizeTerminal(terminalKey, parsed.cols, parsed.rows);
                return;
              }
            } catch {
              // fallback
            }
          }
          fastify.terminalService.writeInput(terminalKey, text);
        } catch {
          // Ignored
        }
      });

      socket.on('close', () => {
        abortController.abort();
        fastify.terminalService.off(`data:${terminalKey}`, onData);
        fastify.terminalService.off(`exit:${terminalKey}`, onExit);
        fastify.terminalService.killTerminal(terminalKey);
      });
    },
  );

  done();
};
