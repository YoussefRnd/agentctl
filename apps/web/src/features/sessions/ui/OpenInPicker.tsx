import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FolderClosed, Copy, Check } from 'lucide-react';
import { Dropdown, Tooltip, cn } from '@agentctl/ui';
import { openInEditor, getAvailableEditors, EDITORS } from '@agentctl/api-client';
import { toast } from 'sonner';
import { EditorBrandIcon } from '@/features/review';

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
          aria-label={`Open in ${activeOption.label}`}
          onClick={() => {
            void handleLaunch(activeOption.id);
          }}
          className="motion-disclosure text-text-muted hover:text-text-main flex h-full cursor-pointer items-center gap-1.5 px-2 text-xs font-medium"
        >
          {activeOption.id === 'file-manager' ? (
            <FolderClosed className="h-3.5 w-3.5 opacity-80" />
          ) : (
            <EditorBrandIcon editorId={activeOption.id} className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="hidden truncate sm:inline">Open in {activeOption.label}</span>
        </button>
      </Tooltip>

      {/* Dropdown Chevron Selector */}
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="motion-disclosure border-border/30 text-text-muted hover:text-text-main hover:bg-surface-secondary data-[state=open]:bg-accent/10 data-[state=open]:text-accent flex h-full w-5 cursor-pointer items-center justify-center border-l"
            title="Choose editor or tool"
            aria-label="Choose editor"
          >
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" className="max-h-[380px] w-48 overflow-y-auto">
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
                      className={cn(
                        'flex items-center justify-between',
                        isSelected
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
                      )}
                      onSelect={() => {
                        void handleLaunch(editor.id);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <EditorBrandIcon editorId={editor.id} className="h-3.5 w-3.5 shrink-0" />
                        <span>{editor.label}</span>
                      </div>
                      <span className="flex items-center gap-2">
                        {editor.badge && (
                          <span className="bg-surface border-border/40 text-text-muted/60 rounded border px-1 font-mono text-[9px]">
                            {editor.badge}
                          </span>
                        )}
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </span>
                    </Dropdown.Item>
                  );
                })}

                <div className="bg-border/30 my-1 h-px" />
              </>
            )}

            <Dropdown.Item
              className={cn(
                'flex items-center justify-between',
                preferredEditor === 'file-manager'
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
              )}
              onSelect={() => {
                void handleLaunch('file-manager');
              }}
            >
              <div className="flex items-center gap-2">
                <FolderClosed className="h-3.5 w-3.5 opacity-70" />
                <span>File Manager</span>
              </div>
              {preferredEditor === 'file-manager' && <Check className="h-3.5 w-3.5 shrink-0" />}
            </Dropdown.Item>

            <div className="bg-border/30 my-1 h-px" />

            <Dropdown.Item
              className="text-text-muted hover:bg-surface-secondary hover:text-text-main flex items-center gap-2"
              onSelect={handleCopyPath}
            >
              <Copy className="h-3.5 w-3.5 opacity-60" />
              <span>Copy Path</span>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
