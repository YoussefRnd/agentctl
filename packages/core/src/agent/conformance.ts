import { AgentError } from './errors.js';
import type {
  AgentDriver,
  AgentPermissionRequest,
  AgentPromptResult,
  AgentSessionHistory,
  AgentSessionOptions,
  AgentUpdate,
} from './types.js';

export interface AgentConformanceReport {
  sessionId: string;
  history: AgentSessionHistory;
  promptResult: AgentPromptResult;
  updates: AgentUpdate[];
  exercisedOperations: string[];
  permissionRequests: AgentPermissionRequest[];
}

export interface AgentConformanceExercises {
  authMethodId?: string;
  cancel?: boolean;
  modelId?: string;
  configOption?: { id: string; value: string | boolean };
  modeId?: string;
  listSessions?: boolean;
  deleteSessionId?: string;
  logout?: boolean;
}

/**
 * Exercises the lifecycle every protocol adapter must provide. Protocol test
 * fixtures use this runner so new adapters inherit the same behavioral checks.
 */
export async function runAgentDriverConformance(
  driver: AgentDriver,
  options: AgentSessionOptions,
  prompt = 'conformance prompt',
  exercises: AgentConformanceExercises = {},
): Promise<AgentConformanceReport> {
  const updates: AgentUpdate[] = [];
  const exercisedOperations: string[] = [];
  const permissionRequests: AgentPermissionRequest[] = [];
  const session = await driver.startSession('agent', [], options, {
    onUpdate(update) {
      updates.push(update);
    },
    onRequestPermission: (request) => {
      permissionRequests.push(request);
      return Promise.resolve({ allowed: false });
    },
  });

  try {
    if (!session.id) {
      throw new AgentError('agent_failure', 'Conformance session did not return an ID');
    }
    if (session.history !== 'fresh' && session.history !== 'restored') {
      throw new AgentError('agent_failure', 'Conformance session returned invalid history state');
    }
    const promptResult = await session.prompt(prompt);
    exercisedOperations.push('prompt');
    if (!promptResult.stopReason) {
      throw new AgentError('agent_failure', 'Conformance prompt returned no stop reason');
    }
    if (exercises.cancel) {
      await session.cancel();
      exercisedOperations.push('cancel');
    }
    if (exercises.authMethodId) {
      await session.authenticate(exercises.authMethodId);
      exercisedOperations.push('authenticate');
    }
    if (exercises.modelId) {
      if (!session.updateModel) throw new AgentError('unsupported', 'Model update is unavailable');
      await session.updateModel(exercises.modelId);
      exercisedOperations.push('update_model');
    }
    if (exercises.configOption) {
      if (!session.updateConfigOption)
        throw new AgentError('unsupported', 'Config update is unavailable');
      await session.updateConfigOption(exercises.configOption.id, exercises.configOption.value);
      exercisedOperations.push('update_config');
    }
    if (exercises.modeId) {
      if (!session.setMode) throw new AgentError('unsupported', 'Mode update is unavailable');
      await session.setMode(exercises.modeId);
      exercisedOperations.push('set_mode');
    }
    if (exercises.listSessions) {
      if (!session.listSessions)
        throw new AgentError('unsupported', 'Session listing is unavailable');
      await session.listSessions({ cwd: options.cwd });
      exercisedOperations.push('list_sessions');
    }
    if (exercises.deleteSessionId) {
      if (!session.deleteSession)
        throw new AgentError('unsupported', 'Session deletion is unavailable');
      await session.deleteSession(exercises.deleteSessionId);
      exercisedOperations.push('delete_session');
    }
    if (exercises.logout) {
      if (!session.logout) throw new AgentError('unsupported', 'Logout is unavailable');
      await session.logout();
      exercisedOperations.push('logout');
    }
    return {
      sessionId: session.id,
      history: session.history,
      promptResult,
      updates,
      exercisedOperations,
      permissionRequests,
    };
  } finally {
    await session.close();
  }
}
