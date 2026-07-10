import { type ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Settings, ExternalLink, Info, RefreshCw, Code2, Power, Menu as MenuIcon } from 'lucide-react';
import { Dropdown } from '@agentctl/ui';
import { TitleBarWindowControls } from './TitleBarWindowControls';

interface TitleBarProps {
  nav: ReactNode;
}

export function TitleBar({ nav }: TitleBarProps) {
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
  const hasWinApi = typeof window !== 'undefined' && !!window.electronAPI?.win;

  const [isMaximized, setIsMaximized] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasWinApi || !window.electronAPI?.win) return;
    void window.electronAPI.win.isMaximized().then(setIsMaximized);
    const unsubscribe = window.electronAPI.win.onMaximizeChange(setIsMaximized);
    return unsubscribe;
  }, [hasWinApi]);

  const showWindowControls = hasWinApi && !isMac;

  return (
    <div className="relative z-40 border-border/50 border-b bg-background/50 backdrop-blur-xl">
      <div className="app-region-drag flex h-14 items-center gap-3 px-3">
        {isMac && <div className="w-[72px] shrink-0" />}

        <div className="hidden w-[180px] shrink-0 items-center lg:flex">
          <Link
            to="/"
            className="app-region-no-drag text-text-main font-sans text-[12px] font-black tracking-[0.4em] uppercase transition-opacity hover:opacity-80"
          >
            AGENTCTL
          </Link>
        </div>
        <div className="flex shrink-0 items-center pl-2 lg:hidden">
          <Link
            to="/"
            className="app-region-no-drag text-text-main font-sans text-[12px] font-black tracking-[0.4em] uppercase transition-opacity hover:opacity-80"
          >
            AGENTCTL
          </Link>
        </div>

        <div className="app-region-no-drag flex h-full min-w-0 flex-1 items-center">{nav}</div>

        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label="Menu"
              className="app-region-no-drag text-text-muted hover:bg-white/5 hover:text-text-main flex h-8 w-8 items-center justify-center rounded-md transition-colors"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" side="bottom" className="min-w-[180px]">
              <Dropdown.Item onSelect={() => { void navigate('/settings'); }}>
                <Settings className="text-text-muted mr-2 h-3.5 w-3.5" />
                Settings
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => window.electronAPI?.win.toggleDevTools()}>
                <Code2 className="text-text-muted mr-2 h-3.5 w-3.5" />
                Toggle DevTools
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => window.electronAPI?.win.reload()}>
                <RefreshCw className="text-text-muted mr-2 h-3.5 w-3.5" />
                Reload
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => window.electronAPI?.win.openExternal('https://github.com/YoussefRnd/agentctl')}>
                <ExternalLink className="text-text-muted mr-2 h-3.5 w-3.5" />
                GitHub
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => window.electronAPI?.win.openExternal('https://github.com/YoussefRnd/agentctl/releases')}>
                <Info className="text-text-muted mr-2 h-3.5 w-3.5" />
                About
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => window.electronAPI?.win.close()}>
                <Power className="text-text-muted mr-2 h-3.5 w-3.5" />
                Quit
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {showWindowControls && window.electronAPI?.win && (
          <TitleBarWindowControls
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
