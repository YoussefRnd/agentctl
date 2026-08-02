import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FilePlus,
  Settings,
  Code2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minus,
  X,
  ExternalLink,
  BookOpen,
  Info,
  Eye,
  EyeOff,
  Menu as MenuIcon,
  type LucideIcon,
} from 'lucide-react';
import { Dropdown } from '@agentctl/ui';
import { requestFontZoom, requestFontZoomReset } from '../../../hooks/useFontZoom';
import type { UpdateState } from '../../../electron';

interface AppMenuProps {
  controlsVisible: boolean;
  onToggleControls: () => void;
  update: UpdateState;
  onUpdateInstall: () => void;
  onCheckUpdates: () => void;
}

const GITHUB = 'https://github.com/YoussefRnd/agentctl';

function Item({
  icon: Icon,
  children,
  onSelect,
  shortcut,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onSelect?: () => void;
  shortcut?: string;
}) {
  return (
    <Dropdown.Item onSelect={onSelect} className="justify-between gap-6">
      <span className="flex items-center">
        {Icon && <Icon className="text-text-muted mr-2 h-3.5 w-3.5" />}
        {children}
      </span>
      {shortcut && <span className="text-text-muted/60 text-[10px]">{shortcut}</span>}
    </Dropdown.Item>
  );
}

function SubMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <span>{label}</span>
        <span className="text-text-muted/60 ml-4">›</span>
      </Dropdown.SubTrigger>
      <Dropdown.Portal>
        <Dropdown.SubContent>{children}</Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  );
}

export function AppMenu({
  controlsVisible,
  onToggleControls,
  update,
  onUpdateInstall,
  onCheckUpdates,
}: AppMenuProps) {
  const navigate = useNavigate();
  const win = typeof window !== 'undefined' ? window.electronAPI?.win : undefined;
  const edit = typeof window !== 'undefined' ? window.electronAPI?.edit : undefined;

  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
  const mod = isMac ? '⌘' : 'Ctrl+';
  const shiftMod = isMac ? '⇧' : 'Shift+';

  const updatable =
    update.status === 'available' ||
    update.status === 'downloading' ||
    update.status === 'downloaded';
  const updateVersion = 'version' in update ? update.version : '';
  const updatePercent = update.status === 'downloading' ? update.percent : 0;

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label="Menu"
          className="app-region-no-drag text-text-muted hover:text-text-main flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/5"
        >
          <MenuIcon className="h-4 w-4" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" side="bottom" className="min-w-[200px]">
          <SubMenu label="File">
            <Item
              icon={FilePlus}
              onSelect={() => {
                void navigate('/');
              }}
            >
              New Session
            </Item>
            <Item
              icon={Settings}
              onSelect={() => {
                void navigate('/settings');
              }}
            >
              Preferences
            </Item>
            <Dropdown.Separator />
            <Item icon={X} onSelect={() => win?.close()}>
              Close Window
            </Item>
            <Item icon={X} onSelect={() => win?.quit()}>
              Quit AgentCtl
            </Item>
          </SubMenu>

          <SubMenu label="Edit">
            <Item shortcut={`${mod}Z`} onSelect={() => edit?.undo()}>
              Undo
            </Item>
            <Item shortcut={`${mod}${shiftMod}Z`} onSelect={() => edit?.redo()}>
              Redo
            </Item>
            <Dropdown.Separator />
            <Item shortcut={`${mod}X`} onSelect={() => edit?.cut()}>
              Cut
            </Item>
            <Item shortcut={`${mod}C`} onSelect={() => edit?.copy()}>
              Copy
            </Item>
            <Item shortcut={`${mod}V`} onSelect={() => edit?.paste()}>
              Paste
            </Item>
            <Dropdown.Separator />
            <Item shortcut={`${mod}A`} onSelect={() => edit?.selectAll()}>
              Select All
            </Item>
          </SubMenu>

          <SubMenu label="View">
            <Item icon={RefreshCw} onSelect={() => win?.reload()}>
              Reload
            </Item>
            <Item icon={Code2} onSelect={() => win?.toggleDevTools()}>
              Toggle Developer Tools
            </Item>
            <Dropdown.Separator />
            <Item
              icon={ZoomIn}
              shortcut={`${mod}=`}
              onSelect={() => {
                requestFontZoom(1);
              }}
            >
              Zoom In
            </Item>
            <Item
              icon={ZoomOut}
              shortcut={`${mod}-`}
              onSelect={() => {
                requestFontZoom(-1);
              }}
            >
              Zoom Out
            </Item>
            <Item onSelect={requestFontZoomReset}>Reset Zoom</Item>
            <Dropdown.Separator />
            <Item icon={Maximize} onSelect={() => win?.toggleFullscreen()}>
              Toggle Full Screen
            </Item>
            <Dropdown.Separator />
            <Item icon={controlsVisible ? EyeOff : Eye} onSelect={onToggleControls}>
              {controlsVisible ? 'Hide Window Controls' : 'Show Window Controls'}
            </Item>
          </SubMenu>

          <SubMenu label="Window">
            <Item icon={Minus} onSelect={() => win?.minimize()}>
              Minimize
            </Item>
            <Item icon={Maximize} onSelect={() => win?.maximize()}>
              Maximize
            </Item>
            <Item icon={X} onSelect={() => win?.close()}>
              Close
            </Item>
          </SubMenu>

          <SubMenu label="Help">
            <Item icon={RefreshCw} onSelect={onCheckUpdates}>
              Check for Updates
            </Item>
            {updatable && (
              <>
                <Dropdown.Separator />
                <Item
                  onSelect={() => {
                    if (update.status === 'downloaded') onUpdateInstall();
                  }}
                >
                  {update.status === 'downloaded'
                    ? `Update & Restart (v${updateVersion})`
                    : update.status === 'downloading'
                      ? `Downloading… ${Math.round(updatePercent).toString()}%`
                      : `Update to v${updateVersion}`}
                </Item>
              </>
            )}
            <Dropdown.Separator />
            <Item icon={ExternalLink} onSelect={() => win?.openExternal(GITHUB)}>
              GitHub Repository
            </Item>
            <Item icon={BookOpen} onSelect={() => win?.openExternal(`${GITHUB}#readme`)}>
              Documentation
            </Item>
            <Item icon={Info} onSelect={() => win?.openExternal(`${GITHUB}/releases`)}>
              About
            </Item>
          </SubMenu>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
