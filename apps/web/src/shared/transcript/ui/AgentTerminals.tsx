import { useMemo, useState } from 'react';
import type { SessionEventRow } from '@agentctl/shared';
import { collectAgentTerminals, terminalDetailEvents } from '../lib/agentTerminals';
import { EventDetailGroup } from './EventDetailContent';

function TerminalView({ id, events }: { id: string; events: SessionEventRow[] }) {
  const [open, setOpen] = useState(false);
  const terminal = collectAgentTerminals(events).find((item) => item.id === id)!;
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-border/40 rounded-lg border p-3 text-xs"
    >
      <summary className="cursor-pointer font-mono">
        {terminal.command || 'Agent terminal'}
        {terminal.exited ? ` · Exit ${terminal.code ?? 'unknown'}` : ''}
      </summary>
      {open && (
        <EventDetailGroup events={terminalDetailEvents(events)}>
          {(full) => (
            <pre className="mt-2 max-h-64 overflow-auto break-words whitespace-pre-wrap">
              {collectAgentTerminals(full).find((item) => item.id === id)?.output}
            </pre>
          )}
        </EventDetailGroup>
      )}
    </details>
  );
}

export function AgentTerminals({ events }: { events: SessionEventRow[] }) {
  const terminals = useMemo(() => collectAgentTerminals(events), [events]);
  return (
    <>
      {terminals.map((terminal) => (
        <TerminalView
          key={terminal.id}
          id={terminal.id}
          events={events.filter(
            (event) =>
              (event.type === 'terminal_created' ||
                event.type === 'terminal_output' ||
                event.type === 'terminal_exit') &&
              event.data.terminalId === terminal.id,
          )}
        />
      ))}
    </>
  );
}
