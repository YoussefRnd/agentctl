import { getErrorMessage } from '@/shared/lib/feedback';
import { createApiQueryClient } from '@agentctl/api-client';
import { toast } from 'sonner';
/** Application-lifetime cache and mutation notification policy. */
export const queryClient = createApiQueryClient({
  defaultOptions: {
    mutations: {
      onError: (error: unknown) => toast.error(getErrorMessage(error, 'Something went wrong')),
    },
  },
});
