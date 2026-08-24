import type { FastifyPluginCallback } from 'fastify';
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
      fastify.terminalService.getOrCreateTerminal(sessionId, cwd);

      const defaultShell =
        process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
      const shellName = defaultShell.split('/').pop()?.split('\\').pop() || 'sh';

      // 3. Send initial metadata and history scrollback
      socket.send(JSON.stringify({ type: 'init', shell: shellName, cwd }));

      const history = fastify.terminalService.getHistory(sessionId);
      if (history) {
        socket.send(JSON.stringify({ type: 'data', data: history }));
      }

      // 4. Stream terminal data to WebSocket
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

      fastify.terminalService.on(`data:${sessionId}`, onData);
      fastify.terminalService.on(`exit:${sessionId}`, onExit);

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
                fastify.terminalService.writeInput(sessionId, parsed.data);
                return;
              }

              if (
                parsed.type === 'resize' &&
                typeof parsed.cols === 'number' &&
                typeof parsed.rows === 'number'
              ) {
                fastify.terminalService.resizeTerminal(sessionId, parsed.cols, parsed.rows);
                return;
              }

              if (parsed.type === 'restart') {
                fastify.terminalService.spawnTerminal(sessionId, cwd);
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
          fastify.terminalService.writeInput(sessionId, text);
        } catch {
          // Ignored
        }
      });

      socket.on('close', () => {
        fastify.terminalService.off(`data:${sessionId}`, onData);
        fastify.terminalService.off(`exit:${sessionId}`, onExit);
      });
    },
  );

  done();
};
