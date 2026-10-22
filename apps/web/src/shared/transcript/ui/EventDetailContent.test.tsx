import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { SessionEventRow } from '@agentctl/shared';
import { EventDetailContent } from './EventDetailContent';
import { ToolStepRow } from './ToolActivityRow';
import { AgentTerminals } from './AgentTerminals';

const { fetchDetail } = vi.hoisted(() => ({ fetchDetail: vi.fn() }));
vi.mock('@agentctl/api-client', () => ({ fetchSessionEventDetail: fetchDetail }));
const sessionId = '11111111-1111-4111-8111-111111111111';
const full: SessionEventRow = {
  id: 1,
  sessionId,
  createdAt: new Date(),
  type: 'tool_call',
  data: {
    name: 'read',
    kind: 'read',
    status: 'completed',
    arguments: { path: '/file' },
    rawOutput: 'complete output',
  },
};
const compact: SessionEventRow = {
  ...full,
  details: { revision: 'a'.repeat(64) },
  data: { name: 'read', kind: 'read', status: 'completed', arguments: { path: '/file' } },
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
beforeEach(() => {
  fetchDetail.mockReset();
  host = document.createElement('div');
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function render(children: React.ReactNode) {
  act(() => root.render(<QueryClientProvider client={client}>{children}</QueryClientProvider>));
}
function body(event: SessionEventRow) {
  return (
    <EventDetailContent event={event}>
      {(row) => <p>{String(row.type === 'tool_call' ? row.data.rawOutput : '')}</p>}
    </EventDetailContent>
  );
}

it('loads output only when a tool is expanded, releases it on collapse and refetches on reopen', async () => {
  fetchDetail.mockResolvedValue(full);
  render(<ToolStepRow event={compact} />);
  expect(fetchDetail).not.toHaveBeenCalled();
  const click = () =>
    act(() =>
      host
        .querySelector('.group\\/step > div')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
  click();
  await settle();
  expect(host.textContent).toContain('complete output');
  expect(fetchDetail).toHaveBeenCalledTimes(1);
  click();
  await settle();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(host.textContent).not.toContain('complete output');
  click();
  await settle();
  expect(fetchDetail).toHaveBeenCalledTimes(2);
});

it('deduplicates expanded consumers and aborts only after the last consumer closes', async () => {
  fetchDetail.mockImplementation(() => new Promise(() => {}));
  render(
    <>
      {body(compact)}
      {body(compact)}
    </>,
  );
  await settle();
  expect(fetchDetail).toHaveBeenCalledTimes(1);
  const signal = fetchDetail.mock.calls[0][2] as AbortSignal;
  render(body(compact));
  await settle();
  expect(signal.aborted).toBe(false);
  render(null);
  await settle();
  expect(signal.aborted).toBe(true);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('changes revisions without displaying a late response from the previous revision', async () => {
  let resolveOld!: (value: SessionEventRow) => void;
  fetchDetail
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...full, data: { ...full.data, rawOutput: 'updated output' } });
  render(body(compact));
  await settle();
  const signal = fetchDetail.mock.calls[0][2] as AbortSignal;
  render(body({ ...compact, details: { revision: 'b'.repeat(64) } }));
  await settle();
  expect(signal.aborted).toBe(true);
  await act(async () => resolveOld(full));
  await settle();
  expect(host.textContent).toBe('updated output');
  expect(client.getQueryCache().getAll()).toHaveLength(1);
});

it('offers explicit retry after a missing or failed detail response', async () => {
  fetchDetail.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(full);
  render(body(compact));
  await settle();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(fetchDetail).toHaveBeenCalledTimes(1);
  act(() => host.querySelector('button')!.click());
  await settle();
  expect(host.textContent).toBe('complete output');
});

it('loads only terminal output contributing to the visible tail and preserves replacement semantics', async () => {
  const events: SessionEventRow[] = [
    { ...compact, id: 2, type: 'terminal_output', data: { terminalId: 't', data: '' } },
    {
      ...compact,
      id: 3,
      type: 'terminal_output',
      data: { terminalId: 't', data: '', operation: 'replace' },
    },
    { ...compact, id: 4, type: 'terminal_output', data: { terminalId: 't', data: '' } },
  ];
  fetchDetail.mockImplementation(async (_session: string, id: number) => ({
    ...events.find((event) => event.id === id)!,
    details: undefined,
    data: {
      terminalId: 't',
      data: id === 3 ? 'new' : ' chunk',
      ...(id === 3 ? { operation: 'replace' } : {}),
    },
  }));
  render(<AgentTerminals events={events} />);
  expect(fetchDetail).not.toHaveBeenCalled();
  await act(async () => {
    host.querySelector('details')!.open = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await settle();
  expect(fetchDetail.mock.calls.map((call) => call[1])).toEqual([3, 4]);
  expect(host.querySelector('pre')?.textContent).toBe('new chunk');
});
