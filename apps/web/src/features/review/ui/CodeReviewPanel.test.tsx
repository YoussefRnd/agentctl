import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { CodeReviewRun } from '@agentctl/shared';
import { CodeReviewPanel } from './CodeReviewPanel';

const fixture = vi.hoisted(() => ({
  list: vi.fn(),
  file: vi.fn(),
  checks: vi.fn(),
  check: vi.fn(),
  runCheck: vi.fn(),
  cancelCheck: vi.fn(),
  evidence: vi.fn(),
  start: vi.fn(),
  resolve: vi.fn(),
  cancel: vi.fn(),
  providers: vi.fn(),
}));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<typeof import('@agentctl/api-client')>()),
  listCodeReviews: fixture.list,
  getCodeReviewFile: fixture.file,
  listReviewChecks: fixture.checks,
  getReviewCheck: fixture.check,
  runReviewCheck: fixture.runCheck,
  cancelReviewCheck: fixture.cancelCheck,
  confirmReviewFindingEvidence: fixture.evidence,
  startCodeReview: fixture.start,
  resolveCodeReviewFinding: fixture.resolve,
  cancelCodeReview: fixture.cancel,
  providerService: { getProviders: fixture.providers },
}));
const roots: Root[] = [];
const clients: QueryClient[] = [];
const capture = {
  current: 'current-snapshot',
  working: 'head-snapshot',
  baseline: 'session-snapshot',
};
function run(extra: Partial<CodeReviewRun> = {}): CodeReviewRun {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    providerId: 'custom-acp',
    modelId: 'chosen-model',
    scope: 'working',
    fromRevision: capture.working,
    toRevision: capture.current,
    status: 'completed',
    summary: 'One issue. Tests were not run.',
    error: null,
    startedAt: 1000,
    finishedAt: 2000,
    freshness: 'current',
    findings: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        path: 'src/example.ts',
        line: 2,
        severity: 'high',
        title: 'Missing guard',
        body: 'Empty input throws.',
        status: 'open',
        resolution: null,
      },
    ],
    ...extra,
  };
}
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  clients.splice(0).forEach((client) => client.clear());
  document.body.innerHTML = '';
  vi.resetAllMocks();
});
async function render(runs: CodeReviewRun[] = [], disabled = false) {
  fixture.list.mockResolvedValue({ runs, nextCursor: null });
  if (!fixture.file.getMockImplementation())
    fixture.file.mockResolvedValue({ file: null, source: 'unavailable' });
  fixture.providers.mockResolvedValue([
    {
      id: 'custom-acp',
      label: 'Custom ACP',
      enabled: true,
      installState: 'system_available',
      configOptions: [],
    },
  ]);
  fixture.resolve.mockResolvedValue(undefined);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const selectFile = vi.fn();
  const renderAgain = (nextCapture = capture) =>
    root.render(
      <QueryClientProvider client={client}>
        <CodeReviewPanel
          sessionId="session-1"
          capture={nextCapture}
          disabled={disabled}
          onSelectFile={selectFile}
        />
      </QueryClientProvider>,
    );
  await act(async () => {
    renderAgain();
  });
  await act(async () => {
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  });
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => {
    toggle.click();
  });
  await act(async () => {
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  });
  return { container, root, client, selectFile, renderAgain };
}
function button(container: Element, text: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text,
  );
  expect(result, text).toBeDefined();
  return result!;
}
it('shows saved findings and navigates to the referenced file', async () => {
  const f = await render([run()]);
  expect(f.container.textContent).toContain('Missing guard');
  expect(f.container.textContent).toContain('chosen-model');
  await act(async () => button(f.container, 'src/example.ts:2').click());
  expect(f.selectFile).toHaveBeenCalledWith('src/example.ts', 'working');
});
it('marks results outdated immediately after uncommitted contents change', async () => {
  const f = await render([run()]);
  expect(f.container.textContent).not.toContain('Outdated review');
  await act(async () => f.renderAgain({ ...capture, current: 'new-uncommitted-snapshot' }));
  expect(f.container.textContent).toContain('Outdated review');
  expect(f.container.textContent).toContain('Missing guard');
});
it('does not call an unknown or server-outdated review current using an old cached workspace capture', async () => {
  const f = await render([run({ freshness: 'unknown' })]);
  expect(f.container.textContent).toContain('Could not verify whether this review is current');
});
it('saves a dismissal reason, and marks fixed only through an explicit action', async () => {
  const f = await render([run()]);
  await act(async () => button(f.container, 'Mark fixed').click());
  expect(fixture.resolve).toHaveBeenCalledWith('session-1', run().id, run().findings[0]!.id, {
    status: 'fixed',
  });
  await act(async () => button(f.container, 'Dismiss').click());
  expect(button(f.container, 'Save reason').disabled).toBe(true);
  const input = f.container.querySelector<HTMLInputElement>('[aria-label="Dismissal reason"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Already guarded by caller',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button(f.container, 'Save reason').click());
  expect(fixture.resolve).toHaveBeenLastCalledWith('session-1', run().id, run().findings[0]!.id, {
    status: 'dismissed',
    resolution: 'Already guarded by caller',
  });
});
it('starts one manual review and exposes provider-neutral selection', async () => {
  const f = await render();
  expect(fixture.start).not.toHaveBeenCalled();
  expect(f.container.querySelector('[aria-label="Reviewer provider"]')).toBeNull();
  await act(async () => button(f.container, 'Review options').click());
  expect(document.querySelector('[aria-label="Reviewer provider"]')).not.toBeNull();
  await act(async () => button(document.body, 'Done').click());
  let finish!: (value: { id: string }) => void;
  fixture.start.mockImplementation(
    async () =>
      await new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    button(f.container, 'Review changes').click();
  });
  expect(fixture.start).toHaveBeenCalledWith('session-1', { scope: 'working' });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(button(f.container, 'Review changes').disabled).toBe(true);
  await act(async () => finish({ id: run().id }));
});
it('can cancel an active review and preserves failed review errors', async () => {
  const f = await render([run({ status: 'running', findings: [], summary: '' })]);
  fixture.cancel.mockResolvedValue(undefined);
  await act(async () => button(f.container, 'Cancel review').click());
  expect(fixture.cancel).toHaveBeenCalledWith('session-1', run().id);
});
it('does not describe a failed or cancelled review as having no findings', async () => {
  const f = await render([
    run({ status: 'failed', error: 'Invalid provider output', findings: [], summary: '' }),
  ]);
  expect(f.container.textContent).toContain('Invalid provider output');
  expect(f.container.textContent).not.toContain('No findings reported');
});
it('keeps saved findings readable when new reviews are disabled', async () => {
  const f = await render([run()], true);
  expect(button(f.container, 'Review again').disabled).toBe(true);
  expect(f.container.textContent).toContain('Missing guard');
});
it('makes loading errors retryable and prevents starting when review state is unknown', async () => {
  const f = await render();
  fixture.list.mockRejectedValue(new Error('Offline'));
  await act(async () => {
    await f.client.invalidateQueries({ queryKey: ['session-code-reviews'] });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(f.container.textContent).toContain('Could not load saved reviews');
  expect(button(f.container, 'Review changes').disabled).toBe(true);
});
it('keeps older saved reviews accessible through paginated history', async () => {
  const f = await render([run()]);
  fixture.list.mockResolvedValueOnce({ runs: [run()], nextCursor: run().id });
  await act(async () => {
    await f.client.invalidateQueries({ queryKey: ['session-code-reviews'] });
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  fixture.list.mockResolvedValueOnce({
    runs: [run({ id: '33333333-3333-4333-8333-333333333333', startedAt: 100 })],
    nextCursor: null,
  });
  await act(async () => button(f.container, 'Review history').click());
  await act(async () => button(document.body, 'Load older reviews').click());
  await act(async () => {
    await vi.waitFor(() => expect(f.client.isFetching()).toBe(0));
  });
  expect(fixture.list).toHaveBeenLastCalledWith('session-1', expect.any(AbortSignal), run().id);
});
it('keeps a clean review compact with options, history and the long summary behind disclosures', async () => {
  const summary = 'A lengthy explanation of the documentation changes. '.repeat(12);
  const f = await render([run({ findings: [], summary })]);
  expect(f.container.textContent).toContain('No issues');
  expect(f.container.textContent).not.toContain('0 open');
  expect(f.container.textContent).not.toContain('Independent review of the captured diff.');
  expect(f.container.querySelector('[aria-label="Review scope"]')).toBeNull();
  expect(f.container.querySelector('[aria-label="Saved review"]')).toBeNull();
  const details = [...f.container.querySelectorAll('details')].find(
    (item) => item.querySelector('summary')?.textContent === 'Review summary',
  )!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain(summary);
  await act(async () => {
    details.querySelector('summary')!.click();
  });
  expect(details.open).toBe(true);
});
it('orders open findings by severity and keeps resolved findings available without crowding the result', async () => {
  const source = run().findings[0]!;
  const f = await render([
    run({
      findings: [
        {
          ...source,
          id: '44444444-4444-4444-8444-444444444444',
          severity: 'low',
          title: 'Low priority',
        },
        source,
        {
          ...source,
          id: '55555555-5555-4555-8555-555555555555',
          status: 'dismissed',
          resolution: 'Intentional behavior',
          title: 'Already resolved',
        },
      ],
    }),
  ]);
  expect(f.container.textContent).toContain('2 issues');
  const open = f.container.querySelector('[aria-label="Open findings"]')!;
  expect([...open.querySelectorAll('strong')].map((item) => item.textContent)).toEqual([
    'Missing guard',
    'Low priority',
  ]);
  const resolved = f.container.querySelector<HTMLDetailsElement>('details.group\\/resolved')!;
  expect(resolved.open).toBe(false);
  expect(resolved.textContent).toContain('Already resolved');
});
it('retains the dismissal draft when saving fails', async () => {
  const f = await render([run()]);
  fixture.resolve.mockRejectedValueOnce(new Error('Could not save finding'));
  await act(async () => button(f.container, 'Dismiss').click());
  const input = f.container.querySelector<HTMLInputElement>('[aria-label="Dismissal reason"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Intentional behavior',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button(f.container, 'Save reason').click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(
    f.container.querySelector<HTMLInputElement>('[aria-label="Dismissal reason"]')?.value,
  ).toBe('Intentional behavior');
  expect(f.container.textContent).toContain('Could not save finding');
});
it('selects earlier reviews from history and provides a direct return to the latest result', async () => {
  const older = run({
    id: '33333333-3333-4333-8333-333333333333',
    providerId: 'older-acp',
    startedAt: 100,
    findings: [],
  });
  const f = await render([run(), older]);
  await act(async () => button(f.container, 'Review history').click());
  const historical = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((item) => item.textContent?.includes('older-acp'))!;
  await act(async () => historical.click());
  expect(f.container.textContent).toContain('Earlier review');
  expect(f.container.textContent).not.toContain('Missing guard');
  await act(async () => button(f.container, 'Show latest').click());
  expect(f.container.textContent).toContain('Missing guard');
  expect(f.container.textContent).not.toContain('Earlier review');
});
it('applies the chosen scope and ACP provider from the options popover', async () => {
  const f = await render();
  await act(async () => button(f.container, 'Review options').click());
  const select = async (label: string, value: string) => {
    await act(async () => {
      document
        .querySelector<HTMLElement>(`[aria-label="${label}"]`)!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
    });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent?.trim() === value,
    )!;
    expect(item).toBeDefined();
    await act(async () => item.click());
  };
  await select('Review scope', 'All session changes');
  await select('Reviewer provider', 'Custom ACP');
  expect(document.querySelector('[aria-label="Reviewer model"]')).not.toBeNull();
  await act(async () => button(document.body, 'Done').click());
  fixture.start.mockResolvedValue({ id: run().id });
  await act(async () => button(f.container, 'Review changes').click());
  expect(fixture.start).toHaveBeenCalledWith('session-1', {
    scope: 'session',
    providerId: 'custom-acp',
  });
});
it('discloses supplied source ranges and omissions without expanding the context report by default', async () => {
  const f = await render([
    run({
      context: {
        version: 2,
        files: [
          {
            path: 'src/example.ts',
            side: 'current',
            role: 'changed',
            ranges: [{ startLine: 1, endLine: 20 }],
            complete: false,
            characters: 300,
          },
          {
            path: 'src/example.test.ts',
            side: 'current',
            role: 'test',
            ranges: [{ startLine: 1, endLine: 10 }],
            complete: true,
            characters: 100,
          },
        ],
        omitted: [
          {
            path: 'credentials.json',
            side: 'current',
            reason: 'Sensitive or generated file excluded',
          },
        ],
        omittedCount: 1,
        limitations: ['Tests were supplied as source and were not run.'],
        indexedFiles: 120,
        indexTruncated: false,
        searchTruncated: false,
        inputCharacters: 1200,
      },
    }),
  ]);
  const context = [...f.container.querySelectorAll('details')].find((item) =>
    item.querySelector('summary')?.textContent?.includes('Context provided'),
  )!;
  expect(context.open).toBe(false);
  expect(context.textContent).toContain('2 files · Limited');
  expect(context.textContent).toContain('Lines 1–20');
  expect(context.textContent).toContain('Test source');
  expect(context.textContent).toContain('Sensitive or generated file excluded');
  expect(context.textContent).not.toContain('Tests passed');
});
it('runs checks explicitly, saves failed output, and requires confirmation before linking reproduction', async () => {
  const check = {
    id: '33333333-3333-4333-8333-333333333333',
    reviewId: run().id,
    name: 'Empty input regression',
    command: 'pnpm test example',
    commandRedacted: false,
    status: 'failed',
    timeoutMs: 180000,
    cwd: '/workspace',
    expectedRevision: capture.current,
    checkedRevision: capture.current,
    afterRevision: capture.current,
    revisionState: 'unchanged',
    exitCode: 1,
    signal: null,
    error: null,
    startedAt: 1,
    finishedAt: 2,
    outputTruncated: false,
  };
  fixture.checks.mockResolvedValue({ checks: [check], nextCursor: null });
  fixture.check.mockResolvedValue({
    ...check,
    stdout: 'assertion: empty input throws',
    stderr: '',
  });
  fixture.runCheck.mockResolvedValue({ id: check.id });
  fixture.evidence.mockResolvedValue({ success: true });
  const f = await render([
    run({ verificationSummary: { total: 1, running: 0, passed: 0, failed: 1 } }),
  ]);
  expect(fixture.runCheck).not.toHaveBeenCalled();
  expect(fixture.evidence).not.toHaveBeenCalled();
  const details = [...f.container.querySelectorAll('details')].find((item) =>
    item.querySelector('summary')?.textContent?.startsWith('Verification'),
  )!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  await act(async () => {
    await vi.waitFor(() => expect(f.client.isFetching()).toBe(0));
  });
  const command = f.container.querySelector<HTMLTextAreaElement>(
    '[aria-label="Verification command"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      command,
      'pnpm test example',
    );
    command.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button(f.container, 'Run check').click());
  expect(fixture.runCheck).toHaveBeenCalledWith('session-1', run().id, {
    command: 'pnpm test example',
    timeoutMs: 180000,
  });
  await act(async () => button(f.container, 'View output').click());
  await act(async () => {
    await vi.waitFor(() => expect(f.client.isFetching()).toBe(0));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.container.textContent).toContain('assertion: empty input throws');
  });
  expect(f.container.textContent).toContain('Suspected');
  expect(fixture.evidence).not.toHaveBeenCalled();
  await act(async () => button(f.container, 'Suspected · add evidence').click());
  await act(async () => {
    await vi.waitFor(() => expect(f.client.isFetching()).toBe(0));
  });
  expect(button(f.container, 'Confirm reproduction').disabled).toBe(true);
  await act(async () => {
    const select = f.container.querySelector<HTMLButtonElement>(
      '[aria-label="Reproduction check"]',
    )!;
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await act(async () => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent?.includes('Empty input regression'),
    )!;
    expect(option).toBeDefined();
    option.click();
  });
  const reason = f.container.querySelector<HTMLTextAreaElement>(
    '[aria-label="Reproduction explanation"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      reason,
      'The empty-input test throws at the reported line.',
    );
    reason.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button(f.container, 'Confirm reproduction').disabled).toBe(true);
  await act(async () =>
    f.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () => button(f.container, 'Confirm reproduction').click());
  expect(fixture.evidence).toHaveBeenCalledWith('session-1', run().id, run().findings[0]!.id, {
    state: 'reproduced',
    checkId: check.id,
    reason: 'The empty-input test throws at the reported line.',
  });
});
it('blocks checks for outdated reviews and blocks reviews during running checks', async () => {
  fixture.checks.mockResolvedValue({ checks: [], nextCursor: null });
  const f = await render([
    run({
      freshness: 'outdated',
      verificationSummary: { total: 1, running: 1, passed: 0, failed: 0 },
    }),
  ]);
  expect(button(f.container, 'Review again').disabled).toBe(true);
  const details = [...f.container.querySelectorAll('details')].find((item) =>
    item.querySelector('summary')?.textContent?.startsWith('Verification'),
  )!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  expect(button(f.container, 'Run check').disabled).toBe(true);
});
it('supplies recorded evidence when reviewing again', async () => {
  fixture.start.mockResolvedValue({ id: run().id });
  const f = await render([
    run({
      verificationSummary: { total: 2, running: 0, passed: 1, failed: 1 },
      evidenceCheckIds: ['33333333-3333-4333-8333-333333333333'],
    }),
  ]);
  await act(async () => button(f.container, 'Review again').click());
  expect(fixture.start).toHaveBeenCalledWith('session-1', {
    scope: 'working',
    evidenceReviewId: run().id,
  });
  expect(f.container.textContent).toContain('1 saved checks supplied');
});
it('renders saved code at the exact finding line and keeps it when the live comparison becomes outdated', async () => {
  fixture.file.mockResolvedValue({
    source: 'saved',
    file: {
      path: 'src/example.ts',
      state: 'modified',
      diff: '@@ -1,3 +1,3 @@\n export function input(value) {\n-  return value;\n+  return CAPTURED_CALL(value);\n }',
    },
  });
  const f = await render([run()]);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.container.textContent).toContain('CAPTURED_CALL(value)');
  });
  expect(f.container.querySelector('[data-review-anchor]')?.textContent).toContain('CAPTURED_CALL');
  expect(fixture.file).toHaveBeenCalledWith(
    'session-1',
    run().id,
    'src/example.ts',
    expect.any(AbortSignal),
  );
  await act(async () => f.renderAgain({ ...capture, current: 'edited-current' }));
  expect(f.container.textContent).toContain('Outdated review');
  expect(f.container.textContent).toContain('CAPTURED_CALL');
});
it('shows earlier decisions and historical verification separately from the new finding state', async () => {
  const oldId = '55555555-5555-4555-8555-555555555555';
  const checkId = '66666666-6666-4666-8666-666666666666';
  const verification = {
    state: 'reproduced' as const,
    checkId,
    reason: 'The recorded assertion fails at this line.',
    confirmedAt: 100,
  };
  fixture.check.mockResolvedValue({
    cwd: '/workspace',
    checkedRevision: 'old',
    startedAt: 10,
    finishedAt: 20,
    stdout: 'HISTORICAL_OUTPUT',
    stderr: '',
    error: null,
    outputTruncated: false,
  });
  const item = run();
  item.findings[0]!.continuity = {
    reviewId: oldId,
    findingId: '77777777-7777-4777-8777-777777777777',
    status: 'dismissed',
    resolution: 'Caller previously guaranteed input.',
    verification,
    comparison: 'changed',
    match: 'reviewer',
    lastDecision: null,
    lastEvidence: null,
  };
  item.continuity = {
    provided: 1,
    omitted: 2,
    historyLimited: true,
    findingIds: [item.findings[0]!.continuity.findingId],
  };
  const f = await render([item]);
  expect(f.container.textContent).toContain('Suspected · add evidence');
  expect(f.container.textContent).toContain('Seen in an earlier review');
  expect(f.container.textContent).toContain('Caller previously guaranteed input.');
  expect(f.container.textContent).toContain('Recheck the earlier assessment.');
  await act(async () => button(f.container, 'View earlier output').click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.container.textContent).toContain('HISTORICAL_OUTPUT');
  });
  expect(fixture.check).toHaveBeenCalledWith('session-1', oldId, checkId, expect.any(AbortSignal));
  expect(f.container.textContent).toContain('2 relevant findings were omitted');
  expect(f.container.textContent).toContain('ten most recent');
});
