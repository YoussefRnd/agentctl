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
    <div className="bg-surface border-border animate-in fade-in zoom-in-95 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl duration-300">
      <div className="bg-background/50 border-border flex items-center justify-between border-b px-4 py-3">
        <div className="text-text-muted flex items-center gap-2 truncate font-mono text-[12px]">
          <Folder className="h-3.5 w-3.5" />
          <span className="truncate">{currentPath ?? 'Browsing...'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              void explore();
            }}
            className="hover:bg-surface text-text-muted rounded-lg p-1.5 transition-colors"
            title="Home"
          >
            <Home className="h-4 w-4" />
          </button>
          {parentPath && parentPath !== currentPath && (
            <button
              onClick={() => {
                void explore(parentPath);
              }}
              className="hover:bg-surface text-text-muted rounded-lg p-1.5 transition-colors"
              title="Go Up"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="scrollbar-hide h-80 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <AlertCircle className="text-danger mb-3 h-8 w-8 opacity-50" />
            <p className="text-text-main text-[13px] font-bold">{error}</p>
            <button
              onClick={() => {
                void explore(currentPath ?? undefined);
              }}
              className="text-accent mt-4 text-[11px] font-black tracking-widest uppercase hover:underline"
            >
              Retry
            </button>
          </div>
        ) : folders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center opacity-50">
            <Folder className="text-text-muted mb-3 h-8 w-8" />
            <p className="text-[13px] font-medium">Empty directory</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-0.5">
            {folders.map((f) => (
              <div
                key={f.path}
                className="group hover:bg-accent/5 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left transition-all"
                onClick={() => {
                  void explore(f.path);
                }}
                onDoubleClick={() => {
                  onSelect(f.path);
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`rounded-lg p-1.5 ${f.isRepo ? 'bg-success/10 text-success' : 'bg-surface-hover text-text-muted group-hover:text-accent'}`}
                  >
                    {f.isRepo ? <GitBranch className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-text-main group-hover:text-accent text-[13px] font-medium transition-colors">
                      {f.name}
                    </span>
                    {f.isRepo && (
                      <span className="text-success/60 -mt-0.5 text-[10px] font-medium tracking-tight uppercase">
                        GIT REPOSITORY
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(f.path);
                  }}
                  className="bg-accent/10 hover:bg-accent text-accent hover:text-background rounded px-3 py-1 text-[10px] font-bold opacity-0 transition-all group-hover:opacity-100"
                >
                  SELECT
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-background/30 border-border text-text-muted flex items-center justify-between border-t px-4 py-3 text-[11px] font-medium">
        <span>Choose a project directory</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <kbd className="bg-surface border-border rounded border px-1.5 py-0.5">
              Double Click
            </kbd>{' '}
            to open
          </span>
        </div>
      </div>
    </div>
  );
}
