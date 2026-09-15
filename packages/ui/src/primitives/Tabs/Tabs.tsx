import * as React from 'react';
import { cn } from '../../utils.js';

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = React.useId();
  const contextValue = React.useMemo(
    () => ({ value, onChange: onValueChange, baseId }),
    [value, onValueChange, baseId],
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={cn('flex flex-col', className)} data-slot="tabs">
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TabsList({ className, children, ...props }: TabsListProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!listRef.current) return;
    const tabs = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (!tabs.length) return;

    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== currentIndex) {
      tabs[nextIndex]?.focus();
      tabs[nextIndex]?.click();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn(
        'bg-surface-secondary/40 text-text-muted inline-flex items-center gap-1 rounded-lg p-1',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, children, disabled, ...props }: TabsTriggerProps) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');

  const isSelected = context.value === value;
  const tabId = `${context.baseId}-tab-${value}`;
  const panelId = `${context.baseId}-panel-${value}`;

  return (
    <button
      id={tabId}
      role="tab"
      type="button"
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={() => context.onChange(value)}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-semibold transition-[color,background-color,box-shadow] duration-150 outline-none select-none',
        'focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
        isSelected
          ? 'bg-surface text-text-main shadow-xs'
          : 'text-text-muted hover:text-text-main hover:bg-white/5',
        disabled && 'pointer-events-none cursor-not-allowed opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  const isSelected = context.value === value;
  const tabId = `${context.baseId}-tab-${value}`;
  const panelId = `${context.baseId}-panel-${value}`;

  if (!isSelected) return null;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      className={cn(
        'focus-visible:ring-accent/40 mt-2 focus-visible:ring-1 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
