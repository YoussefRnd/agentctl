import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vite-plus/test';
import { PlanPanel } from './PlanPanel';
vi.mock('@/features/sessions', () => ({
  useSession: () => ({ sessionData: { session: { status: 'idle' } } }),
  useSessionStream: () => ({ events: [], structuredPlan: [] }),
}));
vi.mock('@/shared/markdown', () => ({ StreamingMarkdown: () => null }));

test('labels cancelled and unfamiliar statuses without presenting them as pending or complete', () => {
  const markup = renderToStaticMarkup(
    <PlanPanel
      plan={[
        { name: 'Skipped task', status: 'cancelled', isCompleted: false },
        {
          name: 'Future task',
          status: 'future_state',
          isCompleted: false,
          priority: 'future_priority',
        },
      ]}
    />,
  );
  expect(markup).toContain('Cancelled');
  expect(markup).toContain('Status: future_state');
  expect(markup).toContain('future_priority');
  expect(markup).not.toContain('line-through');
  expect(markup).not.toContain('Executing task');
});
