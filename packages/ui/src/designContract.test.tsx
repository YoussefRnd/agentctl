/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vite-plus/test';
import {
  Badge,
  Button,
  ConfirmationModal,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Input,
  Select,
  StatusBadge,
} from './index.js';

let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
function appearance(node: Element): unknown {
  return [
    node.tagName,
    node.getAttribute('class'),
    node.getAttribute('style'),
    [...node.children].map(appearance),
  ];
}
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
it('preserves the existing control, badge and feedback appearance in every shared variant', () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <>
        {(['compact', 'default', 'large', 'sm', 'md', 'lg'] as const).map((size) => (
          <div key={size}>
            {(['solid', 'outline', 'ghost', 'danger'] as const).map((variant) => (
              <div key={variant}>
                <Button size={size} variant={variant}>
                  Save
                </Button>
                <IconButton size={size} variant={variant} aria-label="Save">
                  <span>Icon</span>
                </IconButton>
              </div>
            ))}
            <Input sizeVariant={size} />
          </div>
        ))}
        {(['default', 'accent', 'success', 'warning', 'danger', 'outline', 'surface'] as const).map(
          (variant) => (
            <Badge key={variant} variant={variant} dot pulse>
              State
            </Badge>
          ),
        )}
        {(
          [
            'active',
            'running',
            'idle',
            'success',
            'warning',
            'error',
            'archived',
            'neutral',
          ] as const
        ).map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
        <FormField label="Name" description="Display name">
          <Input />
        </FormField>
        <FormField label="Name" error="Required">
          <Input />
        </FormField>
        <Select value="dark" options={[{ value: 'dark', label: 'Dark' }]} onChange={() => {}} />
        <EmptyState
          icon={<span>Icon</span>}
          title="No items"
          description="Add an item"
          action={<Button>Add</Button>}
        />
        <ErrorState title="Failed" message="Try again" onRetry={() => {}} />
      </>,
    ),
  );
  expect(digest(JSON.stringify(appearance(host)))).toMatchInlineSnapshot(
    `"9910cac41fc10f23009bb02d68e2849b06f74311936b32938e9b24aad18023c7"`,
  );
});
it('preserves the existing confirmation layout', () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <ConfirmationModal
        isOpen
        title="Remove"
        message="Remove this item?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(
    digest(JSON.stringify(appearance(document.querySelector('[role="dialog"]')!))),
  ).toMatchInlineSnapshot(`"f0c4421946f480bd5fbf4d8b6a50f2c3854c1ccaf2413a7ac850685791f64b5c"`);
});
it('preserves the existing font, color, spacing, radius and app stylesheet values', () => {
  const paths = [
    'theme.css',
    'foundations/colors.css',
    'foundations/typography.css',
    'foundations/spacing.css',
    'foundations/motion.css',
    'foundations/elevation.css',
    '../../../apps/web/src/index.css',
  ];
  expect(
    Object.fromEntries(
      paths.map((path) => [path, digest(readFileSync(new URL(path, import.meta.url), 'utf8'))]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "../../../apps/web/src/index.css": "6476d8f355b789ac61a3d3f77bf966d9f06eb6c6ca1a37003f4307c0eb1c412d",
      "foundations/colors.css": "4ba7fd564e6b4262072e24b46d3c08aa40e3e076eec1e6366fb8c2fe101622f8",
      "foundations/elevation.css": "4210b14b5c2140ad7234b0fd0e89c6253c51a16c0e707c7b4fe326659849967a",
      "foundations/motion.css": "7a085322b130d09c4e484b7afe2e326bcf5a593097cfe86c271414c1a4380d44",
      "foundations/spacing.css": "43e1b7d06c2ad4a3ca38042fd231c50b4ebc30fc30b46a935ab515d0a010e513",
      "foundations/typography.css": "d5df6b1c0053f9df7b7ce6902d2057b1a213526be73abed69a3dde1e95a815c1",
      "theme.css": "3a689be9971824de6841bcdf8049e451948fc669fc6842a76d8012f1529438ec",
    }
  `);
});
