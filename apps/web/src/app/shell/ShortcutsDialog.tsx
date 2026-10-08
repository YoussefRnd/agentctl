import { useEffect, useId, useMemo, useRef, useState, type ElementType } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Kbd,
  SearchHighlight,
  cn,
} from '@agentctl/ui';
import { fuzzySearch } from '@agentctl/shared';
import { Keyboard, Command, MessageSquareCode, GitPullRequest, Search, X } from 'lucide-react';
import { useShellStore } from './model/useShellStore';
import { MODIFIER_KEY } from '@/shared/lib/platform';

const categories = ['Navigation', 'Composer', 'Review'] as const;
type Category = (typeof categories)[number];
interface Shortcut {
  label: string;
  category: Category;
  bindings: string[][];
  sequence?: boolean;
}
const icons: Record<Category, ElementType> = {
  Navigation: Command,
  Composer: MessageSquareCode,
  Review: GitPullRequest,
};
const shortcuts: Shortcut[] = [
  { label: 'Command palette', category: 'Navigation', bindings: [[MODIFIER_KEY, 'K']] },
  { label: 'Toggle sidebar', category: 'Navigation', bindings: [[MODIFIER_KEY, 'B']] },
  {
    label: 'Toggle inspector / workbench',
    category: 'Navigation',
    bindings: [[MODIFIER_KEY, '\\']],
  },
  { label: 'Settings', category: 'Navigation', bindings: [[MODIFIER_KEY, ',']] },
  { label: 'Keyboard shortcuts', category: 'Navigation', bindings: [[MODIFIER_KEY, '/'], ['?']] },
  { label: 'Send message', category: 'Composer', bindings: [['Enter']] },
  { label: 'New line in composer', category: 'Composer', bindings: [['Shift', 'Enter']] },
  { label: 'Mention file or Git context', category: 'Composer', bindings: [['@']] },
  { label: 'Open slash commands', category: 'Composer', bindings: [['/']] },
  { label: 'Navigate suggestions', category: 'Composer', bindings: [['↑'], ['↓']] },
  { label: 'Accept suggestion', category: 'Composer', bindings: [['Tab'], ['Enter']] },
  { label: 'Stop running agent', category: 'Composer', bindings: [['Esc', 'Esc']], sequence: true },
  { label: 'Next changed file', category: 'Review', bindings: [['j'], [']']] },
  { label: 'Previous changed file', category: 'Review', bindings: [['k'], ['[']] },
  { label: 'Commit changes in dialog', category: 'Review', bindings: [[MODIFIER_KEY, 'Enter']] },
  { label: 'Exit maximized view', category: 'Review', bindings: [['Esc']] },
];

function bindingLabel(shortcut: Shortcut) {
  return shortcut.bindings
    .map((keys) => keys.join(shortcut.sequence ? ' then ' : '+'))
    .join(' or ');
}

function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <span
      role="group"
      aria-label={bindingLabel(shortcut)}
      className="flex shrink-0 flex-wrap items-center gap-1"
    >
      {shortcut.bindings.map((keys, bindingIndex) => (
        <span key={bindingIndex} aria-hidden="true" className="inline-flex items-center gap-1">
          {bindingIndex > 0 && <span className="text-text-muted/60 mx-0.5 text-[10px]">or</span>}
          {keys.map((key, keyIndex) => (
            <span key={keyIndex} className="inline-flex items-center gap-1">
              {keyIndex > 0 && (
                <span className="text-text-muted/60 text-[10px]">
                  {shortcut.sequence ? 'then' : '+'}
                </span>
              )}
              <Kbd className="h-6 min-w-6 rounded-md px-1.5">{key}</Kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsDialog() {
  const isOpen = useShellStore((s) => s.isShortcutsOpen);
  const close = useShellStore((s) => s.closeShortcuts);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | Category>('All');
  const resultsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchQuery = query.trim();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setFilter('All');
    }
  }, [isOpen]);

  const results = useMemo(
    () =>
      fuzzySearch(
        filter === 'All' ? shortcuts : shortcuts.filter((shortcut) => shortcut.category === filter),
        searchQuery,
        (shortcut) => [shortcut.label, shortcut.category, bindingLabel(shortcut)],
      ),
    [filter, searchQuery],
  );
  const groups = searchQuery
    ? [{ label: 'Best matches', entries: results }]
    : categories.map((category) => ({
        label: category,
        entries: results.filter((shortcut) => shortcut.category === category),
      }));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="border-border/50 bg-brand-mantle flex max-h-[min(38rem,calc(100dvh-2rem))] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl border p-0 shadow-2xl"
      >
        <div className="border-border/30 shrink-0 border-b px-4 pt-4 pb-3">
          <div className="mb-3 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="bg-accent/15 text-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            >
              <Keyboard className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-text-main text-xs font-semibold">
                Keyboard Shortcuts
              </DialogTitle>
              <DialogDescription className="text-text-muted mt-0.5 text-[11px]">
                Find a shortcut for navigation, chat, or review
              </DialogDescription>
            </div>
          </div>
          <div className="border-border/40 bg-surface-secondary/50 focus-within:border-accent/50 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors">
            <Search aria-hidden="true" className="text-text-muted h-4 w-4 shrink-0" />
            <input
              ref={inputRef}
              aria-label="Search keyboard shortcuts"
              aria-controls={resultsId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shortcuts or keys…"
              autoComplete="off"
              spellCheck={false}
              className="text-text-main placeholder:text-text-muted/60 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              aria-label="Close keyboard shortcuts"
              onClick={close}
              className="text-text-muted hover:bg-accent/10 hover:text-text-main focus-visible:ring-accent flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter keyboard shortcuts"
          className="flex shrink-0 flex-wrap items-center gap-1 px-3 pt-2.5 pb-2"
        >
          {(['All', ...categories] as const).map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={filter === category}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setFilter(category);
                inputRef.current?.focus();
              }}
              className={cn(
                'focus-visible:ring-accent cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
                filter === category
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
              )}
            >
              {category}
            </button>
          ))}
        </div>

        <div
          id={resultsId}
          role="region"
          aria-label="Keyboard shortcut reference"
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {groups.map(
            (group) =>
              group.entries.length > 0 && (
                <section key={group.label} aria-label={group.label} className="pb-2 last:pb-0">
                  <h3 className="text-text-muted px-2.5 py-2 text-[10px] font-semibold tracking-wider uppercase">
                    {group.label}
                  </h3>
                  <ul className="space-y-0.5">
                    {group.entries.map((shortcut) => {
                      const Icon = icons[shortcut.category];
                      return (
                        <li
                          key={shortcut.label}
                          className="hover:bg-surface-secondary/60 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg px-2.5 py-2.5"
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="bg-surface-secondary/70 text-text-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-text-main text-xs font-medium">
                              <SearchHighlight text={shortcut.label} query={searchQuery} />
                            </span>
                          </span>
                          <ShortcutKeys shortcut={shortcut} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ),
          )}
          {results.length === 0 && (
            <div
              role="status"
              className="text-text-muted flex flex-col items-center gap-2 px-4 py-8 text-center text-xs"
            >
              <Search aria-hidden="true" className="h-5 w-5" />
              <p>No shortcuts match “{searchQuery}”</p>
              <p className="text-[11px]">Try an action name, a key, or another filter.</p>
            </div>
          )}
        </div>

        <div className="border-border/30 text-text-muted flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px]">
          <span role="status">
            {results.length} {results.length === 1 ? 'shortcut' : 'shortcuts'}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
