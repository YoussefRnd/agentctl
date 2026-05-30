import { useState, useEffect } from 'react';
import { Folder, ChevronLeft, Home, GitBranch, AlertCircle } from 'lucide-react';
import { apiClient } from '@agentctl/api-client';

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
    <div className="glass-card animate-in fade-in zoom-in-95 flex w-full max-w-xl flex-col overflow-hidden shadow-2xl">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <div className="text-text-muted flex items-center gap-2 truncate text-[11px] font-bold tracking-tight uppercase">
          <Folder className="h-3.5 w-3.5" />
          <span className="truncate">{currentPath ?? 'SCANNING_FS...'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              void explore();
            }}
            className="hover:text-accent text-text-muted p-1 transition-colors"
            title="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          {parentPath && parentPath !== currentPath && (
            <button
              onClick={() => {
                void explore(parentPath);
              }}
              className="hover:text-accent text-text-muted p-1 transition-colors"
              title="Go Up"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="h-72 overflow-y-auto p-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="border-accent h-4 w-4 animate-spin border-2 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <AlertCircle className="text-danger mb-2 h-6 w-6 opacity-30" />
            <p className="text-text-main text-[11px] font-black uppercase">{error}</p>
            <button
              onClick={() => {
                void explore(currentPath ?? undefined);
              }}
              className="terminal-button mt-4"
            >
              RETRY_SCAN
            </button>
          </div>
        ) : folders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center opacity-30">
            <Folder className="text-text-muted mb-2 h-6 w-6" />
            <p className="text-[10px] font-bold tracking-widest uppercase">DIRECTORY_EMPTY</p>
          </div>
        ) : (
          <div className="space-y-px">
            {folders.map((f) => (
              <div
                key={f.path}
                className="group hover:bg-surface-secondary/60 flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 transition-all"
                onClick={() => {
                  void explore(f.path);
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`p-1 ${f.isRepo ? 'text-accent' : 'text-text-muted'}`}>
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
                      <span className="text-accent/40 text-[8px] font-black tracking-widest uppercase">
                        REPO
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(f.path);
                  }}
                  className="terminal-button !h-6 px-2 text-[9px] opacity-0 group-hover:opacity-100"
                >
                  MOUNT
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-border text-text-muted flex items-center justify-between border-t px-3 py-2 text-[9px] font-black tracking-widest uppercase">
        <span className="">CLICK_FOLDER_TO_EXPLORE_/_CLICK_MOUNT_TO_SELECT</span>
      </div>
    </div>
  );
}
