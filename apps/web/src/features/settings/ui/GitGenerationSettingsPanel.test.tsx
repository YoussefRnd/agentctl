import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { GitTextGenerationSettings, ProviderDiscovery } from '@agentctl/shared';
import { GitGenerationSettingsPanel } from './GitGenerationSettingsPanel';
vi.mock('@agentctl/ui', async (original) => ({
  ...(await original<typeof import('@agentctl/ui')>()),
  Select: ({
    value,
    onChange,
    options,
    disabled,
    id,
    'aria-label': label,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
    id: string;
    'aria-label': string;
  }) => (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
const providers = [
  {
    id: 'a',
    label: 'Writer A',
    enabled: true,
    installState: 'system_available',
    status: 'ready',
    defaultModel: 'a-default',
    configOptions: [
      { id: 'llm', category: 'model', options: [{ value: 'a-fast', name: 'A Fast' }] },
    ],
    customModels: [{ id: 'custom-a', name: 'Custom A' }],
  },
  {
    id: 'b',
    label: 'Writer B',
    enabled: true,
    installState: 'installed_local',
    status: 'ready',
    configOptions: [{ id: 'model', options: [{ value: 'b-fast', name: 'B Fast' }] }],
  },
  { id: 'disabled', label: 'Disabled', enabled: false, installState: 'system_available' },
  { id: 'uninstalled', label: 'Uninstalled', enabled: true, installState: 'not_installed' },
] as ProviderDiscovery[];
function render(
  initial: GitTextGenerationSettings | null = null,
  save = vi.fn(async (_value: GitTextGenerationSettings | null) => {}),
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <GitGenerationSettingsPanel
        providers={providers}
        value={value}
        onChange={async (next) => {
          await save(next);
          setValue(next);
        }}
      />
    );
  }
  act(() => root.render(<Harness />));
  return save;
}
const select = (name: 'provider' | 'model') =>
  document.querySelector<HTMLSelectElement>(`[aria-label="Git generation ${name}"]`)!;
async function change(name: 'provider' | 'model', value: string) {
  await act(async () => {
    const element = select(name);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('starts with session defaults and saves an independent provider/model including custom choices', async () => {
  const save = render();
  expect(select('model').disabled).toBe(true);
  expect(document.body.textContent).toContain('Use session provider and model');
  await change('provider', 'a');
  expect(save).toHaveBeenLastCalledWith({ providerId: 'a', modelId: null });
  expect(select('model').textContent).toContain('Custom A');
  expect(select('model').textContent).not.toContain('B Fast');
  await change('model', 'custom-a');
  expect(save).toHaveBeenLastCalledWith({ providerId: 'a', modelId: 'custom-a' });
  await change('provider', 'b');
  expect(save).toHaveBeenLastCalledWith({ providerId: 'b', modelId: null });
  expect(select('model').value).toBe('');
  expect(select('model').textContent).not.toContain('Custom A');
  await change('provider', '');
  expect(save).toHaveBeenLastCalledWith(null);
  expect(select('model').disabled).toBe(true);
});
it('lists installed enabled providers and shows stale choices instead of silently changing them', () => {
  render({ providerId: 'deleted-provider', modelId: 'old-model' });
  expect(select('provider').textContent).not.toContain('Disabled');
  expect(select('provider').textContent).not.toContain('Uninstalled');
  expect(select('provider').value).toBe('deleted-provider');
  expect(document.body.textContent).toContain('unavailable');
  expect(select('model').disabled).toBe(true);
});
it('keeps the saved selection on save failures', async () => {
  const save = vi.fn(async (_value: GitTextGenerationSettings | null) => {
    throw new Error('Settings could not be saved');
  });
  render({ providerId: 'a', modelId: 'a-fast' }, save);
  await change('provider', 'b');
  expect(select('provider').value).toBe('a');
  expect(select('model').value).toBe('a-fast');
  expect(document.body.textContent).toContain('Settings could not be saved');
});
it('locks both controls until a provider change has saved', async () => {
  let finish!: () => void;
  const save = vi.fn(
    async (_value: GitTextGenerationSettings | null) =>
      await new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render({ providerId: 'a', modelId: 'a-fast' }, save);
  act(() => {
    select('provider').value = 'b';
    select('provider').dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(select('provider').disabled).toBe(true);
  expect(select('model').disabled).toBe(true);
  await act(async () => finish());
  expect(select('provider').value).toBe('b');
  expect(select('model').value).toBe('');
});
it('keeps an unavailable model visible and allows choosing a supported model', async () => {
  const save = render({ providerId: 'a', modelId: 'removed' });
  expect(select('model').value).toBe('removed');
  expect(document.body.textContent).toContain('saved choice is unavailable');
  await change('model', 'a-fast');
  expect(save).toHaveBeenLastCalledWith({ providerId: 'a', modelId: 'a-fast' });
  expect(document.body.textContent).not.toContain('saved choice is unavailable');
});
