/**
 * Platform helper for OS-aware modifier keys and shortcuts.
 */
export const isMac =
  typeof navigator !== 'undefined' &&
  (/Macintosh|Mac OS X|MacPPC|MacIntel/i.test(navigator.userAgent) ||
    (typeof navigator.platform === 'string' && navigator.platform.startsWith('Mac')));

export const MODIFIER_KEY = isMac ? '⌘' : 'Ctrl';

export function formatShortcut(key: string, modifier = MODIFIER_KEY): string {
  if (isMac) {
    return `${modifier}${key}`;
  }
  return `${modifier}+${key}`;
}
