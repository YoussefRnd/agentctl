import { useEffect } from 'react';
import type { FontConfig } from '@agentctl/shared';

interface FontConfigApplierProps {
  fontConfig?: FontConfig;
}

export function FontConfigApplier({ fontConfig }: FontConfigApplierProps) {
  useEffect(() => {
    if (!fontConfig) return;
    const fc = fontConfig;
    const root = document.documentElement;
    const props: [string, string][] = [
      ['--font-ui-family', fc.ui.family],
      ['--font-ui-size', `${String(fc.ui.size)}px`],
      ['--font-mono-family', fc.code.family],
      ['--font-mono-size', `${String(fc.code.size)}px`],
      // Monospace / Editor / Terminal aliases
      ['--font-buffer-family', fc.code.family],
      ['--font-buffer-size', `${String(fc.code.size)}px`],
      ['--font-terminal-family', fc.code.family],
      ['--font-terminal-size', `${String(fc.code.size)}px`],
      // Chat prose aliases
      ['--font-chat-family', fc.ui.family],
      ['--font-chat-size', `${String(fc.ui.size)}px`],
    ];
    for (const [prop, val] of props) {
      root.style.setProperty(prop, val);
    }
  }, [fontConfig]);

  return null;
}
