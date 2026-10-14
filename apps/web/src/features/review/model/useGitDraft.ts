import { useEffect, useRef, useState } from 'react';
import { generateGitDraft } from '@agentctl/api-client';

type Request = Parameters<typeof generateGitDraft>[1];

/** Ignore late responses after closing, retargeting, or editing a draft. */
export function useGitDraft(sessionId: string, open: boolean, request: Request, value: string) {
  const requestIdentity = JSON.stringify(request);
  const identity = JSON.stringify({ sessionId, open, request, value });
  const latest = useRef(identity);
  latest.current = identity;
  const epoch = useRef(0);
  const pending = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    epoch.current++;
    // Invalidate the response, but keep the request locked until it settles.
    // Changing scope or reopening a dialog cannot cancel an ACP request.
    setError(null);
  }, [sessionId, open, requestIdentity]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );

  const generate = async () => {
    if (!sessionId || !open || pending.current) return null;
    const currentEpoch = ++epoch.current;
    const startIdentity = identity;
    pending.current = true;
    setIsGenerating(true);
    setError(null);
    try {
      const draft = await generateGitDraft(sessionId, request);
      if (currentEpoch !== epoch.current) return null;
      if (latest.current !== startIdentity) {
        setError('Your draft or selection changed. Generate again to use the latest changes.');
        return null;
      }
      return draft;
    } catch (err) {
      if (currentEpoch === epoch.current)
        setError(
          err instanceof Error
            ? err.message
            : 'Could not generate a draft. Write it manually or try again.',
        );
      return null;
    } finally {
      pending.current = false;
      setIsGenerating(false);
    }
  };
  return { generate, isGenerating, error };
}

export const formatGeneratedCommit = (draft: { title: string; body: string }) =>
  draft.body ? `${draft.title}\n\n${draft.body}` : draft.title;
