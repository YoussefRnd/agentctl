import { useEffect, useState } from 'react';

const FALLBACK_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.0';

export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(FALLBACK_VERSION);

  useEffect(() => {
    if (!window.electronAPI?.getAppVersion) return;
    void window.electronAPI
      .getAppVersion()
      .then((ver) => {
        if (ver) setVersion(ver);
      })
      .catch(() => undefined);
  }, []);

  return version;
}
