// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Tabs primitive', () => {
  it('switches tabs and activates correct content', () => {
    const handleValueChange = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Tabs value="tab1" onValueChange={handleValueChange}>
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>,
      );
    });

    expect(container.textContent).toContain('Content 1');
    expect(container.textContent).not.toContain('Content 2');

    const triggers = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    const tab2 = triggers.find((t) => t.textContent?.includes('Tab 2'));
    expect(tab2).toBeDefined();

    act(() => {
      tab2?.click();
    });

    expect(handleValueChange).toHaveBeenCalledWith('tab2');
  });
});
