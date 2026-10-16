import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';

export { EDITORS, type EditorId, type EditorDefinition } from '@agentctl/shared';

export async function openInEditor(
  editor: string,
  targetPath: string,
): Promise<{ success: boolean; editor: string }> {
  const res = await api.openInEditor({
    body: { editor, path: targetPath },
  });
  assertApiStatus(res, 200, 'Failed to launch editor');
  return res.body;
}

export async function getAvailableEditors(): Promise<string[]> {
  const res = await api.getAvailableEditors();
  assertApiStatus(res, 200, 'Failed to get available editors');
  return res.body;
}
