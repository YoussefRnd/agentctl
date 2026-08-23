import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FolderClosed, Terminal, Copy, Check } from 'lucide-react';
import { Dropdown, Tooltip } from '@agentctl/ui';
import { openInEditor, getAvailableEditors, EDITORS } from '@agentctl/api-client';
import { toast } from 'sonner';
import { EditorBrandIcon } from './EditorIcons';

const PREFERRED_EDITOR_KEY = 'agentctl:preferred-editor';

interface OpenInPickerProps {
  targetPath: string;
}

export function OpenInPicker({ targetPath }: OpenInPickerProps) {
  const { data: availableEditorIds = [] } = useQuery<string[]>({
    queryKey: ['available-editors'],
    queryFn: getAvailableEditors,
    staleTime: 60_000,
  });

  const installedCodeEditors = useMemo(() => {
    const codeEditors = EDITORS.filter((e) => e.commands !== null);
    if (availableEditorIds.length === 0) return codeEditors;
    const availableSet = new Set(availableEditorIds);
    return codeEditors.filter((e) => availableSet.has(e.id));
  }, [availableEditorIds]);

  const [preferredEditor, setPreferredEditor] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(PREFERRED_EDITOR_KEY);
      if (stored) return stored;
    }
    return 'cursor';
  });

  const effectiveEditor = useMemo(() => {
    if (
      preferredEditor === 'file-manager' ||
      preferredEditor === 'terminal' ||
      installedCodeEditors.some((e) => e.id === preferredEditor)
    ) {
      return preferredEditor;
    }
    return installedCodeEditors[0]?.id ?? 'file-manager';
  }, [preferredEditor, installedCodeEditors]);

  const activeOption = useMemo(() => {
    if (effectiveEditor === 'file-manager') {
      return { id: 'file-manager', label: 'File Manager' };
    }
    if (effectiveEditor === 'terminal') {
      return { id: 'terminal', label: 'Terminal' };
    }
    return (
      installedCodeEditors.find((e) => e.id === effectiveEditor) ??
      installedCodeEditors[0] ?? {
        id: 'file-manager',
        label: 'File Manager',
      }
    );
  }, [effectiveEditor, installedCodeEditors]);

  const handleLaunch = useCallback(
    async (editorId: string) => {
      if (!targetPath) return;

      // Persist preferred editor
      setPreferredEditor(editorId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(PREFERRED_EDITOR_KEY, editorId);
      }

      const editorName =
        editorId === 'file-manager'
          ? 'File Manager'
          : editorId === 'terminal'
            ? 'Terminal'
            : (EDITORS.find((e) => e.id === editorId)?.label ?? editorId);

      try {
        await openInEditor(editorId, targetPath);
        toast.success(`Opened in ${editorName}`);
      } catch {
        // Fallback for browser protocols if server launch encounters permission issues
        if (editorId === 'vscode' || editorId === 'cursor') {
          const scheme = editorId === 'vscode' ? 'vscode' : 'cursor';
          const uri = `${scheme}://file/${encodeURI(targetPath.startsWith('/') ? targetPath : `/${targetPath}`)}`;
          window.open(uri, '_blank', 'noopener,noreferrer');
          toast.success(`Opening in ${editorName}...`);
        } else {
          toast.error(`Could not launch ${editorName}`);
        }
      }
    },
    [targetPath],
  );

  const handleCopyPath = () => {
    if (!targetPath) return;
    void navigator.clipboard.writeText(targetPath);
    toast.success('Path copied to clipboard');
  };

  if (!targetPath) return null;

  return (
    <div className="border-border/30 bg-surface/50 hover:border-border/60 hover:bg-surface/80 flex h-7 items-center rounded-lg border transition-colors">
      {/* Primary 1-Click Action with Brand Icon */}
      <Tooltip content={`Open in ${activeOption.label}`}>
        <button
          type="button"
          onClick={() => {
            void handleLaunch(activeOption.id);
          }}
          className="text-text-muted hover:text-text-main flex h-full cursor-pointer items-center gap-1.5 px-2 text-xs font-medium transition-colors"
        >
          {activeOption.id === 'file-manager' ? (
            <FolderClosed className="h-3.5 w-3.5 opacity-80" />
          ) : activeOption.id === 'terminal' ? (
            <Terminal className="h-3.5 w-3.5 opacity-80" />
          ) : (
            <EditorBrandIcon editorId={activeOption.id} className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">Open in {activeOption.label}</span>
        </button>
      </Tooltip>

      {/* Dropdown Chevron Selector */}
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="border-border/30 text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-full w-5 cursor-pointer items-center justify-center border-l transition-colors"
            title="Choose editor or tool"
            aria-label="Choose editor"
          >
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" className="max-h-[380px] w-54 overflow-y-auto">
            {installedCodeEditors.length > 0 && (
              <>
                <div className="text-text-dim px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                  Installed Editors
                </div>

                {installedCodeEditors.map((editor) => {
                  const isSelected = editor.id === preferredEditor;

                  return (
                    <Dropdown.Item
                      key={editor.id}
                      className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                      onSelect={() => {
                        void handleLaunch(editor.id);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected ? (
                          <Check className="text-accent h-3 w-3 shrink-0" />
                        ) : (
                          <div className="h-3 w-3 shrink-0" />
                        )}
                        <EditorBrandIcon editorId={editor.id} className="h-3.5 w-3.5 shrink-0" />
                        <span>{editor.label}</span>
                      </div>
                      {editor.badge && (
                        <span className="bg-surface border-border/40 text-text-muted/60 rounded border px-1 font-mono text-[9px]">
                          {editor.badge}
                        </span>
                      )}
                    </Dropdown.Item>
                  );
                })}

                <div className="bg-border/30 my-1 h-px" />
              </>
            )}

            <Dropdown.Item
              className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              onSelect={() => {
                void handleLaunch('file-manager');
              }}
            >
              <div className="flex items-center gap-2">
                {preferredEditor === 'file-manager' ? (
                  <Check className="text-accent h-3 w-3 shrink-0" />
                ) : (
                  <div className="h-3 w-3 shrink-0" />
                )}
                <FolderClosed className="h-3.5 w-3.5 opacity-70" />
                <span>File Manager</span>
              </div>
            </Dropdown.Item>

            <Dropdown.Item
              className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              onSelect={() => {
                void handleLaunch('terminal');
              }}
            >
              <div className="flex items-center gap-2">
                {preferredEditor === 'terminal' ? (
                  <Check className="text-accent h-3 w-3 shrink-0" />
                ) : (
                  <div className="h-3 w-3 shrink-0" />
                )}
                <Terminal className="h-3.5 w-3.5 opacity-70" />
                <span>Terminal</span>
              </div>
            </Dropdown.Item>

            <div className="bg-border/30 my-1 h-px" />

            <Dropdown.Item
              className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              onSelect={handleCopyPath}
            >
              <div className="h-3 w-3 shrink-0" />
              <Copy className="h-3.5 w-3.5 opacity-60" />
              <span>Copy Path</span>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
