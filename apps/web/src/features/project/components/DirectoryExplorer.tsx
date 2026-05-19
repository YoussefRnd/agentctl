import { useState, useEffect } from 'react';
import { Folder, ChevronLeft, Home, GitBranch, AlertCircle } from 'lucide-react';
import { apiClient } from '../../../lib/api-client';

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
    <div className="flex flex-col w-full max-w-xl bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300">
      <div className="bg-background/50 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-mono text-text-muted truncate">
          <Folder className="w-3.5 h-3.5" />
          <span className="truncate">{currentPath ?? 'Browsing...'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              void explore();
            }}
            className="p-1.5 hover:bg-surface rounded-lg transition-colors text-text-muted"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
          {parentPath && parentPath !== currentPath && (
            <button
              onClick={() => {
                void explore(parentPath);
              }}
              className="p-1.5 hover:bg-surface rounded-lg transition-colors text-text-muted"
              title="Go Up"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="h-80 overflow-y-auto p-2 scrollbar-hide">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <AlertCircle className="w-8 h-8 text-danger mb-3 opacity-50" />
            <p className="text-[13px] font-bold text-text-main">{error}</p>
            <button
              onClick={() => {
                void explore(currentPath ?? undefined);
              }}
              className="mt-4 text-[11px] font-black text-accent hover:underline uppercase tracking-widest"
            >
              Retry
            </button>
          </div>
        ) : folders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-50">
            <Folder className="w-8 h-8 text-text-muted mb-3" />
            <p className="text-[13px] font-medium">Empty directory</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-0.5">
            {folders.map((f) => (
              <div
                key={f.path}
                className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent/5 transition-all text-left cursor-pointer"
                onClick={() => {
                  void explore(f.path);
                }}
                onDoubleClick={() => {
                  onSelect(f.path);
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`p-1.5 rounded-lg ${f.isRepo ? 'bg-success/10 text-success' : 'bg-surface-hover text-text-muted group-hover:text-accent'}`}
                  >
                    {f.isRepo ? <GitBranch className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium text-text-main group-hover:text-accent transition-colors">
                      {f.name}
                    </span>
                    {f.isRepo && (
                      <span className="text-[10px] text-success/60 font-medium -mt-0.5 tracking-tight uppercase">
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
                  className="px-3 py-1 bg-accent/10 hover:bg-accent text-accent hover:text-background text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-all"
                >
                  SELECT
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-background/30 border-t border-border flex items-center justify-between text-[11px] text-text-muted font-medium">
        <span>Choose a project directory</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <kbd className="bg-surface px-1.5 py-0.5 rounded border border-border">
              Double Click
            </kbd>{' '}
            to open
          </span>
        </div>
      </div>
    </div>
  );
}
