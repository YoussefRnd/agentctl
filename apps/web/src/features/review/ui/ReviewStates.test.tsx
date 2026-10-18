import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vite-plus/test';
import { ReviewEmptyState } from './ReviewStates';

it('explains unavailable change history instead of reporting an ordinary folder as clean', () => {
  const markup = renderToStaticMarkup(<ReviewEmptyState searchQuery="" unavailable />);
  expect(markup).toContain('Change review is unavailable for this workspace.');
  expect(markup).toContain('You can keep working in this folder.');
  expect(markup).not.toContain('Workspace is clean');
});
