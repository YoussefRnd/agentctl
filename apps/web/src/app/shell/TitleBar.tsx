import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PanelLeft } from 'lucide-react';
import { TitleBarWindowControls } from './TitleBarWindowControls';
import { UpdateIndicator } from './UpdateIndicator';
import { useUpdate } from '@/features/updates';
import { Tooltip } from '@agentctl/ui';
import { formatShortcut } from '@/shared/lib/platform';

interface TitleBarProps {
  nav: ReactNode;
  onToggleSidebar?: () => void;
}

export function TitleBar({ nav, onToggleSidebar }: TitleBarProps) {
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
    <div className="border-border/30 bg-surface-secondary/80 relative z-40 border-b backdrop-blur-xl">
      <div className="app-region-drag flex h-10 items-center justify-between gap-3 px-3">
        {isMac && <div className="w-[72px] shrink-0" />}

        {/* Left: Sidebar Toggle & Text Brand */}
        <div className="flex shrink-0 items-center gap-2">
          {onToggleSidebar && (
            <Tooltip content={`Toggle Sidebar (${formatShortcut('B')})`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="app-region-no-drag text-text-muted hover:text-text-main hover:bg-surface flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors active:scale-[0.97]"
                aria-label="Toggle Sidebar"
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}

          <Tooltip content="Workspaces">
            <Link
              to="/"
              className="app-region-no-drag text-text-muted hover:text-text-main hover:bg-surface flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-semibold tracking-tight transition-[color,background-color] duration-150 active:scale-[0.97]"
              aria-label="Agentctl Workspaces"
            >
              <div className="bg-accent/15 text-accent flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold">
                A
              </div>
              <span className="hidden text-[11.5px] font-bold tracking-tight md:inline">
                Agentctl
              </span>
            </Link>
          </Tooltip>
        </div>

        {/* Dynamic Center/Nav Region */}
        <div className="app-region-no-drag flex h-full min-w-0 flex-1 items-center justify-between">
          {nav}
        </div>

        <div className="app-region-no-drag flex items-center gap-2">
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
    </div>
  );
}
