import { expect, test } from 'vitest';
import type { SidebarProject } from '@agentctl/api-client';
import { resolveDroppedWorkspace } from './droppedWorkspace';

const transfer = (text: string, filename?: string) => ({
  files: (filename ? [new File([], filename)] : []) as unknown as FileList,
  getData: (type: string) => (type === 'text/uri-list' ? text : ''),
});
test('resolves encoded file URIs and Windows drives without application or desktop globals', () => {
  expect(resolveDroppedWorkspace(transfer('# comment\nfile:///work/my%20project'), [])).toEqual({
    pathToOpen: '/work/my project',
    resolvedPath: '/work/my project',
  });
  expect(resolveDroppedWorkspace(transfer('file:///C:/work/project'), []).pathToOpen).toBe(
    'C:/work/project',
  );
});
test('falls back from unavailable desktop paths to registered projects, then folder names', () => {
  const projects = [{ name: 'Project', path: '/work/project' }] as SidebarProject[];
  expect(
    resolveDroppedWorkspace(transfer('', 'Project'), projects, () => {
      throw new Error('Unavailable');
    }).pathToOpen,
  ).toBe('/work/project');
  expect(resolveDroppedWorkspace(transfer('', 'Other'), projects).pathToOpen).toBe('Other');
});
