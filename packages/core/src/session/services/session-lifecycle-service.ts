import { eq } from 'drizzle-orm';
import type { SessionRuntime } from '../runtime/session-runtime.js';
import { sessions, projects } from '../../db/schema.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import type { SessionMode, ThinkingEffort } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { AgentDriver } from '../../agent/types.js';
import type { SessionRuntimeRegistry } from '../runtime/session-runtime-registry.js';
import type { SessionWorkspace } from '../../git/session-workspace.js';
import type { SessionLauncher } from './session-launcher.js';

export interface SessionLifecycleDependencies {
  db: DbClient;
  logger: Logger;
  runtime: AgentDriver;
  runtimeRegistry: SessionRuntimeRegistry;
  sessionWorkspace: SessionWorkspace;
  launcher: SessionLauncher;
  restartSession: SessionLauncher['restartSession'];
}

export class SessionLifecycleService {
  constructor(private readonly deps: SessionLifecycleDependencies) {}

  async syncOrphans(): Promise<void> {
    // Derive protection and ownership from the same database snapshot. A
    // session created by another server after this read must remain unknown.
    const knownSessions = await this.deps.db.query.sessions.findMany();
    const activeIds = knownSessions
      .filter((session) => !['merged', 'discarded'].includes(session.status))
      .map((session) => session.id);
    const knownIds = knownSessions.map((session) => session.id);
    await this.deps.sessionWorkspace.syncOrphans(activeIds, knownIds);
  }

  async switchMode(sessionId: string, newMode: SessionMode): Promise<SessionRuntime | null> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (sessionRecord.mode === newMode) {
      const active = this.deps.runtimeRegistry.getSession(sessionId);
      return active ?? null;
    }

    const wasRunning = this.deps.runtimeRegistry.hasSession(sessionId);
    await this.deps.sessionWorkspace.activate(sessionId, {
      mode: newMode,
      baseBranch: sessionRecord.branch || 'main',
    });

    if (wasRunning) {
      return this.deps.restartSession(sessionId);
    }

    return null;
  }

  async stopAll(): Promise<void> {
    await this.deps.runtimeRegistry.stopAll();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.deps.runtimeRegistry.stopSession(sessionId);

    if (sessionRecord.agentSessionId) {
      try {
        let providerSessions = jsonCodecs.agentSessionMap(sessionRecord.agentSessionId);
        if (!providerSessions) {
          const initialProvider = sessionRecord.agent || sessionRecord.selectedProvider;
          providerSessions = { [initialProvider]: sessionRecord.agentSessionId };
        }

        if (typeof this.deps.runtime.deleteSession === 'function') {
          for (const [providerId, sId] of Object.entries(providerSessions)) {
            try {
              const { launch } = await this.deps.launcher.resolveLaunchParameters(
                providerId,
                sessionRecord.selectedModel,
                sessionRecord.selectedThinkingEffort as ThinkingEffort,
              );
              await this.deps.runtime.deleteSession(launch.command, launch.args, launch.env, sId);
            } catch (delErr) {
              this.deps.logger.warn(
                { delErr, providerId },
                `Failed to delete agent session for provider ${providerId}`,
              );
            }
          }
        }
      } catch (err: unknown) {
        this.deps.logger.error({ err, sessionId }, 'Failed to delete session on agent');
      }
    }

    await this.deps.sessionWorkspace.teardown(sessionId).catch((err: unknown) => {
      this.deps.logger.error({ err, sessionId }, 'Failed to teardown workspace on deleteSession');
      throw err;
    });

    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const attachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);
      if (fs.existsSync(attachmentsDir)) {
        fs.rmSync(attachmentsDir, { recursive: true, force: true });
      }
    } catch (err: unknown) {
      this.deps.logger.error({ err, sessionId }, 'Failed to cleanup attachments on deleteSession');
    }
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.deps.sessionWorkspace.archive(sessionId);
  }

  async finalizeSession(
    sessionId: string,
    action: 'merge' | 'discard',
    commitMessage?: string,
    targetBranch?: string,
  ): Promise<void> {
    await this.deps.sessionWorkspace.finalize(
      sessionId,
      action === 'merge' ? 'merged' : 'discarded',
      {
        commitMessage,
        baseBranch: targetBranch,
      },
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    const projectRecord = await this.deps.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      with: { sessions: true },
    });

    if (!projectRecord) {
      throw new Error(`Project not found: ${projectId}`);
    }

    for (const session of projectRecord.sessions) {
      await this.deps.sessionWorkspace.teardown(session.id).catch((err: unknown) => {
        this.deps.logger.error(
          { err, sessionId: session.id },
          'Failed to teardown workspace on deleteProject',
        );
      });
    }

    await this.deps.db.delete(projects).where(eq(projects.id, projectId));
  }
}
