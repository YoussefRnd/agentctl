import { afterEach, expect, it, vi } from 'vite-plus/test';
import { apiClient } from '../api-client.js';
import { fetchSessionEventDetail } from './session-history.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const event = {
  id: 3,
  sessionId,
  createdAt: new Date(),
  type: 'tool_call',
  data: { name: 'read', rawOutput: 'full' },
};
afterEach(() => vi.restoreAllMocks());
it('loads validated full details with cancellation and rejects cross-session or compact responses', async () => {
  const fetch = vi.spyOn(apiClient, 'fetch');
  const signal = new AbortController().signal;
  fetch.mockResolvedValue({ event, revision: 'a'.repeat(64) });
  expect(await fetchSessionEventDetail(sessionId, 3, signal)).toEqual(event);
  expect(fetch).toHaveBeenCalledWith(`/api/sessions/${sessionId}/events/3/detail`, { signal });
  for (const invalid of [
    { ...event, sessionId: '22222222-2222-4222-8222-222222222222' },
    { ...event, id: 4 },
    { ...event, details: { revision: 'a'.repeat(64) } },
  ]) {
    fetch.mockResolvedValue({ event: invalid, revision: 'a'.repeat(64) });
    await expect(fetchSessionEventDetail(sessionId, 3)).rejects.toThrow(
      'Invalid event detail response',
    );
  }
});
