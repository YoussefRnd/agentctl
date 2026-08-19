import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EDITORS, type EditorId } from '@agentctl/shared';

async function isCommandAvailable(cmd: string): Promise<boolean> {
  const envPath = process.env.PATH || '';
  const delimiter = os.platform() === 'win32' ? ';' : ':';
  const dirs = envPath.split(delimiter);
  const extensions = os.platform() === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of extensions) {
      const fullPath = path.join(dir, cmd + ext);
      try {
        await fs.access(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // continue search
      }
    }
  }
  return false;
}

let cachedEditors: EditorId[] | null = null;
let lastCheckTime = 0;

export async function detectAvailableEditors(): Promise<EditorId[]> {
  const now = Date.now();
  if (cachedEditors && now - lastCheckTime < 60_000) {
    return cachedEditors;
  }

  const available: EditorId[] = [];
  for (const editor of EDITORS) {
    if (!editor.commands) {
      available.push(editor.id);
      continue;
    }
    for (const cmd of editor.commands) {
      if (await isCommandAvailable(cmd)) {
        available.push(editor.id);
        break;
      }
    }
  }

  cachedEditors = available;
  lastCheckTime = now;
  return available;
}

export async function launchEditorProcess(
  editorId: string,
  targetPath: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const platform = os.platform();
    const editorDef = EDITORS.find((e) => e.id === editorId);

    let command = '';
    let args: string[] = [];

    if (editorDef?.commands) {
      command = editorDef.commands[0];
      const baseArgs =
        'baseArgs' in editorDef && Array.isArray(editorDef.baseArgs) ? editorDef.baseArgs : [];
      args = [...baseArgs, targetPath];
    } else if (editorId === 'file-manager') {
      if (platform === 'darwin') {
        command = 'open';
        args = [targetPath];
      } else if (platform === 'win32') {
        command = 'explorer.exe';
        args = [targetPath];
      } else {
        command = 'xdg-open';
        args = [targetPath];
      }
    } else if (editorId === 'terminal') {
      if (platform === 'darwin') {
        command = 'open';
        args = ['-a', 'Terminal', targetPath];
      } else if (platform === 'win32') {
        command = 'wt.exe';
        args = ['-d', targetPath];
      } else {
        command = 'x-terminal-emulator';
        args = ['-e', `bash -c "cd '${targetPath}' && exec bash"`];
      }
    } else {
      command = editorId;
      args = [targetPath];
    }

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        shell: platform === 'win32',
      });

      child.unref();

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      setTimeout(() => {
        resolve({ success: true });
      }, 100);
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
