import { describe, expect, it } from 'vitest';
import { AgentDiagnosticsRecorder } from './diagnostics.js';

describe('AgentDiagnosticsRecorder', () => {
  it('keeps a bounded, allowlisted operational history', () => {
    const recorder = new AgentDiagnosticsRecorder(2);
    recorder.record({ kind: 'adapter_selected', adapter: 'acp-v1', providerId: 'one' });
    recorder.record({
      kind: 'fallback_used',
      adapter: 'acp-v1',
      providerId: 'two',
      path: 'spawn',
      reason: 'persistent_connection_unavailable',
      prompt: 'secret prompt',
      environment: { SECRET: 'value' },
    } as Parameters<AgentDiagnosticsRecorder['record']>[0]);
    recorder.record({ kind: 'adapter_selected', adapter: 'acp-v2', providerId: 'three' });

    const snapshot = recorder.snapshot();
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.map((event) => event.providerId)).toEqual(['two', 'three']);
    expect(JSON.stringify(snapshot)).not.toContain('prompt');
    expect(JSON.stringify(snapshot)).not.toContain('environment');
    expect(JSON.stringify(snapshot)).not.toContain('secret prompt');
  });
});
