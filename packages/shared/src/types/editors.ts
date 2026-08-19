export type EditorLaunchStyle = 'direct-path' | 'goto' | 'line-column';

export interface EditorDefinition {
  readonly id: string;
  readonly label: string;
  readonly commands: readonly [string, ...string[]] | null;
  readonly baseArgs?: readonly string[];
  readonly launchStyle: EditorLaunchStyle;
  readonly badge?: string;
}

export const EDITORS = [
  { id: 'cursor', label: 'Cursor', commands: ['cursor'], launchStyle: 'goto', badge: 'cursor' },
  { id: 'trae', label: 'Trae', commands: ['trae'], launchStyle: 'goto', badge: 'trae' },
  {
    id: 'kiro',
    label: 'Kiro',
    commands: ['kiro'],
    baseArgs: ['ide'],
    launchStyle: 'goto',
    badge: 'kiro',
  },
  { id: 'vscode', label: 'VS Code', commands: ['code'], launchStyle: 'goto', badge: 'code' },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    commands: ['code-insiders'],
    launchStyle: 'goto',
    badge: 'insiders',
  },
  { id: 'vscodium', label: 'VSCodium', commands: ['codium'], launchStyle: 'goto', badge: 'codium' },
  {
    id: 'zed',
    label: 'Zed',
    commands: ['zed', 'zeditor'],
    launchStyle: 'direct-path',
    badge: 'zed',
  },
  { id: 'antigravity', label: 'Antigravity', commands: ['agy'], launchStyle: 'goto', badge: 'agy' },
  { id: 'sublime', label: 'Sublime Text', commands: ['subl'], launchStyle: 'goto', badge: 'subl' },
  {
    id: 'idea',
    label: 'IntelliJ IDEA',
    commands: ['idea'],
    launchStyle: 'line-column',
    badge: 'idea',
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    commands: ['webstorm'],
    launchStyle: 'line-column',
    badge: 'webstorm',
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    commands: ['pycharm'],
    launchStyle: 'line-column',
    badge: 'pycharm',
  },
  {
    id: 'goland',
    label: 'GoLand',
    commands: ['goland'],
    launchStyle: 'line-column',
    badge: 'goland',
  },
  {
    id: 'rustrover',
    label: 'RustRover',
    commands: ['rustrover'],
    launchStyle: 'line-column',
    badge: 'rustrover',
  },
  { id: 'clion', label: 'CLion', commands: ['clion'], launchStyle: 'line-column', badge: 'clion' },
  { id: 'rider', label: 'Rider', commands: ['rider'], launchStyle: 'line-column', badge: 'rider' },
  {
    id: 'phpstorm',
    label: 'PhpStorm',
    commands: ['phpstorm'],
    launchStyle: 'line-column',
    badge: 'phpstorm',
  },
  {
    id: 'datagrip',
    label: 'DataGrip',
    commands: ['datagrip'],
    launchStyle: 'line-column',
    badge: 'datagrip',
  },
  {
    id: 'dataspell',
    label: 'DataSpell',
    commands: ['dataspell'],
    launchStyle: 'line-column',
    badge: 'dataspell',
  },
  {
    id: 'rubymine',
    label: 'RubyMine',
    commands: ['rubymine'],
    launchStyle: 'line-column',
    badge: 'rubymine',
  },
  { id: 'aqua', label: 'Aqua', commands: ['aqua'], launchStyle: 'line-column', badge: 'aqua' },
  { id: 'file-manager', label: 'File Manager', commands: null, launchStyle: 'direct-path' },
  { id: 'terminal', label: 'Terminal', commands: null, launchStyle: 'direct-path' },
] as const satisfies readonly EditorDefinition[];

export type EditorId = (typeof EDITORS)[number]['id'];
