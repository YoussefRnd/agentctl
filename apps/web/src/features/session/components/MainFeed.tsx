import { useState } from 'react';
import type { ACPEventRow } from '@agentctl/shared';
import { EventFeed } from './EventFeed';
import { CommandBar } from './CommandBar';
import { ApprovalCard } from './cards/ApprovalCard';
import { useSession } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useProviders } from '../../../hooks/useProviders';

export function MainFeed() {
	const {
		sessionId,
		sessionData,
		events,
		isLoadingEvents,
		isConnected,
		isLoadingSession,
	} = useSession();

	const { handleSend, handleApprove, handleDeny } = useSessionActions();
	const { switchProvider, isSwitching } = useProviders(sessionId);

	const handleProviderSelect = (providerId: string, modelId?: string) => {
		switchProvider(providerId, modelId, sessionData);
	};

	const lastEvent = events[events.length - 1] as ACPEventRow | undefined;

	const approvalEvent =
		lastEvent?.type === 'approval_request' &&
		(lastEvent.data as { status?: string }).status === 'pending'
			? lastEvent
			: undefined;

	const loadingMessages = [
		'SCANNING_HISTORY_VECTORS...',
		'RECONCILING_BRANCH_STATES...',
		'HYDRATING_SESSION_CONTEXT...',
		'ESTABLISHING_ACP_HANDSHAKE...',
		'MAPPING_WORKTREE_STRUCTURE...',
		'SYNCING_PROTOCOL_BUFFERS...',
	];

	const [loadingMsg] = useState(() => loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);

	if (!sessionId) {
		return (
			<div className="flex h-full flex-col bg-background p-8 items-center justify-center text-center">
				<div className="max-w-md w-full space-y-8 animate-in fade-in zoom-in duration-1000">
					<div className="space-y-4">
						<div className="inline-block px-4 py-1 rounded-full border border-white/5 bg-white/5 text-[10px] font-black uppercase tracking-[0.3em] text-accent/60">
							System_Standby
						</div>
						<h1 className="text-text-main text-5xl font-black uppercase tracking-tight leading-none">
							Select_A_Workspace
						</h1>
						<p className="text-text-muted/40 text-[11px] font-bold uppercase tracking-widest leading-relaxed">
							Choose a project from the sidebar to initialize a new secure agent session.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="relative flex h-full flex-col bg-background overflow-hidden">
			{/* Refined Grid Background */}
			<div className="absolute inset-0 z-0">
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(203,166,247,0.08),transparent_70%)]" />
				<div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />
			</div>

			<div className="relative z-10 flex h-full flex-col min-w-0">
				{/* Transparent Header */}
				<header className="flex h-16 shrink-0 items-center justify-between px-8 border-b border-white/5 bg-background/40 backdrop-blur-md">
					<div className="flex items-center gap-6">
						<div className="flex items-center gap-3">
							<div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
							<span className="text-[12px] font-black uppercase tracking-widest text-text-main">
								{sessionData?.session.taskSlug}
							</span>
						</div>
						<div className="h-4 w-px bg-white/5" />
						<div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/5">
							<span className="text-[10px] font-black uppercase tracking-tighter text-text-muted/60">Branch::</span>
							<span className="text-[10px] font-black uppercase tracking-tighter text-text-main">{sessionData?.session.branch}</span>
						</div>
					</div>
					
					<div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-text-muted/30">
						<span>SESSION_ID: {sessionId.slice(0, 8)}</span>
					</div>
				</header>

				<main className="flex min-h-0 flex-1 flex-col relative">
					{isLoadingEvents ? (
						<div className="flex h-full flex-col items-center justify-center gap-4 font-mono">
							<div className="h-px w-24 bg-gradient-to-r from-transparent via-accent/40 to-transparent animate-pulse" />
							<div className="text-[11px] font-black uppercase tracking-[0.3em] text-accent/60 animate-pulse">
								{loadingMsg}
							</div>
							<div className="h-px w-24 bg-gradient-to-r from-transparent via-accent/40 to-transparent animate-pulse" />
						</div>
					) : (
						<EventFeed events={events} />
					)}
				</main>

				{/* Floating Footer Overlay */}
				<footer className="shrink-0 pointer-events-none">
					{approvalEvent && (
						<div className="mx-auto max-w-[800px] px-6 pb-6 pointer-events-auto">
							<div className="animate-in slide-in-from-bottom-4 duration-500">
								<ApprovalCard
									eventId={approvalEvent.id}
									data={approvalEvent.data}
									onApprove={handleApprove}
									onDeny={handleDeny}
								/>
							</div>
						</div>
					)}

					<div className="pointer-events-auto">
						<CommandBar
							onSend={handleSend}
							disabled={!isConnected || isSwitching || isLoadingSession}
							selectedProviderId={sessionData?.session.selectedProvider}
							selectedModelId={sessionData?.session.selectedModel}
							onProviderSelect={handleProviderSelect}
						/>
					</div>
				</footer>
			</div>
		</div>
	);
}
