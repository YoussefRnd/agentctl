import { Check } from 'lucide-react';

export function ReviewCleanState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center opacity-40">
      <div className="bg-success/10 border-success/20 ring-success/5 mb-4 flex h-12 w-12 items-center justify-center rounded-full border p-3 ring-4">
        <Check className="text-success h-6 w-6" />
      </div>
      <div className="text-text-muted text-[10px] font-black tracking-[0.3em] uppercase">
        Worktree Clean
      </div>
      <p className="text-text-muted/60 mt-2 text-[9px] font-bold tracking-widest uppercase">
        No modifications detected
      </p>
    </div>
  );
}
