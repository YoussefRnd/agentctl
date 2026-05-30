import { useState } from 'react';
import { useSetupWizard } from '../hooks/useSetupWizard';
import { useProviders } from '../../../hooks/useProviders';
import { PROVIDER_ENV_KEYS, validateApiKey } from '@agentctl/shared';
import { Bot, Terminal } from 'lucide-react';

export function SetupWizard() {
	const { showWizard, markDone } = useSetupWizard();
	const {
		providers,
		activate,
		toggleProvider,
		isLoadingProviders,
		updateProviderConfig,
		isUpdatingConfig,
	} = useProviders(null);
	const [localCustomEnvs, setLocalCustomEnvs] = useState<Record<string, Record<string, string> | undefined>>({});

	const hasAnyInvalidProvider = providers.some((provider) => {
		if (!provider.enabled) return false;
		const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
		return envKeys.some((key) => {
			const val = localCustomEnvs[provider.id]?.[key] ?? (provider.customEnv[key] || '');
			return validateApiKey(key, val) !== null;
		});
	});

	const enabledProviders = providers.filter((provider) => provider.enabled);
	const defaultProviderId = enabledProviders[0]?.id ?? null;

	if (!showWizard) return null;

	return (
		<div className="bg-background/80 fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
			<div className="terminal-glass relative z-10 flex w-full max-w-md flex-col rounded-3xl border p-4 shadow-2xl">
				<div className="mb-4 text-center">
					<h1 className="text-text-main text-xl font-black uppercase tracking-widest">
						INITIAL_SETUP::AI_PIPELINE
					</h1>
					<p className="text-text-muted mt-1 text-[10px] font-bold uppercase tracking-tight opacity-60">
						ENABLE_PROVIDERS_FOR_TASK_ORCHESTRATION.
					</p>
				</div>

				<div className="max-h-[320px] flex-1 space-y-1 overflow-y-auto py-1 pr-1">
					{isLoadingProviders ? (
						<div className="animate-pulse space-y-1">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="bg-surface-secondary/40 h-10 rounded-sm border border-border/20"
								/>
							))}
						</div>
					) : (
						providers.map((provider) => {
							const isActive = provider.enabled;
							const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
							const hasKeys = envKeys.length > 0;

							const keysValues = envKeys.reduce<Record<string, string>>((acc, key) => {
								acc[key] = localCustomEnvs[provider.id]?.[key] ?? (provider.customEnv[key] || '');
								return acc;
							}, {});

							const hasChanges = envKeys.some((key) => {
								const val = keysValues[key];
								return val !== (provider.customEnv[key] || '');
							});

							return (
								<div
									key={provider.id}
									className="bg-surface-secondary/20 flex flex-col gap-2 rounded-md border border-border/20 p-2 transition-colors hover:border-border/40"
								>
									<div className="flex items-center justify-between">
										<div className="flex min-w-0 items-center gap-2.5">
											<div className="bg-background flex h-7 w-7 shrink-0 items-center justify-center border border-border/20 p-1 rounded-md">
												{provider.icon ? (
													<img src={provider.icon} alt="" className="h-4 w-4 object-contain" />
												) : provider.id.includes('claude') ? (
													<span className="text-text-main text-xs font-bold">C</span>
												) : (
													<Bot className="text-text-main h-3.5 w-3.5" />
												)}
											</div>
											<div className="min-w-0">
												<div className="text-text-main truncate text-[11px] font-black uppercase tracking-tight">
													{provider.label}
												</div>
												<div className="text-text-muted mt-0.5 text-[8px] font-black uppercase tracking-widest opacity-40">
													{!provider.enabled ? 'SUPPORTED' : provider.status === 'ready' ? 'ACTIVE' : provider.status.replace('_', ' ')}
												</div>
											</div>
										</div>

										<button
											role="switch"
											aria-checked={isActive}
											onClick={() => {
												const nextEnabled = !provider.enabled;
												toggleProvider({ providerId: provider.id, enabled: nextEnabled });
												if (nextEnabled && provider.status === 'inactive') {
													activate(provider.id);
												}
											}}
											className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-md border transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-text-main border-text-main' : 'bg-background border-border/20'}`}
										>
											<span
												className={`pointer-events-none inline-block h-3 w-3 transform rounded-md transition duration-200 ease-in-out ${isActive ? 'translate-x-4 bg-background' : 'translate-x-0 bg-text-main/20'}`}
											/>
										</button>
									</div>
									{isActive && hasKeys && (
										<div className="space-y-2 border-t border-white/5 pt-2">
											<div className="space-y-1.5">
												{envKeys.map((key) => {
													const errorMsg = validateApiKey(key, keysValues[key]);
													return (
														<div key={key} className="space-y-1">
															<div className="flex justify-between items-baseline">
																<label className="text-text-muted text-[8px] font-black uppercase tracking-widest">
																	{key}
																</label>
																{errorMsg && (
																	<span className="text-danger text-[8px] font-bold uppercase tracking-tight">
																		{errorMsg}
																	</span>
																)}
															</div>
															<input
																type="password"
																value={keysValues[key]}
																onChange={(e) => {
																	setLocalCustomEnvs({
																		...localCustomEnvs,
																		[provider.id]: {
																			...(localCustomEnvs[provider.id] ?? {}),
																			[key]: e.target.value,
																		},
																	});
																}}
																className={`terminal-input w-full !h-6 !text-[10px] ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
															/>
														</div>
													);
												})}
												{hasChanges && (
													<div className="flex justify-end pt-1">
														<button
															onClick={() => {
																updateProviderConfig({
																	providerId: provider.id,
																	customEnv: keysValues,
																});
															}}
															disabled={isUpdatingConfig || envKeys.some(key => validateApiKey(key, keysValues[key]) !== null)}
															className="terminal-button !h-6 !px-2 text-[9px]"
														>
															{isUpdatingConfig ? 'CONNECTING...' : 'SAVE_CONFIG'}
														</button>
													</div>
												)}
											</div>
										</div>
									)}
								</div>
							);
						})
					)}
				</div>

				<div className="mt-4 text-center">
					<a
						href="/settings"
						onClick={(e) => {
							e.preventDefault();
							void markDone(defaultProviderId);
							window.location.href = '/settings';
						}}
						className="text-text-muted hover:text-white inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest transition-colors"
					>
						<Terminal className="h-3 w-3" />
						ADVANCED_CONFIGURATION
					</a>
				</div>

				<div className="mt-4 flex justify-end gap-2 border-t border-white/5 pt-3">
					<button
						onClick={() => {
							void markDone(defaultProviderId);
						}}
						className="text-text-muted hover:text-white px-3 py-1.5 text-[10px] font-black uppercase transition-colors"
					>
						SKIP
					</button>
					<button
						onClick={() => {
							void markDone(defaultProviderId);
						}}
						disabled={hasAnyInvalidProvider}
						className="terminal-button !h-8 !px-4 text-[11px]"
					>
						INITIALIZATION_COMPLETE
					</button>
				</div>
			</div>
		</div>
	);
}
