import { PlanPanel } from './PlanPanel';
import { McpStatusPanel } from './McpStatusPanel';

export function StatusPane() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="custom-scrollbar flex-1 overflow-y-auto p-5">
        <PlanPanel />
        <McpStatusPanel />
      </div>
    </div>
  );
}
