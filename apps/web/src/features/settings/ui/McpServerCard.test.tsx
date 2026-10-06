import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { McpServerCard } from './McpServerCard';

vi.mock('../api/useMcpServers', () => ({ useMcpTools: () => ({ tools: [] }) }));

it('keeps enabling a server separate from expanding its details', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onToggleExpand = vi.fn();
  const onToggleEnabled = vi.fn();
  act(() =>
    root.render(
      <McpServerCard
        server={{
          id: 'test',
          name: 'Test server',
          enabled: false,
          autoApprove: false,
          type: 'local',
          approvalPolicy: 'always_prompt',
          toolPermissions: '{}',
        }}
        isExpanded={false}
        onToggleExpand={onToggleExpand}
        onToggleEnabled={onToggleEnabled}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onUpdatePolicy={() => undefined}
        onUpdateToolPermission={() => undefined}
      />,
    ),
  );
  try {
    expect(container.querySelector('button button')).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute('aria-label')).toBe('Enable Test server');
    act(() => toggle?.click());
    expect(onToggleEnabled).toHaveBeenCalledWith(true);
    expect(onToggleExpand).not.toHaveBeenCalled();
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Expand Test server"]')?.click(),
    );
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
