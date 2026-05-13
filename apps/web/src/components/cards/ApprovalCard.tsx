export function ApprovalCard({ 
  eventId, 
  data, 
  onApprove, 
  onDeny 
}: { 
  eventId: number; 
  data: { message?: string } | null; 
  onApprove: (eventId: number) => void; 
  onDeny: (eventId: number) => void; 
}) {
  return (
    <div className="p-4 bg-surface border-t-2 border-accent shadow-lg flex items-center justify-between gap-4 my-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex-1">
        <div className="text-sm font-bold text-accent mb-1">Approval Requested</div>
        <div className="text-xs text-text-muted">
          {data?.message ?? 'Agent needs permission to proceed.'}
        </div>
      </div>
      <div className="flex gap-2">
        <button 
          onClick={() => { onDeny(eventId); }}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors font-medium"
        >
          Deny
        </button>
        <button 
          onClick={() => { onApprove(eventId); }}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-background rounded text-sm transition-colors font-medium"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
