import { spawn } from 'node:child_process';
import { AcpAgentDriver } from './acp/driver.js';
import { AgentDiagnosticsRecorder } from './agent/diagnostics.js';
import type { Logger } from './logger.js';

/** Composition helper for applications that use ACP as their configured transport. */
export function createDefaultAgentDriver(
  logger: Logger,
  diagnostics: AgentDiagnosticsRecorder = new AgentDiagnosticsRecorder(),
) {
  return AcpAgentDriver.create(spawn, logger, diagnostics);
}
