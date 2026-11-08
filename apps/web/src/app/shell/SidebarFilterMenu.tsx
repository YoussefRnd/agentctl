import { ListFilter, Check } from 'lucide-react';
import { Dropdown, IconButton, Tooltip } from '@agentctl/ui';
import type { ProjectSort } from '@/features/projects';

interface SidebarFilterMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  sortBy: ProjectSort;
  gitOnly: boolean;
  showArchived: boolean;
  onSettingsChange: (patch: {
    sortBy?: ProjectSort;
    gitOnly?: boolean;
    showArchived?: boolean;
  }) => void;
}

export function SidebarFilterMenu({
  isOpen,
  onToggle,
  onClose,
  sortBy,
  gitOnly,
  showArchived,
  onSettingsChange,
}: SidebarFilterMenuProps) {
  return (
    <Dropdown.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (open === isOpen) return;
        if (open) onToggle();
        else onClose();
      }}
    >
      <Tooltip content="Filter and sort">
        <Dropdown.Trigger asChild>
          <IconButton
            type="button"
            size="compact"
            aria-label="Filter and sort"
            className="motion-disclosure data-[state=open]:bg-surface-tertiary/60 active:transform-none active:opacity-100"
          >
            <ListFilter className="icon-compact" />
          </IconButton>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Portal>
        <Dropdown.Content align="end" className="w-52">
          <div className="text-role-eyebrow text-text-muted px-2 py-2">Sort by</div>
          {(
            [
              { id: 'lastActive', label: 'Last active' },
              { id: 'name', label: 'Project name' },
              { id: 'createdAt', label: 'Date created' },
            ] as const
          ).map((option) => (
            <Dropdown.Item
              key={option.id}
              role="menuitemradio"
              aria-checked={sortBy === option.id}
              onSelect={() => onSettingsChange({ sortBy: option.id })}
              className="text-role-control min-h-8 justify-between gap-2"
            >
              <span>{option.label}</span>
              {sortBy === option.id && (
                <Check className="icon-inline text-text-muted" aria-hidden="true" />
              )}
            </Dropdown.Item>
          ))}
          <Dropdown.Separator />
          <div className="text-role-eyebrow text-text-muted px-2 py-2">Filter</div>
          <Dropdown.Item
            role="menuitemcheckbox"
            aria-checked={gitOnly}
            onSelect={(event) => {
              event.preventDefault();
              onSettingsChange({ gitOnly: !gitOnly });
            }}
            className="text-role-control min-h-8 justify-between gap-2"
          >
            <span>Git repositories only</span>
            {gitOnly && <Check className="icon-inline text-text-muted" aria-hidden="true" />}
          </Dropdown.Item>
          <Dropdown.Item
            role="menuitemcheckbox"
            aria-checked={showArchived}
            onSelect={(event) => {
              event.preventDefault();
              onSettingsChange({ showArchived: !showArchived });
            }}
            className="text-role-control min-h-8 justify-between gap-2"
          >
            <span>Show archived</span>
            {showArchived && <Check className="icon-inline text-text-muted" aria-hidden="true" />}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
