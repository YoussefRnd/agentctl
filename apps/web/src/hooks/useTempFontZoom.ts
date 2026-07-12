import { useEffect, useMemo, useRef, useState } from 'react';
import type { FontConfig } from '@agentctl/shared';
import {
  DELTA_THRESHOLD,
  ALL_CONTEXT_KEYS,
  createEmptyOffsets,
  normalizeDelta,
  consumeDeltaSteps,
  applySteps,
  resolveContextKey,
  type FontContextKey,
  type Offsets,
} from './fontZoomLogic';

const INDICATOR_DURATION = 1500;

type Sizes = Record<FontContextKey, number>;

export interface ZoomIndicatorState {
  context: FontContextKey;
  size: number;
  visible: boolean;
}

const HIDDEN_INDICATOR: ZoomIndicatorState = { context: 'ui', size: 0, visible: false };

/**
 * Ctrl/Cmd + wheel temporary font zoom. Applies per-context size offsets on top
 * of the persisted base sizes by writing `--font-<ctx>-size` CSS variables.
 *
 * CSS variable writes are RAF-batched (imperative, off the React render path)
 * for smoothness. Only the on-screen indicator is driven by React state, so
 * rendering it stays idiomatic (lucide icon, theme classes) without re-rendering
 * on every wheel frame.
 */
export function useTempFontZoom(fontConfig: FontConfig | undefined): ZoomIndicatorState {
  const offsetsRef = useRef<Offsets>(createEmptyOffsets());
  const [indicator, setIndicator] = useState<ZoomIndicatorState>(HIDDEN_INDICATOR);

  const sizes = useMemo<Sizes | null>(() => {
    if (!fontConfig) return null;
    return {
      ui: fontConfig.ui.size,
      buffer: fontConfig.buffer.size,
      terminal: fontConfig.terminal.size,
      chat: fontConfig.chat.size,
    };
  }, [fontConfig]);

  useEffect(() => {
    if (!sizes) return;

    const offsets = offsetsRef.current;
    let hideTimerId: ReturnType<typeof setTimeout> | undefined;
    let rafId = 0;
    let accumulatedDelta = 0;
    const pending = new Map<FontContextKey, number>();

    const writeSize = (context: FontContextKey, size: number) => {
      document.documentElement.style.setProperty(`--font-${context}-size`, `${String(size)}px`);
    };

    const flush = () => {
      rafId = 0;
      for (const [context, size] of pending) writeSize(context, size);
      pending.clear();
    };

    const scheduleFlush = () => {
      if (!rafId) rafId = requestAnimationFrame(flush);
    };

    const applyAll = () => {
      for (const key of ALL_CONTEXT_KEYS) {
        const { offset, size } = applySteps(0, sizes[key], offsets[key]);
        offsets[key] = offset;
        writeSize(key, size);
      }
    };

    const showIndicator = (context: FontContextKey, size: number) => {
      setIndicator({ context, size, visible: true });
      clearTimeout(hideTimerId);
      hideTimerId = setTimeout(() => {
        setIndicator((prev) => ({ ...prev, visible: false }));
      }, INDICATOR_DURATION);
    };

    const resetAll = () => {
      for (const key of ALL_CONTEXT_KEYS) {
        offsets[key] = 0;
        writeSize(key, sizes[key]);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;

      const context =
        resolveContextKey(
          e.target instanceof Element
            ? e.target.closest<HTMLElement>('[data-font-ctx]')?.dataset.fontCtx
            : undefined,
        ) ?? 'ui';

      e.preventDefault();

      accumulatedDelta += normalizeDelta(e.deltaY, e.deltaMode);
      const { steps, remainder } = consumeDeltaSteps(accumulatedDelta, DELTA_THRESHOLD);
      accumulatedDelta = remainder;
      if (steps === 0) return;

      const growSteps = -steps;
      const { offset, size } = applySteps(growSteps, sizes[context], offsets[context]);
      offsets[context] = offset;
      pending.set(context, size);
      scheduleFlush();
      showIndicator(context, size);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        resetAll();
      }
    };

    applyAll();

    document.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(hideTimerId);
    };
  }, [sizes]);

  return indicator;
}
