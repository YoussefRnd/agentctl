import React from 'react';
import { ArrowUpRight, ChevronDown, Folder, FolderPlus, Check } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { Dropdown, cn } from '@agentctl/ui';

export interface StarterSuggestion {
  label: string;
  prompt: string;
}

export const STARTER_SUGGESTIONS: StarterSuggestion[] = [
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

export interface NewSessionEmptyStateProps {
  projectName?: string;
  activeProjectId?: string;
  allowProjectSwitch?: boolean;
  projects?: SidebarProject[];
  onSelectProject?: (projectId: string) => void;
  onOpenDirectory?: () => void;
  onSelectStarterPrompt?: (prompt: string) => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

export function NewSessionEmptyState({
  projectName = 'agentctl',
  activeProjectId,
  allowProjectSwitch = false,
  projects = [],
  onSelectProject,
  onOpenDirectory,
  onSelectStarterPrompt,
  children,
  footer,
}: NewSessionEmptyStateProps = {}) {
  const handleSelectSuggestion = (prompt: string) => {
    if (onSelectStarterPrompt) {
      onSelectStarterPrompt(prompt);
    } else {
      window.dispatchEvent(new CustomEvent('agentctl:edit-prompt', { detail: prompt }));
    }
  };

  return (
    <div className="animate-in fade-in flex w-full max-w-[760px] flex-col items-center px-4 py-6 duration-200 select-none sm:py-8">
      {/* Hero Title */}
      <div className="mb-6 flex flex-col items-center justify-center text-center">
        <h1 className="font-display text-text-main flex flex-wrap items-center justify-center text-2xl font-extrabold tracking-tight sm:text-3xl">
          <span>What should we build in&nbsp;</span>
          {allowProjectSwitch ? (
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button
                  type="button"
                  className="group/trigger text-accent decoration-accent/50 hover:decoration-accent focus-visible:ring-accent/40 click-press inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 underline decoration-dotted underline-offset-4 transition-[color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span>{projectName}</span>
                  <ChevronDown className="h-4 w-4 opacity-70 transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  align="center"
                  className="z-50 max-h-80 w-64 overflow-y-auto p-1.5"
                >
                  <div className="text-text-muted/60 px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                    Select Workspace
                  </div>
                  {projects.map((proj) => {
                    const isSelected = proj.id === activeProjectId;
                    return (
                      <Dropdown.Item
                        key={proj.id}
                        className={cn(
                          'flex cursor-pointer items-center justify-between',
                          isSelected
                            ? 'bg-accent/10 text-accent'
                            : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
                        )}
                        onSelect={() => {
                          onSelectProject?.(proj.id);
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Folder
                            className={cn(
                              'h-3.5 w-3.5 shrink-0',
                              isSelected ? 'text-accent' : 'text-text-muted',
                            )}
                          />
                          <span className="truncate font-medium">{proj.name}</span>
                        </div>
                        {isSelected && <Check className="text-accent h-3.5 w-3.5 shrink-0" />}
                      </Dropdown.Item>
                    );
                  })}
                  {onOpenDirectory && (
                    <>
                      <div className="bg-border/30 my-1 h-px" />
                      <Dropdown.Item
                        className="hover:bg-surface-secondary text-text-main flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
                        onSelect={onOpenDirectory}
                      >
                        <FolderPlus className="text-accent h-3.5 w-3.5 shrink-0" />
                        <span>Open directory / workspace...</span>
                      </Dropdown.Item>
                    </>
                  )}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          ) : (
            <span className="text-accent">{projectName}</span>
          )}
          <span>?</span>
        </h1>
      </div>

      {/* Centered Composer Card */}
      {children && <div className="w-full">{children}</div>}

      {/* Starter Action Suggestion Pills */}
      <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center">
        {STARTER_SUGGESTIONS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleSelectSuggestion(item.prompt)}
            className={cn(
              'group border-border/30 bg-surface-secondary/40 text-text-muted hover:border-border/60 hover:bg-surface-secondary/80 hover:text-text-main',
              'focus-visible:ring-accent/40 flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-xs backdrop-blur-xs transition-[color,background-color,border-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-[0.97]',
            )}
          >
            <span>{item.label}</span>
            <ArrowUpRight className="text-text-muted/50 group-hover:text-text-main h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        ))}
      </div>

      {/* Subtle Hint / Keyboard Shortcuts Footer */}
      <p className="text-text-muted/65 mt-6 text-center text-[11px] font-medium tracking-wide">
        Use <kbd className="text-accent font-mono">@</kbd> for context &middot;{' '}
        <kbd className="text-accent font-mono">/</kbd> for skills &middot; Double-Esc to stop
      </p>

      {/* Optional Custom Footer */}
      {footer}
    </div>
  );
}
