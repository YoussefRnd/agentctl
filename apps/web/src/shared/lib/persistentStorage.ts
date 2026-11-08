import { createJSONStorage } from 'zustand/middleware';

// A full disk, private browsing, or disabled storage must not block the app.
export const browserStorage = {
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
      return true;
    } catch {
      return false;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage is unavailable */
    }
  },
};

export const persistentStorage = createJSONStorage<unknown>(() => browserStorage);
