import fp from 'fastify-plugin';
import { SessionRunner, ACPClient, db } from '@agentctl/core';
import { spawn } from 'node:child_process';
import type { WSClientMessage } from '../types.js';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManagerService;
  }
}

export class SessionManagerService {
  private runners = new Map<string, SessionRunner>();

  constructor(private fastify: FastifyInstance) {}

  startSession(sessionId: string, worktreePath: string, command: string, args: string[]) {
    const child = spawn(command, args, { cwd: worktreePath });
    const client = new ACPClient(child);
    const runner = new SessionRunner(sessionId, client, db, this.fastify.eventBus);
    this.runners.set(sessionId, runner);
    return runner;
  }

  handleClientMessage(msg: WSClientMessage) {
    const runner = this.runners.get(msg.sessionId);
    if (!runner) return;

    if (msg.action === 'approve') {
      runner.approve(msg.eventId);
    } else if (msg.action === 'deny') {
      runner.deny(msg.eventId);
    }
  }
}

export default fp((fastify: FastifyInstance) => {
  fastify.decorate('sessionManager', new SessionManagerService(fastify));
  return Promise.resolve();
});
