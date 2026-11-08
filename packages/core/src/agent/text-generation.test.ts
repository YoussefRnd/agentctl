import { expect, it, vi, afterEach } from 'vite-plus/test';
import { access, mkdir } from 'node:fs/promises';
import { generateGitText, parseGitTextOutput } from './text-generation.js';
import type {
  AgentDriver,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from './types.js';
import { jsonCodecs } from '../db/json-codecs.js';
const options = { selectedModel: 'my-model', features: jsonCodecs.agentFeatures(null) };
const launch = { command: 'agent', args: ['--acp'], env: { CUSTOM: 'profile' } };
afterEach(() => {
  vi.useRealTimers();
});

function fixture(
  response = '{"subject":"Improve Git workflow","body":"Keep user changes"}',
  reason = 'end_turn',
) {
  let cwd = '';
  let callbacks: AgentSessionCallbacks;
  const close = vi.fn(async () => {});
  const prompt = vi.fn(async () => {
    await callbacks.onUpdate({ type: 'text', text: response });
    return { stopReason: reason };
  });
  const startSession = vi.fn(
    async (
      _command: string,
      _args: string[],
      params: AgentSessionOptions,
      cb: AgentSessionCallbacks,
    ) => {
      cwd = params.cwd;
      callbacks = cb;
      return { prompt, close } as unknown as AgentSession;
    },
  );
  return {
    driver: { startSession } as unknown as AgentDriver,
    startSession,
    close,
    prompt,
    get cwd() {
      return cwd;
    },
  };
}
it('uses an isolated new session, denies executable permissions, cleans up, and honors the selected model/profile', async () => {
  const f = fixture();
  expect(await generateGitText(f.driver, launch, options, 'data only', 'commit')).toEqual({
    title: 'Improve Git workflow',
    body: 'Keep user changes',
  });
  const params = f.startSession.mock.calls[0]![2];
  const cb = f.startSession.mock.calls[0]![3];
  expect(params.intent).toEqual({ kind: 'new' });
  expect(params.selectedModel).toBe('my-model');
  expect(params.env).toEqual(launch.env);
  expect(params.mcpServers).toEqual([]);
  expect(params.additionalDirectories).toEqual([]);
  expect(
    await cb.onRequestPermission({ permissionId: 'permission', toolCall: { name: 'bash' } }),
  ).toEqual({ allowed: false });
  expect(f.prompt).toHaveBeenCalledWith('data only');
  expect(f.close).toHaveBeenCalledOnce();
  await expect(access(f.cwd)).rejects.toThrow();
});
it.each([
  'not json',
  '{"subject":"","body":""}',
  '{"subject":"bad\\nsubject","body":""}',
  '{"subject":"' + 'x'.repeat(73) + '","body":""}',
])('rejects invalid output and closes the helper: %s', async (response) => {
  const f = fixture(response);
  await expect(generateGitText(f.driver, launch, options, '', 'commit')).rejects.toThrow(
    'invalid draft',
  );
  expect(f.close).toHaveBeenCalledOnce();
});
it('does not treat a cancelled or truncated response as a usable draft', async () => {
  const f = fixture(undefined, 'max_tokens');
  await expect(generateGitText(f.driver, launch, options, '', 'merge')).rejects.toThrow(
    'max_tokens',
  );
  expect(f.close).toHaveBeenCalledOnce();
});
it('accepts fenced JSON and validates PR fields', () => {
  expect(
    parseGitTextOutput(
      '```json\n{"title":"Improve review","body":"## Testing\\nNot run"}\n```',
      'pr',
    ),
  ).toEqual({ title: 'Improve review', body: '## Testing\nNot run' });
  expect(() => parseGitTextOutput('{"title":"PR","body":""}', 'pr')).toThrow();
});
it('times out a hanging generation and closes its session', async () => {
  const f = fixture();
  let signalStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  f.prompt.mockImplementation(async () => {
    signalStarted();
    return await new Promise<never>(() => {});
  });
  const result = generateGitText(f.driver, launch, options, '', 'commit', 25);
  const failure = expect(result).rejects.toThrow('timed out');
  await ready;
  await failure;
  expect(f.close).toHaveBeenCalledOnce();
  await expect(access(f.cwd)).rejects.toThrow();
});

it('removes the temporary directory when provider startup fails', async () => {
  const f = fixture();
  let cwd = '';
  f.startSession.mockImplementationOnce(async (_command, _args, params) => {
    cwd = params.cwd;
    throw new Error('Provider could not start');
  });
  await expect(generateGitText(f.driver, launch, options, '', 'commit')).rejects.toThrow(
    'could not start',
  );
  await expect(access(cwd)).rejects.toThrow();
});
it('closes a helper and removes files created after its request timed out', async () => {
  const f = fixture();
  let started!: () => void;
  let finish!: (session: AgentSession) => void;
  let closed!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const closedReady = new Promise<void>((resolve) => {
    closed = resolve;
  });
  f.startSession.mockImplementationOnce(async () => {
    started();
    return await new Promise<AgentSession>((resolve) => {
      finish = resolve;
    });
  });
  const result = generateGitText(f.driver, launch, options, '', 'commit', 25);
  const failure = expect(result).rejects.toThrow('timed out');
  await ready;
  await failure;
  const { cwd } = f.startSession.mock.calls[0]![2];
  await mkdir(cwd);
  finish({
    close: async () => {
      closed();
    },
    prompt: f.prompt,
  } as unknown as AgentSession);
  await closedReady;
  expect(f.prompt).not.toHaveBeenCalled();
  await vi.waitFor(async () => {
    await expect(access(cwd)).rejects.toThrow();
  });
});
it('rejects oversized responses without treating truncated JSON as a draft', async () => {
  const f = fixture('{"subject":"Change","body":"' + 'x'.repeat(40_000) + '"}');
  await expect(generateGitText(f.driver, launch, options, '', 'commit')).rejects.toThrow(
    'output limit',
  );
  expect(f.close).toHaveBeenCalledOnce();
});
