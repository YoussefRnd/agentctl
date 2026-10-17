/** One owner for asynchronous startup and reverse-order native resource disposal. */
export function createDesktopRuntime(dependencies: {
  startServer: () => Promise<number>;
  stopServer: () => Promise<void>;
  openWindow: () => void;
  setupResources: () => () => void;
}) {
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let dispose: (() => void) | undefined;
  let stopped = false;
  return {
    start() {
      if (starting) return starting;
      if (stopped) return Promise.reject(new Error('Desktop runtime is stopped'));
      starting = (async () => {
        try {
          await dependencies.startServer();
        } catch (error) {
          if (stopped) return;
          throw error;
        }
        if (stopped) return;
        dispose = dependencies.setupResources();
        dependencies.openWindow();
      })();
      return starting;
    },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      stopping = (async () => {
        try {
          dispose?.();
        } finally {
          await dependencies.stopServer();
        }
        await starting?.catch(() => undefined);
      })();
      return stopping;
    },
  };
}
