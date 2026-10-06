import { Card } from '@agentctl/ui';

export function TurnErrorCard({ message }: { message?: string }) {
  return (
    <div role="alert">
      <Card status="error" className="my-2 flex flex-col gap-2 p-5">
        <span className="text-[11px] font-bold tracking-wider text-rose-400 uppercase">
          Agent run failed
        </span>
        <p className="text-text-muted text-xs leading-relaxed [overflow-wrap:anywhere]">
          {message || 'The agent could not complete this turn.'}
        </p>
      </Card>
    </div>
  );
}
