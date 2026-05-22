import { useState } from 'react';
import { useSetupWizard } from '../hooks/useSetupWizard';
import { useDrivers } from '../../../hooks/useDrivers';
import { DRIVER_ENV_KEYS } from '@agentctl/shared';
import { Bot, Terminal } from 'lucide-react';

export function SetupWizard() {
	const { showWizard, markDone } = useSetupWizard();
	const {
		drivers,
		activate,
		toggleDriver,
		isLoadingDrivers,
		updateDriverConfig,
		isUpdatingConfig,
	} = useDrivers(null);
	const [localCustomEnvs, setLocalCustomEnvs] = useState<Record<string, Record<string, string> | undefined>>({});

	const enabledDrivers = drivers.filter((driver) => driver.enabled);
	const defaultDriverId = enabledDrivers[0]?.id ?? null;

	if (!showWizard) return null;

	return (
		<div className="bg-black/60 fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
			<div className="terminal-glass relative z-10 flex w-full max-w-md flex-col rounded-sm border p-4 shadow-2xl">
				<div className="mb-4 text-center">
					<h1 className="text-white text-xl font-black uppercase tracking-widest">
						INITIAL_SETUP::AI_PIPELINE
					</h1>
					<p className="text-text-muted mt-1 text-[10px] font-bold uppercase tracking-tight opacity-60">
						ENABLE_DRIVERS_FOR_TASK_ORCHESTRATION.
					</p>
				</div>

				<div className="max-h-[320px] flex-1 space-y-1 overflow-y-auto py-1 pr-1">
					{isLoadingDrivers ? (
						<div className="animate-pulse space-y-1">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="bg-white/5 h-10 rounded-sm border border-white/5"
								/>
							))}
						</div>
					) : (
						drivers.map((driver) => {
							const isActive = driver.enabled;
							const envKeys = DRIVER_ENV_KEYS[driver.id] ?? [];
							const hasKeys = envKeys.length > 0;

							const keysValues = envKeys.reduce<Record<string, string>>((acc, key) => {
								acc[key] = localCustomEnvs[driver.id]?.[key] ?? (driver.customEnv[key] || '');
								return acc;
							}, {});

							const hasChanges = envKeys.some((key) => {
								const val = keysValues[key];
								return val !== (driver.customEnv[key] || '');
							});

							return (
								<div
									key={driver.id}
									className="bg-white/5 flex flex-col gap-2 rounded-sm border border-white/5 p-2 transition-colors hover:border-white/10"
								>
									<div className="flex items-center justify-between">
										<div className="flex min-w-0 items-center gap-2.5">
											<div className="bg-black flex h-7 w-7 shrink-0 items-center justify-center border border-white/10 p-1">
												{driver.icon ? (
													<img src={driver.icon} alt="" className="h-4 w-4 object-contain" />
												) : driver.id.includes('claude') ? (
													<span className="text-white text-xs font-bold">C</span>
												) : (
													<Bot className="text-white h-3.5 w-3.5" />
												)}
											</div>
											<div className="min-w-0">
												<div className="text-white truncate text-[11px] font-black uppercase tracking-tight">
													{driver.label}
												</div>
												<div className="text-text-muted mt-0.5 text-[8px] font-black uppercase tracking-widest opacity-40">
													{!driver.enabled ? 'SUPPORTED' : driver.status === 'ready' ? 'ACTIVE' : driver.status.replace('_', ' ')}
												</div>
											</div>
										</div>

										<button
											role="switch"
											aria-checked={isActive}
											onClick={() => {
												const nextEnabled = !driver.enabled;
												toggleDriver({ driverId: driver.id, enabled: nextEnabled });
												if (nextEnabled && driver.status === 'inactive') {
													activate(driver.id);
												}
											}}
											className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-sm border transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-white border-white' : 'bg-black border-white/10'}`}
										>
											<span
												className={`pointer-events-none inline-block h-3 w-3 transform rounded-sm transition duration-200 ease-in-out ${isActive ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white/20'}`}
											/>
										</button>
									</div>

									{isActive && hasKeys && (
										<div className="space-y-2 border-t border-white/5 pt-2">
											<div className="space-y-1.5">
												{envKeys.map((key) => (
													<div key={key} className="space-y-1">
														<label className="text-text-muted text-[8px] font-black uppercase tracking-widest">
															{key}
														</label>
														<input
															type="password"
															value={keysValues[key]}
															onChange={(e) => {
																setLocalCustomEnvs({
																	...localCustomEnvs,
																	[driver.id]: {
																		...(localCustomEnvs[driver.id] ?? {}),
																		[key]: e.target.value,
																	},
																});
															}}
															className="terminal-input w-full !h-6 !text-[10px]"
														/>
													</div>
												))}
												{hasChanges && (
													<div className="flex justify-end pt-1">
														<button
															onClick={() => {
																updateDriverConfig({
																	driverId: driver.id,
																	customEnv: keysValues,
																});
															}}
															disabled={isUpdatingConfig}
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
							void markDone(defaultDriverId);
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
							void markDone(defaultDriverId);
						}}
						className="text-text-muted hover:text-white px-3 py-1.5 text-[10px] font-black uppercase transition-colors"
					>
						SKIP
					</button>
					<button
						onClick={() => {
							void markDone(defaultDriverId);
						}}
						className="terminal-button !h-8 !px-4 text-[11px]"
					>
						INITIALIZATION_COMPLETE
					</button>
				</div>
			</div>
		</div>
	);
}
