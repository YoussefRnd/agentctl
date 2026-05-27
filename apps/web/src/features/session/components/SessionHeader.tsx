import { Menu, PanelRight } from 'lucide-react';

interface SessionHeaderProps {
	sessionId: string;
	onOpenMobileSidebar: () => void;
	onToggleWorkbench: () => void;
	isWorkbenchOpen: boolean;
	sessionTitle?: string | null;
}

export function SessionHeader({
	sessionId,
	onOpenMobileSidebar,
	onToggleWorkbench,
	isWorkbenchOpen,
	sessionTitle,
}: SessionHeaderProps) {

	return (
		<div className="flex h-full w-full min-w-0 items-center justify-between">
			<div className="flex min-w-0 items-center gap-3">
				<button
					type="button"
					className="text-text-muted hover:text-accent -ml-1 p-1 transition-all lg:hidden hover:bg-accent/10 rounded"
					onClick={onOpenMobileSidebar}
					aria-label="Open Sidebar"
				>
					<Menu className="h-5 w-5" />
				</button>
				{/* Session chip */}
				<div className="flex items-center gap-1.5 rounded-full border border-border/20 bg-surface/40 px-2.5 py-1">
					<span className="h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse" />
					<span className="text-text-muted font-bold text-[10px] tracking-[0.15em] uppercase truncate max-w-[180px]">
						{sessionTitle ?? `session::${sessionId.slice(0, 8)}`}
					</span>
				</div>
			</div>

			{/* Workbench toggle — always visible in navbar */}
			<button
				type="button"
				onClick={onToggleWorkbench}
				aria-label="Toggle Inspector"
				title="Toggle Inspector (⌘\\)"
				className={`flex items-center justify-center rounded-md w-8 h-8 transition-all duration-300 border ${
					isWorkbenchOpen
						? 'border-accent/30 bg-accent/10 text-accent'
						: 'border-border/20 bg-surface/30 text-text-muted hover:text-text-main hover:border-border/40 hover:bg-surface/60'
				}`}
			>
				<PanelRight className="h-4 w-4" />
			</button>
		</div>
	);
}
