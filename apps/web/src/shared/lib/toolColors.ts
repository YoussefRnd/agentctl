interface ToolMeta {
  color: string;
  icon: string;
  dotColor: string;
  bgColor: string;
  borderColor: string;
}

const COMMAND_TOOLS = new Set([
  'bash',
  'terminal',
  'sh',
  'exec',
  'execute_command',
  'run_command',
  'command',
  'builtin_bash',
]);
const FILE_TOOLS = new Set([
  'read_file',
  'write_to_file',
  'replace_file_content',
  'view_file',
  'edit_file',
]);
const SEARCH_TOOLS = new Set([
  'grep_search',
  'find_by_name',
  'search_web',
  'read_url_content',
  'search',
  'grep',
]);
const DELETE_TOOLS = new Set(['delete_file', 'remove_file', 'delete']);

export function getToolMeta(kind?: string, name?: string): ToolMeta {
  const k = (kind ?? '').toLowerCase();
  const n = (name ?? '').toLowerCase();

  if (k === 'read' || k === 'edit' || k === 'move' || FILE_TOOLS.has(n)) {
    return {
      color: 'text-brand-green',
      icon: 'file',
      dotColor: 'bg-brand-green',
      bgColor: 'bg-brand-green/10',
      borderColor: 'border-brand-green/20',
    };
  }
  if (k === 'delete' || DELETE_TOOLS.has(n)) {
    return {
      color: 'text-rose-500',
      icon: 'trash',
      dotColor: 'bg-rose-500',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/20',
    };
  }
  if (k === 'search' || k === 'fetch' || SEARCH_TOOLS.has(n)) {
    return {
      color: 'text-brand-blue',
      icon: 'search',
      dotColor: 'bg-brand-blue',
      bgColor: 'bg-brand-blue/10',
      borderColor: 'border-brand-blue/20',
    };
  }
  if (k === 'execute' || COMMAND_TOOLS.has(n)) {
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
