import { afterEach, describe, expect, test, vi } from 'vitest';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import type { AgentDescriptor, AgentDriver } from '../agent/types.js';
import { AcpAgentDriver, selectAcpProtocol } from './driver.js';
import { AcpProtocolIncompatibilityError, negotiateV2 } from './protocol/negotiation.js';
import { z } from 'zod';

const descriptor: AgentDescriptor = {
  status: 'ready',
  configOptions: [],
  authMethods: [],
  supportsDynamicModel: false,
  supportsDynamicConfig: false,
};
function fakeDriver(): AgentDriver {
  return {
    startSession: vi.fn(),
    inspectProvider: vi.fn().mockResolvedValue(descriptor),
    invalidateProviderCache: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  };
}
function setup() {
  vi.stubEnv('AGENTCTL_ACP_PROTOCOL', '');
  vi.stubEnv('AGENTCTL_ACP_V2_ENABLED', 'true');
  const v1 = fakeDriver();
  const v2 = fakeDriver();
  return { v1, v2, driver: new AcpAgentDriver(v1 as never, v2 as never) };
}
describe('ACP protocol negotiation', () => {
  afterEach(() => vi.unstubAllEnvs());
  test('defaults to automatic selection and honors overrides', () => {
    setup();
    expect(selectAcpProtocol({})).toBe('auto');
    expect(selectAcpProtocol({ AGENTCTL_ACP_PROTOCOL: 'v1' })).toBe('v1');
    expect(selectAcpProtocol({ AGENTCTL_ACP_PROTOCOL: '2' })).toBe('v2');
  });
  test('uses stable v1 until draft v2 is explicitly enabled', async () => {
    const { v1, v2, driver } = setup();
    vi.stubEnv('AGENTCTL_ACP_V2_ENABLED', '');
    await driver.inspectProvider('agent', [], {});
    expect(v1.inspectProvider).toHaveBeenCalledOnce();
    expect(v2.inspectProvider).not.toHaveBeenCalled();
    await driver.inspectProvider('agent', [], { AGENTCTL_ACP_PROTOCOL: 'v2' });
    expect(v2.inspectProvider).toHaveBeenCalledOnce();
  });
  test('disabling the draft gate overrides a cached v2 selection', async () => {
    const { v1, v2, driver } = setup();
    await driver.inspectProvider('agent', [], {});
    vi.stubEnv('AGENTCTL_ACP_V2_ENABLED', 'false');
    await driver.inspectProvider('agent', [], {});
    expect(v1.inspectProvider).toHaveBeenCalledOnce();
    expect(v2.inspectProvider).toHaveBeenCalledOnce();
  });
  test('enabling the draft gate after a stable connection still probes v2', async () => {
    const { v1, v2, driver } = setup();
    vi.stubEnv('AGENTCTL_ACP_V2_ENABLED', 'false');
    await driver.inspectProvider('agent', [], {});
    vi.stubEnv('AGENTCTL_ACP_V2_ENABLED', 'true');
    await driver.inspectProvider('agent', [], {});
    expect(v1.inspectProvider).toHaveBeenCalledOnce();
    expect(v2.inspectProvider).toHaveBeenCalledOnce();
  });
  test('prefers v2, falls back only on incompatibility, and caches by launch identity', async () => {
    const { v1, v2, driver } = setup();
    vi.mocked(v2.inspectProvider).mockRejectedValueOnce(
      new AcpProtocolIncompatibilityError('legacy'),
    );
    await driver.inspectProvider('agent', [], { ACCOUNT: 'one' });
    await driver.inspectProvider('agent', [], { ACCOUNT: 'one' });
    expect(v2.inspectProvider).toHaveBeenCalledTimes(1);
    expect(v1.inspectProvider).toHaveBeenCalledTimes(2);
    await driver.inspectProvider('agent', [], { ACCOUNT: 'two' });
    expect(v2.inspectProvider).toHaveBeenCalledTimes(2);
    await driver.invalidateProviderCache('agent', [], { ACCOUNT: 'one' });
    await driver.inspectProvider('agent', [], { ACCOUNT: 'one' });
    expect(v2.inspectProvider).toHaveBeenCalledTimes(3);
  });
  test.each(['authentication required', 'process crashed', 'request timed out', 'invalid model'])(
    'does not mask %s with another adapter',
    async (message) => {
      const { v1, v2, driver } = setup();
      vi.mocked(v2.inspectProvider).mockRejectedValue(new Error(message));
      await expect(driver.inspectProvider('agent', [], {})).rejects.toThrow(message);
      expect(v1.inspectProvider).not.toHaveBeenCalled();
    },
  );
  test('an explicit override disables fallback', async () => {
    const { v1, v2, driver } = setup();
    vi.mocked(v2.inspectProvider).mockRejectedValue(new AcpProtocolIncompatibilityError('legacy'));
    await expect(
      driver.inspectProvider('agent', [], { AGENTCTL_ACP_PROTOCOL: 'v2' }),
    ).rejects.toThrow('legacy');
    expect(v1.inspectProvider).not.toHaveBeenCalled();
  });
  test('session launch shares the negotiated adapter with listing', async () => {
    const { v1, v2, driver } = setup();
    vi.mocked(v2.inspectProvider).mockRejectedValue(new AcpProtocolIncompatibilityError('legacy'));
    await driver.inspectProvider('agent', [], {});
    await driver.listSessions('agent', [], {}, { cwd: '/tmp' });
    await driver.startSession(
      'agent',
      [],
      { cwd: '/tmp', env: {}, features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
      { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
    );
    expect(v1.listSessions).toHaveBeenCalled();
    expect(v1.startSession).toHaveBeenCalled();
    expect(v2.startSession).not.toHaveBeenCalled();
  });
  test('recognizes a legacy initialization shape rejected by the v2 SDK', async () => {
    const result = z
      .object({ info: z.object({ name: z.string() }) })
      .safeParse({ agentInfo: { name: 'legacy' } });
    if (result.success) throw new Error('expected validation error');
    await expect(negotiateV2(Promise.reject(result.error))).rejects.toBeInstanceOf(
      AcpProtocolIncompatibilityError,
    );
    await expect(
      negotiateV2(Promise.reject({ code: -32602, message: 'Authentication required' })),
    ).rejects.toEqual({ code: -32602, message: 'Authentication required' });
  });
});
