import { useState, useEffect } from 'react';
import { Folder, ChevronLeft, Home } from 'lucide-react';
import { apiClient } from '../lib/api-client.js';

interface FolderEntry {
  name: string;
  path: string;
}

interface ExploreResponse {
  currentPath: string;
  parentPath: string;
  folders: FolderEntry[];
}

export function DirectoryExplorer({ 
  onSelect 
}: { 
  onSelect: (path: string) => void 
}) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const explore = async (path?: string) => {
    setIsLoading(true);
    try {
      const data = await apiClient.fetch<ExploreResponse>('/api/fs/explore', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setFolders(data.folders);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to explore:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void explore();
  }, []);

  return (
    <div className="flex flex-col w-full max-w-xl bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl">
      <div className="bg-background/50 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-mono text-text-muted truncate">
          <Folder className="w-3.5 h-3.5" />
          <span className="truncate">{currentPath}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { void explore(); }}
            className="p-1.5 hover:bg-surface rounded-lg transition-colors text-text-muted"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
          {parentPath && parentPath !== currentPath && (
            <button
              onClick={() => { void explore(parentPath); }}
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
        ) : (
          <div className="grid grid-cols-1 gap-0.5">
            {folders.map((f) => (
              <button
                key={f.path}
                onClick={() => { void explore(f.path); }}
                className="group flex items-center justify-between px-3 py-2 rounded-xl hover:bg-accent/10 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <Folder className="w-4 h-4 text-accent/60 group-hover:text-accent" />
                  <span className="text-[13px] text-text-main group-hover:text-accent transition-colors">{f.name}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(f.path);
                  }}
                  className="px-3 py-1 bg-accent/10 hover:bg-accent text-accent hover:text-background text-[11px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                >
                  SELECT
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
      
      <div className="px-4 py-3 bg-background/30 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
        <span>Select a repository folder to begin</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <kbd className="bg-surface px-1.5 py-0.5 rounded border border-border">Click</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
