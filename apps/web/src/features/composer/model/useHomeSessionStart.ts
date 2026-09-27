import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  api,
  createProjectSession,
  uploadAttachment,
  type InitialSessionSettings,
} from '@agentctl/api-client';
import type { SessionMode, SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { useDraftStore } from './useDraftStore';

export interface HomeSessionSelection extends InitialSessionSettings {
  providerId: string;
  thinkingConfig?: { id: string; value: string };
  mode: SessionMode;
}

export function useHomeSessionStart(onStarted: (sessionId: string) => void) {
  const queryClient = useQueryClient();
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const [isStarting, setIsStarting] = useState(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startSession = useCallback(
    async (
      projectId: string,
      text: string,
      files: File[],
      selection: HomeSessionSelection,
    ): Promise<boolean> => {
      if (startingRef.current || (!text.trim() && files.length === 0)) return false;
      startingRef.current = true;
      setIsStarting(true);
      try {
        const store = useDraftStore.getState();
        let session = store.homeDrafts[projectId]?.session;
        const { providerId, mode, thinkingConfig, ...settings } = selection;
        if (!session) {
          session = await createProjectSession(projectId, mode, providerId, settings);
          store.updateHomeDraft(projectId, { session, uploadedFiles: [] });
          void queryClient.invalidateQueries({ queryKey: ['projects'] });
        } else if (
          session.selectedProvider !== providerId ||
          session.selectedModel !== settings.selectedModel ||
          (!thinkingConfig && session.selectedThinkingEffort !== settings.selectedThinkingEffort) ||
          session.approvalMode !== settings.approvalMode ||
          session.agentPersona !== (settings.agentPersona ?? null) ||
          session.mode !== mode
        ) {
          const updated = await api.patchSession({
            params: { id: session.id },
            body: {
              providerId,
              modelId: settings.selectedModel,
              thinkingEffort:
                thinkingConfig && session.selectedProvider === providerId
                  ? session.selectedThinkingEffort
                  : settings.selectedThinkingEffort,
              approvalMode: settings.approvalMode,
              persona: settings.agentPersona,
              mode,
            },
          });
          if (updated.status !== 200) throw new Error('Failed to apply draft settings');
          session = updated.body.session;
          store.updateHomeDraft(projectId, { session });
        }
        if (thinkingConfig) {
          const updated = await api.patchSession({
            params: { id: session.id },
            body: {
              providerId,
              modelId: session.selectedModel,
              thinkingEffort: session.selectedThinkingEffort,
              configId: thinkingConfig.id,
              configValue: thinkingConfig.value,
            },
          });
          if (updated.status !== 200) throw new Error('Failed to apply thinking effort');
          session = updated.body.session;
          store.updateHomeDraft(projectId, { session });
        }
        const attachmentIds: string[] = [];
        for (const file of files) {
          const uploaded = useDraftStore.getState().homeDrafts[projectId]?.uploadedFiles ?? [];
          let attachmentId = uploaded.find((item) => item.file === file)?.attachmentId;
          if (!attachmentId) {
            ({ attachmentId } = await uploadAttachment(session.id, file));
            store.updateHomeDraft(projectId, {
              uploadedFiles: [...uploaded, { file, attachmentId }],
            });
          }
          attachmentIds.push(attachmentId);
        }
        const response = await api.sendInput({
          params: { id: session.id },
          body: { input: text, ...(attachmentIds.length ? { attachmentIds } : {}) },
        });
        if (response.status !== 200) {
          const body = response.body;
          throw new Error(
            body &&
              typeof body === 'object' &&
              'message' in body &&
              typeof body.message === 'string'
              ? body.message
              : 'Session did not accept the message',
          );
        }
        queryClient.setQueryData<SessionWithCapabilities>(sessionKeys.detail(session.id), {
          session: { ...session, status: 'running' },
          capabilities: [],
        });
        queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(session.id), [
          {
            id: response.body.eventId,
            sessionId: session.id,
            type: 'text',
            data: { role: 'user', content: text, attachmentIds },
            createdAt: new Date(),
          },
        ]);
        store.clearHomeDraft(projectId);
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        if (mountedRef.current) onStarted(session.id);
        return true;
      } catch (err) {
        toast.error('Failed to start session', {
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      } finally {
        startingRef.current = false;
        if (mountedRef.current) setIsStarting(false);
      }
    },
    [onStarted, queryClient],
  );
  return { startSession, isStarting };
}
