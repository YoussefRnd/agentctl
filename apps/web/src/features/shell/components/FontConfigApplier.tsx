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
      ['--font-buffer-family', fc.buffer.family],
      ['--font-buffer-size', `${String(fc.buffer.size)}px`],
      ['--font-terminal-family', fc.terminal.family],
      ['--font-terminal-size', `${String(fc.terminal.size)}px`],
      ['--font-chat-family', fc.chat.family],
      ['--font-chat-size', `${String(fc.chat.size)}px`],
    ];
    for (const [prop, val] of props) {
      root.style.setProperty(prop, val);
    }
  }, [fontConfig]);

  return null;
}
