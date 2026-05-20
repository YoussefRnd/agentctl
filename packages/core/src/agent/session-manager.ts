import { spawn } from 'node:child_process';
import { ACPSession, type DbClient, type IEventBus } from './acp-session.js';
import { cleanEnv } from './acp-transport.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';

interface RestartOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class SessionManager {
  private sessions = new Map<string, ACPSession>();

  constructor(
    private db: DbClient,
    private eventBus: IEventBus,
    private logger: Logger = noopLogger,
  ) {}

  startSession(
    sessionId: string,
    worktreePath: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): ACPSession {
    this.logger.info(
      { sessionId, command, args, worktreePath },
      'Starting new agent session',
    );

    const child = spawn(command, args, {
      cwd: worktreePath,
      env: cleanEnv(env),
    });

    const session = new ACPSession(
      sessionId,
      child,
      this.db,
      this.eventBus,
      worktreePath,
      this.logger,
    );

    void session.initialize().catch((err: unknown) => {
      this.logger.error(err, `Failed to initialize session ${sessionId}`);
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  restartSession(
    sessionId: string,
    worktreePath: string,
    options: RestartOptions,
  ): ACPSession {
    this.logger.info({ sessionId }, 'Restarting session');
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.kill();
      this.sessions.delete(sessionId);
    }

    return this.startSession(
      sessionId,
      worktreePath,
      options.command,
      options.args,
      options.env,
    );
  }

  getSession(sessionId: string): ACPSession | undefined {
    return this.sessions.get(sessionId);
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
  }

  async handleClientMessage(
    sessionId: string,
    action: 'approve' | 'deny' | 'session.input',
    payload: { eventId?: string | number; input?: string },
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn({ sessionId }, 'Received message for unknown session');
      return;
    }

    if (action === 'approve') {
      session.resolvePermission(String(payload.eventId), {
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      });
    } else if (action === 'deny') {
      session.resolvePermission(String(payload.eventId), {
        outcome: { outcome: 'cancelled' },
      });
    } else if (payload.input) {
      await session.prompt(payload.input);
    }
  }
}
