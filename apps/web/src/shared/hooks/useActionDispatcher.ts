import { useCallback } from 'react';
import { toast } from 'sonner';
import { useActionStore } from '../stores/useActionStore';

interface ActionOptions {
  silent?: boolean;
  successMessage?: string;
  errorMessage?: string;
}

export const useActionDispatcher = () => {
  const addPending = useActionStore((state) => state.addPending);
  const removePending = useActionStore((state) => state.removePending);

  const execute = useCallback(
    async <T>(
      actionName: string,
      actionFn: () => Promise<T>,
      options?: ActionOptions,
    ): Promise<T | undefined> => {
      const { silent = false, successMessage, errorMessage } = options ?? {};

      addPending(actionName);
      try {
        const result = await actionFn();
        if (!silent && successMessage) {
          toast.success(successMessage, { id: successMessage });
        }
        return result;
      } catch (error) {
        if (!silent) {
          const message =
            errorMessage ?? (error instanceof Error ? error.message : 'Action failed');
          toast.error(message, { id: message });
        }
        return undefined;
      } finally {
        removePending(actionName);
      }
    },
    [addPending, removePending],
  );

  return { execute };
};
