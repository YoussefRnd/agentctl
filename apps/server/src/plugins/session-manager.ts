import fp from 'fastify-plugin';
import { ACPSession } from '@agentctl/core';
import { spawn } from 'node:child_process';
import type { WSClientMessage } from '../types.js';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManagerService;
  }
}

interface RestartOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class SessionManagerService {
  private sessions = new Map<string, ACPSession>();

  constructor(private fastify: FastifyInstance) {}

  startSession(sessionId: string, worktreePath: string, command: string, args: string[], env?: Record<string, string>) {
    const child = spawn(command, args, {
      cwd: worktreePath,
      env: { ...process.env, ...env },
    });
    const session = new ACPSession(sessionId, child, this.fastify.db, this.fastify.eventBus, worktreePath, this.fastify.log);
    void session.initialize().catch((err: unknown) => {
      this.fastify.log.error(err, `Failed to initialize session ${sessionId}`);
    });
    this.sessions.set(sessionId, session);
    return session;
  }

  restartSession(sessionId: string, worktreePath: string, options: RestartOptions) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }

    return this.startSession(sessionId, worktreePath, options.command, options.args, options.env);
  }

  async handleClientMessage(msg: WSClientMessage) {
    const session = this.sessions.get(msg.sessionId);
    if (!session) return;

    if (msg.action === 'approve') {
      session.resolvePermission(String(msg.eventId), { 
        outcome: { outcome: 'selected', optionId: 'allow-once' } 
      });
    } else if (msg.action === 'deny') {
      session.resolvePermission(String(msg.eventId), { 
        outcome: { outcome: 'selected', optionId: 'deny-once' } 
      });
    } else if (msg.action === 'session.input') {
      await session.prompt(msg.input);
    }
  }
}

export default fp((fastify: FastifyInstance) => {
  fastify.decorate('sessionManager', new SessionManagerService(fastify));
  return Promise.resolve();
});
