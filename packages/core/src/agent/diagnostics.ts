import {
  agentDiagnosticEventSchema,
  agentDiagnosticsSnapshotSchema,
  type AgentConnectionDiagnostic,
  type AgentDiagnosticEvent,
  type AgentDiagnosticsSnapshot,
} from '@agentctl/shared';
import { recordConnectionEvent } from '../observability/index.js';
/*
 * Keep these re-exports here so transport implementations do not need to
 * depend on the shared schema package directly.
 */
export type {
  AgentConnectionDiagnostic,
  AgentDiagnosticAdapter,
  AgentDiagnosticEvent,
  AgentDiagnosticEventKind,
  AgentDiagnosticsSnapshot,
} from '@agentctl/shared';

/**
 * Process-local, bounded diagnostics containing only allowlisted operational data.
 * Prompts, tool arguments, environment variables, stderr, and protocol frames are
 * deliberately excluded so snapshots are safe to export for support.
 */
export class AgentDiagnosticsRecorder {
  private readonly events: AgentDiagnosticEvent[] = [];

  constructor(private readonly capacity = 250) {}

  record(event: Omit<AgentDiagnosticEvent, 'timestamp'>): void {
    const recorded = agentDiagnosticEventSchema.parse({
      timestamp: new Date().toISOString(),
      ...event,
    });
    this.events.push(recorded);
    recordConnectionEvent(recorded);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  snapshot(connections: AgentConnectionDiagnostic[] = []): AgentDiagnosticsSnapshot {
    return agentDiagnosticsSnapshotSchema.parse({
      generatedAt: new Date().toISOString(),
      connections,
      events: this.events,
    });
  }
}
