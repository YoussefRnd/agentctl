import { useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAvailableEditors, openInEditor } from '@agentctl/api-client';
import { EDITORS } from '@agentctl/shared';
import { browserStorage } from '@/shared/lib/persistentStorage';

const PREFERRED_EDITOR_KEY = 'agentctl:preferred-editor';
const DEFAULT_EDITOR = 'cursor';
export const fileManager = EDITORS.find((editor) => editor.id === 'file-manager')!;
const codeEditors = EDITORS.filter((editor) => editor.commands !== null);
const listeners = new Set<() => void>();
let unsavedPreference: string | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFERRED_EDITOR_KEY || event.key === null) {
      unsavedPreference = undefined;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function readPreferredEditor() {
  return unsavedPreference ?? (browserStorage.getItem(PREFERRED_EDITOR_KEY) || DEFAULT_EDITOR);
}

function setPreferredEditor(editorId: string) {
  unsavedPreference = browserStorage.setItem(PREFERRED_EDITOR_KEY, editorId) ? undefined : editorId;
  for (const listener of listeners) listener();
}

export function useEditorPreference(enabled: boolean) {
  const preferredEditor = useSyncExternalStore(
    subscribe,
    readPreferredEditor,
    () => DEFAULT_EDITOR,
  );
  const { data } = useQuery({
    queryKey: ['available-editors'],
    queryFn: getAvailableEditors,
    staleTime: 60_000,
    enabled,
  });
  const installedCodeEditors = useMemo(() => {
    if (!data?.length) return codeEditors;
    const available = new Set(data);
    return codeEditors.filter((editor) => available.has(editor.id));
  }, [data]);
  const activeEditor =
    preferredEditor === fileManager.id
      ? fileManager
      : (installedCodeEditors.find((editor) => editor.id === preferredEditor) ??
        installedCodeEditors[0] ??
        fileManager);

  return { activeEditor, installedCodeEditors, preferredEditor, setPreferredEditor };
}

export async function launchEditor(editorId: string, path: string): Promise<'server' | 'browser'> {
  try {
    await openInEditor(editorId, path);
    return 'server';
  } catch (error) {
    // Cursor and VS Code can also open paths through their installed browser protocols.
    if (editorId !== 'cursor' && editorId !== 'vscode') throw error;
    const absolutePath = path.startsWith('/') ? path : `/${path}`;
    window.open(`${editorId}://file/${encodeURI(absolutePath)}`, '_blank', 'noopener,noreferrer');
    return 'browser';
  }
}
