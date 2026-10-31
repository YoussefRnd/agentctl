import { Terminal } from 'lucide-react';
import { AgentIcon } from './AgentIcon';
import type { ProviderDiscovery } from '@agentctl/shared';

interface ProviderIconProps {
  provider: ProviderDiscovery;
  size?: 'sm' | 'md' | 'lg';
  showFallbackIcon?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { container: 'h-7 w-7 p-1', img: 'h-4 w-4', icon: 'h-3.5 w-3.5' },
  md: { container: 'h-9 w-9 p-1.5', img: 'h-5 w-5', icon: 'h-4 w-4' },
  lg: { container: 'h-10 w-10 p-2', img: 'h-6 w-6', icon: 'h-5 w-5' },
};

export function getProviderIconUrl(
  provider: Pick<ProviderDiscovery, 'icon' | 'agent'>,
): string | undefined {
  return provider.agent?.icon || provider.icon;
}

export function ProviderIcon({
  provider,
  size = 'md',
  showFallbackIcon = true,
  className = '',
}: ProviderIconProps) {
  const s = sizeMap[size];
  const iconUrl = getProviderIconUrl(provider);

  if (iconUrl) {
    return (
      <div
        className={`border-border/30 bg-surface-secondary/40 flex items-center justify-center rounded-lg border transition-colors ${s.container} ${className}`}
      >
        <img src={iconUrl} alt="" className={`object-contain ${s.img}`} />
      </div>
    );
  }

  return (
    <div
      className={`border-border/30 bg-surface-secondary/40 flex items-center justify-center rounded-lg border transition-colors ${s.container} ${className}`}
    >
      {showFallbackIcon && <AgentIcon className={`text-text-main ${s.icon}`} />}
    </div>
  );
}

interface ProviderIconUrlProps {
  url: string | null;
  fallback?: 'agent' | 'terminal' | 'bot' | 'sparkles';
  className?: string;
}

export function ProviderIconUrl({ url, fallback = 'agent', className }: ProviderIconUrlProps) {
  if (url) {
    return <img src={url} alt="" className={`h-5 w-5 object-contain ${className ?? ''}`} />;
  }

  if (fallback === 'terminal') {
    return <Terminal className={`h-4 w-4 ${className ?? ''}`} />;
  }

  return <AgentIcon className={`h-4 w-4 ${className ?? ''}`} />;
}
