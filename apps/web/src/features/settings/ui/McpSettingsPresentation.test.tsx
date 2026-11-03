import { createHash } from 'node:crypto';
import { act } from 'react';
import { McpServerForm } from './McpServerForm';
import { initialFormState } from './McpUtils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { McpSettingsPresentation } from './McpSettingsPresentation';
import type { useMcpServers } from '../api/useMcpServers';
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
it('keeps entered MCP configuration until a save succeeds', () => {
  const update = vi.fn();
  const api = {
    mcpServers: [
      {
        id: 'tools',
        name: 'Tools',
        type: 'local',
        command: 'npx',
        enabled: false,
        autoApprove: false,
        approvalPolicy: 'always_prompt',
        toolPermissions: '{}',
      },
    ],
    isLoading: false,
    isAdding: false,
    isUpdating: false,
    isDeleting: false,
    addMcpServer: vi.fn(),
    updateMcpServer: update,
    deleteMcpServer: vi.fn(),
  } as unknown as ReturnType<typeof useMcpServers>;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<McpSettingsPresentation api={api} tools={[]} />));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Expand Tools"]')!.click());
  const click = (text: string) =>
    act(() =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === text)!
        .click(),
    );
  click('Edit server');
  click('Save Server');
  expect((document.getElementById('mcp-name') as HTMLInputElement).value).toBe('Tools');
  expect((document.getElementById('mcp-command') as HTMLInputElement).value).toBe('npx');
  // A rejected request does not call onSuccess; the editor remains available for retry.
  click('Save Server');
  expect(update).toHaveBeenCalledTimes(2);
  act(() => update.mock.calls[1]![1].onSuccess());
  expect(document.getElementById('mcp-name')).toBeNull();
});

it('preserves the local and remote fields and layout around the shared server type selector', () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const appearance = (node: Element): unknown => {
    // The selector is the explicitly approved design change; surrounding fields stay fixed.
    if (node.querySelector(':scope > span')?.textContent === 'Server Type') return ['server-type'];
    return [
      node.tagName,
      node.getAttribute('class'),
      node.getAttribute('style'),
      [...node.children].map(appearance),
    ];
  };
  const result = [];
  for (const type of ['local', 'remote'] as const) {
    act(() =>
      root.render(
        <McpServerForm
          formState={{ ...initialFormState, type }}
          onChange={() => {}}
          onSave={() => {}}
          onCancel={() => {}}
          isEditing={false}
        />,
      ),
    );
    result.push({
      type,
      signature: createHash('sha256')
        .update(JSON.stringify(appearance(host)))
        .digest('hex'),
    });
  }
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "signature": "c8cc4b2a86bfc5f148d512d2a39a9e4cfeafc6fb58ebfe13f6be5d03fcfdeb44",
        "type": "local",
      },
      {
        "signature": "d151cd0e8800e8d660ada67c9fc4085e394fd20b003f4d83d79bbeeb05138f7c",
        "type": "remote",
      },
    ]
  `);
});

function renderMcp(api: Partial<ReturnType<typeof useMcpServers>> = {}) {
  const value = {
    mcpServers: [],
    isLoading: false,
    isAdding: false,
    isUpdating: false,
    isDeleting: false,
    addMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    deleteMcpServer: vi.fn(),
    ...api,
  } as ReturnType<typeof useMcpServers>;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<McpSettingsPresentation api={value} tools={[]} />));
  return { host, api: value };
}
function clickButton(text: string) {
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === text)!
      .click(),
  );
}
function fill(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('focuses the missing required field and keeps validation connected to the unchanged layout', () => {
  const { api } = renderMcp();
  clickButton('Add Server');
  fill('mcp-name', '   ');
  clickButton('Save Server');
  const name = document.getElementById('mcp-name')!;
  expect(api.addMcpServer).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(name);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(name.getAttribute('aria-errormessage')!)?.textContent).toBe(
    'Name is required.',
  );
  fill('mcp-name', 'Tools');
  expect(name.hasAttribute('aria-invalid')).toBe(false);
  clickButton('Save Server');
  expect(document.activeElement?.id).toBe('mcp-command');
  clickButton('Remote (Stateless HTTP / SSE)');
  clickButton('Save Server');
  expect(document.activeElement?.id).toBe('mcp-url');
  fill('mcp-url', 'https://example.com/mcp');
  clickButton('Save Server');
  expect(api.addMcpServer).toHaveBeenCalledOnce();
});
it('blocks repeat saves while a mutation is pending without replacing the form', () => {
  const { api } = renderMcp();
  clickButton('Add Server');
  fill('mcp-name', 'Tools');
  fill('mcp-command', 'npx');
  clickButton('Save Server');
  act(() => root.render(<McpSettingsPresentation api={{ ...api, isAdding: true }} tools={[]} />));
  clickButton('Save Server');
  expect(api.addMcpServer).toHaveBeenCalledOnce();
  expect((document.getElementById('mcp-name') as HTMLInputElement).value).toBe('Tools');
  expect((document.getElementById('mcp-name') as HTMLInputElement).disabled).toBe(true);
  act(() => root.render(<McpSettingsPresentation api={api} tools={[]} />));
  clickButton('Save Server');
  expect(api.addMcpServer).toHaveBeenCalledTimes(2);
});
it('uses the shared confirmation and retains it until deletion succeeds', () => {
  const server = {
    id: 'tools',
    name: 'Tools',
    type: 'local',
    command: 'npx',
    enabled: false,
    autoApprove: false,
    approvalPolicy: 'always_prompt',
    toolPermissions: '{}',
  } as const;
  const { api, host } = renderMcp({ mcpServers: [server] });
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Expand Tools"]')!.click());
  clickButton('Delete server');
  expect(api.deleteMcpServer).not.toHaveBeenCalled();
  const confirm = () =>
    act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((button) => button.textContent === 'Delete server')!
        .click(),
    );
  confirm();
  expect(api.deleteMcpServer).toHaveBeenCalledWith(
    'tools',
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => root.render(<McpSettingsPresentation api={{ ...api, isDeleting: true }} tools={[]} />));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => root.render(<McpSettingsPresentation api={api} tools={[]} />));
  confirm();
  act(() =>
    vi.mocked(api.deleteMcpServer).mock.calls[1]![1]!.onSuccess!(
      {} as never,
      'tools',
      undefined,
      {} as never,
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
