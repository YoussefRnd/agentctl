import { expect, it, vi } from 'vite-plus/test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { providerErrorCopy, type ChatError } from '@agentctl/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnErrorCard } from './TurnErrorCard';

it('renders concise provider access guidance with collapsed details, not stderr', () => {
  const html = renderToStaticMarkup(
    <TurnErrorCard
      message={'Authentication required\nAgent stderr: [session/create] phase=register'}
    />,
  );
  expect(html).toContain('Provider access required');
  expect(html).toContain('check your subscription');
  expect(html).toContain('<details');
  expect(html).not.toContain('<details open');
  expect(html).not.toContain('session/create');
});

const failure: ChatError = {
  version: 1,
  id: 'failure',
  category: 'authentication',
  scope: 'attempt',
  stage: 'dispatch',
  delivery: 'rejected',
  message: providerErrorCopy('authentication').message,
  details: 'Access refused',
  attemptId: 'attempt',
  eventId: 4,
  actions: ['provider_settings', 'retry'],
};

it('uses the structured category instead of reinterpreting provider wording', () => {
  const html = renderToStaticMarkup(
    <TurnErrorCard
      failure={{
        ...failure,
        category: 'rate_limit',
        message: providerErrorCopy('rate_limit').message,
        details: 'Authentication required',
      }}
    />,
  );
  expect(html).toContain('Provider is rate limiting requests');
  expect(html).not.toContain('Provider access required');
});

it.each(['unknown', 'accepted'] as const)(
  'does not render Retry for %s delivery, even with contradictory actions',
  (delivery) => {
    const html = renderToStaticMarkup(
      <TurnErrorCard
        failure={{ ...failure, delivery }}
        onRetry={() => {}}
        onProviderSettings={() => {}}
      />,
    );
    expect(html).not.toContain('Retry message');
    expect(html).toContain('Provider settings');
    expect(html.includes('this message was not resent')).toBe(delivery === 'unknown');
  },
);

it('disables recovery while another queue action is pending', () => {
  const html = renderToStaticMarkup(<TurnErrorCard failure={failure} onRetry={() => {}} pending />);
  expect(html).toContain('Retry message');
  expect(html).toContain('disabled');
});

it('invokes the existing settings and retry flows, leaving details collapsed', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const retry = vi.fn();
  const settings = vi.fn();
  try {
    await act(async () =>
      root.render(
        <TurnErrorCard failure={failure} onRetry={retry} onProviderSettings={settings} />,
      ),
    );
    const buttons = [...container.querySelectorAll('button')];
    await act(async () =>
      buttons.find((button) => button.textContent === 'Provider settings')!.click(),
    );
    await act(async () =>
      buttons.find((button) => button.textContent === 'Retry message')!.click(),
    );
    expect(settings).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
