import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

/** SQLite owns the OS lock: a crashed process cannot leave a stale lock flag. */
export async function withCacheWriterLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const lockPath = `${file}.writer-lock.sqlite`;
  const handle = await fs.open(lockPath, 'a', 0o600);
  await handle.close();
  let coordinator: DatabaseSync | undefined;
  let acquired = false;
  const deadline = Date.now() + 250;
  try {
    while (!acquired) {
      try {
        coordinator ??= new DatabaseSync(lockPath);
        coordinator.exec('BEGIN IMMEDIATE');
        acquired = true;
      } catch (error) {
        const code = (error as { errcode?: number }).errcode;
        if (typeof code !== 'number' || ![5, 6].includes(code & 0xff) || Date.now() >= deadline)
          throw error;
        // Do not block the event loop while another process owns the write lock.
        await delay(10);
      }
    }
    const result = await work();
    coordinator!.exec('COMMIT');
    acquired = false;
    return result;
  } finally {
    try {
      if (acquired) coordinator?.exec('ROLLBACK');
    } finally {
      coordinator?.close();
    }
    // Keep the coordination file: unlinking an open SQLite file could split ownership
    // across different inodes. Presence of this file does not mean a writer is active.
  }
}
