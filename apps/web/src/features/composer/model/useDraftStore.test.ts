import { beforeEach, expect, it } from 'vitest';
import { useDraftStore } from './useDraftStore';

beforeEach(() => {
  localStorage.clear();
  useDraftStore.setState({ homeDrafts: {}, sessionDrafts: {} });
});

it('restores text and project selections without serializing browser files', async () => {
  useDraftStore.getState().setSessionDraft('session-1', 'unfinished prompt');
  useDraftStore.getState().updateHomeDraft('project-1', {
    providerId: 'agent',
    selectedModel: 'model',
    mode: 'worktree',
    files: [new File(['contents'], 'note.txt')],
    contexts: [],
  });
  const saved = localStorage.getItem('agentctl-composer-drafts')!;
  expect(saved).not.toContain('contents');
  useDraftStore.setState({ homeDrafts: {}, sessionDrafts: {} });
  localStorage.setItem('agentctl-composer-drafts', saved);
  await useDraftStore.persist.rehydrate();
  expect(useDraftStore.getState().sessionDrafts['session-1']).toBe('unfinished prompt');
  expect(useDraftStore.getState().homeDrafts['project-1']).toMatchObject({
    providerId: 'agent',
    selectedModel: 'model',
    mode: 'worktree',
    files: [],
  });
});

it('tolerates corrupted persisted JSON', async () => {
  localStorage.setItem('agentctl-composer-drafts', 'broken json');
  await useDraftStore.persist.rehydrate();
  useDraftStore.getState().setSessionDraft('session-1', 'still works');
  expect(useDraftStore.getState().sessionDrafts['session-1']).toBe('still works');
});
