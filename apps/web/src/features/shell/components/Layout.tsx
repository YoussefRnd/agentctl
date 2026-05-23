import { Sidebar } from './Sidebar';
import { SettingsSidebar } from './SettingsSidebar';

interface LayoutProps {
 children: React.ReactNode;
 sidebarType?: 'projects' | 'settings' | 'none';
}

export function Layout({ children, sidebarType = 'none' }: LayoutProps) {
 return (
  <div className="bg-background text-text-main relative flex h-screen w-full overflow-hidden">
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

   {sidebarType === 'projects' && <Sidebar />}
   {sidebarType === 'settings' && <SettingsSidebar />}
   <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
    {children}
   </main>

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



