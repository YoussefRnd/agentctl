import { useEffect } from 'react';
import { FontZoomIndicator, FontConfigApplier, ShortcutsDialog } from './shell/index.js';
import {
  SettingsOverlays,
  useSettings,
  useSettingsOverlayStore,
} from '../features/settings/index.js';
import { CommandPalette, useCommandPaletteStore } from '../features/command-palette/index.js';
import { useShellStore } from './shell/index.js';
import { AppRouter } from './AppRouter.js';
import { useServerStateSync } from './useServerStateSync.js';

export function App() {
  useServerStateSync();
  const { settings } = useSettings();
  const toggleSettings = useSettingsOverlayStore((s) => s.toggleSettings);
  const toggleCommandPalette = useCommandPaletteStore((s) => s.toggle);
  const toggleShortcuts = useShellStore((s) => s.toggleShortcuts);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault();
        e.stopPropagation();
        toggleSettings();
      }
      if (isMod && (e.key === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        toggleCommandPalette();
      }
      if (isMod && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        e.stopPropagation();
        toggleShortcuts();
      }
      if (!isMod && e.key === '?') {
        const target = e.target as HTMLElement | null;
        const isInput =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.getAttribute('contenteditable') === 'true');
        if (!isInput) {
          e.preventDefault();
          e.stopPropagation();
          toggleShortcuts();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [toggleSettings, toggleCommandPalette, toggleShortcuts]);

  return (
    <>
      <CommandPalette />
      <ShortcutsDialog />
      <FontConfigApplier fontConfig={settings?.fontConfig} />
      <FontZoomIndicator />
      <SettingsOverlays />
      <AppRouter />
    </>
  );
}
