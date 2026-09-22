import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Server state must not remain "fresh" for the lifetime of the app.
      // Individual real-time queries may override this when they have a
      // stronger update mechanism such as SSE.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 10_000,
    },
    mutations: {
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Something went wrong';
        toast.error(message);
      },
    },
  },
});
