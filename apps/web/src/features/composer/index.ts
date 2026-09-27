export { CommandBar } from './ui/CommandBar.js';
export { CommandBarToolbar } from './ui/CommandBarToolbar.js';
export { AttachmentStrip } from './ui/AttachmentStrip.js';
export { useCommandBarState } from './model/useCommandBarState.js';
export { useDraftStore, type DraftState } from './model/useDraftStore.js';

export { DraftCommandBar } from './ui/DraftCommandBar.js';
export { useHomeSessionStart } from './model/useHomeSessionStart.js';
export type { HomeSessionSelection } from './model/useHomeSessionStart.js';

export type ComposerState = ReturnType<
  typeof import('./model/useComposerState.js').useComposerState
>;
