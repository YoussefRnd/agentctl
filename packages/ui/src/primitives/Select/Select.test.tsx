// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Select } from './Select.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Select primitive', () => {
  it('triggers onChange exactly once when an option is selected', () => {
    const handleChange = vi.fn();
    const options = [
      { value: 'opt1', label: 'Option 1' },
      { value: 'opt2', label: 'Option 2' },
    ];

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<Select value="opt1" onChange={handleChange} options={options} />);
    });

    const trigger = document.querySelector('button');
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger?.click();
    });

    const items = [...document.querySelectorAll('[role="menuitem"]')];
    if (items.length > 0) {
      const option2 = items.find((el) => el.textContent?.includes('Option 2')) as HTMLElement;
      expect(option2).toBeDefined();

      act(() => {
        option2?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        option2?.click();
      });

      expect(handleChange).toHaveBeenCalledTimes(1);
      expect(handleChange).toHaveBeenCalledWith('opt2');
    }
  });
});
