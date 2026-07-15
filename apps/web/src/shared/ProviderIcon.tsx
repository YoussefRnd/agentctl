import { Bot, Terminal, Sparkles } from 'lucide-react';
import type { ProviderDiscovery } from '@agentctl/shared';

interface ProviderIconProps {
  provider: ProviderDiscovery;
  size?: 'sm' | 'md' | 'lg';
  showFallbackIcon?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { container: 'h-7 w-7 p-1', img: 'h-4 w-4', icon: 'h-3.5 w-3.5', letter: 'text-xs' },
  md: { container: 'h-9 w-9 p-1.5', img: 'h-5 w-5', icon: 'h-4 w-4', letter: 'text-lg' },
  lg: { container: 'h-10 w-10 p-2', img: 'h-6 w-6', icon: 'h-5 w-5', letter: 'text-xl' },
};

export function ProviderIcon({ provider, size = 'md', showFallbackIcon = true, className = '' }: ProviderIconProps) {
  const s = sizeMap[size];

  if (provider.agent?.icon) {
    return (
      <div className={`border-border/30 bg-surface-secondary/40 flex items-center justify-center rounded-lg border transition-all ${s.container} ${className}`}>
        <img src={provider.agent.icon} alt="" className={`object-contain ${s.img}`} />
      </div>
    );
  }

  if (provider.id.includes('claude')) {
    return (
      <div className={`border-border/30 bg-surface-secondary/40 flex items-center justify-center rounded-lg border transition-all ${s.container} ${className}`}>
        <span className={`text-text-main font-bold ${s.letter}`}>C</span>
      </div>
    );
  }

  return (
    <div className={`border-border/30 bg-surface-secondary/40 flex items-center justify-center rounded-lg border transition-all ${s.container} ${className}`}>
      {showFallbackIcon && <Terminal className={`text-text-main ${s.icon}`} />}
    </div>
  );
}

interface ProviderIconUrlProps {
  url: string | null;
  fallback?: 'sparkles' | 'bot' | 'terminal';
  className?: string;
}

export function ProviderIconUrl({ url, fallback = 'sparkles', className }: ProviderIconUrlProps) {
  if (url) {
    return <img src={url} alt="" className={`h-5 w-5 object-contain ${className ?? ''}`} />;
  }

  const Icon = fallback === 'sparkles' ? Sparkles : fallback === 'bot' ? Bot : Terminal;
  return <Icon className={`h-4 w-4 ${className ?? ''}`} />;
}
