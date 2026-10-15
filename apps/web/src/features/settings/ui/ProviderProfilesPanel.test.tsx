import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProviderDiscovery } from '@agentctl/shared';
import { ProviderProfilesPanel } from './ProviderProfilesPanel';
const mocks = vi.hoisted(() => ({ create: vi.fn(), config: vi.fn() }));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<typeof import('@agentctl/api-client')>()),
  providerService: { createProfile: mocks.create, updateConfig: mocks.config },
}));
vi.mock('@agentctl/ui', async (original) => ({
  ...(await original<typeof import('@agentctl/ui')>()),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});
const provider = {
  id: 'profile',
  label: 'Work',
  isProfile: true,
  registryAgentId: 'agent',
  installState: 'installed_local',
  configOptions: [
    { id: 'llm', category: 'model', options: [{ value: 'model', name: 'Model' }] },
    {
      id: 'effort',
      category: 'thought_level',
      options: [
        { value: 'thinking', name: 'Thinking' },
        { value: 'none', name: 'No reasoning' },
      ],
    },
  ],
} as ProviderDiscovery;
const change = (index: number, value: string) =>
  act(() => {
    const select = container.querySelectorAll('select')[index];
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
const click = async (text: string) =>
  act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text,
    );
    if (!button) throw new Error('Missing button');
    button.click();
  });
test('saves protocol and model defaults on the selected profile without copying credentials', async () => {
  mocks.config.mockResolvedValue(provider);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProviderProfilesPanel providers={[provider]} />
      </QueryClientProvider>,
    ),
  );
  change(0, 'profile');
  change(1, 'v1');
  change(2, 'model');
  expect(
    [...container.querySelectorAll('select')[3].options].map((option) => option.value),
  ).toContain('thinking');
  change(3, 'thinking');
  await click('Save configuration');
  expect(mocks.config).toHaveBeenCalledWith('profile', undefined, undefined, {
    customModels: [],
    protocol: 'v1',
    defaultModel: 'model',
    defaultThinkingEffort: 'thinking',
  });
});

test('saves only edited environment variables, keeping existing secrets untouched', async () => {
  const configured = { ...provider, customEnvConfigured: { EXISTING_TOKEN: true } };
  mocks.config.mockResolvedValue(configured);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProviderProfilesPanel providers={[configured]} />
      </QueryClientProvider>,
    ),
  );
  change(0, 'profile');
  const input = (label: string, value: string) =>
    act(() => {
      const field = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  input('Environment variable name', 'AGENT_HOME');
  await click('Add variable');
  input('Value for AGENT_HOME', '/tmp/work-account');
  await click('Save configuration');
  expect(mocks.config).toHaveBeenCalledWith(
    'profile',
    { AGENT_HOME: '/tmp/work-account' },
    undefined,
    { customModels: [], protocol: 'auto', defaultModel: '', defaultThinkingEffort: '' },
  );
});

test('undoing removal preserves an existing secret without sending an empty replacement', async () => {
  const configured = { ...provider, customEnvConfigured: { TOKEN: true } };
  mocks.config.mockResolvedValue(configured);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProviderProfilesPanel providers={[configured]} />
      </QueryClientProvider>,
    ),
  );
  change(0, 'profile');
  await click('Remove');
  await click('Undo');
  await click('Save configuration');
  expect(mocks.config).toHaveBeenCalledWith('profile', undefined, undefined, {
    customModels: [],
    protocol: 'auto',
    defaultModel: '',
    defaultThinkingEffort: '',
  });
});

test('adds a custom model, selects its default, and saves its context window', async () => {
  mocks.config.mockResolvedValue(provider);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProviderProfilesPanel providers={[provider]} />
      </QueryClientProvider>,
    ),
  );
  change(0, 'profile');
  const input = (label: string, value: string) =>
    act(() => {
      const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  input('Custom model ID', 'hidden');
  input('Custom model name', 'Hidden model');
  input('Custom model context window', '128000');
  await click('Add model');
  expect(container.textContent).toContain('Hidden model');
  change(2, 'hidden');
  await click('Save configuration');
  expect(mocks.config).toHaveBeenLastCalledWith('profile', undefined, undefined, {
    protocol: 'auto',
    defaultModel: 'hidden',
    defaultThinkingEffort: '',
    customModels: [{ id: 'hidden', name: 'Hidden model', contextWindow: 128000 }],
  });
  await click('Remove model');
  await click('Save configuration');
  expect(mocks.config).toHaveBeenLastCalledWith('profile', undefined, undefined, {
    protocol: 'auto',
    defaultModel: '',
    defaultThinkingEffort: '',
    customModels: [],
  });
});
