import { useState } from 'react';
import { providerService } from '@agentctl/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { providerKeys } from '@/shared/lib/queryKeys';

export function BrowserAuthInteraction({
  providerId,
  request,
}: {
  providerId: string;
  request: { id: string; url: string; message: string };
}) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const respond = async (accepted: boolean) => {
    setBusy(true);
    try {
      await providerService.respondAuthInteraction(providerId, request.id, accepted);
      await queryClient.invalidateQueries({ queryKey: providerKeys.all });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not continue sign-in');
    } finally {
      setBusy(false);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(request.url);
      setOpened(true);
      toast.success('Sign-in link copied');
    } catch {
      toast.error('Could not copy sign-in link');
    }
  };
  return (
    <div className="border-border/40 space-y-3 rounded-xl border p-4 text-xs">
      <p>{request.message}</p>
      <div className="flex flex-wrap gap-3">
        <a
          href={request.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          className="text-accent underline"
        >
          Open sign-in page
        </a>
        <button type="button" disabled={busy} onClick={() => void copyLink()}>
          Copy link
        </button>
      </div>
      <p className="text-text-muted">
        Open or copy the link, then continue to let the agent proceed with sign-in.
      </p>
      <div className="flex gap-3">
        <button type="button" disabled={!opened || busy} onClick={() => void respond(true)}>
          Continue sign-in
        </button>
        <button type="button" disabled={busy} onClick={() => void respond(false)}>
          Decline
        </button>
      </div>
    </div>
  );
}
