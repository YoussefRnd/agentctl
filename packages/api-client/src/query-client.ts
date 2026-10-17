import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

/** Creates isolated query caches; the host owns application errors and cache lifetime. */
export function createApiQueryClient(config: QueryClientConfig = {}): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: {
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 10_000,
        ...config.defaultOptions?.queries,
      },
    },
  });
}
