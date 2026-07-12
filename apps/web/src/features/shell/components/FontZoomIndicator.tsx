import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { cn } from '@agentctl/ui';
import type { FontConfig } from '@agentctl/shared';
import { useTempFontZoom } from '../../../hooks/useTempFontZoom';
import { LABELS } from '../../../hooks/fontZoomLogic';

interface FontZoomIndicatorProps {
  fontConfig?: FontConfig;
}

export function FontZoomIndicator({ fontConfig }: FontZoomIndicatorProps) {
  const { context, size, visible } = useTempFontZoom(fontConfig);

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'liquid-glass pointer-events-none fixed top-16 left-1/2 z-[9999] flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 shadow-2xl',
        'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
        visible
          ? '-translate-x-1/2 translate-y-0 opacity-100'
          : '-translate-x-1/2 -translate-y-2 scale-95 opacity-0',
      )}
    >
      <Search className="size-[11px] text-[#cba6f7]" strokeWidth={2.5} aria-hidden="true" />
      <span className="text-[10px] font-bold tracking-[0.1em] text-white/45 uppercase">
        {LABELS[context]}
      </span>
      <span className="font-mono text-[11px] font-extrabold text-[#cba6f7]">{size}px</span>
    </div>,
    document.body,
  );
}
