import type { ReviewFile } from './ReviewView';
import { GitPullRequest, FileCheck, Search, Eye } from 'lucide-react';

interface MagicBarProps {
  files: ReviewFile[];
  onAction: (action: string) => void;
  activeTab: 'feed' | 'review';
  onTabChange: (tab: 'feed' | 'review') => void;
}

export function MagicBar({ files, onAction, activeTab, onTabChange }: MagicBarProps) {
  const hasChanges = files.length > 0;
  
  return (
    <div className="flex items-center gap-2 p-2 px-4 mb-2">
      <button 
        onClick={() => { onTabChange('review'); }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border ${
          activeTab === 'review' 
            ? 'bg-accent/10 border-accent text-accent' 
            : 'border-transparent text-text-muted hover:bg-surface-hover hover:border-border'
        }`}
      >
        <Eye className="w-3.5 h-3.5" />
        Review Changes
      </button>
      
      {hasChanges && (
        <button 
          onClick={() => { onAction('Generate Commit'); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border border-transparent text-text-muted hover:bg-surface-hover hover:border-border"
        >
          <FileCheck className="w-3.5 h-3.5" />
          Generate Commit
        </button>
      )}

      {hasChanges && (
        <button 
          onClick={() => { onAction('Create PR'); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border border-transparent text-text-muted hover:bg-surface-hover hover:border-border"
        >
          <GitPullRequest className="w-3.5 h-3.5" />
          Create PR
        </button>
      )}

      <button 
        onClick={() => { onAction('Investigate'); }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border border-transparent text-text-muted hover:bg-surface-hover hover:border-border"
      >
        <Search className="w-3.5 h-3.5" />
        Investigate
      </button>
    </div>
  );
}
