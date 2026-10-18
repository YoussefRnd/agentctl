import { expect, test, vi } from 'vite-plus/test';
import { handleBuiltinBash, handleTerminalCreate } from './terminals.js';
import { TerminalManager } from './terminal-manager.js';
import { noopLogger } from '../../logger.js';

test('releases a terminal if its creation event cannot be saved', async () => {
  const manager = new TerminalManager();
  vi.spyOn(manager, 'spawn').mockReturnValue('t');
  const release = vi.spyOn(manager, 'release');
  await expect(
    handleTerminalCreate({ command: 'unused' }, manager, '/tmp', noopLogger, async () => {
      throw new Error('storage failed');
    }),
  ).rejects.toThrow('storage failed');
  expect(release).toHaveBeenCalledWith('t');
});

test.each([false, true])(
  'releases a one-shot bash terminal when execution fails: %s',
  async (fails) => {
    const manager = new TerminalManager();
    vi.spyOn(manager, 'spawn').mockReturnValue('t');
    vi.spyOn(manager, 'wait').mockImplementation(async () => {
      if (fails) throw new Error('execution failed');
      return { exitCode: 0, signal: null };
    });
    const release = vi.spyOn(manager, 'release');
    const pending = handleBuiltinBash({ command: 'unused' }, manager, '/tmp', noopLogger);
    if (fails) await expect(pending).rejects.toThrow('execution failed');
    else await expect(pending).resolves.toEqual({ output: '', exitCode: 0 });
    expect(release).toHaveBeenCalledWith('t');
  },
);
