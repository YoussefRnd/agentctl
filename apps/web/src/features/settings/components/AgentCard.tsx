import { useState } from 'react';
import type { DriverDiscovery } from '@agentctl/shared';
import { DRIVER_ENV_KEYS } from '@agentctl/shared';
import { ChevronDown, RefreshCw, Terminal, Eye, EyeOff } from 'lucide-react';

interface AgentCardProps {
	driver: DriverDiscovery;
	onActivate: (id: string) => void;
	onToggle: (id: string, enabled: boolean) => void;
	onResync: () => void;
	onUpdateConfig?: (id: string, customEnv: Record<string, string>) => void;
	isUpdatingConfig?: boolean;
}

export function AgentCard({
	driver,
	onActivate,
	onToggle,
	onResync,
	onUpdateConfig,
	isUpdatingConfig,
}: AgentCardProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const [showInstructions, setShowInstructions] = useState(false);

	const envKeys = DRIVER_ENV_KEYS[driver.id] ?? [];
	const [customEnv, setCustomEnv] = useState<Record<string, string>>(() => {
		const state: Record<string, string> = {};
		for (const key of envKeys) {
			state[key] = driver.customEnv[key] || '';
		}
		return state;
	});

	const hasChanges = envKeys.some((key) => customEnv[key] !== (driver.customEnv[key] || ''));

	const handleSaveConfig = () => {
		if (onUpdateConfig) {
			onUpdateConfig(driver.id, customEnv);
		}
	};

	const getStatusBadge = () => {
		if (!driver.enabled) {
			if (driver.status === 'ready') {
				return (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-400 ring-1 ring-blue-500/20 ring-inset">
						Available
					</span>
				);
			}
			if (driver.status === 'needs_auth') {
				return (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-500/80 ring-1 ring-amber-500/20 ring-inset">
						Supported
					</span>
				);
			}
		}

		switch (driver.status) {
			case 'ready':
				return (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-500 shadow-[0_0_8px_rgba(16,185,129,0.2)] ring-1 ring-green-500/20 ring-inset">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
						Active
					</span>
				);
			case 'needs_auth':
				return (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-500 ring-1 ring-amber-500/20 ring-inset">
						<span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
						Needs Auth
					</span>
				);
			case 'not_found':
				return (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-400 ring-1 ring-red-500/20 ring-inset">
						<span className="h-1.5 w-1.5 rounded-full bg-red-500" />
						Not Installed
					</span>
				);
			case 'inactive':
				return (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs font-semibold text-zinc-400 ring-1 ring-zinc-500/20 ring-inset">
						<span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
						Inactive
					</span>
				);
			default:
				return null;
		}
	};

	const isActive = driver.enabled;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		const nextEnabled = !driver.enabled;
		onToggle(driver.id, nextEnabled);

		if (nextEnabled) {
			if (driver.status === 'inactive') {
				onActivate(driver.id);
			} else if (driver.status === 'needs_auth') {
				setIsExpanded(true);
				setShowInstructions(true);
			} else if (driver.status === 'not_found') {
				setIsExpanded(true);
			}
		}
	};

	return (
		<div className="bg-surface-secondary/80 hover:shadow-immersive-lg group overflow-hidden rounded-xl border border-white/5 backdrop-blur-lg transition-all duration-300 hover:border-white/10">
			{/* Accordion Header Row */}
			<div
				onClick={() => {
					setIsExpanded(!isExpanded);
				}}
				className="flex cursor-pointer items-center justify-between p-5 select-none"
			>
				<div className="flex min-w-0 items-center gap-4">
					<div className="bg-surface-tertiary relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 p-2 shadow-sm transition-shadow group-hover:shadow-[0_0_12px_var(--color-accent-glow)]">
						{driver.icon ? (
							<img src={driver.icon} alt={driver.label} className="h-full w-full object-contain" />
						) : (
							<div className="from-accent/20 to-accent/5 absolute inset-0 flex items-center justify-center bg-linear-to-br select-none">
								<span className="text-accent text-lg font-bold drop-shadow-sm">
									{driver.label.charAt(0)}
								</span>
							</div>
						)}
					</div>
					<div className="min-w-0">
						<h3 className="text-text-main flex items-center gap-3 text-base font-semibold">
							{driver.label}
							{getStatusBadge()}
						</h3>
						<p className="text-text-muted mt-0.5 max-w-md truncate text-xs">
							{driver.description ?? 'No description available.'}
						</p>
					</div>
				</div>

				<div className="flex items-center gap-4">
					{/* ON / OFF Switch */}
					<div
						className="flex items-center gap-2"
						onClick={(e) => {
							e.stopPropagation();
						}}
					>
						<button
							role="switch"
							aria-checked={isActive}
							onClick={handleToggle}
							className={`focus:ring-accent relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-1 focus:outline-none ${isActive ? 'bg-accent' : 'bg-surface-tertiary border-white/5'}`}
						>
							<span
								className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isActive ? 'translate-x-5' : 'translate-x-0'}`}
							/>
						</button>
					</div>

					{/* Accordion Chevron */}
					<ChevronDown
						className={`text-text-muted h-4 w-4 transition-transform duration-300 ${isExpanded ? 'text-text-main rotate-180' : ''}`}
					/>
				</div>
			</div>

			{/* Accordion Expandable Body */}
			{isExpanded && (
				<div className="bg-background/25 animate-fade-in-up space-y-4 border-t border-white/5 px-5 py-4">
					<div className="text-text-muted space-y-1 text-sm">
						<strong className="text-text-main">Description</strong>
						<p>{driver.description ?? 'No description available for this AI agent.'}</p>
					</div>

					{driver.status === 'not_found' && (
						<div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-red-500/5 p-3 text-xs">
							<span className="text-red-400">
								Not detected locally. Ensure the agent binary is available in your PATH.
							</span>
							<button
								onClick={onResync}
								className="bg-surface text-text-main hover:bg-surface-hover flex items-center gap-1.5 rounded border border-white/5 px-3 py-1.5 transition-colors hover:border-white/10"
							>
								<RefreshCw className="h-3.5 w-3.5" />
								Re-check
							</button>
						</div>
					)}

					{/* Config & Launch Info */}
					<div className="space-y-2">
						<div className="text-text-main flex items-center gap-2 text-xs font-semibold">
							<Terminal className="h-3.5 w-3.5" />
							Launch Configuration
						</div>
						<div className="bg-surface/50 text-text-muted space-y-1.5 rounded-lg border border-white/5 p-3 font-mono text-[11px]">
							<div>
								Command: <span className="text-text-main">{driver.command}</span>
							</div>
							{driver.launchArgs.length > 0 && (
								<div>
									Default Args:{' '}
									<span className="text-text-main">{JSON.stringify(driver.launchArgs)}</span>
								</div>
							)}
						</div>
					</div>

					{/* Credentials / Auth Instructions */}
					{driver.authMethods.length > 0 && (
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<button
									onClick={() => {
										setShowInstructions(!showInstructions);
									}}
									className="text-accent flex items-center gap-1 text-xs font-semibold hover:underline"
								>
									{showInstructions ? (
										<>
											<EyeOff className="h-3.5 w-3.5" />
											Hide credentials setup
										</>
									) : (
										<>
											<Eye className="h-3.5 w-3.5" />
											Show credentials setup
										</>
									)}
								</button>
							</div>

							{showInstructions && (
								<div className="bg-surface-tertiary text-text-muted animate-fade-in-up space-y-3 rounded-xl border border-white/5 p-4 text-xs">
									<p>
										Setup the required environment variables in your environment before starting the
										server:
									</p>
									{driver.authMethods.map((method) => (
										<div key={method.id} className="border-accent/50 space-y-1 border-l-2 pl-3">
											<strong className="text-text-main">{method.name}</strong>
											<p>{method.description}</p>
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* Credentials & API Keys Input Form */}
					{envKeys.length > 0 && (
						<div className="space-y-3 border-t border-white/5 pt-4">
							<div className="text-text-main flex items-center gap-2 text-xs font-semibold">
								<Eye className="h-3.5 w-3.5" />
								Credentials & API Keys
							</div>
							<div className="space-y-3">
								{envKeys.map((key) => (
									<div key={key} className="space-y-1.5">
										<label className="text-text-muted text-[11px] font-medium uppercase tracking-wider">
											{key}
										</label>
										<input
											type="password"
											value={customEnv[key] || ''}
											onChange={(e) => { setCustomEnv({ ...customEnv, [key]: e.target.value }); }}
											placeholder={`Enter your ${key}`}
											className="bg-surface/50 border-white/5 focus:border-accent/40 w-full rounded-lg border px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-0"
										/>
									</div>
								))}
								{hasChanges && (
									<div className="flex justify-end pt-1">
										<button
											onClick={handleSaveConfig}
											disabled={isUpdatingConfig}
											className="bg-accent hover:bg-accent-hover flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
										>
											{isUpdatingConfig ? (
												<>
													<RefreshCw className="h-3.5 w-3.5 animate-spin" />
													Saving & Connecting...
												</>
											) : (
												'Save & Connect'
											)}
										</button>
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
