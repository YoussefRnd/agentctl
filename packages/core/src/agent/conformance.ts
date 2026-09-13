import { AgentError } from './errors.js';
import type {
  AgentDriver,
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
}

/**
 * Exercises the lifecycle every protocol adapter must provide. Protocol test
 * fixtures use this runner so new adapters inherit the same behavioral checks.
 */
export async function runAgentDriverConformance(
  driver: AgentDriver,
  options: AgentSessionOptions,
  prompt = 'conformance prompt',
): Promise<AgentConformanceReport> {
  const updates: AgentUpdate[] = [];
  const session = await driver.startSession('agent', [], options, {
    onUpdate(update) {
      updates.push(update);
    },
    onRequestPermission: () => Promise.resolve({ allowed: false }),
  });

  try {
    if (!session.id) {
      throw new AgentError('agent_failure', 'Conformance session did not return an ID');
    }
    if (session.history !== 'fresh' && session.history !== 'restored') {
      throw new AgentError('agent_failure', 'Conformance session returned invalid history state');
    }
    const promptResult = await session.prompt(prompt);
    if (!promptResult.stopReason) {
      throw new AgentError('agent_failure', 'Conformance prompt returned no stop reason');
    }
    return { sessionId: session.id, history: session.history, promptResult, updates };
  } finally {
    await session.close();
  }
}
