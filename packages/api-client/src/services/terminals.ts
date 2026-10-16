import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';

export async function sendTerminalInput(
  sessionId: string,
  terminalId: string,
  data: string,
): Promise<{ success: boolean }> {
  const res = await api.sendTerminalInput({
    params: { id: sessionId, terminalId },
    body: { data },
  });
  assertApiStatus(res, 200, 'Failed to send terminal input');
  return res.body;
}
