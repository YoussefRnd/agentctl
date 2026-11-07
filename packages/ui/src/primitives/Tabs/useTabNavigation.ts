import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef, HTMLAttributes, KeyboardEvent } from 'react';

export type NavigationOrientation = 'horizontal' | 'vertical' | 'both' | 'auto';
export type NavigationItem<Value extends string> = Value | { value: Value; disabled?: boolean };

export interface TabNavigationOptions<Value extends string> {
  value: Value | null;
  onValueChange: (value: Value) => void;
  items?: readonly NavigationItem<Value>[];
  orientation?: NavigationOrientation;
  /** Selection lists retain button semantics when their destinations can be visible together. */
  selectionMode?: 'tabs' | 'buttons';
}

function getTabIds(baseId: string, value: string) {
  const key = encodeURIComponent(value);
  return { tabId: `${baseId}-tab-${key}`, panelId: `${baseId}-panel-${key}` };
}

function navigationItems(list: HTMLElement) {
  return [...list.querySelectorAll<HTMLButtonElement>('[data-navigation-item]')].filter(
    (item) =>
      item.closest('[data-navigation-list]') === list &&
      !item.disabled &&
      item.getAttribute('aria-disabled') !== 'true',
  );
}

/** Share navigation behavior without injecting a wrapper, class or inline style. */
export function useTabNavigation<Value extends string>({
  value,
  onValueChange,
  items,
  orientation = 'horizontal',
  selectionMode = 'tabs',
}: TabNavigationOptions<Value>) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setListElement(element);
  }, []);
  const [autoOrientation, setAutoOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const axis = orientation === 'auto' ? autoOrientation : orientation;
  const focused = useRef<{ element: HTMLElement; value: string | null; index: number } | null>(
    null,
  );
  const entries = items?.map((item) => (typeof item === 'string' ? { value: item } : item));
  const enabled = entries?.filter((item) => !item.disabled);
  const tabStop = enabled
    ? (enabled.find((item) => item.value === value) ?? enabled[0])?.value
    : value;

  useLayoutEffect(() => {
    if (orientation !== 'auto' || !listElement) return;
    const list = listElement;
    const measure = () => {
      setAutoOrientation(
        getComputedStyle(list).flexDirection.startsWith('column') ? 'vertical' : 'horizontal',
      );
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(list);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [orientation, listElement]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const previous = focused.current;
    if (!list || !previous || previous.element.isConnected) return;
    // A newly focused editor or another application region always keeps its focus.
    if (document.activeElement !== document.body && document.activeElement !== null) return;
    const owner = [...list.querySelectorAll<HTMLElement>('[data-navigation-owner]')].find(
      (element) => element.dataset.navigationOwner === previous.value,
    );
    const editor = owner?.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), [contenteditable="true"]',
    );
    const buttons = navigationItems(list);
    const selected = buttons.find((button) => button.dataset.navigationItem === value);
    const next = editor ?? selected ?? buttons[Math.min(previous.index, buttons.length - 1)];
    const fallback = list.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]');
    (next ?? fallback)?.focus();
  });

  function getListProps(props: HTMLAttributes<HTMLDivElement> = {}) {
    return {
      ...props,
      ref: attachList,
      role: selectionMode === 'tabs' ? 'tablist' : 'group',
      'aria-orientation': selectionMode === 'tabs' && axis !== 'both' ? axis : undefined,
      'data-navigation-list': baseId,
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
        const list = event.currentTarget;
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>('[data-navigation-item]')
            : null;
        if (!target || target.closest('[data-navigation-list]') !== list) return;
        const buttons = navigationItems(list);
        const current = buttons.indexOf(target);
        if (current < 0) return;
        const style = getComputedStyle(list);
        const currentAxis =
          orientation === 'auto'
            ? style.flexDirection.startsWith('column')
              ? 'vertical'
              : 'horizontal'
            : axis;
        const rtl = style.direction === 'rtl';
        let next: number;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else if (
          (currentAxis === 'horizontal' || currentAxis === 'both') &&
          event.key === 'ArrowRight'
        )
          next = current + (rtl ? -1 : 1);
        else if (
          (currentAxis === 'horizontal' || currentAxis === 'both') &&
          event.key === 'ArrowLeft'
        )
          next = current + (rtl ? 1 : -1);
        else if (
          (currentAxis === 'vertical' || currentAxis === 'both') &&
          event.key === 'ArrowDown'
        )
          next = current + 1;
        else if ((currentAxis === 'vertical' || currentAxis === 'both') && event.key === 'ArrowUp')
          next = current - 1;
        else return;
        event.preventDefault();
        next = (next + buttons.length) % buttons.length;
        buttons[next]?.focus();
        buttons[next]?.click();
      },
      onFocusCapture(event: React.FocusEvent<HTMLDivElement>) {
        props.onFocusCapture?.(event);
        if (
          !(event.target instanceof HTMLElement) ||
          event.target.closest('[data-navigation-list]') !== event.currentTarget
        )
          return;
        const target = event.target;
        const owner = target.closest<HTMLElement>(
          '[data-navigation-item], [data-navigation-owner]',
        );
        const itemValue = owner?.dataset.navigationItem ?? owner?.dataset.navigationOwner ?? null;
        const buttons = navigationItems(event.currentTarget);
        const index = buttons.findIndex((button) => button.dataset.navigationItem === itemValue);
        focused.current = { element: target, value: itemValue, index: Math.max(0, index) };
      },
      onBlurCapture(event: React.FocusEvent<HTMLDivElement>) {
        props.onBlurCapture?.(event);
        if (
          !(event.target instanceof HTMLElement) ||
          event.target.closest('[data-navigation-list]') !== event.currentTarget
        )
          return;
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          focused.current = null;
        else if (event.relatedTarget === null && event.target.isConnected) focused.current = null;
      },
    };
  }

  function getItemProps(itemValue: Value, props: ComponentPropsWithRef<'button'> = {}) {
    const selected = itemValue === value;
    const disabled = props.disabled || entries?.find((item) => item.value === itemValue)?.disabled;
    const { tabId, panelId } = getTabIds(baseId, itemValue);
    return {
      ...props,
      id: props.id ?? tabId,
      type: 'button' as const,
      'data-navigation-item': itemValue,
      role: selectionMode === 'tabs' ? 'tab' : props.role,
      'aria-selected': selectionMode === 'tabs' ? selected : undefined,
      'aria-controls': selectionMode === 'tabs' ? panelId : undefined,
      'aria-pressed': selectionMode === 'buttons' ? selected : undefined,
      tabIndex: !disabled && itemValue === tabStop ? 0 : -1,
      disabled,
      onClick(event: React.MouseEvent<HTMLButtonElement>) {
        props.onClick?.(event);
        if (!event.defaultPrevented && !disabled) onValueChange(itemValue);
      },
    };
  }

  function getPanelProps(itemValue: Value | null) {
    if (selectionMode !== 'tabs' || itemValue === null) return {};
    const { tabId, panelId } = getTabIds(baseId, itemValue);
    return { id: panelId, role: 'tabpanel', 'aria-labelledby': tabId, tabIndex: 0 };
  }

  function getItemContainerProps(itemValue: Value) {
    return { 'data-navigation-owner': itemValue };
  }

  return { getListProps, getItemProps, getPanelProps, getItemContainerProps };
}
