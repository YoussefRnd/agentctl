import { useSetupWizard } from '../hooks/useSetupWizard';
import { useDrivers } from '../../../hooks/useDrivers';
import { Sparkles } from 'lucide-react';

export function SetupWizard() {
	const { showWizard, markDone } = useSetupWizard();
	const { drivers, activate, toggleDriver, isLoadingDrivers } = useDrivers(null);
	const enabledDrivers = drivers.filter((driver) => driver.enabled);
	const defaultDriverId = enabledDrivers[0]?.id ?? null;

	if (!showWizard) return null;

	return (
		<div className="bg-background/80 animate-fade-in-up fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
			<div className="bg-accent-glow pointer-events-none absolute top-1/2 left-1/2 h-[450px] w-[450px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[100px]" />

			{/* Compact card layout: max-w-md */}
			<div className="liquid-glass shadow-immersive-lg relative z-10 flex w-full max-w-md flex-col rounded-2xl border border-white/5 p-6">
				<div className="mb-5 text-center">
					<h1 className="font-display from-text-main to-text-muted bg-gradient-to-br bg-clip-text text-2xl font-bold text-transparent">
						Choose AI Drivers
					</h1>
					<p className="text-text-muted mt-1.5 text-xs">
						Enable the AI drivers you wish to work with. Local installations have been auto-detected.
					</p>
				</div>

				<div className="max-h-[300px] flex-1 space-y-2 overflow-y-auto py-2 pr-1">
					{isLoadingDrivers ? (
						<div className="animate-pulse space-y-2">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="bg-surface-tertiary border-border-main h-12 rounded-xl border"
								/>
							))}
						</div>
					) : (
						drivers.map((driver) => {
							const isActive = driver.enabled;
							return (
								<div
									key={driver.id}
									className="bg-surface-secondary/40 flex items-center justify-between rounded-xl border border-white/5 p-3 transition-colors hover:border-white/10"
								>
									<div className="flex min-w-0 items-center gap-3">
										<div className="bg-surface-tertiary relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 p-1">
											{driver.icon ? (
												<img
													src={driver.icon}
													alt={driver.label}
													className="h-full w-full object-contain"
												/>
											) : (
												<div className="from-accent/20 to-accent/5 absolute inset-0 flex items-center justify-center bg-gradient-to-br select-none">
													<span className="text-accent text-xs font-bold drop-shadow-sm">
														{driver.label.charAt(0)}
													</span>
												</div>
											)}
										</div>
										<div className="min-w-0">
											<div className="text-text-main truncate text-sm font-semibold">
												{driver.label}
											</div>
											<div className="text-text-muted mt-0.5 text-[10px]">
												{!driver.enabled && driver.status === 'ready' && (
													<span className="text-blue-400">Supported</span>
												)}
												{!driver.enabled && driver.status === 'needs_auth' && (
													<span className="text-amber-500/80">Supported</span>
												)}
												{driver.enabled && (
													driver.status === 'not_found' ? (
														<span className="text-red-400 font-semibold">Not Installed</span>
													) : driver.status === 'needs_auth' ? (
														<span className="text-amber-400 font-semibold">Needs Auth</span>
													) : (
														<span className="text-green-500 font-semibold">Active</span>
													)
												)}
												{!driver.enabled && driver.status !== 'ready' && driver.status !== 'needs_auth' && (
													driver.status === 'not_found' ? (
														<span className="text-red-400/60">Not Installed</span>
													) : (
														<span className="text-zinc-500">Inactive</span>
													)
												)}
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
										className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-accent' : 'bg-surface-tertiary border-white/5'}`}
									>
										<span
											className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isActive ? 'translate-x-4' : 'translate-x-0'}`}
										/>
									</button>
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
						className="text-accent inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
					>
						<Sparkles className="h-3 w-3" />
						Configure advanced credentials in Settings
					</a>
				</div>

				<div className="mt-6 flex justify-end gap-3 border-t border-white/5 pt-4">
					<button
						onClick={() => {
							void markDone(defaultDriverId);
						}}
						className="text-text-muted hover:text-text-main bg-surface-tertiary hover:bg-surface-hover rounded-lg border border-white/5 px-4 py-1.5 text-xs font-medium transition-colors"
					>
						Skip
					</button>
					<button
						onClick={() => {
							void markDone(defaultDriverId);
						}}
						className="from-accent to-accent-hover rounded-lg bg-gradient-to-r px-4 py-1.5 text-xs font-semibold text-white transition-all hover:shadow-[0_0_12px_var(--color-accent-glow)]"
					>
						Done
					</button>
				</div>
			</div>
		</div>
	);
}
