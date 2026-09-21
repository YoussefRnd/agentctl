export { Workbench } from './ui/Workbench.js';
export {
  useWorkbenchStore,
  isTerminalTab,
  getTerminalTabId,
  type WorkbenchState,
  type WorkbenchTab,
} from './model/useWorkbenchStore.js';
export {
  useTerminalTabsStore,
  createInitialTerminalWorkspace,
  type TerminalTabData,
  type TerminalPaneData,
  type TerminalWorkspaceState,
  type TerminalTabsState,
} from './model/useTerminalTabsStore.js';
