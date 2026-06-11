import { useState, useEffect } from 'react';
import { Folder, ChevronLeft, Home, GitBranch, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '@agentctl/api-client';
import { Button, GlassPanel } from '@agentctl/ui';

interface FolderEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

interface ExploreResponse {
  currentPath: string;
  parentPath: string;
  folders: FolderEntry[];
  error?: string;
}

export function DirectoryExplorer({ onSelect }: { onSelect: (path: string) => void }) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const explore = async (path?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.fetch<ExploreResponse>('/api/fs/explore', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setFolders(data.folders);
      if (data.error) {
        setError(data.error);
      }
    } catch {
      setError('Connection failed. Is the server running?');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void explore();
  }, []);

  return (
    <GlassPanel intensity="default" className="w-full max-w-xl shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95">
      <div className="border-border/40 flex items-center justify-between border-b px-4 py-3 bg-surface-secondary/20">
        <div className="text-text-muted flex items-center gap-2 truncate text-[11px] font-bold tracking-tight uppercase">
          <Folder className="h-4 w-4" />
          <span className="truncate">{currentPath ?? 'SCANNING_FS...'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              void explore();
            }}
            className="hover:text-accent text-text-muted p-1 transition-colors hover:scale-105 active:scale-95 cursor-pointer"
            title="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          {parentPath && parentPath !== currentPath && (
            <button
              onClick={() => {
                void explore(parentPath);
              }}
              className="hover:text-accent text-text-muted p-1 transition-colors hover:scale-105 active:scale-95 cursor-pointer"
              title="Go Up"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="h-72 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <AlertCircle className="text-danger mb-2 h-6 w-6 opacity-30" />
            <p className="text-text-main text-[11px] font-black uppercase">{error}</p>
            <Button
              onClick={() => {
                void explore(currentPath ?? undefined);
              }}
              variant="outline"
              className="mt-4"
            >
              RETRY_SCAN
            </Button>
          </div>
        ) : folders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center opacity-30">
            <Folder className="text-text-muted mb-2 h-6 w-6" />
            <p className="text-[10px] font-bold tracking-widest uppercase">DIRECTORY_EMPTY</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {folders.map((f) => (
              <div
                key={f.path}
                className="group hover:bg-surface-secondary/60 flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 transition-all"
                onClick={() => {
                  void explore(f.path);
                }}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg bg-surface-secondary/40 ${f.isRepo ? 'text-accent' : 'text-text-muted'}`}>
                    {f.isRepo ? (
                      <GitBranch className="h-3.5 w-3.5" />
                    ) : (
                      <Folder className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-text-main text-[12px] font-bold tracking-tight uppercase">
                      {f.name}
                    </span>
                    {f.isRepo && (
                      <span className="text-accent/60 text-[8px] font-black tracking-widest uppercase mt-0.5">
                        REPO
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(f.path);
                  }}
                  size="sm"
                  className="h-7 px-3 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  MOUNT
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-border/40 text-text-muted bg-surface-secondary/10 flex items-center justify-between border-t px-4 py-2.5 text-[9px] font-black tracking-widest uppercase">
        <span className="opacity-50">CLICK_FOLDER_TO_EXPLORE_/_CLICK_MOUNT_TO_SELECT</span>
      </div>
    </GlassPanel>
  );
}
