import { getErrorMessage } from '@/shared/lib/feedback';
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { providerService } from '@agentctl/api-client';
import { Button, LoadingState } from '@agentctl/ui';
import { projectKeys } from '@/shared/lib/queryKeys';
import { toast } from 'sonner';

export function NativeSessionImport({
  providerId,
  projectId,
  onImported,
}: {
  providerId: string;
  projectId: string;
  onImported: (sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['native-sessions', providerId, projectId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      providerService.listNativeSessions(providerId, projectId, pageParam),
    getNextPageParam: (lastPage, _pages, previousCursor, cursors) =>
      lastPage.nextCursor &&
      lastPage.nextCursor !== previousCursor &&
      !cursors.includes(lastPage.nextCursor)
        ? lastPage.nextCursor
        : undefined,
  });
  const rows = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.sessions) ?? []).map((row) => [row.sessionId, row]),
    ).values(),
  ];
  const importSession = async (nativeSessionId: string, title?: string) => {
    setImporting(nativeSessionId);
    try {
      const result = await providerService.importNativeSession(
        providerId,
        projectId,
        nativeSessionId,
        title,
      );
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      await queryClient.invalidateQueries({ queryKey: ['native-sessions', providerId, projectId] });
      onImported(result.sessionId);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to import session'));
    } finally {
      setImporting(null);
    }
  };
  return (
    <div className="border-border/40 max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3">
      <p className="text-text-muted text-xs">Existing sessions in this project’s directory</p>
      {query.isPending && <LoadingState variant="inline" message="Loading sessions…" />}
      {query.error && (
        <div>
          <p role="alert" className="text-xs">
            {query.error.message}
          </p>
          <Button type="button" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!query.isPending && !query.error && rows.length === 0 && (
        <p className="text-xs">No native sessions found.</p>
      )}
      {rows.map((row) => (
        <div key={row.sessionId} className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p title={row.title || row.sessionId} className="truncate text-xs">
              {row.title || row.sessionId}
            </p>
            {row.updatedAt && <p className="text-text-muted text-xs">{row.updatedAt}</p>}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={importing !== null}
            onClick={() =>
              row.importedSessionId
                ? onImported(row.importedSessionId)
                : void importSession(row.sessionId, row.title)
            }
          >
            {importing === row.sessionId ? 'Importing…' : row.importedSessionId ? 'Open' : 'Import'}
          </Button>
        </div>
      ))}
      {query.hasNextPage && (
        <Button
          type="button"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
