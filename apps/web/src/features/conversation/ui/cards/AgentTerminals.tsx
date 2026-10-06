import { useMemo } from 'react';
import type { SessionEventRow } from '@agentctl/shared';
import { collectAgentTerminals } from '../../lib/agentTerminals';

export function AgentTerminals({ events }: { events: SessionEventRow[] }) {
  const terminals = useMemo(() => collectAgentTerminals(events), [events]);
  return (
    <>
      {terminals.map((terminal) => (
        <details key={terminal.id} className="border-border/40 rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-mono">
            {terminal.command || 'Agent terminal'}
            {terminal.exited ? ` · Exit ${terminal.code ?? 'unknown'}` : ''}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto break-words whitespace-pre-wrap">
            {terminal.output}
          </pre>
        </details>
      ))}
    </>
  );
}
