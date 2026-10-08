import { useEffect } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import {
  SuggestionDropdown,
  SuggestionHeader,
  SuggestionList,
  SuggestionOption,
  SuggestionFooter,
} from './SuggestionDropdown';

interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}

export function SlashCommandsDropdown({
  isOpen,
  commands,
  query,
  listboxId,
  activeIndex,
  commandRefs,
  onActiveIndexChange,
  onSelectCommand,
  onDismiss,
}: {
  isOpen: boolean;
  commands: CommandInfo[];
  query: string;
  listboxId: string;
  activeIndex: number;
  commandRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  onActiveIndexChange: (index: number) => void;
  onSelectCommand: (command: CommandInfo) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (isOpen) commandRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, commands, activeIndex, commandRefs]);
  if (!isOpen) return null;
  return (
    <SuggestionDropdown label="Slash commands" onDismiss={onDismiss}>
      <SuggestionHeader
        symbol="/"
        title="Commands"
        description="Search agent commands, shortcuts, and skills"
      />
      <SuggestionList id={listboxId} label="Available commands">
        {commands.map((command, index) => (
          <SuggestionOption
            key={command.name}
            id={`${listboxId}-option-${index}`}
            ref={(element) => {
              commandRefs.current[index] = element;
            }}
            active={index === activeIndex}
            title={`/${command.name}`}
            description={[
              command.description,
              command.input?.hint ? `Input: ${command.input.hint}` : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
            query={query}
            highlightDescription={false}
            icon={<span className="text-accent font-mono text-sm">/</span>}
            onActivate={() => onActiveIndexChange(index)}
            onSelect={() => onSelectCommand(command)}
            trailing={
              command.category ? (
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-text-muted bg-surface-secondary/70 max-w-16 truncate rounded-md px-1.5 py-1 text-[10px]">
                    {command.category}
                  </span>
                  {index === activeIndex && (
                    <CornerDownLeft aria-hidden="true" className="text-accent h-3.5 w-3.5" />
                  )}
                </span>
              ) : undefined
            }
          />
        ))}
      </SuggestionList>
      {commands.length === 0 && (
        <div
          role="status"
          className="text-text-muted flex flex-col items-center gap-2 px-4 pt-3 pb-7 text-center text-xs"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
          <p>No commands match “{query}”</p>
          <p className="text-[11px]">Try another command name.</p>
        </div>
      )}
      <SuggestionFooter count={commands.length} action="select" />
    </SuggestionDropdown>
  );
}
