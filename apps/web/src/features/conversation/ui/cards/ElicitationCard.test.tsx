import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { ElicitationFormField, ElicitationItem } from '@agentctl/shared';
import { ElicitationCard, type ElicitationCardProps } from './ElicitationCard';

let root: Root | undefined;
it('links each field label to its own request when field names repeat', () => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <>
        {['first', 'second'].map((id) => (
          <ElicitationCard
            key={id}
            elicitation={{
              id,
              status: 'pending',
              createdAt: new Date().toISOString(),
              request: {
                id,
                mode: 'form',
                message: id,
                form: {
                  fields: [{ id: 'name', label: 'Name', type: 'string', required: false }],
                },
              },
            }}
            onRespond={() => undefined}
          />
        ))}
      </>,
    ),
  );
  const inputs = [...container.querySelectorAll('input')];
  const labels = [...container.querySelectorAll('label')];
  expect(inputs).toHaveLength(2);
  expect(inputs[0].id).not.toBe(inputs[1].id);
  expect(labels.map((label) => label.control)).toEqual(inputs);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
});
function render(fields: ElicitationFormField[], onRespond: ElicitationCardProps['onRespond']) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const elicitation: ElicitationItem = {
    id: 'form',
    status: 'pending',
    createdAt: new Date().toISOString(),
    request: { id: 'form', mode: 'form', message: 'Provide input', form: { fields } },
  };
  act(() => root!.render(<ElicitationCard elicitation={elicitation} onRespond={onRespond} />));
  return container;
}

it.each([
  { type: 'string', default: 'lowercase', pattern: '^[A-Z]+$' },
  { type: 'string', default: 'not-an-email', format: 'email' },
  { type: 'integer', default: 1.5 },
] as const)('prevents submission of a value violating %j', (constraint) => {
  const respond = vi.fn();
  const container = render(
    [{ id: 'value', label: 'Value', required: true, ...constraint }],
    respond,
  );
  const submit = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Submit',
  )!;
  expect(submit.disabled).toBe(true);
  act(() =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(respond).not.toHaveBeenCalled();
});

it('omits blank optional fields and lets the user retry after a failed response', async () => {
  const respond = vi
    .fn()
    .mockRejectedValueOnce(new Error('Connection interrupted'))
    .mockResolvedValue(undefined);
  const container = render(
    [
      {
        id: 'name',
        label: 'Name',
        type: 'string',
        required: true,
        default: 'VALID',
        pattern: '^[A-Z]+$',
      },
      { id: 'email', label: 'Email', type: 'string', required: false, format: 'email' },
    ],
    respond,
  );
  const form = container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(respond).toHaveBeenCalledWith('form', { action: 'submit', values: { name: 'VALID' } });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Connection interrupted');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(respond).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('allows declining a form with incomplete fields', async () => {
  const respond = vi.fn().mockResolvedValue(undefined);
  const container = render(
    [{ id: 'name', label: 'Name', type: 'string', required: true }],
    respond,
  );
  const decline = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Decline',
  )!;
  await act(async () => decline.click());
  expect(respond).toHaveBeenCalledWith('form', { action: 'decline' });
});
