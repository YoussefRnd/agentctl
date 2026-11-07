import * as React from 'react';
import { cn } from '../../utils.js';
import {
  useTabNavigation,
  type NavigationItem,
  type NavigationOrientation,
} from './useTabNavigation.js';

type Navigation = ReturnType<typeof useTabNavigation<string>>;
interface TabsContextValue {
  value: string | null;
  navigation: Navigation;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);
function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be used within Tabs or TabsRoot');
  return context;
}

export interface TabsRootProps<Value extends string = string> {
  value: Value | null;
  onValueChange: (value: Value) => void;
  items?: readonly NavigationItem<Value>[];
  orientation?: NavigationOrientation;
  children: React.ReactNode;
}

/** Context only. Feature navigation keeps its own existing layout and appearance. */
export function TabsRoot<Value extends string>({
  value,
  onValueChange,
  items,
  orientation = 'both',
  children,
}: TabsRootProps<Value>) {
  const navigation = useTabNavigation<string>({
    value,
    onValueChange: (next) => onValueChange(next as Value),
    items,
    orientation,
  });
  return <TabsContext.Provider value={{ value, navigation }}>{children}</TabsContext.Provider>;
}

export interface TabsProps extends TabsRootProps {
  className?: string;
}
export function Tabs({ children, className, ...props }: TabsProps) {
  return (
    <TabsRoot {...props}>
      <div className={cn('flex flex-col', className)} data-slot="tabs">
        {children}
      </div>
    </TabsRoot>
  );
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  unstyled?: boolean;
}
export function TabsList({ className, children, unstyled = false, ...props }: TabsListProps) {
  const { navigation } = useTabsContext();
  return (
    <div
      {...navigation.getListProps(props)}
      className={
        unstyled
          ? className
          : cn(
              'bg-surface-secondary/40 text-text-muted inline-flex items-center gap-1 rounded-lg p-1',
              className,
            )
      }
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends React.ComponentPropsWithRef<'button'> {
  value: string;
  unstyled?: boolean;
}
export function TabsTrigger({
  value,
  className,
  children,
  disabled,
  unstyled = false,
  ...props
}: TabsTriggerProps) {
  const context = useTabsContext();
  const isSelected = context.value === value;
  const triggerProps = context.navigation.getItemProps(value, { ...props, disabled });
  return (
    <button
      {...triggerProps}
      className={
        unstyled
          ? className
          : cn(
              'inline-flex cursor-pointer items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-semibold transition-[color,background-color,box-shadow] duration-150 outline-none select-none',
              'focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
              isSelected
                ? 'bg-surface text-text-main shadow-xs'
                : 'text-text-muted hover:text-text-main hover:bg-white/5',
              triggerProps.disabled && 'pointer-events-none cursor-not-allowed opacity-40',
              className,
            )
      }
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string | null;
  unstyled?: boolean;
}
export function TabsContent({
  value,
  className,
  children,
  unstyled = false,
  ...props
}: TabsContentProps) {
  const context = useTabsContext();
  if (value !== context.value) return null;
  return (
    <div
      {...context.navigation.getPanelProps(value)}
      className={
        unstyled
          ? className
          : cn(
              'focus-visible:ring-accent/40 mt-2 focus-visible:ring-1 focus-visible:outline-none',
              className,
            )
      }
      {...props}
    >
      {children}
    </div>
  );
}
