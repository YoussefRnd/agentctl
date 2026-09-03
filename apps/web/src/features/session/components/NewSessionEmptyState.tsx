import { ArrowUpRight } from 'lucide-react';

interface StarterSuggestion {
  label: string;
  prompt: string;
}

const SUGGESTIONS: StarterSuggestion[] = [
  {
    label: 'Explore architecture',
    prompt:
      'Please analyze this repository and summarize the high-level architecture, main packages, and key components.',
  },
  {
    label: 'Review git changes',
    prompt:
      "Please check the current git status, inspect recent uncommitted changes, and summarize what's in progress.",
  },
  {
    label: 'Run test suite',
    prompt:
      'Please run the project tests, report any failing test suites, and explain why they failed.',
  },
  {
    label: 'Audit TODOs',
    prompt:
      'Search the codebase for critical TODOs, deprecated patterns, or technical debt that we can improve.',
  },
];

export function NewSessionEmptyState() {
  const handleSelectSuggestion = (prompt: string) => {
    window.dispatchEvent(new CustomEvent('agentctl:edit-prompt', { detail: prompt }));
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6 select-none">
      <div className="flex w-full max-w-sm flex-col items-center gap-3.5 text-center">
        <div className="space-y-1">
          <h3 className="text-text-main text-xs font-semibold tracking-wide">Session ready</h3>
          <p className="text-text-muted/60 text-[11px]">Send a message or pick a quick starter</p>
        </div>

        {/* Minimalist suggestion pills */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => handleSelectSuggestion(item.prompt)}
              className="group border-border/20 bg-surface-secondary/30 text-text-muted/80 hover:border-border/40 hover:bg-surface-secondary/70 hover:text-text-main flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 active:scale-[0.97]"
            >
              <span>{item.label}</span>
              <ArrowUpRight className="text-text-muted/40 group-hover:text-text-main h-2.5 w-2.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
