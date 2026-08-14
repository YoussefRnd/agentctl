interface ToolMeta {
  color: string;
  icon: string;
  dotColor: string;
  bgColor: string;
  borderColor: string;
}

export function getToolMeta(kind?: string, name?: string): ToolMeta {
  const k = kind ?? '';
  const n = name ?? '';

  if (
    k === 'read' ||
    k === 'edit' ||
    k === 'move' ||
    n.includes('file') ||
    n.includes('view') ||
    n.includes('read') ||
    n.includes('write')
  ) {
    return {
      color: 'text-brand-green',
      icon: 'file',
      dotColor: 'bg-brand-green',
      bgColor: 'bg-brand-green/10',
      borderColor: 'border-brand-green/20',
    };
  }
  if (k === 'delete' || n.includes('delete') || n.includes('remove') || n.includes('kill')) {
    return {
      color: 'text-rose-500',
      icon: 'trash',
      dotColor: 'bg-rose-500',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/20',
    };
  }
  if (k === 'search' || k === 'fetch' || n.includes('search') || n.includes('grep')) {
    return {
      color: 'text-brand-blue',
      icon: 'search',
      dotColor: 'bg-brand-blue',
      bgColor: 'bg-brand-blue/10',
      borderColor: 'border-brand-blue/20',
    };
  }
  if (k === 'execute' || n.includes('command') || n.includes('shell') || n.includes('run')) {
    return {
      color: 'text-brand-peach',
      icon: 'terminal',
      dotColor: 'bg-brand-peach',
      bgColor: 'bg-brand-peach/10',
      borderColor: 'border-brand-peach/20',
    };
  }
  if (k === 'think') {
    return {
      color: 'text-accent',
      icon: 'think',
      dotColor: 'bg-accent',
      bgColor: 'bg-accent/10',
      borderColor: 'border-accent/20',
    };
  }
  return {
    color: 'text-text-muted',
    icon: 'settings',
    dotColor: 'bg-text-muted/40',
    bgColor: 'bg-text-muted/10',
    borderColor: 'border-text-muted/20',
  };
}
