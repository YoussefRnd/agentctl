import { createJSONStorage } from 'zustand/middleware';

// A full disk, private browsing, or disabled storage must not block composing.
export const persistentStorage = createJSONStorage(() => ({
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* keep the in-memory draft */
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage is unavailable */
    }
  },
}));
