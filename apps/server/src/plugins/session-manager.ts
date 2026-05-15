import fp from 'fastify-plugin';
import { SessionRunner, ACPClient, driverCapabilities } from '@agentctl/core';
import { spawn } from 'node:child_process';
import type { WSClientMessage } from '../types.js';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManagerService;
  }
}

interface ProviderSelection {
  selectedDriver: keyof typeof driverCapabilities;
  selectedModel: string;
  selectedThinkingEffort: 'low' | 'medium' | 'high';
}

export class SessionManagerService {
  private runners = new Map<string, SessionRunner>();

  constructor(private fastify: FastifyInstance) {}

  startSession(sessionId: string, worktreePath: string, command: string, args: string[]) {
    const child = spawn(command, args, { cwd: worktreePath });
    const client = new ACPClient(child);
    const runner = new SessionRunner(sessionId, client, this.fastify.db, this.fastify.eventBus);
    this.runners.set(sessionId, runner);
    return runner;
  }

  restartSession(sessionId: string, worktreePath: string, selection: ProviderSelection) {
    const runner = this.runners.get(sessionId);
    if (runner) {
      runner.kill();
      this.runners.delete(sessionId);
    }

    const capability = driverCapabilities[selection.selectedDriver];
    const args = capability.buildArgs(selection.selectedModel, selection.selectedThinkingEffort);
    return this.startSession(sessionId, worktreePath, capability.command, args);
  }

  async handleClientMessage(msg: WSClientMessage) {
    const runner = this.runners.get(msg.sessionId);
    if (!runner) return;

    if (msg.action === 'approve') {
      await runner.approve(msg.eventId);
    } else if (msg.action === 'deny') {
      await runner.deny(msg.eventId);
    } else if (msg.action === 'session.input') {
      await runner.input(msg.input);
    }
  }
}

export default fp((fastify: FastifyInstance) => {
  fastify.decorate('sessionManager', new SessionManagerService(fastify));
  return Promise.resolve();
});
