import { execFile } from 'node:child_process';
import type { BrowserWindow } from 'electron';

export interface WindowControlFlags {
  minimize: boolean;
  maximize: boolean;
  close: boolean;
}

// Compositors that don't expose minimize/maximize to clients.
// Used only as a fallback when EWMH allowed-actions can't be read
// (pure Wayland, where Chromium itself falls back to XDG_CURRENT_DESKTOP).
const TILING_COMPOSITORS = ['niri', 'sway', 'hyprland', 'river', 'dwl'];

function isTilingCompositor(): boolean {
  const de = (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase();
  const session = (process.env.DESKTOP_SESSION ?? '').toLowerCase();
  return TILING_COMPOSITORS.some((c) => de.includes(c) || session.includes(c));
}

let cachedControls: WindowControlFlags | null = null;

// Reads _NET_WM_ALLOWED_ACTIONS (EWMH) for the window asynchronously.
export function getAllowedActionsAsync(win: BrowserWindow): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'linux') {
      resolve(null);
      return;
    }
    try {
      const handle = win.getNativeWindowHandle();
      const xid = handle.readUInt32LE(0);
      execFile(
        'xprop',
        ['-id', `0x${xid.toString(16)}`, '_NET_WM_ALLOWED_ACTIONS'],
        { timeout: 2000 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve(null);
            return;
          }
          const actions = new Set<string>();
          const re = /_NET_WM_ACTION_([A-Z_]+)/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(stdout)) !== null) {
            actions.add(m[1]);
          }
          resolve(actions);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

// Resolves which window-control buttons should be drawn, using async non-blocking calls.
export async function resolveWindowControls(win: BrowserWindow | null): Promise<WindowControlFlags> {
  if (process.platform === 'darwin') {
    return { minimize: false, maximize: false, close: false };
  }
  if (process.platform === 'win32') {
    return { minimize: true, maximize: true, close: true };
  }
  // Linux
  if (isTilingCompositor()) {
    return { minimize: false, maximize: false, close: false };
  }
  if (cachedControls) {
    return cachedControls;
  }
  if (!win) {
    return { minimize: true, maximize: true, close: true };
  }

  try {
    const actions = await getAllowedActionsAsync(win);
    if (actions) {
      cachedControls = {
        minimize: actions.has('MINIMIZE'),
        maximize: actions.has('MAXIMIZE_HORZ') || actions.has('MAXIMIZE_VERT'),
        close: actions.has('CLOSE'),
      };
      return cachedControls;
    }
  } catch {
    // Ignore and fall back
  }

  // EWMH unavailable (pure Wayland). Default to showing controls.
  return { minimize: true, maximize: true, close: true };
}
