import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDirectoryPicker } from './useDirectoryPicker.js';

describe('useDirectoryPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns directory name when showDirectoryPicker succeeds', async () => {
    const mockHandle = {
      name: 'myproject',
    };
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');
    delete (window as any).showDirectoryPicker;
    const mockPicker = vi.fn().mockResolvedValue(mockHandle);
    (window as any).showDirectoryPicker = mockPicker;

    const { result } = renderHook(() => useDirectoryPicker());

    await act(async () => {
      const name = await result.current.pickDirectory();
      expect(name).toBe('myproject');
    });

    if (originalDescriptor) {
      Object.defineProperty(window, 'showDirectoryPicker', originalDescriptor);
    }
  });

  it('falls back to input click when showDirectoryPicker is not available', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');
    delete (window as any).showDirectoryPicker;

    const { result } = renderHook(() => useDirectoryPicker());

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    act(() => {
      result.current.pickDirectory();
    });

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    if (originalDescriptor) {
      Object.defineProperty(window, 'showDirectoryPicker', originalDescriptor);
    }
  });
});
