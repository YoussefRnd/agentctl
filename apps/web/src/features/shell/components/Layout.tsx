import { Link } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SettingsSidebar } from './SettingsSidebar';

interface LayoutProps {
	children: React.ReactNode;
	sidebarType?: 'projects' | 'settings' | 'none';
}

export function Layout({ children, sidebarType = 'none' }: LayoutProps) {

	// Determine breadcrumb/chip title
	let pageTitle = null;
	if (sidebarType === 'projects') {
		pageTitle = 'projects';
	} else if (sidebarType === 'settings') {
		pageTitle = 'settings';
	}

	return (
		<div className="bg-background text-text-main relative flex h-screen w-full overflow-hidden flex-col">
			{/* Light Leaks with Refraction */}
			<div 
				className="pointer-events-none absolute inset-0 overflow-hidden"
				style={{ filter: 'url(#liquid-distort)' }}
			>
				<div 
					className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full opacity-20 blur-[160px] animate-pulse"
					style={{ backgroundColor: 'var(--color-accent)', willChange: 'transform, filter' }} // Mauve
				/>
				<div 
					className="absolute top-[20%] -right-[5%] h-[50%] w-[50%] rounded-full opacity-10 blur-[180px]"
					style={{ backgroundColor: '#89b4fa', animation: 'pulse 8s infinite', willChange: 'transform, filter' }} // Blue (Catppuccin Blue #89b4fa)
				/>
				<div 
					className="absolute -bottom-[10%] left-[20%] h-[45%] w-[45%] rounded-full opacity-15 blur-[160px]"
					style={{ backgroundColor: 'var(--color-accent-secondary)', animation: 'pulse 12s infinite', willChange: 'transform, filter' }} // Lavender
				/>
			</div>

			{/* Unified Top Navbar */}
			<div className="z-40 border-b border-border/50 bg-background/50 backdrop-blur-xl relative">
				<div className="flex h-14 items-center gap-3 px-3">
					<div className="w-[240px] shrink-0 lg:flex hidden items-center">
						<Link to="/" className="text-text-main text-[12px] font-black uppercase tracking-[0.4em] font-sans hover:opacity-80 transition-opacity">
							AGENTCTL
						</Link>
					</div>
					<div className="lg:hidden flex shrink-0 items-center pl-2">
						<Link to="/" className="text-text-main text-[12px] font-black uppercase tracking-[0.4em] font-sans hover:opacity-80 transition-opacity">
							AGENTCTL
						</Link>
					</div>
					{pageTitle && (
						<div className="flex-1 flex min-w-0 h-full items-center">
							<div className="flex items-center gap-1.5 rounded-full border border-border/20 bg-surface/40 px-2.5 py-1">
								<span className="h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse" />
								<span className="text-text-muted font-bold text-[10px] tracking-[0.15em] uppercase">
									{pageTitle}
								</span>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Spaced desktop grid body */}
			<div className="flex-1 flex min-h-0 w-full overflow-hidden p-3 gap-3 relative z-10">
				{sidebarType === 'projects' && (
					<div className="z-20 hidden w-[240px] shrink-0 lg:block h-full">
						<div className="terminal-glass h-full rounded-3xl border border-border shadow-2xl overflow-hidden">
							<Sidebar />
						</div>
					</div>
				)}
				{sidebarType === 'settings' && (
					<div className="z-20 hidden w-[240px] shrink-0 lg:block h-full">
						<div className="terminal-glass h-full rounded-3xl border border-border shadow-2xl overflow-hidden">
							<SettingsSidebar />
						</div>
					</div>
				)}

				<main className="terminal-glass relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border shadow-2xl transition-all duration-500 ease-in-out rounded-3xl bg-surface/30">
					<div className="flex-grow overflow-hidden flex flex-col relative">
						{children}
					</div>
				</main>
			</div>

			{/* Liquid Refraction Filter */}
			<svg style={{ position: 'absolute', width: 0, height: 0 }}>
				<filter id="liquid-distort">
					<feTurbulence type="fractalNoise" baseFrequency="0.01" numOctaves="3" result="noise" />
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="10" />
				</filter>
			</svg>
		</div>
 );
}



