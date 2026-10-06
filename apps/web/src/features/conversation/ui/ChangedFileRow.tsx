import { ExternalLink } from 'lucide-react';
import { cn, Tooltip } from '@agentctl/ui';
import { FileIcon } from '@/shared';

interface ChangedFile {
  path: string;
  additions?: number | null;
  deletions?: number | null;
  status?: string;
}

interface ChangedFileRowProps {
  file: ChangedFile;
  onReview: (path: string) => void;
  onOpenEditor: (path: string) => unknown;
  emptyStatus?: string;
  editorButtonClassName?: string;
}

export function ChangedFileRow({
  file,
  onReview,
  onOpenEditor,
  emptyStatus = file.status,
  editorButtonClassName,
}: ChangedFileRowProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;
  return (
    <div className="hover:bg-surface/50 group/file-row flex items-center rounded-lg transition-colors">
      <button
        type="button"
        onClick={() => onReview(file.path)}
        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between px-2.5 py-1.5 text-left"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <FileIcon path={file.path} className="shrink-0" />
          <span className="text-text-main group-hover/file-row:text-accent truncate font-mono text-[12px] font-medium">
            {fileName}
          </span>
          {dirPath && (
            <span className="text-text-muted/60 truncate font-mono text-[11px]">{dirPath}</span>
          )}
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] font-medium">
          {additions > 0 && <span className="text-emerald-400">+{additions}</span>}
          {deletions > 0 && <span className="text-rose-400">-{deletions}</span>}
          {additions === 0 && deletions === 0 && (
            <span className="text-text-muted/60 text-[10px]">{emptyStatus}</span>
          )}
        </div>
      </button>
      <Tooltip content="Open in editor">
        <button
          type="button"
          onClick={() => {
            void onOpenEditor(file.path);
          }}
          className={cn(
            'text-text-muted flex shrink-0 cursor-pointer items-center justify-center rounded-md',
            editorButtonClassName ??
              'hover:bg-surface-tertiary/60 pointer-events-none mr-2 h-6 w-6 opacity-0 transition-[opacity,color,background-color,transform] duration-150 group-focus-within/file-row:pointer-events-auto group-focus-within/file-row:opacity-100 group-hover/file-row:pointer-events-auto group-hover/file-row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
          )}
          aria-label={`Open ${fileName} in editor`}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </Tooltip>
    </div>
  );
}
