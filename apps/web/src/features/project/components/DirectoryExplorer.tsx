import { useReducer, useEffect } from 'react';
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

interface State {
  currentPath: string | null;
  parentPath: string | null;
  folders: FolderEntry[];
  error: string | null;
  isLoading: boolean;
}

type Action =
  | { type: 'EXPLORE_START' }
  | { type: 'EXPLORE_SUCCESS'; payload: ExploreResponse }
  | { type: 'EXPLORE_FAILURE'; payload: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'EXPLORE_START':
      return { ...state, isLoading: true, error: null };
    case 'EXPLORE_SUCCESS':
      return {
        ...state,
        isLoading: false,
        currentPath: action.payload.currentPath,
        parentPath: action.payload.parentPath,
        folders: action.payload.folders,
        error: action.payload.error ?? null,
      };
    case 'EXPLORE_FAILURE':
      return { ...state, isLoading: false, error: action.payload };
    default:
      return state;
  }
}

const initialState: State = {
  currentPath: null,
  parentPath: null,
  folders: [],
  error: null,
  isLoading: false,
};

export function DirectoryExplorer({ onSelect }: { onSelect: (path: string) => void }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { currentPath, parentPath, folders, error, isLoading } = state;

  const explore = async (path?: string) => {
    dispatch({ type: 'EXPLORE_START' });
    try {
      const data = await apiClient.fetch<ExploreResponse>('/api/fs/explore', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      dispatch({ type: 'EXPLORE_SUCCESS', payload: data });
    } catch {
      dispatch({ type: 'EXPLORE_FAILURE', payload: 'Connection failed. Is the server running?' });
    }
  };

  useEffect(() => {
    void explore();
  }, []);

  return (
    <GlassPanel className="animate-in fade-in zoom-in-95 w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl">
      <div className="border-border/40 bg-surface-secondary/20 flex items-center justify-between border-b px-4 py-3">
        <div className="text-text-muted flex items-center gap-2 truncate text-xs">
          <Folder className="h-4 w-4" />
          <span className="truncate">{currentPath ?? 'Scanning file system...'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              void explore();
            }}
            className="hover:text-accent text-text-muted cursor-pointer rounded-sm p-1 transition-[color,transform] duration-150 ease-out active:scale-90"
            title="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          {parentPath && parentPath !== currentPath && (
            <button
              type="button"
              onClick={() => {
                void explore(parentPath);
              }}
              className="hover:text-accent text-text-muted cursor-pointer rounded-sm p-1 transition-[color,transform] duration-150 ease-out active:scale-90"
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
            <Loader2 className="text-accent h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <AlertCircle className="text-danger mb-2 h-6 w-6 opacity-30" />
            <p className="text-text-main text-xs font-medium">{error}</p>
            <Button
              onClick={() => {
                void explore(currentPath ?? undefined);
              }}
              variant="outline"
              className="mt-4 text-xs font-medium"
            >
              Retry scan
            </Button>
          </div>
        ) : folders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center opacity-40">
            <Folder className="text-text-muted mb-2 h-6 w-6" />
            <p className="text-xs font-medium">Directory is empty</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                className="group hover:bg-surface-secondary/60 flex w-full cursor-pointer items-center justify-between rounded-xl border-none bg-transparent px-3 py-2 text-left transition-colors"
                onClick={() => {
                  void explore(f.path);
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`bg-surface-secondary/40 rounded-lg p-1.5 ${f.isRepo ? 'text-accent' : 'text-text-muted'}`}
                  >
                    {f.isRepo ? (
                      <GitBranch className="h-3.5 w-3.5" />
                    ) : (
                      <Folder className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-text-main text-xs font-semibold tracking-tight">
                      {f.name}
                    </span>
                    {f.isRepo && (
                      <span className="text-accent/70 mt-0.5 text-[10px] font-medium">
                        Git repo
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
                  className="h-7 px-3 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100"
                >
                  Open
                </Button>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-border/40 text-text-muted bg-surface-secondary/10 flex items-center justify-between border-t px-4 py-2.5 text-[11px]">
        <span className="opacity-60">Click a folder to explore, or click Open to select</span>
      </div>
    </GlassPanel>
  );
}
