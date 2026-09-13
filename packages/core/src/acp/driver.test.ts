import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AgentDriver } from '../agent/types.js';
import { AcpAgentDriver, selectAcpProtocol } from './driver.js';

function fakeDriver(label: string): AgentDriver {
  return {
    startSession: vi.fn(() => Promise.reject(new Error(label))),
    inspectProvider: vi.fn(() => Promise.reject(new Error(label))),
  };
}

describe('ACP protocol adapter selection', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('defaults to the stable v1 adapter', () => {
    vi.stubEnv('AGENTCTL_ACP_PROTOCOL', '');
    expect(selectAcpProtocol({})).toBe('v1');
  });

  test('requires an explicit v2 feature flag', () => {
    expect(selectAcpProtocol({ AGENTCTL_ACP_PROTOCOL: 'v2' })).toBe('v2');
    expect(selectAcpProtocol({ AGENTCTL_ACP_PROTOCOL: '2' })).toBe('v2');
  });

  test('routes provider inspection through the selected adapter', async () => {
    const v1 = fakeDriver('v1');
    const v2 = fakeDriver('v2');
    const driver = new AcpAgentDriver(v1 as never, v2 as never);

    await expect(driver.inspectProvider('agent', [], {})).rejects.toThrow('v1');
    await expect(
      driver.inspectProvider('agent', [], { AGENTCTL_ACP_PROTOCOL: 'v2' }),
    ).rejects.toThrow('v2');
  });
});
