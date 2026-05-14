import { useCallback } from 'react';

type ShowDirectoryPicker = () => Promise<{ name: string }>;

export function useDirectoryPicker() {
  const pickDirectory = useCallback(async (): Promise<string | null> => {
    if ('showDirectoryPicker' in window) {
      try {
        const showPicker = (window as Window & typeof globalThis & { showDirectoryPicker: ShowDirectoryPicker }).showDirectoryPicker;
        const handle = await showPicker();
        return handle.name;
      } catch {
        return null;
      }
    }

    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      input.style.display = 'none';

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        const dirName = file?.webkitRelativePath.split('/')[0];
        if (dirName) {
          resolve(dirName);
        } else {
          resolve(null);
        }
        input.remove();
      });

      input.addEventListener('cancel', () => {
        resolve(null);
        input.remove();
      });

      document.body.appendChild(input);
      input.click();
    });
  }, []);

  return { pickDirectory };
}
