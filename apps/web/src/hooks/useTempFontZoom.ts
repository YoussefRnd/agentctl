import { useEffect, useRef } from 'react';
import type { FontConfig } from '@agentctl/shared';

const SIZE_MIN = 8;
const SIZE_MAX = 72;
const DELTA_THRESHOLD = 50;
const INDICATOR_DURATION = 1500;

const LABELS: Record<keyof FontConfig, string> = {
  ui: 'UI',
  buffer: 'Buffer',
  terminal: 'Terminal',
  chat: 'Chat',
};

let hideTimerId: ReturnType<typeof setTimeout> | undefined;

function createIndicator() {
  let el = document.getElementById('font-zoom-indicator');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'font-zoom-indicator';
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%) translateY(0)',
    zIndex: '9999',
    borderRadius: '9999px',
    background: 'rgba(30,30,46,0.85)',
    border: '1px solid rgba(255,255,255,0.08)',
    padding: '6px 14px',
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
    fontSize: '11px',
    fontWeight: '800',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.85)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    pointerEvents: 'none',
    transition: 'opacity 0.15s ease, transform 0.15s ease',
    opacity: '0',
  });
  document.body.appendChild(el);
  return el;
}

function showIndicator(label: string, size: number) {
  const el = createIndicator();
  el.textContent = `${label} ${String(size)}px`;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(hideTimerId);
  hideTimerId = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-4px)';
  }, INDICATOR_DURATION);
}

export function useTempFontZoom(fontConfig: FontConfig | undefined) {
  const offsetsRef = useRef<Record<keyof FontConfig, number>>({
    ui: 0, buffer: 0, terminal: 0, chat: 0,
  });
  const accumulatedDelta = useRef(0);
  const rafId = useRef(0);

  useEffect(() => {
    if (!fontConfig) return;

    const offsets = offsetsRef.current;
    const pending = { context: null as keyof FontConfig | null, size: 0 };

    const flush = () => {
      rafId.current = 0;
      if (pending.context) {
        document.documentElement.style.setProperty(
           `--font-${pending.context}-size`,
           `${String(pending.size)}px`,
        );
        pending.context = null;
      }
    };

    const scheduleFontUpdate = (context: keyof FontConfig, size: number) => {
      pending.context = context;
      pending.size = size;
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(flush);
      }
    };

    const resetAll = () => {
      const keys = Object.keys(offsets) as (keyof FontConfig)[];
      for (const key of keys) {
        offsets[key] = 0;
        document.documentElement.style.setProperty(
          `--font-${key}-size`,
          `${String(fontConfig[key].size)}px`,
        );
      }
    };

    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const target = e.target as HTMLElement;
      let context: keyof FontConfig = 'ui';
      if (target.closest('[data-font-ctx="buffer"]')) context = 'buffer';
      else if (target.closest('[data-font-ctx="terminal"]')) context = 'terminal';
      else if (target.closest('[data-font-ctx="chat"]')) context = 'chat';

      let rawDelta = e.deltaY;
      if (e.deltaMode === 1) rawDelta *= 16;
      else if (e.deltaMode === 2) rawDelta *= 500;

      accumulatedDelta.current += rawDelta;
      if (Math.abs(accumulatedDelta.current) < DELTA_THRESHOLD) return;

      const direction = accumulatedDelta.current > 0 ? -1 : 1;
      accumulatedDelta.current = 0;

      const base = fontConfig[context].size;
      offsets[context] += direction;
      const newSize = Math.min(SIZE_MAX, Math.max(SIZE_MIN, base + offsets[context]));
      scheduleFontUpdate(context, newSize);
      showIndicator(LABELS[context], newSize);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        resetAll();
      }
    };

    document.addEventListener('wheel', handler, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('wheel', handler);
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(rafId.current);
      const el = document.getElementById('font-zoom-indicator');
      if (el) {
        clearTimeout(hideTimerId);
        el.remove();
      }
    };
  }, [fontConfig]);
}
