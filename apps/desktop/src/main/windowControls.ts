import type { BrowserWindow } from 'electron';

export interface WindowControlFlags {
  minimize: boolean;
  maximize: boolean;
  close: boolean;
}

// Compositors that don't expose minimize/maximize controls.
const TILING_COMPOSITORS = ['niri', 'sway', 'hyprland', 'river', 'dwl'];

function isTilingCompositor(): boolean {
  const de = (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase();
  const session = (process.env.DESKTOP_SESSION ?? '').toLowerCase();
  return TILING_COMPOSITORS.some((c) => de.includes(c) || session.includes(c));
}

// Resolves which window-control buttons should be drawn using native Electron window capabilities.
export function resolveWindowControls(win: BrowserWindow | null): WindowControlFlags {
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
  if (win) {
    return {
      minimize: win.isMinimizable(),
      maximize: win.isMaximizable(),
      close: win.isClosable(),
    };
  }

  return { minimize: true, maximize: true, close: true };
}
