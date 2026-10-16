import { expect, test, vi } from 'vitest';
import { createDatabase, projects, sessions, providers } from '../../db/index.js';
import { Provider } from '../../providers/provider.js';
import { noopLogger } from '../../logger.js';
import type { AgentConfigOption } from '@agentctl/shared';
import { SessionStateProjector } from '../projection/session-state-projector.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import {
  SessionCommandHandler,
  type SessionCommandHandlerDependencies,
} from './session-command-handler.js';

function setup(
  newEffort: AgentConfigOption | null,
  options: { notifyOnly?: boolean; failEffort?: boolean; effectiveEffort?: string } = {},
) {
  const db = createDatabase(':memory:');
  const model: AgentConfigOption = {
    id: 'model',
    category: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'a',
    options: [
      { value: 'a', name: 'A' },
      { value: 'b', name: 'B' },
    ],
  };
  const oldEffort: AgentConfigOption = {
    id: 'old-effort',
    category: 'thought_level',
    name: 'Effort',
    type: 'select',
    currentValue: 'high',
    options: [
      { value: 'high', name: 'High' },
      { value: 'default', name: 'Default' },
    ],
  };
  const oldOptions = [model, oldEffort];
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(providers)
    .values({
      id: 'provider',
      name: 'Provider',
      command: 'fixture',
      installState: 'system_available',
      authState: 'not_required',
      supportsDynamicModel: true,
      supportsDynamicConfig: true,
      configOptions: JSON.stringify(oldOptions),
    })
    .run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      worktreePath: '/tmp',
      branch: 'main',
      baseCommit: 'none',
      taskSlug: 'probe',
      agent: 'provider',
      selectedProvider: 'provider',
      selectedModel: 'a',
      selectedThinkingEffort: 'high',
      sessionConfigOptions: JSON.stringify(oldOptions),
    })
    .run();
  const provider = new Provider(db.select().from(providers).get()!);
  const repository = new SessionEventRepository(db, { publish() {} });
  const projector = new SessionStateProjector('s', db, repository);
  let liveOptions = oldOptions;
  const calls: string[] = [];
  const active = {
    isDead: false,
    updateModel: vi.fn(async (id: string) => {
      calls.push(`model:${id}`);
      liveOptions =
        id === 'a'
          ? oldOptions
          : [{ ...model, currentValue: 'b' }, ...(newEffort ? [newEffort] : [])];
      await projector.handleDomainEvent({
        type: 'config_option_update',
        configOptions: liveOptions,
      });
      return options.notifyOnly ? undefined : liveOptions;
    }),
    updateConfigOption: vi.fn(async (id: string, value: string) => {
      calls.push(`effort:${id}:${value}`);
      if (options.failEffort && id === 'new-effort') throw new Error('Effort failed');
      liveOptions = liveOptions.map((option) =>
        option.id === id ? { ...option, currentValue: options.effectiveEffort ?? value } : option,
      );
      await projector.handleDomainEvent({
        type: 'config_option_update',
        configOptions: liveOptions,
      });
      return liveOptions;
    }),
  };
  const handler = new SessionCommandHandler({
    db,
    logger: noopLogger,
    providerRegistry: {
      async ensureProviderReady() {
        return provider;
      },
    },
    eventRepository: repository,
    runtimeRegistry: {
      getSession() {
        return active;
      },
    },
    launcher: {
      buildInitialConfigOptions(config: AgentConfigOption[]) {
        return config;
      },
      async ensureWorkspaceAvailable() {},
      async reportModelFallback() {},
    },
  } as unknown as SessionCommandHandlerDependencies);
  return { handler, active, calls, row: () => db.select().from(sessions).get()! };
}
const newEffort: AgentConfigOption = {
  id: 'new-effort',
  category: 'thought_level',
  name: 'Effort',
  type: 'select',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'max', name: 'Max' },
  ],
};

test.each([false, true])(
  'saves the new model default instead of the old effort (notifyOnly=%s)',
  async (notifyOnly) => {
    const { handler, active, row } = setup(newEffort, { notifyOnly });
    await handler.updateSessionConfig('s', { selectedProvider: 'provider', selectedModel: 'b' });
    expect(row().selectedThinkingEffort).toBe('default');
    expect(
      JSON.parse(row().sessionConfigOptions).find(
        (option: AgentConfigOption) => option.category === 'thought_level',
      ).currentValue,
    ).toBe('default');
    expect(active.updateConfigOption).not.toHaveBeenCalled();
  },
);

test('honors a requested effort newly advertised by the selected model', async () => {
  const { handler, active, row } = setup(newEffort);
  await handler.updateSessionConfig('s', {
    selectedProvider: 'provider',
    selectedModel: 'b',
    selectedThinkingEffort: 'max',
  });
  expect(active.updateConfigOption).toHaveBeenCalledExactlyOnceWith('new-effort', 'max');
  expect(row().selectedThinkingEffort).toBe('max');
});

test('falls back to the new model default when the requested old effort is unsupported', async () => {
  const { handler, active, row } = setup(newEffort);
  await handler.updateSessionConfig('s', {
    selectedProvider: 'provider',
    selectedModel: 'b',
    selectedThinkingEffort: 'high',
  });
  expect(row().selectedThinkingEffort).toBe('default');
  expect(active.updateConfigOption).not.toHaveBeenCalled();
});

test('clears the effort when the new model removes the setting', async () => {
  const { handler, active, row } = setup(null);
  await handler.updateSessionConfig('s', { selectedProvider: 'provider', selectedModel: 'b' });
  expect(row().selectedThinkingEffort).toBeNull();
  expect(active.updateConfigOption).not.toHaveBeenCalled();
});

test('persists the effective provider response instead of overwriting it with the request', async () => {
  const { handler, row } = setup(newEffort, { effectiveEffort: 'default' });
  await handler.updateSessionConfig('s', {
    selectedProvider: 'provider',
    selectedModel: 'b',
    selectedThinkingEffort: 'max',
  });
  expect(row().selectedThinkingEffort).toBe('default');
});

test('restores the previous model before restoring its effort after a failure', async () => {
  const { handler, calls, row } = setup(newEffort, { failEffort: true });
  await expect(
    handler.updateSessionConfig('s', {
      selectedProvider: 'provider',
      selectedModel: 'b',
      selectedThinkingEffort: 'max',
    }),
  ).rejects.toThrow('Effort failed');
  expect(calls).toEqual(['model:b', 'effort:new-effort:max', 'model:a', 'effort:old-effort:high']);
  expect(row()).toMatchObject({ selectedModel: 'a', selectedThinkingEffort: 'high' });
});
