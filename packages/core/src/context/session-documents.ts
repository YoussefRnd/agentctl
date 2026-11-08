import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

function contextDirectory(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error('Invalid context session ID');
  return path.resolve(
    process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl'),
    'context',
    sessionId,
  );
}

function assertPrivateDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid context directory');
}

export async function persistContextDocument(sessionId: string, content: string): Promise<string> {
  const directory = contextDirectory(sessionId);
  const root = path.dirname(directory);
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(root);
  await fs.promises.mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  assertPrivateDirectory(directory);
  await fs.promises.chmod(root, 0o700);
  await fs.promises.chmod(directory, 0o700);
  const digest = createHash('sha256').update(content).digest('hex');
  const filePath = path.join(directory, `${digest}.md`);
  const temporary = path.join(directory, `.${digest}-${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    // Publish only a complete document; a crash must not leave a partial history at its final path.
    try {
      await fs.promises.link(temporary, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (
        fs.lstatSync(filePath).isSymbolicLink() ||
        (await fs.promises.readFile(filePath, 'utf8')) !== content
      )
        throw new Error('Saved context document does not match its contents');
    }
    await fs.promises.chmod(filePath, 0o600);
    return filePath;
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

export async function removeSessionContextFiles(sessionId: string): Promise<void> {
  const directory = contextDirectory(sessionId);
  if (fs.existsSync(path.dirname(directory))) assertPrivateDirectory(path.dirname(directory));
  await fs.promises.rm(directory, { recursive: true, force: true });
}

function isSavedContextFile(sessionId: string, requestedPath: string): boolean {
  try {
    const directory = contextDirectory(sessionId);
    if (
      path.dirname(requestedPath) !== directory ||
      !/^[a-f0-9]{64}\.md$/.test(path.basename(requestedPath))
    )
      return false;
    assertPrivateDirectory(path.dirname(directory));
    assertPrivateDirectory(directory);
    const stat = fs.lstatSync(requestedPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolveSessionContextDocument(
  sessionId: string | undefined,
  absolutePath: string,
): string | undefined {
  const filePath = path.resolve(absolutePath);
  return sessionId && isSavedContextFile(sessionId, filePath)
    ? fs.realpathSync(filePath)
    : undefined;
}
