import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { RegistryBrowserPresentation } from './RegistryBrowser';
import { pendingProvider } from './RegistryCard';
import { McpToolPermissionEditor } from './McpToolPermissionEditor';
let root: Root;
function render(element: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(element));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
it('uses the Theme Mode control for provider filtering and still filters installed and available agents', () => {
  const api: ComponentProps<typeof RegistryBrowserPresentation>['api'] = {
    providers: [],
    registry: [
      {
        ...pendingProvider,
        id: 'installed',
        label: 'Installed agent',
        installState: 'system_available',
      },
      { ...pendingProvider, id: 'available', label: 'Available agent' },
    ],
    isLoadingProviders: false,
    isLoadingRegistry: false,
    syncProviders: vi.fn(),
    isSyncing: false,
    installProvider: vi.fn(),
    cancelInstall: vi.fn(),
    isInstalling: false,
    installingProviderId: null,
    removeProvider: vi.fn(),
    isRemoving: false,
    removingProviderId: null,
    logoutProvider: vi.fn(),
    updateProviderConfig: vi.fn(),
    isUpdatingConfig: false,
    login: vi.fn(),
    isLoggingIn: false,
    refreshProvider: vi.fn(),
    isRefreshing: false,
  };
  const host = render(<RegistryBrowserPresentation settings={undefined} api={api} />);
  const group = host.querySelector('[aria-label="Filter providers"]')!;
  expect(group.getAttribute('data-slot')).toBe('segmented-control');
  expect(host.textContent).toContain('Installed agent');
  expect(host.textContent).toContain('Available agent');
  const buttons = group.querySelectorAll<HTMLButtonElement>('button');
  act(() => buttons[1]!.click());
  expect(host.textContent).toContain('Installed agent');
  expect(host.textContent).not.toContain('Available agent');
  expect(buttons[1]!.className).toContain('bg-accent text-brand-crust shadow-sm');
  expect(buttons[1]!.className).toContain('text-xs font-semibold');
  expect(group.className).toContain('rounded-lg');
  expect(group.className).not.toContain('rounded-xl');
  act(() => buttons[2]!.click());
  expect(host.textContent).not.toContain('Installed agent');
  expect(host.textContent).toContain('Available agent');
  act(() => buttons[0]!.click());
  expect(host.textContent).toContain('Installed agent');
});
it('retains compact MCP permission typography, stable control IDs and override semantics', () => {
  const update = vi.fn();
  const host = render(
    <McpToolPermissionEditor
      toolName="server__read_file"
      description="Read a file"
      toolPermissions="{}"
      onUpdateOverride={update}
    />,
  );
  const group = host.querySelector('[data-slot="segmented-control"]')!;
  expect(group.getAttribute('aria-label')).toBe('Approval policy for read_file');
  const allow = host.querySelector<HTMLButtonElement>(
    '#mcp-tool-override-server__read_file-auto_approve',
  )!;
  expect(allow.className).toContain('label-3xs');
  expect(allow.className).not.toContain('text-xs');
  act(() => allow.click());
  expect(update).toHaveBeenCalledWith('read_file', 'auto_approve');
});
