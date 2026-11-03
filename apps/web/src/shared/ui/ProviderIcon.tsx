import type { ReactNode } from 'react';
import { useState } from 'react';
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

function ProviderIconFrame({
  size,
  className,
  children,
}: {
  size: NonNullable<ProviderIconProps['size']>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`border-border/30 bg-surface-secondary/40 flex items-center justify-center rounded-lg border transition-colors ${sizeMap[size].container} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export function ProviderIcon({
  provider,
  size = 'md',
  showFallbackIcon = true,
  className = '',
}: ProviderIconProps) {
  const iconUrl = getProviderIconUrl(provider);
  const sizing = sizeMap[size];
  return (
    <ProviderIconFrame size={size} className={className}>
      {iconUrl ? (
        <img src={iconUrl} alt="" className={`object-contain ${sizing.img}`} />
      ) : (
        showFallbackIcon && <AgentIcon className={`text-text-main ${sizing.icon}`} />
      )}
    </ProviderIconFrame>
  );
}

interface ProviderIconUrlProps {
  url: string | null;
  size?: 'inline' | 'compact';
  fallback?: 'agent' | 'terminal' | 'bot' | 'sparkles';
  className?: string;
}

export function ProviderIconUrl({
  url,
  size,
  fallback = 'agent',
  className,
}: ProviderIconUrlProps) {
  const sizeClass =
    size === 'inline' ? 'icon-inline' : size === 'compact' ? 'icon-compact' : undefined;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setFailedUrl(url)}
        className={`${sizeClass ?? 'h-5 w-5'} object-contain ${className ?? ''}`}
      />
    );
  }

  if (fallback === 'terminal') {
    return <Terminal className={`${sizeClass ?? 'h-4 w-4'} ${className ?? ''}`} />;
  }

  return <AgentIcon className={`${sizeClass ?? 'h-4 w-4'} ${className ?? ''}`} />;
}
