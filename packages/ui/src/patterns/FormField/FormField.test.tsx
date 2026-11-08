// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vite-plus/test';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { FormField } from './FormField.js';
import { Input } from '../../primitives/Input/Input.js';

let root: Root;

function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(element));
  return container;
}

function referencedText(control: HTMLElement, attribute: string) {
  return (control.getAttribute(attribute) ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);
}

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('FormField', () => {
  it('associates a required input with its label and description', () => {
    const container = render(
      <FormField label="Username" description="Enter your username" required>
        <Input />
      </FormField>,
    );
    const input = container.querySelector('input')!;
    expect(container.querySelector('label')?.control).toBe(input);
    expect(input.required).toBe(true);
    expect(referencedText(input, 'aria-describedby')).toEqual(['Enter your username']);
  });

  it('associates an invalid input with its announced error', () => {
    const container = render(
      <FormField label="Email" error="Invalid email address">
        <Input />
      </FormField>,
    );
    const input = container.querySelector('input')!;
    const alert = container.querySelector('[role="alert"]');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(alert?.textContent).toBe('Invalid email address');
    expect(document.getElementById(input.getAttribute('aria-errormessage')!)).toBe(alert);
  });
});

it('retains an existing control ID and external accessible description and error', () => {
  const container = render(
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
  );
  const input = container.querySelector('input')!;
  expect(input.id).toBe('custom-name');
  expect(container.querySelector('label')?.control).toBe(input);
  expect(referencedText(input, 'aria-describedby')).toEqual(
    expect.arrayContaining(['Account name', 'Use your full name']),
  );
  expect(referencedText(input, 'aria-errormessage')).toEqual(['Already taken']);
  expect(input.getAttribute('aria-invalid')).toBe('true');
});
