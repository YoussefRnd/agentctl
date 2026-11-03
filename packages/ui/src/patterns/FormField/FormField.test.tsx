// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vite-plus/test';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { FormField } from './FormField.js';
import { Input } from '../../primitives/Input/Input.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FormField', () => {
  it('connects label htmlFor to input id and description aria-describedby', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <FormField label="Username" description="Enter your username" required>
          <Input placeholder="user..." />
        </FormField>,
      );
    });

    const input = container.querySelector('input');
    const label = container.querySelector('label');
    expect(input).not.toBeNull();
    expect(label).not.toBeNull();
    expect(label?.getAttribute('for')).toBe(input?.id);
    expect(input?.getAttribute('aria-required')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBeDefined();
    expect(container.textContent).toContain('Enter your username');
  });

  it('renders error message with role alert and aria-invalid on control', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <FormField label="Email" error="Invalid email address">
          <Input placeholder="email..." />
        </FormField>,
      );
    });

    const input = container.querySelector('input');
    const alert = container.querySelector('[role="alert"]');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toBe('Invalid email address');
  });
});

it('retains an existing control ID and external accessible description and error', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <>
        <p id="external-hint">Account name</p>
        <p id="external-error">Already taken</p>
        <FormField id="wrapper" label="Name" description="Use your full name">
          <Input
            id="custom-name"
            aria-describedby="external-hint"
            aria-invalid
            aria-errormessage="external-error"
          />
        </FormField>
      </>,
    ),
  );
  const input = container.querySelector('input')!;
  expect(container.querySelector('label')!.htmlFor).toBe('custom-name');
  expect(input.getAttribute('aria-describedby')).toBe('external-hint custom-name-desc');
  expect(document.getElementById('custom-name-desc')?.textContent).toBe('Use your full name');
  expect(input.getAttribute('aria-errormessage')).toBe('external-error');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  act(() => root.unmount());
});
