import { useState } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { PROVIDER_ENV_KEYS, validateApiKey } from '@agentctl/shared';
import { ChevronDown, Terminal, Eye } from 'lucide-react';

interface ProviderCardProps {
	provider: ProviderDiscovery;
	onActivate: (id: string) => void;
	onToggle: (id: string, enabled: boolean) => void;
	onResync: () => void;
	onUpdateConfig?: (id: string, customEnv: Record<string, string>) => void;
	isUpdatingConfig?: boolean;
}

export function ProviderCard({
	provider,
	onActivate,
	onToggle,
	onResync,
	onUpdateConfig,
	isUpdatingConfig,
}: ProviderCardProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
	const [customEnv, setCustomEnv] = useState<Record<string, string>>(() => {
		const state: Record<string, string> = {};
		for (const key of envKeys) {
			state[key] = provider.customEnv[key] ?? '';
		}
		return state;
	});

	const hasChanges = envKeys.some((key) => customEnv[key] !== (provider.customEnv[key] ?? ''));
	const hasInvalidKeys = envKeys.some((key) => validateApiKey(key, customEnv[key] ?? '') !== null);

	const handleSaveConfig = () => {
		if (onUpdateConfig) {
			onUpdateConfig(provider.id, customEnv);
		}
	};

	const getStatusBadge = () => {
		const baseStyles = "inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-sm";

		if (!provider.enabled) {
			return <span className={`${baseStyles} border-white/10 text-text-muted opacity-50`}>DISABLED</span>;
		}

		switch (provider.status) {
			case 'ready':
				return <span className={`${baseStyles} border-white/40 text-white bg-white/5`}>READY</span>;
			case 'needs_auth':
				return <span className={`${baseStyles} border-white/20 text-zinc-400`}>AUTH_REQ</span>;
			case 'not_found':
				return <span className={`${baseStyles} border-white/10 text-zinc-600`}>MISSING</span>;
			default:
				return <span className={`${baseStyles} border-white/10 text-zinc-600 uppercase`}>{provider.status}</span>;
		}
	};

	const isActive = provider.enabled;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		const nextEnabled = !provider.enabled;
		onToggle(provider.id, nextEnabled);

		if (nextEnabled) {
			if (provider.status === 'inactive') {
				onActivate(provider.id);
			} else if (provider.status === 'needs_auth') {
				setIsExpanded(true);
			} else if (provider.status === 'not_found') {
				setIsExpanded(true);
			}
		}
	};

	return (
		<div className="terminal-glass group overflow-hidden rounded-md transition-all duration-200">
			<div
				onClick={() => {
					setIsExpanded(!isExpanded);
				}}
				className="flex cursor-pointer items-center justify-between p-3 select-none"
			>
				<div className="flex min-w-0 items-center gap-3">
					<div className="bg-white/5 flex h-9 w-9 shrink-0 items-center justify-center border border-white/10 p-1.5 transition-all group-hover:bg-white/10 rounded-md">
						{provider.icon ? (
							<img src={provider.icon} alt="" className="h-5 w-5 object-contain" />
						) : provider.id.includes('claude') ? (
							<span className="text-white text-lg font-bold">C</span>
						) : (
							<Terminal className="text-white h-4 w-4" />
						)}
					</div>
					<div className="min-w-0">
						<h3 className="text-white flex items-center gap-3 text-[13px] font-black uppercase tracking-tighter">
							{provider.label}
							{getStatusBadge()}
						</h3>
						<p className="text-text-muted mt-0.5 max-w-md truncate text-[10px] font-bold uppercase tracking-tight opacity-50">
							{provider.description ?? 'NO_DESCRIPTION'}
						</p>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<div
						className="flex items-center"
						onClick={(e) => {
							e.stopPropagation();
						}}
					>
						<button
							role="switch"
							aria-checked={isActive}
							onClick={handleToggle}
							className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-md border transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-text-main border-text-main' : 'bg-background border-border/40'}`}
						>
							<span
								className={`pointer-events-none inline-block h-4 w-4 transform rounded-md transition duration-200 ease-in-out ${isActive ? 'translate-x-4 bg-background' : 'translate-x-0 bg-text-main/20'}`}
							/>
						</button>
					</div>

					<ChevronDown
						className={`text-text-muted h-3.5 w-3.5 transition-transform duration-300 ${isExpanded ? 'text-text-main rotate-180' : ''}`}
					/>
				</div>
			</div>

			{isExpanded && (
				<div className="animate-in fade-in slide-in-from-top-1 space-y-4 border-t border-border/30 p-3">
					<div className="space-y-1">
						<strong className="text-text-main text-[10px] font-black uppercase tracking-widest opacity-60">DESCRIPTION</strong>
						<p className="text-text-muted text-[11px] font-bold uppercase tracking-tight">{provider.description ?? 'NO_DESCRIPTION_AVAILABLE'}</p>
					</div>

					{provider.status === 'not_found' && (
						<div className="flex items-center justify-between border border-border/20 bg-surface-secondary/20 p-2 rounded-md">
							<span className="text-text-main text-[10px] font-bold uppercase">BINARY_NOT_DETECTED_IN_PATH</span>
							<button
								onClick={onResync}
								className="text-text-muted hover:text-text-main text-[10px] font-black uppercase transition-colors"
							>
								RE_SYNC
							</button>
						</div>
					)}

					<div className="space-y-1.5">
						<div className="text-text-main flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-60">
							<Terminal className="h-3 w-3" />
							LAUNCH_CONFIG
						</div>
						<div className="bg-background border border-border/20 p-2 font-mono text-[11px] text-text-muted rounded-md">
							<div>
								CMD: <span className="text-text-main">{provider.command}</span>
							</div>
							{provider.launchArgs.length > 0 && (
								<div className="mt-1">
									ARGS: <span className="text-text-main">{JSON.stringify(provider.launchArgs)}</span>
								</div>
							)}
						</div>
					</div>
					{envKeys.length > 0 && (
						<div className="space-y-3 border-t border-white/5 pt-3">
							<div className="text-white flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
								<Eye className="h-3 w-3" />
								CREDENTIALS
							</div>
							<div className="space-y-2">
								{envKeys.map((key) => {
									const errorMsg = validateApiKey(key, customEnv[key] ?? '');
									return (
										<div key={key} className="space-y-1">
											<div className="flex justify-between items-baseline">
												<label className="text-text-muted text-[9px] font-black uppercase tracking-widest">
													{key}
												</label>
												{errorMsg && (
													<span className="text-danger text-[9px] font-bold uppercase tracking-tight">
														{errorMsg}
													</span>
												)}
											</div>
											<input
												type="password"
												value={customEnv[key] ?? ''}
												onChange={(e) => { setCustomEnv({ ...customEnv, [key]: e.target.value }); }}
												className={`terminal-input w-full ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
											/>
										</div>
									);
								})}
								{hasChanges && (
									<div className="flex justify-end pt-1">
										<button
											onClick={handleSaveConfig}
											disabled={(isUpdatingConfig ?? false) || hasInvalidKeys}
											className="terminal-button"
										>
											{isUpdatingConfig ? 'SAVING...' : 'SAVE_CONFIG'}
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
