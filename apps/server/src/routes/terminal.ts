import { AppError } from '../errors/app-error.js';
import type { FastifyPluginCallback } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { InteractiveTerminalService } from '../services/terminal-service.js';

interface WebSocketLike {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

type TerminalInput =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'restart' }
  | { type: 'unsupported' };

function readTerminalInput(text: string): TerminalInput {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { type: 'input', data: text };

  let message: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  try {
    message = JSON.parse(trimmed);
  } catch {
    return { type: 'input', data: text };
  }
  if ((message.type === 'input' || message.type === 'data') && typeof message.data === 'string')
    return { type: 'input', data: message.data };
  if (
    message.type === 'resize' &&
    typeof message.cols === 'number' &&
    typeof message.rows === 'number'
  ) {
    return { type: 'resize', cols: message.cols, rows: message.rows };
  }
  if (message.type === 'restart') return { type: 'restart' };
  return { type: 'unsupported' };
}

function bindTerminalOutput(
  socket: WebSocketLike,
  terminal: InteractiveTerminalService,
  key: string,
  onOutput?: () => void,
): () => void {
  const onData = (data: string) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'data', data }));
    onOutput?.();
  };
  const onExit = (exit: { code: number | null; signal: string | null }) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'exit', ...exit }));
  };
  terminal.on(`data:${key}`, onData);
  terminal.on(`exit:${key}`, onExit);
  return () => {
    terminal.off(`data:${key}`, onData);
    terminal.off(`exit:${key}`, onExit);
  };
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

      let cwd: string;
      try {
        cwd = await fastify.services.workspaces.sessionDirectory(sessionId, 'terminal');
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', error: error.message }));
          socket.close();
        }
        return;
      }
      if (socket.readyState !== socket.OPEN) return;

      const terminal = fastify.terminalService.getOrCreateTerminal(terminalKey, cwd);
      const shellName = terminal.shell.split(/[\\/]/).pop() || 'sh';
      socket.send(JSON.stringify({ type: 'init', shell: shellName, cwd, termId }));

      const history = fastify.terminalService.getHistory(terminalKey);
      if (history) {
        socket.send(JSON.stringify({ type: 'data', data: history }));
      }

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

      const unbindOutput = bindTerminalOutput(
        socket,
        fastify.terminalService,
        terminalKey,
        scheduleWorkspaceChange,
      );
      socket.on('message', (rawMessage: Buffer | string) => {
        const message = readTerminalInput(rawMessage.toString());
        try {
          switch (message.type) {
            case 'input':
              markCommandInput(message.data);
              fastify.terminalService.writeInput(terminalKey, message.data);
              break;
            case 'resize':
              fastify.terminalService.resizeTerminal(terminalKey, message.cols, message.rows);
              break;
            case 'restart':
              fastify.terminalService.spawnTerminal(terminalKey, cwd);
              socket.send(
                JSON.stringify({
                  type: 'data',
                  data: '\r\n\x1b[1;33m● Shell restarted\x1b[0m\r\n\r\n',
                }),
              );
              break;
            case 'unsupported':
              // Workspace terminals treat valid JSON objects as protocol frames.
              break;
          }
        } catch (error) {
          req.log.debug({ err: error }, 'Terminal input failed');
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
        unbindOutput();
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

      const unbindOutput = bindTerminalOutput(socket, fastify.terminalService, terminalKey);

      void coordinator
        .runTerminalAuth(
          providerId,
          methodId,
          (command, args, env, signal) =>
            new Promise<{ exitCode: number }>((resolve, reject) => {
              signal.throwIfAborted();
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
                const abort = () => fastify.terminalService.killTerminal(terminalKey);
                signal.addEventListener('abort', abort, { once: true });
                terminal.process.once('exit', (code) => {
                  signal.removeEventListener('abort', abort);
                  resolve({ exitCode: code ?? 1 });
                });
                terminal.process.once('error', (error) => {
                  signal.removeEventListener('abort', abort);
                  reject(error);
                });
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
        const text = rawMessage.toString();
        const message = readTerminalInput(text);
        try {
          if (message.type === 'resize')
            fastify.terminalService.resizeTerminal(terminalKey, message.cols, message.rows);
          else
            // Auth terminals accept pasted JSON, including objects that are not protocol frames.
            fastify.terminalService.writeInput(
              terminalKey,
              message.type === 'input' ? message.data : text,
            );
        } catch (error) {
          req.log.debug({ err: error }, 'Authentication terminal input failed');
        }
      });

      socket.on('close', () => {
        unbindOutput();
        abortController.abort();
        fastify.terminalService.killTerminal(terminalKey);
      });
    },
  );

  done();
};
