import { useState, useMemo } from 'react';
import { ChevronDown, ListChecks, Server } from 'lucide-react';
import { PlanPanel } from './PlanPanel';
import { McpStatusPanel } from './McpStatusPanel';
import { useSessionStream, useSession } from '../../../contexts/SessionContext';
import { useMcpServers } from '../../../hooks/useMcpServers';

export function StatusPane() {
  const [isPlanOpen, setIsPlanOpen] = useState(true);
  const [isMcpOpen, setIsMcpOpen] = useState(true);

  const { structuredPlan } = useSessionStream();
  const { sessionData } = useSession();
  const { mcpServers, isLoading: isLoadingMcp } = useMcpServers();

  const sessionPlan = sessionData?.session.plan;
  const plan = useMemo(() => {
    return structuredPlan.length > 0 ? structuredPlan : (sessionPlan ?? []);
  }, [structuredPlan, sessionPlan]);

  const completedSteps = useMemo(() => {
    return plan.filter((item) => item.status === 'completed' || item.isCompleted).length;
  }, [plan]);

  const activeMcpServers = useMemo(() => {
    return mcpServers.filter((server) => server.enabled && server.status === 'connected').length;
  }, [mcpServers]);

  const planBadgeText = useMemo(() => {
    if (plan.length === 0) return '0 steps';
    return `${String(completedSteps)}/${String(plan.length)} completed`;
  }, [completedSteps, plan.length]);

  const mcpBadgeText = useMemo(() => {
    if (isLoadingMcp) return 'Loading...';
    if (mcpServers.length === 0) return '0 servers';
    return `${String(activeMcpServers)}/${String(mcpServers.length)} active`;
  }, [isLoadingMcp, activeMcpServers, mcpServers.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {/* Accordion Card 1: Execution plan */}
        <div className="bg-surface-secondary/10 border-border/20 overflow-hidden rounded-xl border shadow-sm transition-all duration-200">
          <button
            type="button"
            onClick={() => {
              setIsPlanOpen((prev) => !prev);
            }}
            aria-expanded={isPlanOpen}
            className="hover:bg-surface-tertiary/20 flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors select-none"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <ChevronDown
                className={`text-text-muted h-4 w-4 shrink-0 transition-transform duration-200 ${
                  isPlanOpen ? 'rotate-0 transform' : '-rotate-90 transform'
                }`}
              />
              <ListChecks className="text-accent/80 h-4 w-4 shrink-0" />
              <span className="text-text-main text-xs font-semibold">Execution plan</span>
            </div>
            <span className="bg-surface-tertiary/50 border-border/20 text-text-muted ml-2 shrink-0 rounded-full border px-2 py-0.5 font-mono text-xs font-medium">
              {planBadgeText}
            </span>
          </button>

          {isPlanOpen && (
            <div className="border-border/10 border-t px-4 pt-1 pb-4">
              <PlanPanel plan={plan} />
            </div>
          )}
        </div>

        {/* Accordion Card 2: MCP servers */}
        <div className="bg-surface-secondary/10 border-border/20 overflow-hidden rounded-xl border shadow-sm transition-all duration-200">
          <button
            type="button"
            onClick={() => {
              setIsMcpOpen((prev) => !prev);
            }}
            aria-expanded={isMcpOpen}
            className="hover:bg-surface-tertiary/20 flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors select-none"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <ChevronDown
                className={`text-text-muted h-4 w-4 shrink-0 transition-transform duration-200 ${
                  isMcpOpen ? 'rotate-0 transform' : '-rotate-90 transform'
                }`}
              />
              <Server className="text-accent/80 h-4 w-4 shrink-0" />
              <span className="text-text-main text-xs font-semibold">MCP servers</span>
            </div>
            <span className="bg-surface-tertiary/50 border-border/20 text-text-muted ml-2 shrink-0 rounded-full border px-2 py-0.5 font-mono text-xs font-medium">
              {mcpBadgeText}
            </span>
          </button>

          {isMcpOpen && (
            <div className="border-border/10 border-t px-4 pt-1 pb-4">
              <McpStatusPanel servers={mcpServers} isLoading={isLoadingMcp} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
