import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TitleBarWindowControls } from './TitleBarWindowControls';
import { UpdateIndicator } from './UpdateIndicator';
import { useUpdate } from '../hooks/useUpdate';

interface TitleBarProps {
  nav: ReactNode;
}

export function TitleBar({ nav }: TitleBarProps) {
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
  const hasWinApi = typeof window !== 'undefined' && !!window.electronAPI?.win;

  const [isMaximized, setIsMaximized] = useState(false);
  const [controls, setControls] = useState<{
    minimize: boolean;
    maximize: boolean;
    close: boolean;
  } | null>(null);
  const [controlsPref] = useState<'auto' | 'show' | 'hide'>(
    () =>
      (typeof window !== 'undefined'
        ? (localStorage.getItem('agentctl:windowControls') as 'auto' | 'show' | 'hide' | null)
        : null) ?? 'auto',
  );

  useEffect(() => {
    if (!hasWinApi || !window.electronAPI?.win) return;
    void window.electronAPI.win.isMaximized().then(setIsMaximized);
    const unsubscribe = window.electronAPI.win.onMaximizeChange(setIsMaximized);
    return unsubscribe;
  }, [hasWinApi]);

  useEffect(() => {
    if (!window.electronAPI?.getWindowControls) return;
    void window.electronAPI
      .getWindowControls()
      .then(setControls)
      .catch(() => undefined);
  }, []);

  const wmAllows = !!controls && (controls.minimize || controls.maximize || controls.close);
  const effectiveControls =
    controlsPref === 'show'
      ? { minimize: true, maximize: true, close: true }
      : (controls ?? { minimize: false, maximize: false, close: false });
  const showWindowControls =
    !isMac && controlsPref !== 'hide' && (controlsPref === 'show' || wmAllows);

  const { state: update, install: installUpdate } = useUpdate();

  return (
    <div className="border-border/40 bg-background/80 relative z-40 border-b backdrop-blur-xl">
      <div className="app-region-drag flex h-11 items-center gap-4 px-3">
        {isMac && <div className="w-[72px] shrink-0" />}

        {/* Brand Anchor */}
        <div className="flex shrink-0 items-center">
          <Link
            to="/"
            className="app-region-no-drag text-text-main flex items-center gap-2 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            <span className="text-brand-mauve font-mono text-[14px]">✦</span>
            <span>agentctl</span>
          </Link>
        </div>

        {/* Dynamic Center/Nav Region */}
        <div className="app-region-no-drag flex h-full min-w-0 flex-1 items-center">{nav}</div>

        {update.status !== 'idle' && <UpdateIndicator state={update} onInstall={installUpdate} />}

        {showWindowControls && window.electronAPI?.win && (
          <TitleBarWindowControls
            controls={effectiveControls}
            isMaximized={isMaximized}
            onMinimize={() => window.electronAPI?.win.minimize()}
            onMaximize={() => window.electronAPI?.win.maximize()}
            onClose={() => window.electronAPI?.win.close()}
          />
        )}
      </div>
    </div>
  );
}
