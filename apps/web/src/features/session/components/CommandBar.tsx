import { useState, useRef, useEffect } from 'react';
import { Send, ChevronUp, Zap, Paperclip } from 'lucide-react';
import { ProviderPicker } from './ProviderPicker';
import { useProviders } from '../../../hooks/useProviders';
import { useSession } from '../../../contexts/SessionContext';

interface ControlBarProps {
	onSend: (val: string) => void;
	disabled?: boolean;
	selectedProviderId?: string | null;
	selectedModelId?: string | null;
	onProviderSelect?: (id: string, modelId?: string) => void;
	placeholder?: string;
}

import { MagicBar } from './MagicBar';

export function CommandBar({
	onSend,
	disabled,
	selectedProviderId: propSelectedProviderId,
	selectedModelId: propSelectedModelId,
	onProviderSelect,
	placeholder = 'Ask for follow-up changes or attach images',
}: ControlBarProps) {
	const {
		sessionId,
		reviewData,
		sessionData,
		branches,
		switchBranch,
		isSwitchingBranch,
		switchMode,
		isSwitchingMode,
	} = useSession();
	const { providers, isLoadingProviders } = useProviders(sessionId);
	const [input, setInput] = useState('');
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const [internalSelectedProviderId, setInternalSelectedProviderId] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const selectedId = propSelectedProviderId ?? internalSelectedProviderId;

	const firstId = providers[0]?.id ?? null;
	const resolvedId = selectedId ?? firstId;
	const activeProvider = providers.find((p) => p.id === resolvedId);
	const selectedProviderLabel =
		activeProvider !== undefined ? activeProvider.label : 'Select provider';

	const handleSubmit = () => {
		if (input.trim() && !disabled) {
			onSend(input);
			setInput('');
		}
	};

	const handleProviderSelect = (id: string, modelId?: string) => {
		if (onProviderSelect) {
			onProviderSelect(id, modelId);
		} else {
			setInternalSelectedProviderId(id);
		}
		setIsPickerOpen(false);
	};

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto';
			textareaRef.current.style.height = `${String(textareaRef.current.scrollHeight)}px`;
		}
	}, [input]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isPickerOpen) {
				setIsPickerOpen(false);
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [isPickerOpen]);

	return (
		<div className="relative z-40 w-full px-6 pb-12">
			<div className="relative max-w-[1000px] mx-auto">
				<ProviderPicker
					sessionId={sessionId}
					isOpen={isPickerOpen}
					onClose={() => {
						setIsPickerOpen(false);
					}}
					providers={providers}
					selectedId={resolvedId}
					selectedModelId={propSelectedModelId ?? null}
					onSelect={handleProviderSelect}
				/>

				<form
					className="w-full"
					aria-label="Command interface"
					onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
				>
					<div
						className={`glass-card flex flex-col rounded-[32px] border border-border/30 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] transition-all duration-500 bg-surface/60 backdrop-blur-3xl overflow-hidden ${disabled ? 'opacity-30' : ''}`}
					>
						<div className="w-full p-5 pb-2">
							<textarea
								ref={textareaRef}
								rows={1}
								value={input}
								onChange={(e) => {
									setInput(e.target.value);
								}}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										handleSubmit();
									}
								}}
								placeholder={disabled ? 'PROCESSING...' : placeholder}
								aria-label="Command input"
								className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main max-h-60 w-full resize-none border-none bg-transparent p-0 text-[15px] leading-relaxed focus:ring-0 text-text-main font-sans"
								style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
								disabled={disabled}
							/>
						</div>

						<div className="flex items-center justify-between px-4 py-3">
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => {
										setIsPickerOpen(!isPickerOpen);
									}}
									aria-label="Select AI provider"
									aria-expanded={isPickerOpen}
									className={`flex items-center gap-2 rounded-full px-3 h-10 transition-all duration-300 border border-transparent ${isPickerOpen ? 'bg-accent/20 text-accent border-accent/30' : 'hover:bg-text-main/5 text-text-muted hover:text-text-main'}`}
								>
									{activeProvider?.icon ? (
										<img src={activeProvider.icon} alt="" className="h-4 w-4 object-contain" />
									) : (
										<Zap className={`h-4 w-4 ${isPickerOpen ? 'fill-accent' : 'fill-none'}`} />
									)}
									<span className="max-w-[120px] truncate text-[12px] font-bold uppercase tracking-tight">
										{isLoadingProviders ? '...' : (propSelectedModelId ?? selectedProviderLabel)}
									</span>
									<ChevronUp
										className={`h-4 w-4 transition-transform duration-500 ${isPickerOpen ? 'rotate-180' : ''}`}
									/>
								</button>

								<div className="h-4 w-px bg-border/20 mx-1" />

								<MagicBar
									files={reviewData.files}
									onAction={(action) => {
										onSend(action);
									}}
								/>

								<button
									type="button"
									className="text-text-muted hover:text-accent transition-all px-3 h-10 flex items-center gap-2 hover:bg-accent/10 rounded-full"
									title="Attach file"
									aria-label="Attach file"
								>
									<Paperclip className="h-4 w-4" />
									<span className="text-[11px] font-bold uppercase tracking-tight">Files</span>
								</button>
							</div>

							<button
								type="submit"
								onClick={handleSubmit}
								aria-label="Execute command"
								className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${input.trim() && !disabled ? 'bg-accent text-background shadow-[0_0_20px_rgba(203,166,247,0.4)] hover:scale-105 active:scale-95' : 'bg-surface-quaternary text-text-muted/40 cursor-not-allowed'}`}
								disabled={!input.trim() || disabled}
							>
								<Send className="h-4 w-4" />
							</button>
						</div>
					</div>
				</form>
				{sessionData?.session && (
					<div className="mt-4 flex items-center justify-between px-4 text-[10px] font-bold uppercase tracking-widest text-text-muted/40">
						<div className="flex items-center gap-4">
							<button
								type="button"
								disabled={isSwitchingMode}
								onClick={() => { void switchMode('local'); }}
								className={`transition-all duration-300 ${sessionData.session.mode === 'local' ? 'text-text-main font-black' : 'opacity-40 hover:opacity-100 hover:text-text-main cursor-pointer'}`}
							>
								Local
							</button>
							<button
								type="button"
								disabled={isSwitchingMode || (branches.length === 0 && sessionData.session.mode !== 'worktree')}
								onClick={() => { void switchMode('worktree'); }}
								className={`transition-all duration-300 ${sessionData.session.mode === 'worktree' ? 'text-text-main font-black' : 'opacity-40 hover:opacity-100 hover:text-text-main cursor-pointer'} ${(branches.length === 0 && sessionData.session.mode !== 'worktree') ? 'hidden' : ''}`}
							>
								Worktree
							</button>
						</div>

						<div className="flex items-center gap-1.5 text-text-muted/60 hover:text-text-main transition-colors">
							<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
								<line x1="6" y1="3" x2="6" y2="15"></line>
								<circle cx="18" cy="6" r="3"></circle>
								<circle cx="6" cy="18" r="3"></circle>
								<path d="M18 9a9 9 0 0 1-9 9"></path>
							</svg>
							<div className="relative inline-flex items-center">
								<select
									value={sessionData.session.branch}
									disabled={isSwitchingBranch}
									onChange={(e) => { void switchBranch(e.target.value); }}
									className="appearance-none bg-transparent pr-5 text-[10px] font-bold uppercase tracking-widest text-text-muted/80 hover:text-text-main focus:outline-none cursor-pointer transition-all disabled:opacity-50 border-none p-0"
								>
									{branches.map((b) => (
										<option key={b} value={b} className="bg-background text-text-main uppercase">
											{b}
										</option>
									))}
									{branches.length === 0 || !branches.includes(sessionData.session.branch) ? (
										<option value={sessionData.session.branch} className="bg-background text-text-main uppercase">
											{sessionData.session.branch}
										</option>
									) : null}
								</select>
								<div className="pointer-events-none absolute right-0 flex items-center text-text-muted/50">
									<svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
										<path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
									</svg>
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
