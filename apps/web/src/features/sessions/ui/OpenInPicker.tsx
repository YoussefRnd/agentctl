import { ChevronDown, FolderClosed, Copy, Check } from 'lucide-react';
import { Dropdown, Tooltip, cn } from '@agentctl/ui';
import { toast } from 'sonner';
import { EditorBrandIcon } from '@/shared/editors/EditorIcons';
import {
  fileManager,
  launchEditor,
  useEditorPreference,
} from '@/shared/editors/useEditorPreference';

interface OpenInPickerProps {
  targetPath: string;
}

export function OpenInPicker({ targetPath }: OpenInPickerProps) {
  const { activeEditor, installedCodeEditors, preferredEditor, setPreferredEditor } =
    useEditorPreference(!!targetPath);

  const handleLaunch = async ({ id, label }: { id: string; label: string }) => {
    if (!targetPath) return;
    setPreferredEditor(id);
    try {
      const result = await launchEditor(id, targetPath);
      toast.success(result === 'browser' ? `Opening in ${label}...` : `Opened in ${label}`);
    } catch {
      toast.error(`Could not launch ${label}`);
    }
  };

  const handleCopyPath = () => {
    if (!targetPath) return;
    void navigator.clipboard.writeText(targetPath);
    toast.success('Path copied to clipboard');
  };

  if (!targetPath) return null;

  return (
    <div className="border-border/30 bg-surface/50 hover:border-border/60 hover:bg-surface/80 flex h-7 items-center rounded-lg border transition-colors">
      <Tooltip content={`Open in ${activeEditor.label}`}>
        <button
          type="button"
          aria-label={`Open in ${activeEditor.label}`}
          onClick={() => {
            void handleLaunch(activeEditor);
          }}
          className="motion-disclosure text-text-muted hover:text-text-main flex h-full cursor-pointer items-center gap-1.5 px-2 text-xs font-medium"
        >
          {activeEditor.id === fileManager.id ? (
            <FolderClosed className="h-3.5 w-3.5 opacity-80" />
          ) : (
            <EditorBrandIcon editorId={activeEditor.id} className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="hidden truncate sm:inline">Open in {activeEditor.label}</span>
        </button>
      </Tooltip>

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
                        void handleLaunch(editor);
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
                preferredEditor === fileManager.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
              )}
              onSelect={() => {
                void handleLaunch(fileManager);
              }}
            >
              <div className="flex items-center gap-2">
                <FolderClosed className="h-3.5 w-3.5 opacity-70" />
                <span>{fileManager.label}</span>
              </div>
              {preferredEditor === fileManager.id && <Check className="h-3.5 w-3.5 shrink-0" />}
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
